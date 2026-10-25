import { z } from "zod";
import { AI_DOMAIN, DEFAULT_RULES, contractOfJob, detectSeniority, masteryRequired, normalizeContract, parseExperienceYears, productionRequired, trainingOffered } from "@job-radar/scoring";
import { extractSkills, getSkill, normalizeText, resolveSkill } from "@job-radar/skills";
import { toFields } from "./job-reading";
import type { OllamaClient } from "./ollama";

/**
 * Changer ce numéro quand la consigne change : les avis déjà donnés ne comptent plus, et l'IA refait d'elle-même
 * les offres au-dessus du seuil « Analyse IA à partir de » (30 par collecte) ; les autres avec « Relancer »
 * (cf. analysisFitsJob dans l'API).
 * Pas changé pour contrat / salaire / adresse (2026-10-19) : les anciens avis restent bons, ils n'ont juste pas ces infos.
 * 2026-10-21 : technos « à apprendre » (formation proposée, poste junior, liste du candidat) jamais une raison de « faible ».
 * Pas changé pour la note sur 100 (2026-10-25) : réanalyser toutes les offres coûterait des crédits Claude. Seules les
 * nouvelles analyses ont une note ; les anciennes gardent le score du code.
 */
export const ANALYSIS_PROMPT_VERSION = "2026-10-21.1";

/**
 * Liste rendue par l'IA : éléments vides retirés, trop longs coupés, liste coupée à `max`. Une liste un peu
 * trop longue (16 compétences) faisait refuser toute l'analyse, relancée ensuite à chaque collecte.
 */
const list = (max: number, len: number) =>
  z.array(z.string()).transform((a) => a.map((s) => s.trim().slice(0, len).trim()).filter(Boolean).slice(0, max));

/** Ce que l'IA doit rendre (validé : une réponse hors format est refusée). */
export const JobAnalysisSchema = z.object({
  resume: z.string().trim().min(1).max(600),
  missions: list(6, 200),
  competences_obligatoires: list(15, 60),
  competences_bonus: list(15, 60),
  niveau: z.enum(["junior", "confirme", "senior", "inconnu"]),
  experience_min_ans: z.number().int().min(0).max(30).nullable(),
  employeur: z.enum(["direct", "esn_ou_cabinet", "inconnu"]),
  points_attention: list(6, 200),
  /** Compétences exigées classées selon ton niveau (recalculées par le code, cf. classifyRequired). */
  exigees_en_entreprise: list(15, 60).default([]),
  exigees_en_projets: list(15, 60).default([]),
  exigees_manquantes: list(15, 60).default([]),
  adequation: z.enum(["forte", "moyenne", "faible"]),
  /** Note sur 100 : remplace le score par mots-clés (cf. toSummary dans l'API). Absente des analyses d'avant le 2026-10-25. */
  note: z.number().transform((n) => Math.round(n)).nullable().default(null),
  avis: z.string().trim().min(1).max(400),
  /** Infos lues dans le texte : corrigent ce que la source ou le code ont mal lu (vérifiées par le code, cf. checkInfos). */
  contrat: z.enum(["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE", "inconnu"]).default("inconnu"),
  salaire_min: z.number().nullable().default(null),
  salaire_max: z.number().nullable().default(null),
  salaire_periode: z.enum(["annuel", "mensuel", "journalier", "horaire", "inconnu"]).default("inconnu"),
  adresse: z.string().trim().max(200).nullable().default(null),
});
export type JobAnalysisResult = z.infer<typeof JobAnalysisSchema>;

/** Même chose en schéma JSON : Ollama force le modèle à respecter ce format. */
export const JOB_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    resume: { type: "string" },
    missions: { type: "array", items: { type: "string" } },
    competences_obligatoires: { type: "array", items: { type: "string" } },
    competences_bonus: { type: "array", items: { type: "string" } },
    niveau: { type: "string", enum: ["junior", "confirme", "senior", "inconnu"] },
    experience_min_ans: { type: ["integer", "null"] },
    employeur: { type: "string", enum: ["direct", "esn_ou_cabinet", "inconnu"] },
    points_attention: { type: "array", items: { type: "string" } },
    exigees_en_entreprise: { type: "array", items: { type: "string" } },
    exigees_en_projets: { type: "array", items: { type: "string" } },
    exigees_manquantes: { type: "array", items: { type: "string" } },
    adequation: { type: "string", enum: ["forte", "moyenne", "faible"] },
    note: { type: "integer" },
    avis: { type: "string" },
    contrat: { type: "string", enum: ["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE", "inconnu"] },
    salaire_min: { type: ["number", "null"] },
    salaire_max: { type: ["number", "null"] },
    salaire_periode: { type: "string", enum: ["annuel", "mensuel", "journalier", "horaire", "inconnu"] },
    adresse: { type: ["string", "null"] },
  },
  required: [
    "resume",
    "missions",
    "competences_obligatoires",
    "competences_bonus",
    "niveau",
    "experience_min_ans",
    "employeur",
    "points_attention",
    "exigees_en_entreprise",
    "exigees_en_projets",
    "exigees_manquantes",
    "adequation",
    "note",
    "avis",
    "contrat",
    "salaire_min",
    "salaire_max",
    "salaire_periode",
    "adresse",
  ],
} as const;

export type AnalysisJobInput = {
  title: string;
  company: string | null;
  city: string | null;
  department: string | null;
  contractType: string | null;
  remoteType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  description: string;
  /** La source ne donne qu'un extrait de l'annonce (Adzuna, Jooble). */
  abridged?: boolean;
};

export type AnalysisProfileInput = {
  skills: string[];
  /** Compétences vues seulement en projets (jamais en entreprise). */
  projectSkills?: string[];
  /** Technos absentes de son profil qu'il peut apprendre vite (sa liste). */
  learnableSkills?: string[];
  experienceMin: number;
  experienceMax: number;
  contracts: string[];
  locations: string[];
  /** Texte du CV (écran « CV & lettre »), s'il est rempli. */
  cv?: string;
};

const MAX_DESCRIPTION = 12_000; // ≈ 3 500 mots : tient dans la mémoire de travail du modèle
const MAX_DESCRIPTION_WITH_CV = 8_000; // avec le CV, on garde de la place dans la mémoire de travail (8k)
const MAX_CV = 3_500;

function contractOf(job: AnalysisJobInput) {
  return contractOfJob(job);
}

export const ANALYSIS_SYSTEM_PROMPT = `Tu aides un développeur qui cherche un emploi à trier des offres d'emploi.
Tu lis UNE annonce et tu réponds UNIQUEMENT avec le JSON demandé, en français, sans rien ajouter.

Règles :
- N'invente rien. Ce qui n'est pas écrit dans l'annonce : liste vide, "inconnu" ou null.
- resume : 2 phrases maximum. Ce que fait le poste et pour qui (l'entreprise, ou son client).
- missions : les 3 à 5 missions principales, en phrases courtes.
- competences_obligatoires : les technologies et compétences exigées (« maîtrise », « requis », « indispensable », « expert », « X ans de … »). UNIQUEMENT des noms courts (1 à 3 mots) : « React », « Java », « SQL ». Jamais de phrase, jamais de durée (les années vont dans experience_min_ans). Si l'annonce dit « A ou B », ou « maîtrise d'au moins une de ces technologies : A, B ou C », écris UN SEUL élément « A ou B ou C » : il est rempli dès que le candidat en a une. Les formats et protocoles cités en passant (JSON, XML, REST/SOAP) ne sont pas des compétences à ranger en manquantes.
- competences_bonus : celles présentées comme un plus (« apprécié », « souhaité », « un plus », « idéalement », « nice to have »).
- niveau : junior, confirme ou senior. Si le TITRE du poste dit « junior », « confirmé » ou « senior », c'est le titre qui compte ; si le texte dit autre chose, signale la contradiction dans points_attention. Sinon, d'après l'expérience demandée ; inconnu si rien ne l'indique.
- experience_min_ans : le MINIMUM d'années d'expérience demandées AU CANDIDAT (« 1 à 2 ans » → 1, « > 1 an » → 1, « junior / débutant accepté » → 0). Jamais l'âge de l'entreprise ni l'expérience d'une personne de l'équipe (« notre CTO a 12 ans d'expérience »). Rien d'écrit → null. Si l'annonce se contredit (fiche du site « Expérience : 1 à 2 ans » mais texte « au moins 5 ans »), prends ce que dit le texte rédigé par le recruteur (profil recherché) et signale la contradiction dans points_attention. Le nombre d'années cité dans avis est TOUJOURS celui de experience_min_ans.
- employeur : esn_ou_cabinet si c'est une ESN, un cabinet ou une mission chez un client (« pour l'un de nos clients », « en mission chez ») ; direct si l'entreprise recrute pour elle-même ; sinon inconnu.
- Si l'annonce est marquée EXTRAIT : ce n'est que le début du texte. Ne déduis rien de ce qui manque, et mets « Annonce incomplète : ouvre l'annonce complète pour vérifier les exigences » dans points_attention.
- Le candidat a deux niveaux de compétences : EN ENTREPRISE (expérience professionnelle) et SEULEMENT EN PROJETS (projets personnels ou de formation, aucune expérience professionnelle). Une compétence vue seulement en projets n'est JAMAIS une « solide base », une « maîtrise », une « bonne connaissance » ni une « expérience » : écris « vue en projets ».
- exigees_en_entreprise / exigees_en_projets / exigees_manquantes : range chaque élément de competences_obligatoires dans une seule de ces 3 listes, d'après le PROFIL DU CANDIDAT.
- Technologie À APPRENDRE : une technologie absente de son profil qui est dans sa liste « peut apprendre vite », OU n'importe quelle technologie absente quand l'annonce propose une formation (formation interne, « vous serez formé », montée en compétences, mentorat) ou vise un junior / débutant. SAUF si l'annonce exige une maîtrise ou des années d'expérience sur elle : elle manque alors vraiment. Une technologie à apprendre n'est jamais à elle seule une raison de « faible », même si c'est la technologie principale ; dans avis et points_attention, écris « à apprendre (formation proposée) », pas « te manque ».
- Ce qui correspond au parcours du candidat (secteur où il a déjà travaillé, technologie de son CV) est un ATOUT : cite-le dans avis, jamais dans points_attention.
- Type de contrat : compare-le aux « Contrats souhaités » du candidat. Si le contrat est connu et non souhaité, indique-le dans points_attention et considère l'adéquation comme faible. S'il est souhaité, ne le mets pas dans points_attention. Si l'annonce propose PLUSIEURS contrats (« CDI ou Freelance ») dont au moins un est souhaité, le contrat convient : ne le mets ni dans points_attention ni dans avis.
- points_attention : les pièges concrets pour le candidat (poste senior, mission chez un client, astreintes, déplacements, anglais exigé, habilitation, salaire non indiqué, technologie principale absente de son profil…). 5 maximum.
- adequation : compare l'annonce au PROFIL DU CANDIDAT donné, y compris le contrat souhaité.
  forte = il a EN ENTREPRISE la plupart des compétences exigées, dont la technologie principale, ET l'expérience demandée ne dépasse pas la sienne.
  faible = contrat connu non souhaité, OU expérience demandée nettement au-dessus de la sienne, OU technologie principale absente de son profil et pas à apprendre, OU au moins 2 compétences exigées manquantes et pas à apprendre, OU poste très orienté vers un domaine absent de son expérience en entreprise (concevoir des modèles d'IA ou de LLM, data science…).
  Développer AVEC des agents de code IA (Claude Code, Cursor, Copilot, Codex) est une méthode de travail, pas un domaine : traite-le comme une compétence (en entreprise, en projets ou manquante), jamais à lui seul comme une raison de « faible ». S'il est demandé ou cité (IA appliquée au développement, agentic engineering…), mets-le dans les compétences, exigées ou bonus, avec les mots de l'annonce.
  Technologie principale vue seulement en projets, ou à apprendre : au mieux moyenne.
  moyenne = entre les deux.
- note : sur 100, à quel point l'offre convient au candidat, d'après TOUT le contexte (missions, stack, niveau, contrat, secteur, ce qu'il a en entreprise ou en projets). Elle doit rester dans la fourchette de l'adequation : forte = 75 à 100, moyenne = 45 à 74, faible = 0 à 40. Dans la fourchette, place-la selon le nombre de compétences exigées qu'il a et l'importance de ce qui manque. Ne tiens pas compte du lieu, du trajet ni du salaire.
- avis : une phrase directe, en TUTOYANT le candidat (« tu », jamais « vous »), qui dit pourquoi ça colle ou pas, en distinguant ce qu'il a en entreprise, ce qu'il n'a vu qu'en projets et ce qui lui manque. Même règle pour points_attention.
- contrat / salaire_min / salaire_max / salaire_periode / adresse : ce que dit VRAIMENT le texte de l'annonce, même si les champs « Contrat » ou « Salaire » au-dessus disent autre chose (ils viennent d'un robot qui se trompe parfois).
  contrat : CDI, CDD, INTERIM, ALTERNANCE, STAGE, FREELANCE (freelance / portage / TJM), sinon inconnu.
  salaire : seulement un montant écrit pour CE poste, en euros, tel qu'écrit (« 45k€ » → 45000), avec sa période ; un seul montant → min = max ; rien d'écrit → null et inconnu. Jamais le chiffre d'affaires ni une « estimation » du site.
  adresse : l'adresse du lieu de travail si elle est écrite (« 48 Boulevard des Batignolles, 75017 Paris »), sinon null. Jamais le siège d'un groupe cité en passant.`;

/**
 * Consigne + profil (même texte d'une offre à l'autre, mis en cache chez Claude : relu à 10 % du prix) et annonce à part.
 * Le cache ne reconnaît que le début identique : le profil placé avant l'annonce dans le même message n'était jamais relu.
 */
export function buildAnalysisPrompt(job: AnalysisJobInput, profile: AnalysisProfileInput): { system: string; user: string } {
  const salary =
    job.salaryMin || job.salaryMax
      ? `${job.salaryMin ?? "?"} à ${job.salaryMax ?? "?"} € brut par an`
      : "non indiqué";
  const place = [job.city, job.department ? `(${job.department})` : null].filter(Boolean).join(" ") || "non indiqué";
  const { atWork, inProjects } = levels(profile);
  const system = `${ANALYSIS_SYSTEM_PROMPT}

PROFIL DU CANDIDAT
- Compétences EN ENTREPRISE : ${atWork.join(", ") || "non renseignées"}
- Compétences vues SEULEMENT EN PROJETS (pas en entreprise) : ${inProjects.join(", ") || "aucune"}
- Technologies qu'il peut APPRENDRE VITE (absentes de son profil, choisies par lui) : ${profile.learnableSkills?.join(", ") || "aucune"}
- Expérience visée : ${profile.experienceMin} à ${profile.experienceMax} ans
- Contrats souhaités : ${profile.contracts.join(", ") || "non renseignés"}
- Zones : ${profile.locations.join(", ") || "non renseignées"}
${profile.cv ? `\nCV DU CANDIDAT\n"""\n${profile.cv.slice(0, MAX_CV)}\n"""\n` : ""}`;
  const user = `ANNONCE
Titre : ${job.title}
Entreprise : ${job.company ?? "non indiquée"}
Lieu : ${place}
Contrat (champ de la source ou deviné par un robot, à vérifier dans le texte) : ${contractOf(job) ?? "non indiqué"}
Télétravail : ${job.remoteType === "unknown" ? "non indiqué" : job.remoteType}
Salaire : ${salary}

Texte de l'annonce${job.abridged ? " (EXTRAIT : l'annonce complète est plus longue)" : ""} :
"""
${job.description.slice(0, profile.cv ? MAX_DESCRIPTION_WITH_CV : MAX_DESCRIPTION)}
"""`;
  return { system, user };
}

/** Compétences du profil par niveau : en entreprise, ou seulement en projets. */
function levels(profile: AnalysisProfileInput) {
  const inProjects = profile.projectSkills ?? [];
  const p = new Set(inProjects.map(normalizeText));
  return { atWork: profile.skills.filter((s) => !p.has(normalizeText(s))), inProjects };
}

const idsOf = (label: string) => {
  const ex = extractSkills(label);
  return ex.length ? ex : [resolveSkill(label).id];
};

/** Classe les compétences exigées selon ton niveau : fait par le code, le petit modèle s'y trompe. */
export function classifyRequired(required: string[], profile: AnalysisProfileInput) {
  const { atWork, inProjects } = levels(profile);
  const work = new Set(atWork.flatMap(idsOf));
  const proj = new Set(inProjects.flatMap(idsOf));
  const out = { exigees_en_entreprise: [] as string[], exigees_en_projets: [] as string[], exigees_manquantes: [] as string[] };
  for (const r of required) {
    const ids = idsOf(r);
    if (ids.some((id) => work.has(id))) out.exigees_en_entreprise.push(r);
    else if (ids.some((id) => proj.has(id))) out.exigees_en_projets.push(r);
    else out.exigees_manquantes.push(r);
  }
  return out;
}

/**
 * L'avis prête une « solide base » / une « maîtrise » sur une techno vue seulement en projets (« solides bases en Python ») :
 * remplacé par une phrase factuelle.
 */
export function checkAvis(avis: string, profile: AnalysisProfileInput, c: ReturnType<typeof classifyRequired>): string {
  const overclaims = /solides? (bases?|connaissances?|experiences?|competences?)|maitris|bonnes? connaissances?|experimente|expert|a l'aise/.test(normalizeText(avis));
  const proj = new Set((profile.projectSkills ?? []).flatMap(idsOf));
  if (!overclaims || !extractSkills(avis).some((id) => proj.has(id))) return avis;
  const part = (label: string, l: string[]) => (l.length ? `${label} : ${l.join(", ")}.` : "");
  return [
    part("Tu as en entreprise", c.exigees_en_entreprise),
    part("Vu seulement en projets", c.exigees_en_projets),
    part("Il te manque", c.exigees_manquantes),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 400);
}

/** Dédoublonne et retire les vides (le modèle répète parfois un élément). */
function tidy(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = x.toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Garde les noms de compétences : retire les phrases (« 5 ans de développement Java en backend »). */
function skillNames(list: string[]): string[] {
  return tidy(list).filter((x) => x.split(/\s+/).length <= 4 && !/\d+\s*(ans?|années?)\b/i.test(x));
}

/**
 * Compétence exigée absente mais « à apprendre » (même règle que le score) : dans ta liste, ou poste junior / formation
 * proposée — sauf maîtrise ou années exigées sur elle.
 */
export function learnableRequired(label: string, job: AnalysisJobInput, profile: AnalysisProfileInput, experienceMin: number | null): boolean {
  const ids = idsOf(label);
  const skills = ids.map((id) => getSkill(id)).filter((s) => s !== undefined);
  if (skills.some((s) => masteryRequired(job.description, s))) return false;
  const listed = new Set((profile.learnableSkills ?? []).flatMap(idsOf));
  if (ids.some((id) => listed.has(id))) return true;
  const junior = detectSeniority(job.title) === "junior" || experienceMin === 0;
  return trainingOffered(job.description) || (junior && !productionRequired(job.description));
}

/**
 * Filet de sécurité : poste trop expérimenté pour le profil → adéquation faible, quoi qu'en dise le modèle.
 * À l'inverse, un « faible » dont la seule raison possible est une techno à apprendre (contrat voulu, expérience dans ta
 * cible, rien d'autre ne manque, pas de domaine IA) remonte à « moyenne ».
 */
function checkAdequation(
  r: JobAnalysisResult,
  job: AnalysisJobInput,
  profile: AnalysisProfileInput,
): JobAnalysisResult["adequation"] {
  const kind = contractOf(job);
  const wantedContracts = profile.contracts.map((contract) => normalizeContract(contract) ?? contract.toUpperCase());
  if (kind && !wantedContracts.includes(kind)) return "faible";
  if (r.experience_min_ans !== null && r.experience_min_ans > profile.experienceMax + 1) return "faible";
  // Vérifié par le code : au moins 2 langages / frameworks exigés manquants (pas les outils, ni les technos à apprendre), ou poste orienté IA sans IA en entreprise.
  const missingCore = r.exigees_manquantes.filter((x) => idsOf(x).some((id) => getSkill(id)?.core));
  // Comme le score : au plus `maxLearnable` technos à apprendre, les suivantes manquent vraiment.
  const learnable = missingCore.filter((x) => learnableRequired(x, job, profile, r.experience_min_ans));
  const reallyMissing = [...missingCore.filter((x) => !learnable.includes(x)), ...learnable.slice(DEFAULT_RULES.maxLearnable)];
  if (reallyMissing.length >= 2) return "faible";
  if (AI_DOMAIN.test(normalizeText(job.title)) && !levels(profile).atWork.some((s) => AI_DOMAIN.test(normalizeText(s)))) return "faible";
  const inTarget = (r.experience_min_ans === null || r.experience_min_ans <= profile.experienceMax) && r.niveau !== "senior";
  if (r.adequation === "faible" && inTarget && reallyMissing.length === 0 && missingCore.length > 0) return "moyenne";
  // Techno principale (celle du titre) vue seulement en projets : au mieux « moyenne », comme le dit la consigne.
  const main = new Set(extractSkills(job.title));
  if (r.adequation === "forte" && r.exigees_en_projets.some((x) => idsOf(x).some((id) => main.has(id)))) return "moyenne";
  return r.adequation;
}

/**
 * Contrat, salaire (annuel) et adresse lus par l'IA, gardés seulement s'ils sont écrits dans l'annonce
 * (mêmes garde-fous que la lecture d'une page : montants et adresse retrouvés dans le texte).
 */
function checkInfos(r: JobAnalysisResult, job: AnalysisJobInput): Pick<JobAnalysisResult, "contrat" | "salaire_min" | "salaire_max" | "salaire_periode" | "adresse"> {
  const f = toFields(
    { ...r, titre: null, entreprise: null, ville: null, departement: null, teletravail: "inconnu", experience_min_ans: null, competences: [] },
    `${job.title}
${job.description}`,
  );
  return {
    contrat: r.contrat,
    salaire_min: f.salaryMin,
    salaire_max: f.salaryMax,
    salaire_periode: f.salaryMin !== null ? "annuel" : "inconnu",
    adresse: f.address,
  };
}

/** Fourchette de la note selon l'adéquation (celle de la consigne). */
export const NOTE_RANGES: Record<JobAnalysisResult["adequation"], [number, number]> = { forte: [75, 100], moyenne: [45, 74], faible: [0, 40] };

/** Note ramenée dans la fourchette de l'adéquation vérifiée par le code (le petit modèle se contredit, ou le code a corrigé l'adéquation). */
export function checkNote(note: number | null, adequation: JobAnalysisResult["adequation"]): number | null {
  if (note === null) return null;
  const [min, max] = NOTE_RANGES[adequation];
  return Math.min(max, Math.max(min, note));
}

/** Le niveau écrit dans le titre (« Développeur junior … ») l'emporte sur ce que le modèle a déduit. */
function checkNiveau(r: JobAnalysisResult, title: string): JobAnalysisResult["niveau"] {
  const t = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\bjunior\b/.test(t)) return "junior";
  if (/\bsenior\b/.test(t)) return "senior";
  if (/\bconfirme\b/.test(t)) return "confirme";
  return r.niveau;
}

/** « Contrat CDD » alors que le candidat accepte les CDD : pas un piège. */
function wantedContract(point: string, contracts: string[]): boolean {
  const p = point.trim();
  const choice = /\s(ou|or)\s/i.test(p); // « CDI ou Freelance » : une seule option souhaitée suffit
  if (p.length > (choice ? 160 : 70) || !/contrat|^(cdd|cdi|int[ée]rim|freelance|alternance|stage)\b/i.test(p)) return false;
  const types = [...p.matchAll(/\b(cdd|cdi|int[ée]rim|freelance|alternance|stage|apprentissage|professionnalisation)\b/giu)]
    .map((m) => normalizeContract(m[1]!))
    .filter((kind): kind is NonNullable<typeof kind> => kind !== null);
  const wanted = (kind: (typeof types)[number]) => contracts.some((c) => normalizeContract(c) === kind);
  return types.length > 0 && (choice ? types.some(wanted) : types.every(wanted));
}

const BEGINNER = /\b(junior|jr|d[ée]butant(e|s)?|jeune dipl[ôo]m[ée]e?|sans exp[ée]rience|entry[- ]level|graduate|no experience required)\b/i;

export const ABRIDGED_WARNING = "Annonce incomplète (extrait) : ouvre l'annonce complète pour vérifier les exigences.";

/** Analyse une offre avec l'IA. Une réponse hors format est redemandée une fois. */
export async function analyzeJobWithAi(
  client: Pick<OllamaClient, "chatJson" | "model">,
  job: AnalysisJobInput,
  profile: AnalysisProfileInput,
): Promise<{ result: JobAnalysisResult; model: string; durationMs: number }> {
  const started = Date.now();
  const prompt = buildAnalysisPrompt(job, profile);
  const kind = contractOf(job);
  const wantedContracts = profile.contracts.map((contract) => normalizeContract(contract) ?? contract.toUpperCase());
  const contractWarning =
    kind && !wantedContracts.includes(kind)
      ? `Contrat ${kind} hors de tes critères (tu cherches : ${profile.contracts.join(", ") || "non renseignés"})`
      : null;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await client.chatJson(prompt.system, prompt.user, JOB_ANALYSIS_JSON_SCHEMA, { cache: "system" });
    const parsed = JobAnalysisSchema.safeParse(raw);
    if (parsed.success) {
      const required = skillNames(parsed.data.competences_obligatoires);
      const classes = classifyRequired(required, profile);
      // Les années écrites dans le texte (la plus élevée : « au moins 4 ans » et fiche « 3 à 5 ans » → 4) l'emportent sur un nombre plus bas lu par l'IA.
      const written = parseExperienceYears(`${job.title}\n${job.description}`)?.min ?? null;
      const e = written !== null && written > (parsed.data.experience_min_ans ?? -1) ? written : parsed.data.experience_min_ans;
      // « 0 an » sans « junior / débutant » écrit : rien n'est précisé (« early in your career » n'est pas une exigence).
      const r = { ...parsed.data, ...classes, experience_min_ans: e === 0 && !BEGINNER.test(`${job.title}\n${job.description}`) ? null : e };
      const adequation = checkAdequation({ ...r, niveau: checkNiveau(r, job.title) }, job, profile);
      return {
        result: {
          ...r,
          ...checkInfos(r, job),
          avis: checkAvis(r.avis, profile, classes),
          missions: tidy(r.missions),
          competences_obligatoires: required,
          competences_bonus: skillNames(r.competences_bonus).filter(
            (b) => !r.competences_obligatoires.some((o) => o.toLowerCase() === b.toLowerCase()),
          ),
          points_attention: [
            ...(job.abridged ? [ABRIDGED_WARNING] : []),
            ...(contractWarning ? [contractWarning] : []),
            ...tidy(r.points_attention).filter((p) => !/incompl|extrait/i.test(p)),
          ]
            .filter((p) => !wantedContract(p, profile.contracts))
            .slice(0, 6),
          niveau: checkNiveau(r, job.title),
          adequation,
          note: checkNote(r.note, adequation),
        },
        model: client.model,
        durationMs: Date.now() - started,
      };
    }
    lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ; ");
  }
  throw new Error(`Réponse de l'IA hors format : ${lastError}`);
}

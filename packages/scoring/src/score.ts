import { departmentName, type Profile, type RemoteType, type ScoreRule, zoneDepartments } from "@job-radar/shared";
import { extractSkills, getSkill, normalizeText, resolveSkill, type Skill } from "@job-radar/skills";
import { DEFAULT_RULES, type ScoringRules } from "./rules";
import { salaryOfJob } from "./salary";
import {
  AI_DOMAIN,
  contractOfJob,
  detectNonDevRole,
  detectSeniority,
  detectSideRole,
  fluentEnglishRequired,
  looksLikeItTitle,
  masteryRequired,
  normalizeContract,
  productExperienceRequired,
  productionRequired,
  splitRequired,
  trainingOffered,
  type Seniority,
} from "./signals";

/** Ce dont le score a besoin. Les champs inconnus sont `null` — jamais devinés. */
export type ScoringInput = {
  title: string;
  description: string;
  /** Pour tes règles « entreprise ». */
  company?: string | null;
  /** Technologies déjà listées par la source, en plus du texte. */
  technologies?: string[];
  contractType: string | null;
  experienceMinYears: number | null;
  /** Si absent, déduit du titre. */
  seniority?: Seniority | null;
  /** Niveau donné par la source (« Niveau senior », « Confirmé ») : utilisé quand le titre ne dit rien. */
  experienceText?: string | null;
  /** Salaire annuel brut en euros. */
  salaryMin: number | null;
  salaryMax: number | null;
  department: string | null;
  remoteType: RemoteType;
  /** Durée porte-à-porte estimée, en minutes. null = non calculé. */
  travelMinutes: number | null;
  /** « car » : voiture depuis le domicile ; « transit » : transports depuis la gare d'arrivée (Île-de-France). */
  travelMode?: "car" | "transit" | null;
  /** Distance à vol d'oiseau entre le point de départ et l'offre, en km. null/absent = inconnue. */
  distanceKm?: number | null;
  /**
   * Compétences lues par l'IA (analyse à jour) : exigées et « un plus ». Si présentes, le critère Technique
   * est calculé sur elles (les « plus » comptent moitié) au lieu des mots-clés trouvés dans le texte.
   */
  aiSkills?: { required: string[]; bonus: string[] } | null;
};

/** Sous-notes de 0 à 100, affichées et utilisées pour masquer ; seule `technical` est la base du score. */
export type Breakdown = {
  technical: number;
  experience: number;
  contract: number;
  salary: number;
  location: number;
  transport: number;
};

/** Un bonus ou malus appliqué à la note technique, avec sa raison. */
export type Adjustment = { label: string; points: number };

export type ScoreResult = {
  final: number;
  /** Points de départ : la note technique ramenée sur `technicalPoints` (80 par défaut). */
  base: number;
  breakdown: Breakdown;
  /** Bonus et malus ajoutés à la note technique, dans l'ordre. */
  adjustments: Adjustment[];
  /** Pourquoi ça correspond. */
  reasons: string[];
  /** Points de vigilance. */
  warnings: string[];
  /** Compétences de l'offre que tu as. */
  matchedSkills: string[];
  /** Mots-clés de l'offre absents de ton profil (pistes pour le CV / la lettre). */
  missingSkills: string[];
  /** Tes technos préférées présentes : sert à départager deux offres de même score. */
  preferredSkills: string[];
  /** Offre gardée en base mais masquée du flux principal. */
  hidden: boolean;
  hiddenReason: string | null;
  rulesVersion: string;
  /** Plafond appliqué (critère bloquant), sinon null. */
  capLabel: string | null;
  /** Raisons d'une adéquation faible vérifiées par le code (l'avis de l'IA est alors ramené à « faible »). */
  weakFit: string[];
};

type Part = { score: number; reasons: string[]; warnings: string[]; adjustment?: Adjustment };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const k = (n: number) => `${Math.round(n / 1000)}k`;

// ───────── Technique ─────────
// Part des technos principales de l'offre que tu maîtrises ; celles du titre (la stack principale) comptent triple.
// Une techno vue seulement en projets compte à moitié ; une techno que tu n'as pas compte à moitié si le poste est
// junior ou propose une formation — sauf maîtrise exigée.

type Item = { id: string; weight: number };

function scoreTechnical(input: ScoringInput, profile: Profile, rules: ScoringRules) {
  const projects = (profile.projectSkills ?? []).map(resolveSkill);
  const owned = [...profile.skills.map(resolveSkill), ...projects];
  const projectIds = new Set(projects.map((s) => s.id));
  const preferred = profile.preferredTechs.map((p) => resolveSkill(p.name));
  const customSkills = [...owned, ...preferred].filter((s) => s.id.startsWith("custom:"));
  const skillOf = (id: string): Skill | undefined => getSkill(id) ?? customSkills.find((s) => s.id === id);
  const ownedIds = new Set(owned.map((s) => s.id));
  const inTitle = new Set(extractSkills(input.title, customSkills));
  const titleWeight = (id: string) => (inTitle.has(id) ? rules.titleWeight : 1);

  const ai = input.aiSkills;
  const useAi = !!ai && ai.required.length + ai.bonus.length > 0;
  let items: Item[];
  let found: string[];
  let aiLabels: string[] = [];
  /** Compétences exigées : celles de l'IA, sinon celles du titre et du texte hors « un plus ». */
  let requiredIds: string[];
  if (useAi) {
    const idsOf = (labels: string[]) => [
      ...new Set(
        labels.flatMap((l) => {
          const ex = extractSkills(l, customSkills);
          return ex.length ? ex : [resolveSkill(l).id];
        }),
      ),
    ];
    const req = idsOf(ai.required);
    const bonus = idsOf(ai.bonus).filter((id) => !req.includes(id));
    items = [...req.map((id) => ({ id, weight: titleWeight(id) })), ...bonus.map((id) => ({ id, weight: 0.5 }))];
    found = [...req, ...bonus];
    aiLabels = [...ai.required, ...ai.bonus];
    requiredIds = req;
  } else {
    found = extractSkills([input.title, input.description, ...(input.technologies ?? [])].join("\n"), customSkills);
    // Les outils (Git, SQL, Docker...) ne départagent pas : seulement langages et frameworks, sauf s'il n'y a qu'eux.
    const core = found.filter((id) => skillOf(id)?.core ?? true);
    items = (core.length ? core : found).map((id) => ({ id, weight: titleWeight(id) }));
    // Une techno citée dans « Nice to have / un plus » n'est pas exigée, même si elle apparaît ailleurs (« Stack : …, Vue for the back office »).
    const text = splitRequired(input.description);
    const req = new Set(extractSkills(text.required, customSkills));
    const optional = new Set(extractSkills(text.optional, customSkills));
    requiredIds = found.filter((id) => inTitle.has(id) || (req.has(id) && !optional.has(id)));
  }

  const label = (id: string) => skillOf(id)?.label ?? aiLabels.find((l) => resolveSkill(l).id === id) ?? id;
  const matched = found.filter((id) => ownedIds.has(id)).map(label);
  const inProjects = found.filter((id) => projectIds.has(id)).map(label);
  const missing = found.filter((id) => !ownedIds.has(id)).map(label);
  const preferredIds = new Set(preferred.map((s) => s.id));
  const preferredFound = found.filter((id) => preferredIds.has(id)).map(label);

  // Années exigées sur une techno principale (pas un outil) absente de ton profil : critère bloquant.
  const required = productExperienceRequired(input.title, input.description, customSkills);
  const lacking = required?.ids.filter((id) => !ownedIds.has(id) && (skillOf(id)?.core ?? true)) ?? [];
  const product = required && lacking.length ? { labels: lacking.map(label), years: required.years } : null;

  const part: Part = { score: rules.noSkillsTechnical, reasons: [], warnings: [] };
  if (items.length === 0) {
    part.warnings.push("Aucune techno détectée : poste peut-être hors informatique");
    return { part, matched, missing, preferredFound, main: [] as string[], product, requiredIds, missingRequired: [] as string[], blocking: [] as string[] };
  }

  const seniority = titleSeniority(input, profile);
  const learnableWhy = trainingOffered(input.description)
    ? "formation proposée"
    : (seniority === "junior" || input.experienceMinYears === 0) && !productionRequired(input.description)
      ? "poste junior"
      : null;
  const toLearn: string[] = [];
  const blocking: string[] = [];
  let got = 0;
  let total = 0;
  for (const it of items) {
    total += it.weight;
    if (ownedIds.has(it.id)) {
      got += it.weight * (projectIds.has(it.id) ? rules.projectCredit : 1);
      continue;
    }
    const skill = skillOf(it.id);
    const mastery = skill ? masteryRequired(input.description, skill) : null;
    if (learnableWhy && !mastery) {
      got += it.weight * rules.learnableCredit;
      toLearn.push(label(it.id));
    } else if (inTitle.has(it.id) || mastery) {
      blocking.push(mastery ? `${label(it.id)} (${mastery})` : label(it.id));
    }
  }
  part.score = clamp((100 * got) / total);

  const main = items.filter((it) => inTitle.has(it.id)).map((it) => it.id);
  // Techno principale (celle du titre, sinon les langages / frameworks exigés) vue seulement en projets : plafond.
  const mainCore = main.length ? main : requiredIds.filter((id) => skillOf(id)?.core ?? true);
  const projectOnly = mainCore.filter((id) => projectIds.has(id));
  if (projectOnly.length && !mainCore.some((id) => ownedIds.has(id) && !projectIds.has(id)) && part.score > rules.projectOnlyMainCap) {
    part.score = rules.projectOnlyMainCap;
    part.warnings.push(`Techno principale vue seulement en projets : ${projectOnly.map(label).join(", ")} (technique plafonnée à ${rules.projectOnlyMainCap} %)`);
  }
  if (main.length) part.reasons.push(`Stack principale (titre) : ${main.map(label).join(", ")}`);
  if (useAi) part.reasons.push("Compétences lues par l'IA (« plus » comptés à moitié)");
  if (matched.length) part.reasons.push(`Tu as : ${matched.join(", ")}`);
  if (inProjects.length) part.reasons.push(`Vu seulement en projets (compté à moitié) : ${inProjects.join(", ")}`);
  if (toLearn.length) part.reasons.push(`À apprendre (${learnableWhy}) : ${toLearn.join(", ")}`);
  if (blocking.length) part.warnings.push(`Techno principale ou exigée que tu n'as pas : ${blocking.join(", ")}`);
  const others = missing.filter((m) => !toLearn.includes(m) && !blocking.some((b) => b.startsWith(m)));
  if (others.length) part.warnings.push(`Mots-clés absents de ton profil : ${others.join(", ")} — à ajouter au CV si tu les maîtrises`);
  // Langages / frameworks exigés absents (les outils et mots inconnus — Kafka, Scrum… — ne comptent pas).
  // Sans l'IA, « cité dans l'annonce » n'est pas « exigé » : seulement les technos du titre ou à maîtrise exigée.
  const missingRequired = useAi ? requiredIds.filter((id) => !ownedIds.has(id) && getSkill(id)?.core).map(label) : blocking;
  return { part, matched, missing, preferredFound, main, product, requiredIds, missingRequired, blocking };
}

type ProductExperience = { labels: string[]; years: number } | null;
const fr = (n: number) => String(n).replace(".", ",");

// ───────── Expérience ─────────

/**
 * Niveau lu dans le titre. « Architecte » seul ne fait pas un poste de lead quand l'annonce demande
 * peu d'années (≤ ta cible max) : « Architecte Fullstack, 2 ans » reste dans ton niveau.
 */
function titleSeniority(input: ScoringInput, profile: Profile): Seniority | null {
  if (input.seniority !== undefined) return input.seniority;
  const s = detectSeniority(input.title);
  const years = input.experienceMinYears;
  if (s !== "lead" || years === null || years > profile.experienceMax) return s;
  return detectSeniority(normalizeText(input.title).replace(/\barchitecte?\b/g, " "));
}

function scoreExperience(input: ScoringInput, profile: Profile, rules: ScoringRules, product: ProductExperience): Part {
  const years = input.experienceMinYears;
  // Niveau de la source (« Niveau senior », LinkedIn le met sur presque tout) : seulement si l'annonce ne dit pas
  // combien d'années. « 2 à 3 ans » lu dans le texte est plus précis qu'une étiquette (il était noté 30 au lieu de 100).
  // Un « Senior » écrit dans le titre, lui, compte toujours.
  const seniority =
    (titleSeniority(input, profile)) ??
    (years === null && input.experienceText ? detectSeniority(input.experienceText) : null);
  const { experienceMin: min, experienceMax: max } = profile;
  const part: Part = { score: rules.neutral, reasons: [], warnings: [] };

  let byYears: number | null = null;
  if (years !== null) {
    if (years < max) byYears = 100;
    else if (years === max) byYears = 85;
    // Un an au-dessus de ta cible : jugé « faible » ou « moyenne » par l'IA, jamais « forte » (17 offres mesurées).
    else if (years === max + 1) byYears = 35;
    else if (years <= max + 4) byYears = 35;
    else byYears = 10;

    // Ton expérience réelle (si renseignée) décide du vert ; sans effet sur le score, qui suit ta cible.
    const real = profile.experienceYears ?? max;
    if (years > max) part.warnings.push(`Demande ${years} ans d'expérience (ta cible : ${min} à ${max})`);
    else if (product) {
      // signalé ci-dessous
    } else if (years === 0) part.reasons.push("Débutant accepté");
    else if (years <= real) part.reasons.push(`${years} an(s) d'expérience demandé(s)`);
    else part.warnings.push(`Demande ${years} ans d'expérience (tu en as ${fr(real)})`);
  }
  if (product)
    part.warnings.push(`Expérience exigée sur un produit que tu n'as pas : ${product.labels.join(", ")} (${product.years} ans demandés)`);

  let bySeniority: number | null = null;
  if (seniority === "junior") bySeniority = 100;
  else if (seniority === "senior") bySeniority = 30;
  else if (seniority === "lead") bySeniority = 15;
  else if (seniority === "intern") bySeniority = 20;

  if (seniority === "junior" && byYears === null) part.reasons.push("Poste junior");
  if (seniority === "senior") part.warnings.push("Poste indiqué senior / confirmé");
  if (seniority === "lead") part.warnings.push("Poste de lead / architecte / manager");
  if (seniority === "intern") part.warnings.push("Annonce de stage");

  const known = [byYears, bySeniority].filter((n): n is number => n !== null);
  if (known.length === 0) {
    part.warnings.push("Expérience demandée non précisée");
    return part;
  }
  part.score = Math.min(...known); // l'exigence la plus stricte l'emporte
  const s = part.score;
  if (s >= 100 && (seniority === "junior" || years === 0) && !productionRequired(input.description)) part.adjustment = { label: "Poste junior / débutant accepté", points: 5 };
  else if (s <= 15) part.adjustment = { label: "Expérience très au-dessus de ta cible", points: -40 };
  else if (s <= 35) part.adjustment = { label: "Expérience au-dessus de ta cible", points: -25 };
  else if (s <= 65) part.adjustment = { label: "Un peu plus d'expérience que ta cible", points: -10 };
  return part;
}

// ───────── Contrat ─────────

function scoreContract(input: ScoringInput, profile: Profile, rules: ScoringRules): Part {
  const kind = contractOfJob(input);
  if (!kind) return { score: rules.neutral, reasons: [], warnings: ["Type de contrat non précisé"] };
  const wanted = profile.contracts.map((c) => normalizeContract(c) ?? c.toUpperCase());
  if (wanted.includes(kind)) return { score: 100, reasons: [kind], warnings: [] };
  return { score: 10, reasons: [], warnings: [`Contrat ${kind} (tu cherches : ${profile.contracts.join(", ")})`] };
}

// ───────── Salaire ─────────

function scoreSalary(job: ScoringInput, profile: Profile, rules: ScoringRules): Part {
  // Salaire de la source, sinon lu dans l'annonce (« Salary: €50K to €90K »).
  const input = { ...job, ...salaryOfJob(job) };
  const raw = input.salaryMax ?? input.salaryMin;
  // Moins de 8 000 €/an : ce n'est pas un salaire annuel (souvent un taux journalier de freelance) → inconnu.
  const ref = raw !== null && raw >= 8000 ? raw : null;
  if (ref === null) return { score: 50, reasons: [], warnings: ["Salaire non communiqué"] };

  const label =
    input.salaryMin !== null && input.salaryMax !== null && input.salaryMin !== input.salaryMax
      ? `${k(input.salaryMin)}–${k(input.salaryMax)}`
      : k(ref);
  const target = profile.salaryTarget;
  const minimum = profile.salaryMinimum ?? target;
  if (target === null || minimum === null) return { score: rules.neutral, reasons: [`Salaire ${label}`], warnings: [] };

  if (ref >= target) return { score: ref >= target + 5000 ? 100 : 95, reasons: [`Salaire ${label}`], warnings: [], adjustment: { label: `Salaire ${label}, à ta cible ou plus`, points: 5 } };
  if (ref >= minimum) return { score: 80, reasons: [`Salaire ${label}`], warnings: [] };
  if (ref >= minimum - 3000)
    return { score: 50, reasons: [], warnings: [`Salaire ${label}, sous ton minimum de ${k(minimum)}`], adjustment: { label: `Salaire ${label}, sous ton minimum`, points: -10 } };
  return {
    score: 20,
    reasons: [],
    warnings: [`Salaire ${label}, nettement sous ton minimum de ${k(minimum)}`],
    adjustment: { label: `Salaire ${label}, nettement sous ton minimum`, points: -20 },
  };
}

// ───────── Localisation ─────────

function scoreLocation(input: ScoringInput, profile: Profile): Part {
  if (input.remoteType === "remote") return { score: 100, reasons: ["Télétravail complet"], warnings: [], adjustment: { label: "Télétravail complet", points: 5 } };
  const dept = input.department;
  const km = input.distanceKm ?? null;
  if (!dept && km === null) return { score: 50, reasons: [], warnings: ["Lieu de travail non précisé"] };
  // Départements de tes recherches, ou acceptés en plus (ex. 93 : Saint-Ouen sans recherche dédiée).
  if (dept && zoneDepartments(profile).has(dept)) {
    const label = profile.locations.find((l) => l.department === dept)?.label ?? departmentName(dept) ?? dept;
    return { score: 100, reasons: [`Dans ta zone : ${label}`], warnings: [] };
  }
  const radius = profile.searchRadiusKm;
  if (radius !== null && km !== null && km <= radius) {
    return { score: 80, reasons: [`À ${Math.round(km)} km de chez toi (rayon ${radius} km)`], warnings: [] };
  }
  const where = dept ? `Département ${dept}` : "Lieu";
  return {
    score: 15,
    reasons: [],
    warnings: [`${where}, hors de ta zone${km !== null ? ` (${Math.round(km)} km)` : ""}`],
    adjustment: { label: "Hors de ta zone", points: -30 },
  };
}

// ───────── Transport ─────────

function scoreTransport(input: ScoringInput, rules: ScoringRules): Part {
  if (input.remoteType === "remote") return { score: 100, reasons: [], warnings: [] };
  const m = input.travelMinutes;
  if (m === null) return { score: rules.neutral, reasons: [], warnings: ["Temps de trajet non calculé"] };
  // Paris : le train jusqu'à la gare d'arrivée est accepté ; au-delà de 30 min de transports en plus, ça pèse.
  if (input.travelMode === "transit") {
    const est = `${m} min de transports depuis ta gare d'arrivée`;
    if (m <= 30) return { score: 100, reasons: [est], warnings: [] };
    if (m <= 45) return { score: 65, reasons: [], warnings: [est], adjustment: { label: est, points: -5 } };
    if (m <= 60) return { score: 35, reasons: [], warnings: [`${est} (long)`], adjustment: { label: `${est} (long)`, points: -15 } };
    return { score: 10, reasons: [], warnings: [`${est} (trop long)`], adjustment: { label: `${est} (trop long)`, points: -25 } };
  }
  const est = input.travelMode === "car" ? `Trajet estimé à ${m} min en voiture` : `Trajet estimé à ${m} min`;
  if (m <= 30) return { score: 100, reasons: [est], warnings: [] };
  if (m <= 45) return { score: 85, reasons: [est], warnings: [] };
  const short = input.travelMode === "car" ? `${m} min en voiture` : `Trajet ${m} min`;
  if (m <= 60) return { score: 65, reasons: [], warnings: [est], adjustment: { label: short, points: -5 } };
  if (m <= 75) return { score: 40, reasons: [], warnings: [`${est} (fatigant)`], adjustment: { label: `${short} (fatigant)`, points: -10 } };
  if (m <= 90) return { score: 20, reasons: [], warnings: [`${est} (très fatigant)`], adjustment: { label: `${short} (très fatigant)`, points: -20 } };
  return { score: 5, reasons: [], warnings: [`${est} (trop long au quotidien)`], adjustment: { label: `${short} (trop long)`, points: -30 } };
}

// ───────── Tes règles ─────────

const KIND_LABELS: Record<ScoreRule["kind"], string> = { title: "dans le titre", text: "dans l'annonce", company: "entreprise" };

/** Mot entier, sans accents ni majuscules (« angular » trouve « Angular 17 », pas « rectangular »). */
function containsWord(text: string, word: string): boolean {
  const w = normalizeText(word).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, "u").test(normalizeText(text));
}

export function userRuleAdjustments(input: ScoringInput, rules: ScoreRule[]): Adjustment[] {
  return rules
    .filter((r) =>
      r.kind === "company"
        ? !!input.company && normalizeText(input.company).includes(normalizeText(r.value).trim())
        : containsWord(r.kind === "title" ? input.title : `${input.title}\n${input.description}`, r.value),
    )
    .map((r) => ({ label: `Ta règle : « ${r.value} » (${KIND_LABELS[r.kind]})`, points: r.points }));
}

// ───────── Score final ─────────

export function scoreJob(input: ScoringInput, profile: Profile, rules: ScoringRules = DEFAULT_RULES): ScoreResult {
  const tech = scoreTechnical(input, profile, rules);
  const parts = {
    technical: tech.part,
    experience: scoreExperience(input, profile, rules, tech.product),
    contract: scoreContract(input, profile, rules),
    salary: scoreSalary(input, profile, rules),
    location: scoreLocation(input, profile),
    transport: scoreTransport(input, rules),
  };
  const breakdown: Breakdown = {
    technical: parts.technical.score,
    experience: parts.experience.score,
    contract: parts.contract.score,
    salary: parts.salary.score,
    location: parts.location.score,
    transport: parts.transport.score,
  };

  const adjustments: Adjustment[] = [];
  // Ta techno préférée dans la stack principale (le titre, sinon les compétences exigées, pas les « plus ») : jusqu'à +10.
  const mainIds = tech.main.length ? tech.main : tech.requiredIds;
  const fav = profile.preferredTechs
    .map((p) => ({ p, id: resolveSkill(p.name).id }))
    .filter((x) => mainIds.includes(x.id) && x.p.weight >= 0.5)
    .sort((a, b) => b.p.weight - a.p.weight)[0];
  if (fav) adjustments.push({ label: `${fav.p.name}, ta techno préférée`, points: Math.round(10 * fav.p.weight) });
  for (const p of Object.values(parts)) if (p.adjustment) adjustments.push(p.adjustment);
  const english = fluentEnglishRequired(input.description);
  if (english) adjustments.push({ label: "Anglais courant exigé", points: rules.fluentEnglishPoints });
  const side = detectSideRole(input.title);
  if (side) adjustments.push({ label: `Fonction à vérifier : ${side}`, points: rules.sideRolePoints });
  adjustments.push(...userRuleAdjustments(input, profile.scoreRules));

  const base = Math.round((breakdown.technical * rules.technicalPoints) / 100);
  let final = clamp(base + adjustments.reduce((a, x) => a + x.points, 0));

  // Critères bloquants : on garde le plafond le plus bas atteint.
  let capLabel: string | null = null;
  const cap = (value: number, label: string) => {
    if (value < final) {
      final = value;
      capLabel = label;
    }
  };
  if (breakdown.contract <= 10) cap(0, "contrat hors profil");
  const nonDev = detectNonDevRole(input.title);
  if (nonDev) cap(rules.nonDevRoleCap, `pas un poste de développement (${nonDev})`);
  // Aucune techno dans l'annonce et un titre sans rapport avec l'informatique : hors sujet.
  const offTopic = tech.matched.length + tech.missing.length === 0 && !looksLikeItTitle(input.title);
  if (offTopic) cap(rules.offTopicCap, "aucune techno et titre sans rapport avec l'informatique");
  if (tech.product) cap(profile.productExperienceCap ?? 40, "expérience exigée sur un produit que tu n'as pas");
  if (tech.blocking.length) cap(rules.missingMainTechCap, `techno principale ou exigée que tu n'as pas : ${tech.blocking.join(", ")}`);
  // Adéquation faible vérifiée par le code (le petit modèle d'IA s'y trompe) : compétences exigées manquantes, domaine IA.
  const weakFit: string[] = [];
  if (tech.missingRequired.length >= 2) weakFit.push(`compétences exigées manquantes : ${tech.missingRequired.join(", ")}`);
  const inProjects = new Set((profile.projectSkills ?? []).map((p) => normalizeText(p)));
  const aiAtWork = profile.skills.some((x) => !inProjects.has(normalizeText(x)) && AI_DOMAIN.test(normalizeText(x)));
  if (AI_DOMAIN.test(normalizeText(input.title)) && !aiAtWork) weakFit.push("poste orienté IA / LLM, domaine absent de ton expérience en entreprise");
  if (weakFit.length) cap(rules.weakFitCap, `adéquation faible (${weakFit.join(" ; ")})`);

  let hiddenReason: string | null = null;
  const kind = contractOfJob(input);
  const seniority = titleSeniority(input, profile);
  if (rules.hideNonMatchingContract && kind && breakdown.contract < 100) {
    hiddenReason = `Contrat ${kind} hors profil`;
  } else if (rules.hideSenior && (seniority === "senior" || seniority === "lead")) {
    hiddenReason = seniority === "lead" ? "Poste de lead / manager" : "Poste senior / confirmé";
  } else if (
    rules.hideYearsOverMax !== null &&
    input.experienceMinYears !== null &&
    input.experienceMinYears > profile.experienceMax + rules.hideYearsOverMax
  ) {
    hiddenReason = `Demande ${input.experienceMinYears} ans d'expérience`;
  } else if (rules.hideOutOfZone && breakdown.location <= 15) {
    hiddenReason = input.department ? `Hors de ta zone (département ${input.department})` : "Hors de ta zone";
  } else if (rules.hideOffTopic && offTopic) {
    hiddenReason = "Pas un poste informatique";
  }

  const all = Object.values(parts);
  const warnings = all.flatMap((p) => p.warnings);
  if (english) warnings.push("Anglais courant exigé");
  if (capLabel) warnings.unshift(`Score plafonné à ${final} % : ${capLabel}`);
  return {
    final,
    base,
    breakdown,
    adjustments,
    reasons: all.flatMap((p) => p.reasons),
    warnings,
    matchedSkills: tech.matched,
    missingSkills: tech.missing,
    preferredSkills: tech.preferredFound,
    hidden: hiddenReason !== null,
    hiddenReason,
    rulesVersion: rules.version,
    capLabel,
    weakFit,
  };
}

/** Champs d'une offre en base utiles au score (évite de dupliquer la conversion ailleurs). */
export type ScorableJob = {
  title: string;
  description: string;
  company?: string | null;
  technologies: string[];
  contractType: string | null;
  experienceMinYrs: number | null;
  experienceText?: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  department: string | null;
  remoteType: RemoteType;
  travelMinutes: number | null;
  travelMode?: string | null;
};

export function scoringInputFromJob(job: ScorableJob): ScoringInput {
  return {
    title: job.title,
    description: job.description,
    company: job.company ?? null,
    technologies: job.technologies,
    contractType: job.contractType,
    experienceMinYears: job.experienceMinYrs,
    experienceText: job.experienceText ?? null,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    department: job.department,
    remoteType: job.remoteType,
    travelMinutes: job.travelMinutes,
    travelMode: job.travelMode === "car" || job.travelMode === "transit" ? job.travelMode : null,
  };
}

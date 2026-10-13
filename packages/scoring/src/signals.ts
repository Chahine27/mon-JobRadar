import { extractSkills, normalizeText, skillIndexes, type Skill } from "@job-radar/skills";

/** Petits extracteurs de texte, réutilisés par la normalisation (étape 7). Ne devinent jamais : inconnu → null. */

export type Seniority = "intern" | "junior" | "mid" | "senior" | "lead";

export type ContractKind = "CDI" | "CDD" | "INTERIM" | "ALTERNANCE" | "STAGE" | "FREELANCE";

/** Niveau lu dans le titre de l'annonce. */
export function detectSeniority(title: string): Seniority | null {
  // « futur lead », « évolution vers lead », « à terme lead » : une perspective, pas le poste actuel.
  const t = normalizeText(title).replace(
    /\b(futur(e|s)?|evolution( possible)? vers( un poste de| un role de| le role de| du)?|evolutif vers|a terme|potentiel(le)?|pouvant evoluer vers|avec evolution)\s+(en\s+)?(tech\s*lead|lead( dev(eloppeur)?)?|manager|architecte)\b/g,
    " ",
  );
  if (/\b(stage|stagiaire|intern(ship)?)\b/.test(t)) return "intern";
  if (/\b(lead|tech ?lead|principal|staff|head of|architecte|manager)\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?|confirme|confirmed|expert|experimente|experienced)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.?|debutant|jeune diplome)\b/.test(t)) return "junior";
  return null;
}

/**
 * Années d'expérience demandées.
 * Gère : « 3 ans d'expérience », « 3 à 5 ans », « 3-5 ans », « minimum 2 ans », « 5+ ans », « 3 An(s) ».
 * Plusieurs mentions → on garde l'exigence la plus élevée (prudent).
 */
export function parseExperienceYears(text: string): { min: number; max: number | null } | null {
  const t = normalizeText(text);
  if (/debutant(e)? accepte/.test(t)) return { min: 0, max: null };
  const re =
    /(?:minimum\s+|au moins\s+|min\.?\s+)?(\d{1,2})\s*(?:\+|\s*(?:a|-|–)\s*(\d{1,2}))?\s*(?:an\(s\)|(?:ans?|annees?|years?)\b)/g;
  let best: { min: number; max: number | null } | null = null;
  for (const m of t.matchAll(re)) {
    const start = m.index ?? 0;
    const context = t.slice(Math.max(0, start - 60), start + m[0].length + 40);
    if (!/(experience|exp\b|minimum|au moins|exige|requis|souhaite|dans un poste|similaire|years)/.test(context)) continue;
    // « Disposant d'une expérience de plus de 20 ans en la matière » : l'ancienneté de l'ENTREPRISE, pas le poste.
    const before = t.slice(Math.max(0, start - 45), start);
    const after = t.slice(start + m[0].length, start + m[0].length + 25);
    if (/disposant d'une|forte? d'une|riche d'une|depuis|fondee|creee/.test(before) || /en la matiere|d'existence|d'histoire/.test(after)) continue;
    // « Matthieu, notre CTO qui a plus de 12 ans d'expérience » : l'expérience d'une personne de l'équipe, pas celle demandée.
    if (/\bqui (a|ont|possede|possedent|cumule|cumulent|compte|comptent)\b|\b(notre|nos|son|sa|leur|leurs|votre) (cto|ceo|fondateur|fondatrice|directeur|directrice|manager|associes?|equipes?|experts?|consultants?|formateurs?|coachs?)\b/.test(before)) continue;
    // « 2 Tech Leads with a combined 30 years of experience » : l'expérience cumulée de l'équipe.
    if (/\b(combined|cumulee?s?|a eux (deux|trois|tous))\s*$/.test(before)) continue;
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : null;
    if (min > 30) continue;
    if (!best || min > best.min) best = { min, max };
  }
  return best;
}

/** Type de contrat, à partir d'un libellé libre ou d'un code France Travail (CDI, CDD, MIS, LIB...). */
export function normalizeContract(value: string | null | undefined): ContractKind | null {
  if (!value) return null;
  const v = normalizeText(value).trim();
  if (/^cdi\b|contrat a duree indeterminee/.test(v)) return "CDI";
  if (/^cdd\b|contrat a duree determinee/.test(v)) return "CDD";
  if (/^(mis|tti)\b|interim|travail temporaire/.test(v)) return "INTERIM";
  if (/alternance|apprentissage|professionnalisation/.test(v)) return "ALTERNANCE";
  if (/^stage\b|stage$|internship/.test(v)) return "STAGE";
  if (/^lib\b|freelance|independant|liberal|portage/.test(v)) return "FREELANCE";
  return null;
}

/** Contract from an explicit contract label or from a description that names only one kind. */
export function contractFromText(text: string): ContractKind | null {
  // `label` : ligne de contrat explicite. Ailleurs, les mots ambigus (« mis en place », « lib »,
  // « apprentissage automatique ») ne comptent pas.
  const kindsIn = (value: string, label: boolean): Set<ContractKind> => {
    const found = new Set<ContractKind>();
    if (/\bcdi\b|contrat a duree indeterminee/.test(value)) found.add("CDI");
    if (/\bcdd\b|contrat a duree determinee/.test(value)) found.add("CDD");
    if ((label && /\b(mis|tti)\b/.test(value)) || /interim|travail temporaire/.test(value)) found.add("INTERIM");
    // « professionnalisation » seul ne suffit pas : « professionnalisation de nos pratiques agiles » n'est pas un contrat.
    if (/alternance|contrat d'apprentissage|en apprentissage|contrat de professionnalisation/.test(value) || (label && /apprentissage|professionnalisation/.test(value)))
      found.add("ALTERNANCE");
    if (/\bstage\b|stagiaire|internship/.test(value)) found.add("STAGE");
    if ((label && /\b(lib|liberal|tjm)\b/.test(value)) || /\b(freelance|free-lance|independant|portage salarial)\b/.test(value))
      found.add("FREELANCE");
    return found;
  };
  const lines = normalizeText(text)
    .split(/\r?\n/)
    .flatMap((line) => line.split(/\s+[·•|]\s+/))
    .map((line) => line.replace(/^[\s*•·-]+|[\s.,;:!?]+$/g, "").trim())
    .filter(Boolean);
  for (const line of lines) {
    const kinds = kindsIn(line, true);
    const isContractField = /^(type de contrat|contrat(?: de travail)?|employment type|contract(?: type)?)\s*[:=-]/.test(line);
    const isContractLabel =
      line.length <= 80 &&
      /^(?:cdi|cdd|mis|tti|interim|travail temporaire|alternance|apprentissage|professionnalisation|stage|stagiaire|internship|freelance|free-lance|independant|liberal|portage|tjm)(?:\s*(?:\/|,|ou|et)\s*(?:cdi|cdd|interim|alternance|apprentissage|stage|freelance|independant|portage))?$/.test(
        line,
      );
    if ((isContractField || isContractLabel) && kinds.size === 1) return [...kinds][0]!;
  }

  // « 3 ans d'expérience (alternance incluse) », « stages compris » : on compte l'expérience, ce n'est pas le contrat.
  const rest = normalizeText(text).replace(
    /\b(alternances?|stages?|apprentissages?)\s+(inclus|compris)e?s?\b|\by compris (en |les |des )?(alternances?|stages?|apprentissages?)\b/g,
    " ",
  );
  const kinds = kindsIn(rest, false);
  return kinds.size === 1 ? [...kinds][0]! : null;
}

/** Télétravail lu dans le texte. Rien trouvé → "unknown" (pas "sur site" : on ne devine pas). */
export function detectRemote(text: string): "remote" | "hybrid" | "onsite" | "unknown" {
  const t = normalizeText(text);
  if (/(100\s*%|full|totalement|entierement|complet)\s*(en\s*)?(teletravail|remote)|teletravail\s*(a\s*)?(100\s*%|complet|total)|full[\s-]?remote/.test(t)) {
    return "remote";
  }
  if (/teletravail|hybride|remote|travail a distance/.test(t)) {
    if (/(pas de|sans|aucun)\s+teletravail|teletravail\s+(non\s+)?(impossible|non autorise)/.test(t)) return "onsite";
    return "hybrid";
  }
  if (/100\s*%\s*(sur site|presentiel)|pas de teletravail/.test(t)) return "onsite";
  return "unknown";
}

/**
 * Postes qui ne sont pas du développement, même si le titre contient des technos ou le mot « développeur »
 * (« Chef de projet Java », « Développeur foncier », « Business developer »...). Lu dans le titre uniquement.
 * Renvoie un libellé lisible, ou null si c'est bien un poste de développement.
 */
export function detectNonDevRole(title: string): string | null {
  const t = normalizeText(title);
  const rules: Array<[RegExp, string]> = [
    [/\bchef(fe)? de projets?\b|\bproject manager\b/, "chef de projet"],
    [/\bproduct (owner|manager)\b|\bproduct ops\b/, "product owner / manager"],
    [/\bscrum master\b|\bagile coach\b|\bcoach agile\b/, "scrum master / coach agile"],
    [/\b(product|ux|ui|ux\/ui|ui\/ux|web|graphic|graphique)\s*designer\b|\bdesigner (ux|ui)\b/, "design (UX/UI)"],
    [/\bbusiness analyst\b|\bconsultant(e)? fonctionnel(le)?\b|\bamoa\b/, "fonctionnel / AMOA"],
    [/\bbusiness develop(er|pement)\b|\bingenieur(e)? d'affaires\b|\bcommercial(e)?\b|\bsales\b/, "commercial"],
    [
      /\bdeveloppeu(r|se)s?\s+(foncier|fonciere|immobilier|commercial(e)?|d'affaires|business|rh|territorial(e)?|economique|de reseau|de franchise|de clientele)\b/,
      "développement commercial / immobilier",
    ],
    [/\b(directeur|directrice|responsable|head of)\b/, "poste de direction / responsable"],
  ];
  for (const [re, label] of rules) if (re.test(t)) return label;
  return null;
}

/**
 * Métiers proches du développement mais d'une autre fonction (« Ingénieur support », « Security Analyst », « Testeur QA »).
 * Malus seulement : le titre peut aussi dire « Développeur ». Libellé lisible, ou null.
 */
export function detectSideRole(title: string): string | null {
  const t = normalizeText(title);
  const rules: Array<[RegExp, string]> = [
    [/\b(support|helpdesk|hotline|service desk)\b/, "support"],
    [/\banalyst(e)?s?\b/, "analyste"],
    [/\b(security|securite|cyber ?securite|cybersecurity|pentest(eur|er)?)\b/, "sécurité"],
    [/\b(qa|testeu(r|se)s?|tests? engineer|ingenieur(e)? (de )?tests?|recette(ur|use)?)\b/, "test / QA"],
    [/\b(administrateur|administratrice|sysadmin|technicien(ne)?)\b/, "administration / technicien"],
  ];
  for (const [re, label] of rules) if (re.test(t)) return label;
  return null;
}

/**
 * L'annonce propose-t-elle de te former (« formation interne », « vous serez formé », « montée en compétences ») ?
 * « Formation : Bac+5 » (diplôme demandé) ne compte pas.
 */
export function trainingOffered(text: string): boolean {
  return /\b(formations? (en )?interne|formations? (assuree|proposee|prevue|offerte|complete|continue|dediee|adaptee|personnalisee)s?|nous (vous )?formons|vous (serez|etes) forme|(serez|etre|sera|seras) formee?s?|formee?s? (a|aux|sur) |parcours (de formation|d'integration)|programme de formation|montee en competences?|monter en competences?|mentorat|mentoring|tutorat|accompagnee? (par|dans|tout au long)|onboarding)/.test(
    normalizeText(text),
  );
}

/**
 * La maîtrise de cette techno est-elle exigée (« 3 ans d'expérience sur Angular », « maîtrise d'Angular »,
 * « Angular indispensable ») ? Renvoie la raison (« 3 ans exigés », « maîtrise exigée ») ou null.
 */
export function masteryRequired(text: string, skill: Skill): string | null {
  const t = normalizeText(text);
  for (const i of skillIndexes(text, skill)) {
    const before = t.slice(Math.max(0, i - 70), i).split(/[.;\n!?]/).pop() ?? "";
    const after = t.slice(i, i + 70).split(/[.;\n!?]/)[0] ?? "";
    const years = [...`${before} ${after}`.matchAll(/(\d{1,2})\s*\+?\s*(ans?|annees?|years?)\b/g)].map((m) => Number(m[1])).filter((n) => n >= 2 && n <= 15);
    if (years.length) return `${Math.max(...years)} ans exigés`;
    if (/(maitrise|maitriser|maitrisez|expert(e|ise)?|solide experience|forte experience|(tres )?bonne connaissance|excellente connaissance|experience (significative|confirmee|solide|averee)|confirmee? (en|sur))\b/.test(before.slice(-45)))
      return "maîtrise exigée";
    if (/^[^,]{0,25}\b(confirme|expert|avance|indispensable|obligatoire|exige|requis|imperati(f|ve))/.test(after)) return "maîtrise exigée";
  }
  return null;
}

/**
 * Le titre évoque-t-il un métier de l'informatique ? Sert quand AUCUNE techno n'est trouvée dans l'annonce :
 * « Dessinateur », « Soudeur », « Comptable » → non ; « Développeur », « Ingénieur logiciel » (extrait trop court) → oui.
 */
export function looksLikeItTitle(title: string): boolean {
  const t = normalizeText(title);
  return /\b(developpeu(r|se)s?|developers?|dev|devops|programmeu(r|se)|logiciels?|software|informatiques?|informaticien(ne)?|web|webmaster|mobile|full ?stack|front ?end|back ?end|frontend|backend|integrat(eur|rice)|data|cloud|api|applications?|applicatif|numerique|digital|it|tech|si|systemes? d'information|sre|qa|testeu(r|se)|recette|cyber|securite informatique|reseaux?|administrateur|sysadmin|codeu(r|se)|code|java|php|python)\b/.test(
    t,
  );
}

/**
 * Contrat écrit dans le titre, quand la source ne le donne pas (fréquent chez Adzuna) :
 * « Développeur React - Freelance », « Stage développeur », « CDD 6 mois ».
 */
/**
 * Contrat d'une offre, la même règle partout (score, analyse IA, pastille affichée) :
 * un titre qui dit Stage / Alternance / Freelance l'emporte sur le champ de la source (souvent par défaut :
 * « Temps plein » → CDI, missions freelance classées « contract ») ; sinon le champ de la source, puis le titre,
 * puis la description. Pour CDD/CDI, la source reste prioritaire (« CDI » + titre « (CDD possible) » = CDI).
 */
export function contractOfJob(job: { contractType: string | null; title: string; description: string }): ContractKind | null {
  const fromTitle = contractFromTitle(job.title);
  if (fromTitle === "STAGE" || fromTitle === "ALTERNANCE" || fromTitle === "FREELANCE") return fromTitle;
  return normalizeContract(job.contractType) ?? fromTitle ?? contractFromText(job.description);
}

export function contractFromTitle(title: string): ContractKind | null {
  const t = normalizeText(title);
  if (/\b(freelance|free-lance|independant|portage salarial|\btjm\b)|\[mission\]/.test(t)) return "FREELANCE";
  if (/\b(alternance|alternant(e)?|apprenti(e|ssage)?|contrat pro)\b/.test(t)) return "ALTERNANCE";
  if (/\b(stage|stagiaire|internship|intern)\b/.test(t)) return "STAGE";
  if (/\b(interim|interimaire)\b/.test(t)) return "INTERIM";
  if (/\bcdd\b/.test(t)) return "CDD";
  if (/\bcdi\b/.test(t)) return "CDI";
  return null;
}

/** « 3 ans d'expérience minimum sur ces environnements », « 3 years of experience working with these technologies ». */
const PRODUCT_ANAPHORA =
  /^[^,]{0,30}?\b(sur|avec|dans|with|on|in|using)\s+(ces|cet|cette|ce|these|those|this|such)\s+(environnements?|solutions?|technologies?|technos?|outils|produits?|logiciels?|progiciels?|plateformes?|environments?|tools|products?|platforms?)\b/;

/**
 * Années d'expérience exigées sur des technos / produits précis : « 3 ans d'expérience sur Angular », ou
 * « … sur ces environnements » qui renvoie aux produits du titre et des deux phrases d'avant.
 * Renvoie les compétences visées (le score garde celles absentes du profil) et le nombre d'années, ou null.
 */
export function productExperienceRequired(title: string, description: string, extraSkills: Skill[] = []): { ids: string[]; years: number } | null {
  // Phrases : coupure après . ! ? ; suivi d'un espace (« Vue.js » reste entier) ou à la ligne.
  const sentences = description.split(/(?<=[.!?;])\s+|\n+/).map(normalizeText);
  const ids = new Set<string>();
  let years = 0;
  sentences.forEach((s, i) => {
    if (!/experience/.test(s) || /un plus|apprecie|idealement|serait un atout|bonus|nice to have/.test(s)) return;
    const m = s.match(/(\d{1,2})\s*\+?\s*(?:ans?|annees?|years?)\b/);
    const n = Number(m?.[1]);
    if (!m || n < 1 || n > 15) return;
    const tail = s.slice((m.index ?? 0) + m[0].length);
    // ponytail: texte sans majuscules, donc les alias sensibles à la casse (« Vue ») ne sont pas vus ici.
    const found = extractSkills(tail.slice(0, 80), extraSkills);
    if (PRODUCT_ANAPHORA.test(tail)) found.push(...extractSkills([title, sentences[i - 1] ?? "", sentences[i - 2] ?? ""].join("\n"), extraSkills));
    if (!found.length) return;
    found.forEach((id) => ids.add(id));
    years = Math.max(years, n);
  });
  return ids.size ? { ids: [...ids], years } : null;
}

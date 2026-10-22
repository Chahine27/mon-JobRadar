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
  if (/\b(lead|tech ?lead|principal|staff|head of|architecte?|manager)\b/.test(t)) return "lead";
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
    // « Disposant d'une expérience de plus de 20 ans en la matière », « Forts de 25 ans d'expérience » : l'ancienneté de l'ENTREPRISE, pas le poste.
    const before = t.slice(Math.max(0, start - 45), start);
    const after = t.slice(start + m[0].length, start + m[0].length + 25);
    if (/disposant d'une|forte? d'une|\bforte?s? de\b|riche d'une|depuis|fondee|creee/.test(before) || /en la matiere|d'existence|d'histoire/.test(after)) continue;
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
    // « indépendant » seul décrit souvent l'entreprise (« Groupe indépendant de conseil ») : freelance seulement
    // sur une ligne de contrat ou dans un vrai contexte de statut (« travailleur indépendant », « auto-entrepreneur »).
    if (
      (label && /\b(lib|liberal|tjm|independant)\b/.test(value)) ||
      /\b(freelance|free-lance|portage salarial|auto[- ]?entrepreneur|micro[- ]?entrepreneur)\b/.test(value) ||
      /\b(travailleurs?|statut|consultants?|developpeurs?|en|d'|profils?)\s*:?\s*independants?\b/.test(value)
    )
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
    [/\b(directeur|directrice|director|responsable|head of)\b/, "poste de direction / responsable"],
    [/\b(web )?analytics\b|\btracking\b|\btag management\b/, "web analytics / tracking"],
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
 * « Formation Angular assurée » compte ; « Formation : Bac+5 » (diplôme demandé) et « onboarding » seul ne comptent pas.
 * Le mentorat compte seulement s'il est pour toi (« vous bénéficierez d'un mentorat », « mentoring program ») :
 * « internal mentoring » dans les missions veut dire que c'est toi qui encadres.
 * Même chose pour la montée en compétences : « tu seras accompagné pour monter en compétence » compte, pas « forte envie
 * de monter en compétence » (exigence) ni « montée en compétence des équipes clientes » (mission).
 * « Formation continue » seule (accès Udemy) et « parcours d'intégration » sont des avantages d'accueil, pas une formation.
 */
export function trainingOffered(text: string): boolean {
  return /\b(formations? (en )?interne|formations? (assuree|proposee|prevue|offerte|complete|dediee|adaptee|personnalisee)s?|formations? ([\w+#.-]+ ){1,2}(assuree|proposee|prevue|offerte|dediee|adaptee|personnalisee)s?|nous (vous )?formons|vous (serez|etes) forme|(serez|etre|sera|seras) formee?s?|formee?s? (a|aux|sur) |parcours de formation|programme de formation|accompagne\S* (pour|dans|vers|sur) (ta |votre )?(montee|monter) en competences?|(ta|votre) montee en competences?|(beneficie\w*|profite\w*) d.(un|une) (mentor|tut)\w*|(mentorat|tutorat|mentoring|mentorship) (program\w*|dedie|personnalise|provided|offered)|(etre|serez|sera|seras) (mentore|tutore|parraine)e?s?|(be|get|will be) mentored|mentoring (from|by)|(mentor|tuteur|tutrice|parrain|marraine) (dedie|attitre)e?|accompagnee? (par|dans|tout au long))/.test(
    normalizeText(text),
  );
}

/** Texte normalisé, espaces insécables et retours à la ligne ramenés à une espace (« vous êtes étudiant »). */
const flat = (text: string) => normalizeText(text.replace(/\s+/g, " "));

/**
 * Stage réservé aux étudiants (convention, fin d'études, diplôme en cours) : renvoie la phrase trouvée, sinon null.
 * Une annonce ouverte aussi aux reconversions, autodidactes ou jeunes diplômés ne compte pas (cf. internshipOpenToGraduates).
 */
export function studentOnlyInternship(text: string): string | null {
  const m = flat(text).match(
    /\b(convention de stage|stages? (sont )?conventionnes?|sous convention|convention (obligatoire|tripartite|d'ecole)|stages? de fin d'etudes?|fin d'etudes?|pfe|cesure|final[- ]year|derniere annee|(vous preparez|tu prepares|preparant|en preparation d')( un| une| votre| ton)? (diplome|master|bac|formation|cursus|niveau)|en tant qu'etudiant|(actuellement|vous etes|tu es) (etudiant(\(e\)|·e|e)?s?|en (bac|master|m1|m2|ecole|derniere))|etudiant(\(e\)|·e|e)?s? (en|de) (ecole|master|universite|bac|m1|m2|informatique|niveau|derniere|etudes)|en formation (bac|master|m1|m2|ecole|d'ingenieur)|en cours de (formation|cursus|scolarite|diplome)|pour valider (ton|votre) diplome|currently (pursuing|enrolled|studying)|enrolled in|\d+(st|nd|rd|th)[- ]year students?|(master'?s?|engineering|bachelor'?s?|university|school) students?)\b/,
  );
  return m?.[0] ?? null;
}

/**
 * L'annonce accepte-t-elle aussi des candidats qui ne sont plus étudiants (« en reconversion », « recently graduated ») ?
 * « Convention de stage obligatoire » l'emporte : sans école, pas de stage.
 */
export function internshipOpenToGraduates(text: string): boolean {
  const t = flat(text);
  return (
    !/\bconvention (de stage )?obligatoire\b/.test(t) &&
    /\b(en reconversion|reconversion professionnelle|autodidacte|jeunes? diplomee?s?|(ou|or) (recemment |recently )?(diplomee?|graduated)|recent(ly)? graduat(e|ed)|demandeurs? d'emploi)\b/.test(t)
  );
}

/** Le stage débouche-t-il sur un CDI / CDD (« pré-embauche », « poursuivre en CDI », « internship-to-hire ») ? Phrase trouvée ou null. */
export function hireAfterInternship(text: string): string | null {
  const m = flat(text).match(
    /\b(pre-? ?embauche|(embauche|recrutement|poursuivre|continuer|rejoindre|transformer|transformation|convertir|evoluer)[^.;•]{0,40}\b(cdi|cdd)|(cdi|cdd) a la cle|(perspectives?|possibilites?|opportunites?) (d'|de |reelle d'|d'une )?(embauche|recrutement)|deboucher sur (une embauche|un cdi|un cdd|un poste)|intern(ship)?[- ]to[- ]hire|conver(t|sion)[^.;•]{0,30}(full[- ]time|permanent)|return offer)\b/,
  );
  return m?.[0] ?? null;
}

/**
 * Dispositif France Travail pour demandeur d'emploi cité dans l'annonce : POEI / POEC / AFPR (formation avant embauche)
 * ou PMSMP (immersion en entreprise). Ouverts sans être étudiant.
 */
export function jobseekerScheme(text: string): string | null {
  const t = flat(text);
  if (/\b(poei|poec|preparation operationnelle a l'emploi)\b/.test(t)) return "POEI";
  if (/\bafpr\b|action de formation prealable au recrutement/.test(t)) return "AFPR";
  if (/\bpmsmp\b|mise en situation en milieu professionnel|immersion professionnelle/.test(t)) return "PMSMP";
  return null;
}

/** « 3 ans (d'expérience) sur / en / d' » juste avant la techno (« sur Java et Angular » : les deux). */
const YEARS_BEFORE =
  /(\d{1,2})\s*\+?\s*(?:ans?|annees?|years?)\b(?:\s+(?:d'experience|of experience|minimum|min\.?|au moins|professionnelle?s?|confirmee?s?))*\s*(?:sur|en|avec|dans|de|d'|du|des|on|with|in|using)\s*(?:le |la |l'|les )?(?:[\w.#+-]+\s*(?:,|\/|et|ou|and|or)\s*){0,2}$/;
/** « Angular : 3 ans », « Angular (3 ans) », « Angular 3 ans » juste après la techno (pas « Angular, 2 ans d'expérience »). */
const YEARS_AFTER = /^[^\s,;]+\s*[:(–-]?\s*(\d{1,2})\s*\+?\s*(?:ans?|annees?|years?)\b/;

/**
 * La maîtrise de cette techno est-elle exigée (« 3 ans d'expérience sur Angular », « maîtrise d'Angular »,
 * « Angular indispensable ») ? Renvoie la raison (« 3 ans exigés », « maîtrise exigée ») ou null.
 * Des années ne comptent que si la phrase les relie à la techno : « Java et Angular, 2 ans d'expérience » = 2 ans sur le poste.
 */
export function masteryRequired(text: string, skill: Skill): string | null {
  const t = normalizeText(text);
  for (const i of skillIndexes(text, skill)) {
    const before = t.slice(Math.max(0, i - 70), i).split(/[.;\n!?]/).pop() ?? "";
    const after = t.slice(i, i + 70).split(/[.;\n!?]/)[0] ?? "";
    const years = [before.match(YEARS_BEFORE)?.[1], after.match(YEARS_AFTER)?.[1]].map(Number).filter((n) => n >= 2 && n <= 15);
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

/** « un plus », « apprécié », « nice to have » : ce qui suit n'est pas exigé. */
const OPTIONAL = /un plus|apprecie|idealement|serait un atout|bonus|nice to have|strongly preferred|would be a plus/;

/**
 * Texte de l'annonce sans ce qui n'est pas exigé : lignes « … un plus », et rubriques « Nice to have / Un plus »
 * (jusqu'au titre de rubrique suivant : ligne courte, sans puce ni ponctuation finale).
 */
export function requiredText(description: string): string {
  return splitRequired(description).required;
}

/** L'annonce coupée en deux : ce qui est exigé, et ce qui est présenté comme un plus. */
export function splitRequired(description: string): { required: string; optional: string } {
  let section = false;
  const required: string[] = [];
  const optional: string[] = [];
  for (const line of description.split(/\n+/)) {
    const t = normalizeText(line).trim();
    const heading = t.length > 0 && t.length <= 60 && !/^[•·*-]/.test(t) && !/[.,;:]$/.test(t);
    if (heading) section = OPTIONAL.test(t);
    (section || OPTIONAL.test(t) ? optional : required).push(line);
  }
  return { required: required.join("\n"), optional: optional.join("\n") };
}

/**
 * L'annonce exige-t-elle d'avoir déjà fait tourner des services en production (« built and run backend services
 * in production », « expérience de mise en production ») ? Ce n'est alors pas un poste junior, même sans années écrites.
 */
export function productionRequired(description: string): boolean {
  const t = normalizeText(requiredText(description));
  return /\b(you have|you've|vous avez|tu as|avoir)\s+(already\s+|deja\s+)?(built and run|built and operated|run|operated|shipped|deploye?d?|maintenu|fait tourner|mis)\b[^.\n]{0,60}\b(in production|en production)\b|\b(production experience|experience (de|en) (la )?(mise en )?production)\b/.test(t);
}

/** Anglais courant ou bilingue exigé, ou candidature en anglais. Les lignes « un plus » ne comptent pas. */
export function fluentEnglishRequired(description: string): boolean {
  const t = normalizeText(requiredText(description));
  return /\b(fluent|fluency in|bilingual|native)\s+(in\s+)?english\b|\benglish\b[^.\n]{0,20}\b(fluent|fluency|bilingual|courant|native)\b|\banglais\s+(courant|bilingue|fluide|professionnel courant|parfait|natif)\b|\bbilingue\s+(en\s+)?anglais\b|\bapply in english\b|\bcandidat(ure|ez|er) en anglais\b/.test(
    t,
  );
}

/** ESN, cabinet ou mission chez un client (« pour l'un de nos clients », « en mission chez ») : une porte d'entrée pour un junior. */
export function consultingFirm(text: string): boolean {
  return /\b(pour (le compte )?(de )?(l'un de |l'une de |un de |une de )?nos clients|en mission chez|missions? chez (nos|des|un|le) clients?|esn|ssii|societe de conseil|cabinet de conseil)\b/.test(normalizeText(text));
}

/**
 * Exigences au choix dans le texte (« expérience significative sur Angular ou React ») : chaque groupe est UNE exigence,
 * remplie par l'une des technos. Lu phrase par phrase, un ou deux mots de chaque côté du « ou ».
 */
export function alternativeSkills(text: string, extraSkills: Skill[] = []): string[][] {
  const groups: string[][] = [];
  for (const sentence of text.split(/[.;\n!?]/)) {
    for (const m of sentence.matchAll(/(\S+(?:\s+\S+)?)\s+(?:ou|or)\s+(\S+(?:\s+\S+)?)/gi)) {
      const left = extractSkills(m[1]!, extraSkills);
      const right = extractSkills(m[2]!, extraSkills);
      if (left.length && right.length && left.at(-1) !== right[0]) groups.push([left.at(-1)!, right[0]!]);
    }
  }
  return groups;
}

/** Langues étrangères autres que l'anglais (l'anglais courant a son propre malus). */
const FOREIGN_LANGUAGES: Array<[RegExp, string]> = [
  [/\b(allemand|german|deutsch)\b/, "allemand"],
  [/\b(espagnol|spanish|castillan)\b/, "espagnol"],
  [/\b(italien|italian)\b/, "italien"],
  [/\b(chinois|mandarin|chinese|cantonais)\b/, "chinois"],
  [/\b(japonais|japanese)\b/, "japonais"],
  [/\b(coreen|korean)\b/, "coréen"],
  [/\b(arabe|arabic)\b/, "arabe"],
  [/\b(russe|russian)\b/, "russe"],
  [/\b(portugais|portuguese)\b/, "portugais"],
  [/\b(neerlandais|dutch|flamand)\b/, "néerlandais"],
  [/\b(polonais|polish)\b/, "polonais"],
  [/\b(turc|turkish)\b/, "turc"],
  [/\b(suedois|swedish|danois|danish|norvegien|norwegian|finnois|finnish)\b/, "langue nordique"],
  [/\b(hebreu|hebrew|hindi|vietnamien|vietnamese|thai|grec|greek|roumain|romanian|tcheque|czech|hongrois|hungarian)\b/, "langue étrangère"],
];
const LANGUAGE_LEVEL =
  /\b(courant|courante|bilingue|natif|native|maternelle|fluent|fluency|maitrise|maitriser|maitrisez|exige|exigee|indispensable|obligatoire|requis|requise|imperatif|imperative|professionnel|professional|c1|c2|b2)\b/;

/**
 * Langue étrangère autre que l'anglais exigée (« Chinois courant », « maîtrise de l'allemand ») : dans les compétences
 * exigées lues par l'IA, sinon dans le texte, hors lignes « un plus ». Renvoie la langue, ou null.
 */
export function foreignLanguageRequired(description: string, aiRequired: string[] = []): string | null {
  for (const label of aiRequired) {
    const l = normalizeText(label);
    const hit = FOREIGN_LANGUAGES.find(([re]) => re.test(l));
    if (hit && !/\b(anglais|english)\b/.test(l)) return hit[1];
  }
  for (const line of normalizeText(requiredText(description)).split(/[\n.;!?]/)) {
    for (const [re, name] of FOREIGN_LANGUAGES) {
      const m = re.exec(line);
      if (!m) continue;
      // Le niveau doit être tout près de la langue : « chinois courant », « maîtrise de l'allemand », « German (C1) ».
      const around = line.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
      if (LANGUAGE_LEVEL.test(around)) return name;
    }
  }
  return null;
}

/** Le titre vise l'IA / les LLM / le machine learning (domaine à part, au-delà de la techno). */
export const AI_DOMAIN = /\b(ai|ia|llms?|genai|gen ai|machine learning|ml|mlops|deep learning|data scien\w*|intelligence artificielle|nlp)\b/;

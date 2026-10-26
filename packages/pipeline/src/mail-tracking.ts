import type { PrismaClient } from "@job-radar/db";
import { comparable, decodeEntities } from "@job-radar/job-normalizer";
import type { MailKind } from "@job-radar/shared";

/** Un mail reçu, déjà décodé (texte brut). */
export type InboxMail = {
  messageId: string;
  folder: string;
  from: string;
  fromName: string;
  subject: string;
  text: string;
  date: Date;
  /** Message-ID auxquels il répond (In-Reply-To + References). */
  replyTo: string[];
};

export type MailCursorRow = { folder: string; uidValidity: string; lastUid: number };

/** Boîte mail en LECTURE SEULE : rien n'est marqué comme lu, rien n'est déplacé. */
export type Inbox = {
  /** `terms` : noms d'entreprises et adresses à chercher en plus des mots-clés (Gmail). */
  /** `rescanSince` : relire aussi les mails déjà vus depuis cette date. */
  /** `skip` : lu dans l'enveloppe, évite de télécharger un mail déjà traité ou envoyé par toi. */
  fetchNew(opts: {
    since: Date;
    cursors: MailCursorRow[];
    terms?: string[];
    rescanSince?: Date;
    skip?: (m: { messageId: string; from: string }) => boolean;
  }): Promise<{ mails: InboxMail[]; cursors: MailCursorRow[] }>;
};

export type MailVerdict = { kind: MailKind; detail: string | null };
/**
 * L'IA lit chaque mail qui peut répondre à une candidature : laquelle (index dans `candidates`, null = aucune), quel
 * genre de réponse, en une phrase, et si elle est sûre. Sans IA (ou en panne) : les règles ci-dessous.
 */
export type MailClassifier = (
  mail: { subject: string; from: string; text: string },
  candidates: Array<{ company: string; title: string | null; since: Date }>,
) => Promise<{ index: number | null; verdict: MailVerdict | null; summary: string; certain: boolean }>;

// ───────── Tri par règles ─────────

const REJECTION = new RegExp(
  [
    "pas (pu |pouvoir )?donner (une |de )?suite", // ne pouvons pas donner suite, n'avons pas pu donner suite
    "donner(ons|a|ont)? pas (de |une )?suite", // nous ne donnerons pas suite
    "classee? sans suite",
    "pas (ete )?retenue?", // n'a pas été retenue, nous n'avons pas retenu
    "non retenue?",
    "ne retiendrons pas",
    "autres? (candidat|profil)", // retenu un autre candidat
    "ne correspond(ait)? pas",
    "poste (a ete |est )?pourvu",
    "(pas de|aucune?) (poste|besoin|ouverture|opportunite|recrutement)", // pas de poste à pourvoir, aucun besoin actuellement
    "avons le regret|regrett?ons de (vous|t)'informer",
    "malheureusement",
    "unfortunately|not (to )?(move|moving) forward|other candidates|not been selected|decided not to|position has been filled|will not be progressing|regret to inform|no (current )?(open positions|openings|vacancies)",
  ].join("|"),
);
const OFFER = /proposition d'embauche|promesse d'embauche|lettre d'offre|offre (d'emploi |de contrat )?(ferme|ecrite|formelle)|job offer|offer letter|pleased to offer|heureux de vous proposer le poste/;
const TEST = /test technique|exercice technique|cas pratique|coding (challenge|test|game)|technical (test|assessment|challenge)|take-home|hackerrank|codingame|codility/;
const INTERVIEW =
  /entretien|vous rencontrer|te rencontrer|echange (telephonique|en visio|visio)|appel (telephonique|visio)|vos disponibilites|tes disponibilites|creneau|calendly|interview|schedule a (call|meeting)|your availability|meet you/;
const INFO = /pretentions salariales|vos disponibilites|cv a jour|complement d'information|informations complementaires/;
const ACK =
  /bien recu|accuse de reception|candidature (a bien ete |a ete )?(recue|envoyee|enregistree|transmise)|merci (pour|de) (votre|ta) (candidature|interet)|thank you for (applying|your application|your interest)|application (has been )?(received|submitted)|we('ve| have) received your application|nous etudions votre candidature|examinerons votre candidature/;
/**
 * Phrases au conditionnel, typiques des accusés de réception : « sans réponse sous 3 semaines, considérez que votre
 * candidature n'a pas été retenue », « si votre profil correspond, nous vous proposerons un entretien ».
 * Ni un refus ni une invitation : retirées avant d'appliquer les règles.
 */
const CONDITIONAL = /\b(si|sans (reponse|retour|nouvelles)|en l'absence|a defaut|faute de|au-dela|passe ce delai|if|should|unless|otherwise|without (a )?(reply|response))\b/;

/** Avertissements anti-arnaque en bas des mails (« en cas de doute, ne donnez pas suite ») : rien à voir avec la candidature. */
const BOILERPLATE = /phishing|hameconnage|fraude|frauduleu|arnaque|escroquer|en cas de doute|canaux officiels|ne (communiquez|transmettez) jamais|never (share|send)|scam/;

/**
 * Phrases du mail, entières : codes HTML décodés (&eacute;) et lignes coupées recollées
 * (« Si vous n'avez pas de nouvelles…⏎ votre candidature ne correspond pas » reste UNE phrase, conditionnelle).
 */
function sentences(subject: string, text: string): string[] {
  const body = decodeEntities(text.slice(0, 8000))
    .split(/\n\s*\n/) // paragraphes
    .map((p) => p.replace(/\s*\n\s*/g, " "));
  return [subject, ...body]
    .join("\n")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !CONDITIONAL.test(sentence) && !BOILERPLATE.test(sentence));
}

/**
 * Ce que dit le mail, d'après des règles. "AMBIGUOUS" = accusé et invitation à la fois (l'IA tranche),
 * null = aucun signal.
 */
export function classifyMail(subject: string, text: string): MailVerdict | "AMBIGUOUS" | null {
  const raw = sentences(subject, text).join("\n");
  // Les refus commencent souvent par « merci pour votre candidature » et citent l'entretien passé : le refus prime.
  if (REJECTION.test(raw)) return { kind: "REJECTION", detail: null };
  if (OFFER.test(raw)) return { kind: "OFFER", detail: null };
  const ack = ACK.test(raw);
  const test = TEST.test(raw);
  const interview = INTERVIEW.test(raw) || test;
  if (interview && ack) return "AMBIGUOUS";
  if (interview) return { kind: "INTERVIEW", detail: test ? "Test technique" : INFO.test(raw) ? "Demande d'informations" : "Entretien" };
  if (ack) return { kind: "ACK", detail: null };
  return null;
}

// ───────── Bruit à ignorer ─────────

/** Alertes emploi, newsletters, « candidature consultée » : beaucoup de « candidature » / « offre », aucune réponse. */
const NOISE_FROM = /jobalert|job-alerts|jobs-listings|alerte?s?@|newsletter|digest|news@|marketing|info@welcometothejungle|noreply@glassdoor|jobs@indeed\.com|alert@indeed/;
const NOISE_SUBJECT = /a ete consultee|avez[- ]vous finalise|a ete vue|was viewed|has been viewed|nouvelles offres|dernieres offres|offres? recommandees?|selectionnees? pour (vous|toi)|ils recrutent|recrutent en ce moment|new jobs|offres? (qui|pour) (vous|toi)|jobs? (you may|for you)|alerte emploi|job alert|creation de (votre|ton) compte|activ(ez|e|er) (votre|ton) compte|verify your (email|account)|mot de passe|password/;

export function isNoise(mail: Pick<InboxMail, "from" | "subject">, self: string[]): boolean {
  const from = mail.from.toLowerCase();
  if (self.includes(from)) return true; // tes envois et les mails de Job Radar (même compte)
  const subject = mail.subject.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return NOISE_FROM.test(from) || NOISE_SUBJECT.test(subject) || /^(job radar|🟢|📝)/i.test(mail.subject.trim());
}

// ───────── Mail non distribué ─────────

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery/i;
const BOUNCE_SUBJECT = /delivery status notification|undeliver|non remis|non distribu|address not found|adresse introuvable|returned mail|delivery (has )?failed|delivery failure|echec de (la )?remise/;
/** Échec définitif seulement : « Delay » / « nouvel essai » veut dire que Gmail réessaie encore. */
const TEMPORARY = /\bdelay\b|retard|will (retry|keep trying)|nouvel essai|continuera d'essayer/;
const PERMANENT = /\b5\.\d\.\d+\b|\b55[0-4]\b|does not exist|n'existe pas|introuvable|user unknown|no such user|address not found|not found|rejected|refuse|unknown (user|recipient)|mailbox unavailable/;

const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[’`]/g, "'");

/**
 * Mail « Adresse introuvable » renvoyé par le serveur : laquelle des adresses où tu as envoyé une candidature
 * a été rejetée ? null si ce n'est pas un rejet définitif.
 */
export function bouncedAddress(mail: Pick<InboxMail, "from" | "fromName" | "subject" | "text">, sentTo: string[]): string | null {
  const subject = plain(mail.subject);
  if (!BOUNCE_FROM.test(`${mail.from} ${mail.fromName}`) && !BOUNCE_SUBJECT.test(subject)) return null;
  const text = plain(mail.text.slice(0, 10_000));
  if (TEMPORARY.test(subject) || !PERMANENT.test(text)) return null;
  return sentTo.find((a) => text.includes(a.toLowerCase())) ?? null;
}

/** Pourquoi le serveur a refusé : adresse inexistante, ou liste qui n'accepte que les mails internes (« Sender not allowed »). */
export function bounceReason(text: string): string {
  return /sender not allowed|not authenticated|only accepts messages|allowed senders|n'accepte que|expediteur non autorise/i.test(plain(text))
    ? "l'adresse n'accepte pas les mails venant de l'extérieur"
    : "adresse introuvable";
}

// ───────── Mauvaise adresse : départ de la personne, support client, renvoi vers le site carrière ─────────

const LEFT =
  /ne fait plus partie|a quitte (la societe|l'entreprise|le groupe|nos effectifs|ses fonctions|le cabinet)|n'est plus (en poste|dans (la societe|l'entreprise)|au sein|joignable|en fonction|collaborat)|ne travaille plus|no longer (with|works|employed|part of|at)|has left (the|our)/;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;

/**
 * Réponse automatique « X ne fait plus partie de la société, écrivez à Y » : la nouvelle adresse (null si aucune n'est
 * donnée). undefined : ce n'est pas ce cas.
 */
export function movedContact(mail: Pick<InboxMail, "from" | "text">, sentTo: string, self: string[]): { newEmail: string | null } | undefined {
  const text = plain(mail.text.slice(0, 4000));
  if (!LEFT.test(text)) return undefined;
  const others = [...new Set(text.match(EMAIL) ?? [])].filter((a) => a !== sentTo.toLowerCase() && a !== mail.from.toLowerCase() && !self.includes(a));
  const domain = domainOf(sentTo);
  return { newEmail: others.find((a) => domainOf(a) === domain) ?? others[0] ?? null };
}

const HELPDESK_FROM = /helpdesk|help desk|support|zendesk|freshdesk|servicedesk|service client|customer (care|service)|ticket/;
const HELPDESK_TEXT = /(demande|ticket|request|case|requete|incident)\s*(n°|no\.?|#)\s*\d+|votre (demande|ticket|requete) (a ete|est) (bien )?(enregistree|recue|creee|examinee|ouverte)|ticket (has been )?(created|opened)/;

/** Ticket ouvert par un support client (Zendesk, Freshdesk…) : l'adresse écrite était celle du support, pas du recrutement. */
export function isHelpdeskReply(mail: Pick<InboxMail, "from" | "fromName" | "subject" | "text">): boolean {
  return HELPDESK_FROM.test(plain(`${mail.from} ${mail.fromName}`)) && HELPDESK_TEXT.test(plain(`${mail.subject}\n${mail.text.slice(0, 4000)}`));
}

const CAREER =
  /(retrouver|consulter|voir|postuler|candidater|deposer|disponibles?).{0,80}(offres|sur (le|notre) site|carrieres?|jobs|recrutement|careers?|welcome ?to ?the ?jungle)|(apply|applications?).{0,40}(website|careers? (page|site)|portal)/;

/** Réponse qui renvoie vers le site carrière (« retrouvez nos offres sur … ») : le lien, ou null. */
/**
 * Seulement la réponse : le message d'origine cité en dessous (ta candidature, ta relance) est retiré. Sinon « je serais
 * heureux d'en discuter », écrit par toi, se lit comme une invitation à un entretien.
 */
export function replyOnly(text: string): string {
  const cut = text.search(
    /\n[ \t]*_{5,}\s*\n|-{3,}\s*(?:message d'origine|original message|message transf[ée]r[ée]|forwarded message)|\n[ \t]*(?:de|from)\s*:.{0,200}\n[ \t]*(?:envoy[ée]|sent|date)\s*:|\nle .{5,120} a [ée]crit\s*:|\non .{5,120} wrote:|\n>/i,
  );
  return (cut > 0 ? text.slice(0, cut) : text).trim();
}

export function careerSiteUrl(mail: Pick<InboxMail, "text">): string | null {
  const reply = replyOnly(mail.text).slice(0, 3000);
  if (!CAREER.test(plain(reply))) return null;
  return reply.match(/https?:\/\/[^\s<>")\]]+/)?.[0]?.replace(/[.,;]+$/, "") ?? null;
}

// ───────── Message d'absence ─────────

const AWAY =
  /\bje (?:suis|serai) (?:actuellement |aujourd'hui )?(?:absente?|en (?:conges?|vacances|deplacement|formation|arret)|hors du bureau|indisponible)|\b(?:absente?|en conges?) (?:du|jusqu|ce|cette|le|aujourd|a partir)|out of (?:the )?office|i am (?:currently )?(?:away|out of)|i will be (?:away|out)|i'?m (?:currently )?(?:away|out of)/;
const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const DATE = new RegExp(`(\\d{1,2})(?:er)? (${MONTHS.join("|")})(?: (\\d{4}))?`);
const DAY_MS = 86_400_000;

/**
 * Message d'absence (« je suis absent ce vendredi 16 octobre », « de retour le 20 octobre ») : pas une réponse. Renvoie
 * le jour où relancer (lendemain de la fin d'absence, ou date de retour ; 7 jours sans date) et une autre adresse
 * donnée, ou null si ce n'est pas un message d'absence.
 */
export function outOfOffice(mail: Pick<InboxMail, "from" | "text" | "date">, self: string[] = []): { back: Date; contact: string | null } | null {
  const text = plain(mail.text.slice(0, 2000)).replace(/\s+/g, " ");
  if (!AWAY.test(text)) return null;
  let back = new Date(mail.date.getTime() + 7 * DAY_MS);
  const m = text.match(DATE);
  if (m) {
    const year = m[3] ? Number(m[3]) : mail.date.getFullYear();
    let d = new Date(year, MONTHS.indexOf(m[2]!), Number(m[1]));
    if (!m[3] && d.getTime() < mail.date.getTime() - 60 * DAY_MS) d = new Date(year + 1, d.getMonth(), d.getDate());
    // « de retour le 20 » : ce jour-là ; « jusqu'au 20 », « absent ce vendredi 16 » : le lendemain.
    const returning = new RegExp(`(?:retour|back)[^.]{0,30}${m[0]}`).test(text);
    back = returning ? d : new Date(d.getTime() + DAY_MS);
  }
  const emails = [...new Set(text.match(EMAIL) ?? [])].filter((a) => a !== mail.from.toLowerCase() && !self.includes(a));
  return { back, contact: emails[0] ?? null };
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ───────── Association à une candidature ─────────

/** `senders` : adresses dont on a déjà reconnu un mail pour cette candidature (même outil de recrutement). */
/** `kinds` : genres de réponses déjà reçues pour cette candidature (ACK, REJECTION…). */
export type JobApplicationRef = { kind: "job"; id: string; company: string | null; title: string; since: Date; senders?: string[]; kinds?: string[] };
export type SpontaneousRef = {
  kind: "spontaneous";
  id: string;
  company: string;
  since: Date;
  messageId: string | null;
  sentTo: string | null;
  senders?: string[];
  kinds?: string[];
};
export type ApplicationRef = JobApplicationRef | SpontaneousRef;

const LEGAL = /\b(sas|sasu|sarl|sa|eurl|sca|scop|groupe?|group|france|international|holding|services?|consulting|technologies|tech|solutions)\b/g;
const PUBLIC_MAIL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|orange|free|sfr|laposte|wanadoo|protonmail)\./;

/** Nom d'entreprise comparable : « SOLENT SAS » → « solent ». Trop court ou trop vague → null. */
function companyKey(name: string | null): string | null {
  const k = comparable(name).replace(LEGAL, " ").replace(/\s+/g, " ").trim();
  return k.length >= 3 ? k : null;
}

const domainOf = (address: string) => address.toLowerCase().split("@")[1] ?? "";

/**
 * Le mail parle-t-il de cette entreprise ? Nom dans l'expéditeur, le sujet ou le texte, ou domaine de l'expéditeur.
 * Le nom peut être écrit autrement (« Eurofins Biologie Médicale » ↔ « Eurofins France Clinical Diagnostics -
 * Biologie Médicale ») : il suffit que chacun de ses mots y soit.
 */
function mentionsCompany(mail: InboxMail, company: string | null): boolean {
  const key = companyKey(company);
  if (!key) return false;
  const domain = domainOf(mail.from);
  if (!PUBLIC_MAIL.test(domain) && domain.replace(/[^a-z0-9]/g, "").includes(key.replace(/ /g, ""))) return true;
  const hay = ` ${comparable(`${mail.fromName} ${mail.subject} ${mail.text.slice(0, 6000)}`)} `;
  return hay.includes(` ${key} `) || key.split(" ").every((w) => hay.includes(` ${w} `));
}

/** Mots du titre retrouvés dans le mail : départage plusieurs candidatures chez la même entreprise. */
function titleOverlap(mail: InboxMail, title: string): number {
  const words = comparable(title).split(" ").filter((w) => w.length >= 3 && !/^(developpeur|developpeuse|engineer|ingenieur|stage|cdi)$/.test(w));
  const hay = ` ${comparable(`${mail.subject} ${mail.text.slice(0, 6000)}`)} `;
  return words.filter((w) => hay.includes(` ${w} `)).length;
}

/** Mots trop courants dans les intitulés pour distinguer deux postes. */
const GENERIC_WORD = /^(developpeur|developpeuse|developer|euse|se|rice|trice|ere|e|engineer|ingenieur|software|full|stack|fullstack|junior|senior|confirme|confirmed|cdi|cdd|stage|alternance|paris|france|remote|it|nb|x|h|f|the|and|for|en|de|des|du|la|le|les|et|pour|avec|chez)$/;
const distinctive = (words: string[]) => words.filter((w) => !GENERIC_WORD.test(w));

const POST_PATTERNS = [
  /\bposte (?:de |d'|:)\s*["«“]?\s*(.{3,90}?)\s*["»”]?\s*(?:[,.!;]|\s+chez\s|\s+au sein|\s+et\s|\s+a\s|\s+localise|$)/,
  /\bcandidature (?:pour|au) (?:le )?poste (?:de |d'|:)?\s*["«“]?\s*(.{3,90}?)\s*["»”]?\s*(?:[,.!;]|\s+chez\s|\s+au sein|\s+et\s|$)/,
  /\b(?:l'|notre |votre )offre\b(?: d'emploi)?\s*(?::|de\s)?\s*["«“]?\s*(.{3,90}?)\s*["»”]?\s*(?:[,.!;]|\s+chez\s|\s+au sein|\s+n'est|\s+est\s|$)/,
  /\bapplication (?:received )?for (?:the )?["«“]?(.{3,90}?)["»”]?(?: role| position)?\s*(?:[,.!;]|\s+at\s|\s+-\s|$)/,
];

/** Intitulé du poste écrit dans le mail (« pour le poste de X », « l'offre X », « application for X »), ou null. */
export function postInMail(mail: Pick<InboxMail, "subject" | "text">): string | null {
  for (const line of [mail.subject, ...decodeEntities(mail.text.slice(0, 3000)).split("\n")]) {
    const l = plain(line).replace(/\s+/g, " ");
    for (const re of POST_PATTERNS) {
      const m = l.match(re);
      if (m && comparable(m[1]).length >= 3) return m[1]!;
    }
  }
  return null;
}

/**
 * Le poste écrit dans le mail est-il celui de la candidature ? null = aucun poste lisible dans le mail.
 * Ses mots distinctifs (« ai native » dans « AI-Native Software Engineer ») doivent être à moitié dans l'intitulé ;
 * sans mot distinctif (« Développeur Full Stack Junior »), tous ses mots comptent.
 */
export function samePost(mail: Pick<InboxMail, "subject" | "text">, title: string): boolean | null {
  const post = postInMail(mail);
  if (!post) return null;
  const words = comparable(post).split(" ").filter(Boolean);
  const pool = distinctive(words).length ? distinctive(words) : words;
  const inTitle = new Set(comparable(title).split(" "));
  return pool.filter((w) => inTitle.has(w)).length / pool.length >= 0.5;
}

/** L'intitulé complet de l'offre est écrit dans le mail (nom d'entreprise différent : CNRS pour un labo, « Manhattan »). */
function titleInMail(mail: InboxMail, title: string): boolean {
  const t = comparable(title);
  const words = t.split(" ");
  if (words.length < 3 || !distinctive(words).some((w) => w.length >= 3)) return false;
  return ` ${comparable(`${mail.subject} ${mail.text.slice(0, 6000)}`)} `.includes(` ${t} `);
}

/** Réponse (« Re: », « TR: », « Fwd: ») venue du domaine de l'adresse où la spontanée est partie (rh@ → recrutement@). */
const isReply = (subject: string) => /^\s*(re|tr|fwd?|aw)\s*:/i.test(subject);
const sameDomain = (a: SpontaneousRef, mail: InboxMail) =>
  !!a.sentTo && isReply(mail.subject) && !PUBLIC_MAIL.test(domainOf(a.sentTo)) && domainOf(a.sentTo) === domainOf(mail.from);

/** Réponse d'une entreprise à une spontanée : « pas de poste », « aucune opportunité », « nous ne recrutons pas » = refus. */
const NO_OPENING = /malheureusement|(pas|aucune?) (d'|de )?(poste|besoin|ouverture|opportunite|offre)s?\b|ne recrut(ons|e) pas/;

/** « Merci de me supprimer de votre liste », « ne plus me contacter » : ne plus jamais écrire à cette personne. */
const OPT_OUT = /(supprimer|retirer|enlever|desinscrire)( de)? (votre|vos|la|ta) (liste|fichier|base|mailing)|ne (plus )?(me )?(contacter|recontacter|solliciter|ecrire)|remove me from|unsubscribe|do not contact/;

/** Réponse certaine à la spontanée : dans son fil, de l'adresse où elle est partie, ou « Re: / TR: Candidature spontanée ». */
const repliesTo = (a: SpontaneousRef, mail: InboxMail) =>
  (!!a.messageId && mail.replyTo.includes(a.messageId)) ||
  a.sentTo?.toLowerCase() === mail.from.toLowerCase() ||
  (isReply(mail.subject) && /candidature spontanee/.test(plain(mail.subject)));

const JOB_MARGIN_MS = 7 * 86_400_000;
/** Relecture complète (clic « Actualiser ») : jamais plus loin que 60 jours. */
const FULL_RESCAN_MS = 60 * 86_400_000;

/**
 * À quelle candidature ce mail répond-il ?
 * 1. réponse dans le fil d'une candidature spontanée (certain) ou depuis l'adresse à laquelle tu l'as envoyée ;
 * 2. sinon l'entreprise (puis le titre du poste pour départager), et seulement après la date de candidature.
 * Aucune → null (le mail est ignoré).
 */
export function matchApplication(mail: InboxMail, apps: ApplicationRef[]): ApplicationRef | null {
  // Spontanée : date d'envoi exacte. Offre : date du clic « postulé », parfois faite des jours après la vraie candidature.
  const after = (a: ApplicationRef) => mail.date.getTime() >= a.since.getTime() - (a.kind === "job" ? JOB_MARGIN_MS : 3_600_000);
  const spontaneous = apps.filter((a): a is SpontaneousRef => a.kind === "spontaneous" && after(a));
  const inThread = spontaneous.find((a) => a.messageId && mail.replyTo.includes(a.messageId));
  if (inThread) return inThread;
  const fromSentTo = spontaneous.find((a) => a.sentTo && a.sentTo.toLowerCase() === mail.from.toLowerCase()) ?? spontaneous.find((a) => sameDomain(a, mail));
  if (fromSentTo) return fromSentTo;

  const candidates = apps.filter((a) => after(a) && mentionsCompany(mail, a.company));
  if (candidates.length <= 1) return candidates[0] ?? null;
  // Plusieurs candidatures chez la même entreprise : le titre départage, sinon la plus récente.
  // Départage : 1. titre du poste cité ; 2. même expéditeur qu'un mail déjà reconnu pour cette candidature
  // (l'accusé puis le refus viennent du même outil) ; 3. offre plutôt que spontanée (les outils de recrutement
  // répondent aux offres, une spontanée reçoit une réponse dans son fil) ; 4. la plus récente.
  const from = mail.from.toLowerCase();
  const scored = candidates.map((a) => ({
    a,
    title: a.kind === "job" ? titleOverlap(mail, a.title) : 0,
    sender: a.senders?.some((s) => s.toLowerCase() === from) ? 1 : 0,
    job: a.kind === "job" ? 1 : 0,
  }));
  scored.sort((x, y) => y.title - x.title || y.sender - x.sender || y.job - x.job || y.a.since.getTime() - x.a.since.getTime());
  return scored[0]!.a;
}

/**
 * Candidatures auxquelles ce mail peut répondre, la plus probable d'abord (6 au plus), à départager par l'IA : celle de
 * matchApplication, puis celles dont un mail est déjà venu du même expéditeur (outil de recrutement partagé).
 */
export function candidateApplications(mail: InboxMail, apps: ApplicationRef[]): ApplicationRef[] {
  const best = matchApplication(mail, apps);
  if (best?.kind === "spontaneous" && ((best.messageId && mail.replyTo.includes(best.messageId)) || best.sentTo?.toLowerCase() === mail.from.toLowerCase() || sameDomain(best, mail))) return [best];
  const after = (a: ApplicationRef) => mail.date.getTime() >= a.since.getTime() - (a.kind === "job" ? JOB_MARGIN_MS : 3_600_000);
  const from = mail.from.toLowerCase();
  const others = apps.filter(
    (a) =>
      a !== best &&
      after(a) &&
      (mentionsCompany(mail, a.company) || a.senders?.some((x) => x.toLowerCase() === from) || (a.kind === "job" && titleInMail(mail, a.title))),
  );
  return [...(best ? [best] : []), ...others].slice(0, 6);
}

/**
 * Même réponse reçue deux fois pour la même candidature (copie, relance automatique, sujet un peu différent) : même
 * expéditeur, même genre de réponse, même jour. La candidature compte : un outil partagé écrit pour d'autres entreprises.
 */
const dupKey = (appId: string, from: string, kind: string, date: Date) => `${appId}|${from.toLowerCase()}|${kind}|${date.toISOString().slice(0, 10)}`;

// ───────── Orchestration ─────────

/** `bounced` : candidatures spontanées revenues « adresse introuvable ». */
export type MailTrackingReport = { read: number; matched: number; recorded: number; rejected: number; bounced: number };

/**
 * Lit les nouveaux mails (lecture seule), reconnaît les réponses à tes candidatures et met les statuts à jour :
 * un refus passe l'offre en « Refusée ». Les mails sans candidature correspondante sont ignorés.
 */
export async function trackApplicationMails(opts: {
  prisma: PrismaClient;
  inbox: Inbox;
  /** Tes adresses : leurs mails (envois, notifications Job Radar) ne sont jamais des réponses. */
  self: string[];
  classify?: MailClassifier;
  /**
   * Vérification demandée par un clic : relit tous les mails depuis la plus ancienne candidature (60 jours au plus),
   * pas seulement les nouveaux. Sinon (passage automatique) : les nouveaux mails, plus la relecture des candidatures
   * marquées depuis la dernière fois.
   */
  full?: boolean;
  /**
   * Mails déjà lus et sans rapport avec tes candidatures : retenus ici (en mémoire, le temps que l'appli tourne), jamais
   * en base, pour ne pas les redonner à l'IA à chaque passage.
   */
  ignored?: Set<string>;
  now?: Date;
  log?: (m: string) => void;
}): Promise<MailTrackingReport> {
  const { prisma, log = () => {} } = opts;
  const report: MailTrackingReport = { read: 0, matched: 0, recorded: 0, rejected: 0, bounced: 0 };
  const self = opts.self.map((s) => s.toLowerCase());

  const applied = await prisma.jobEvent.findMany({
    where: { type: "STATUS_CHANGED", toValue: "APPLIED", job: { status: { in: ["APPLIED", "REJECTED"] } } },
    orderBy: { createdAt: "asc" },
    distinct: ["jobId"],
    select: { createdAt: true, job: { select: { id: true, title: true, company: true, status: true } } },
  });
  const sent = await prisma.spontaneousApplication.findMany({
    where: { sentAt: { not: null } },
    select: { id: true, sentAt: true, sentTo: true, messageId: true, leadId: true, lead: { select: { name: true } } },
  });
  const apps: ApplicationRef[] = [
    ...applied.map((e): JobApplicationRef => ({ kind: "job", id: e.job.id, company: e.job.company, title: e.job.title, since: e.createdAt })),
    ...sent.map((s): SpontaneousRef => ({ kind: "spontaneous", id: s.id, company: s.lead.name, since: s.sentAt!, messageId: s.messageId, sentTo: s.sentTo })),
  ];
  if (apps.length === 0) return report; // rien à suivre : on ne lit pas la boîte
  for (const m of await prisma.applicationMail.findMany({ where: { dismissed: false }, select: { jobId: true, spontaneousId: true, fromAddress: true, kind: true } })) {
    const app = apps.find((a) => a.id === (m.jobId ?? m.spontaneousId));
    if (app) {
      app.senders = [...(app.senders ?? []), m.fromAddress];
      app.kinds = [...(app.kinds ?? []), m.kind];
    }
  }

  const since = new Date(Math.min(...apps.map((a) => a.since.getTime())) - 86_400_000);
  const cursorRows = await prisma.mailCursor.findMany({ select: { folder: true, uidValidity: true, lastUid: true, checkedAt: true } });
  const cursors = cursorRows.map(({ checkedAt: _, ...c }) => c);
  // Candidature marquée depuis la dernière lecture : son accusé a pu arriver AVANT (lu puis ignoré). On relit ses 7 jours.
  const lastCheck = Math.min(...cursorRows.map((c) => c.checkedAt.getTime()));
  const marked = apps.filter((a) => a.since.getTime() > lastCheck).map((a) => a.since.getTime());
  // Clic sur « Actualiser » : tout depuis la plus ancienne candidature (spontanée : sa date d'envoi), 60 jours au plus.
  const oldest = Math.min(...apps.map((a) => a.since.getTime() - (a.kind === "job" ? JOB_MARGIN_MS : 3_600_000)));
  const fullSince = new Date(Math.max(oldest, (opts.now ?? new Date()).getTime() - FULL_RESCAN_MS));
  const rescanSince = !cursorRows.length ? undefined : opts.full ? fullSince : marked.length ? new Date(Math.min(...marked) - JOB_MARGIN_MS) : undefined;
  // Entreprises (sans « SAS », « Group »…) et adresses déjà connues : un mail qui ne dit ni « candidature » ni « poste » est lu quand même.
  const terms = [
    ...apps.map((a) => (a.company ?? "").replace(new RegExp(LEGAL.source, "gi"), " ").replace(/\s+/g, " ").trim()),
    ...apps.flatMap((a) => [...(a.kind === "spontaneous" && a.sentTo ? [a.sentTo] : []), ...(a.senders ?? [])]),
  ].filter((t) => !self.includes(t.toLowerCase()));
  // Déjà traités (gardés en base) : ni retéléchargés ni relus. Tes envois non plus (ils portent le CV et la lettre).
  const done = new Set((await prisma.applicationMail.findMany({ where: { receivedAt: { gte: since } }, select: { messageId: true } })).map((m) => m.messageId));
  const { mails, cursors: next } = await opts.inbox.fetchNew({
    since,
    cursors,
    terms,
    ...(rescanSince ? { rescanSince } : {}),
    skip: (m) => done.has(m.messageId) || !!opts.ignored?.has(m.messageId) || self.includes(m.from.toLowerCase()),
  });
  report.read = mails.length;

  const known = new Set(
    (await prisma.applicationMail.findMany({ where: { messageId: { in: mails.map((m) => m.messageId) } }, select: { messageId: true } })).map((m) => m.messageId),
  );
  const seen = new Set(
    (
      await prisma.applicationMail.findMany({
        where: { receivedAt: { gte: since }, dismissed: false },
        select: { jobId: true, spontaneousId: true, fromAddress: true, kind: true, receivedAt: true },
      })
    ).map((m) => dupKey(m.jobId ?? m.spontaneousId ?? "", m.fromAddress, m.kind, m.receivedAt)),
  );
  /** Mail sans rapport : pas en base, seulement retenu en mémoire pour ne pas le redonner à l'IA. */
  const forget = (mail: InboxMail) => {
    opts.ignored?.add(mail.messageId);
    known.add(mail.messageId);
  };
  /**
   * Enregistre une réponse. false = déjà en base : un autre passage l'a lue en même temps (l'API au démarrage pendant
   * « pnpm mails:retrack ») ; on la saute au lieu de tout arrêter.
   */
  const save = (data: Parameters<typeof prisma.applicationMail.create>[0]["data"]) =>
    prisma.applicationMail.create({ data }).then(
      () => true,
      (err: unknown) => {
        if ((err as { code?: string }).code === "P2002") return false;
        throw err;
      },
    );
  /** Mail gardé sans lien (jamais affiché), quand il a changé quelque chose (adresse rejetée, personne partie…). */
  const remember = (mail: InboxMail, kind: string, detail: string | null) =>
    prisma.applicationMail.create({
      data: { messageId: mail.messageId, kind, detail, subject: mail.subject.slice(0, 500), fromAddress: mail.from.slice(0, 320), receivedAt: mail.date, dismissed: true },
    });

  /**
   * L'adresse n'était pas la bonne (rejetée, personne partie, support client) : la candidature n'est pas arrivée
   * au recrutement. Elle redevient « à envoyer » (lettre gardée), l'entreprise « À contacter », avec une note ;
   * nouvelle adresse donnée par la réponse → elle remplace l'ancienne.
   */
  async function wrongAddress(spontaneousId: string, mail: InboxMail, p: { kind: string; detail: string; note: string; newEmail?: string | null }) {
    const s = sent.find((x) => x.id === spontaneousId)!;
    const bad = s.sentTo ?? "";
    const lead = await prisma.companyLead.findUnique({ where: { id: s.leadId }, select: { status: true, contactEmail: true, notes: true } });
    const sameEmail = lead?.contactEmail?.toLowerCase() === bad.toLowerCase();
    await prisma.$transaction([
      remember(mail, p.kind, p.detail),
      prisma.spontaneousApplication.update({ where: { id: s.id }, data: { sentAt: null, sentTo: null, messageId: null } }),
      prisma.companyLead.update({
        where: { id: s.leadId },
        data: {
          ...(lead?.status === "CONTACTED" ? { status: "TO_CONTACT" } : {}),
          ...(sameEmail || !lead?.contactEmail ? { contactEmail: p.newEmail ?? null } : {}),
          notes: [lead?.notes, `${p.note} (${mail.date.toLocaleDateString("fr-FR")})`].filter(Boolean).join("\n").slice(0, 2000),
        },
      }),
    ]);
    known.add(mail.messageId);
    s.sentTo = null;
    const i = apps.findIndex((a) => a.id === s.id);
    if (i >= 0) apps.splice(i, 1);
    report.bounced++;
    log(`Candidature spontanée à refaire (${s.lead.name}) : ${p.detail}`);
  }

  for (let mail of mails.sort((a, b) => a.date.getTime() - b.date.getTime())) {
    if (known.has(mail.messageId)) continue;
    // Rejet du serveur (adresse introuvable, ou n'accepte pas les mails extérieurs).
    const pending = sent.filter((x) => x.sentTo && x.sentAt && mail.date.getTime() >= x.sentAt.getTime() - 3_600_000);
    const bounced = bouncedAddress(mail, pending.map((x) => x.sentTo!));
    if (bounced) {
      const s = pending.find((x) => x.sentTo!.toLowerCase() === bounced.toLowerCase())!;
      const reason = bounceReason(mail.text);
      await wrongAddress(s.id, mail, { kind: "BOUNCE", detail: `${bounced} : ${reason}`, note: `Email ${bounced} rejeté : ${reason}. Cherche une autre adresse.` });
      continue;
    }
    if (isNoise(mail, self)) continue;
    // Le mail entier sert à retrouver la candidature (le message cité dessous la nomme souvent) ;
    // tout ce qui suit lit la réponse seule, sans ce message d'origine.
    const candidates = candidateApplications(mail, apps);
    if (!candidates.length) continue;
    const full = mail;
    mail = { ...mail, text: replyOnly(mail.text) };
    // Message d'absence : pas une réponse, pas besoin de l'IA. La relance attendra le retour.
    const away = outOfOffice(mail, self);
    const awayApp = away ? (candidates.length === 1 ? candidates[0]! : matchApplication(full, apps)) : null;
    if (away && awayApp) {
      const when = away.back.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
      await save({
        messageId: mail.messageId,
        ...(awayApp.kind === "job" ? { jobId: awayApp.id } : { spontaneousId: awayApp.id }),
        kind: "AWAY",
        detail: isoDay(away.back),
        summary: `Absent : relance possible à partir du ${when}.${away.contact ? ` Autre contact donné : ${away.contact}.` : ""}`,
        subject: mail.subject.slice(0, 500),
        fromAddress: mail.from.slice(0, 320),
        receivedAt: mail.date,
      });
      known.add(mail.messageId);
      report.matched++;
      report.recorded++;
      continue;
    }

    let app: ApplicationRef | null = null;
    let verdict: MailVerdict | null = null;
    let summary: string | null = null;
    let review = false;
    let answered = Boolean(opts.classify); // false = pas d'IA ou IA en panne : règles, et le mail sera relu
    if (opts.classify) {
      try {
        const r = await opts.classify(
          { subject: mail.subject, from: mail.from, text: mail.text.slice(0, 4000) },
          candidates.map((a) => ({ company: a.company ?? "", title: a.kind === "job" ? a.title : null, since: a.since })),
        );
        // Aucune candidature : sauf réponse dans le fil d'une spontanée (départ, support, site carrière, vus plus bas).
        const thread = candidates.length === 1 && candidates[0]!.kind === "spontaneous" ? candidates[0]! : null;
        // Vraie réponse (refus, accusé…) sans candidature choisie : l'IA hésite entre plusieurs postes de la même
        // entreprise. La plus probable d'après l'entreprise, à vérifier par toi.
        const unsure = r.index === null && r.verdict ? matchApplication(full, apps) : null;
        app = r.index !== null ? candidates[r.index]! : (unsure ?? thread);
        verdict = r.index !== null || unsure ? r.verdict : null;
        summary = r.summary || null;
        review = !r.certain || !!unsure;
      } catch {
        answered = false;
      }
    }
    if (!answered) {
      // Rattachement par l'entreprise seulement (pas par l'expéditeur : outil partagé), et règles.
      // Un mail ambigu (accusé + mot « entretien ») est pris pour un accusé.
      app = matchApplication(full, apps);
      if (!app) continue;
      const byRules = classifyMail(mail.subject, mail.text);
      verdict = byRules === "AMBIGUOUS" ? { kind: "ACK", detail: null } : byRules;
    }
    if (!app) {
      // Lu par l'IA : ne répond à aucune candidature. Gardé pour ne pas le redonner à l'IA.
      forget(mail);
      continue;
    }
    // Le mail nomme un autre poste que celui choisi : la candidature chez cette entreprise qui lui correspond, sinon
    // aucune (postulé hors de Job Radar). Gardé sans lien, avec le poste, pour ne pas le redonner à l'IA.
    if (app.kind === "job" && samePost(mail, app.title) === false) {
      const other = candidates.find((a) => a.kind === "job" && samePost(mail, a.title) === true);
      if (!other) {
        await save({ messageId: mail.messageId, kind: "OTHER_POST", detail: postInMail(mail)!.slice(0, 200), subject: mail.subject.slice(0, 500), fromAddress: mail.from.slice(0, 320), receivedAt: mail.date, dismissed: true });
        known.add(mail.messageId);
        continue;
      }
      app = other;
    }
    report.matched++;

    if (app.kind === "spontaneous" && app.sentTo) {
      // « X ne fait plus partie de la société, écrivez à Y » : Y devient l'adresse de contact, la candidature est à renvoyer.
      const moved = movedContact(mail, app.sentTo, self);
      if (moved) {
        const detail = moved.newEmail ? `${app.sentTo} a quitté l'entreprise, nouvelle adresse : ${moved.newEmail}` : `${app.sentTo} a quitté l'entreprise`;
        await wrongAddress(app.id, mail, {
          kind: "MOVED",
          detail,
          note: moved.newEmail ? `${detail} : candidature à renvoyer.` : `${detail} : cherche une autre adresse.`,
          newEmail: moved.newEmail,
        });
        continue;
      }
      // Ticket ouvert par le support client : la lettre n'arrivera pas au recrutement.
      if (isHelpdeskReply(mail)) {
        await wrongAddress(app.id, mail, {
          kind: "WRONG_ADDRESS",
          detail: `${app.sentTo} est l'adresse du support client`,
          note: `${app.sentTo} est l'adresse du support client (ticket ouvert), pas du recrutement : cherche une adresse RH.`,
        });
        continue;
      }
    }

    // « Postulez sur notre site » : pour une spontanée, la candidature s'arrête là (à refaire sur leur site).
    // Pour une offre, ce n'est qu'un accusé qui cite leurs autres offres.
    const career = !verdict || verdict.kind === "ACK" ? careerSiteUrl(mail) : null;
    if (career) verdict = app.kind === "spontaneous" ? { kind: "CAREER_SITE", detail: career } : { kind: "ACK", detail: `Te renvoie vers son site carrière : ${career}` };
    if (app.kind === "spontaneous" && verdict?.kind === "ACK" && NO_OPENING.test(plain(mail.text))) verdict = { kind: "REJECTION", detail: null };
    // Une personne a répondu à la spontanée, même sans étape reconnue (« je ne gère pas les recrutements, je fais suivre,
    // supprimez-moi de votre liste ») : gardée quand même, sinon une relance part vers quelqu'un qui a déjà répondu (Amelkis).
    if (app.kind === "spontaneous" && (!verdict || verdict.kind === "ACK") && repliesTo(app, mail)) {
      const optOut = OPT_OUT.test(plain(mail.text));
      if (!verdict || optOut) verdict = { kind: "ACK", detail: optOut ? `Ne plus écrire à ${app.sentTo ?? "cette adresse"} : demandé dans sa réponse` : "Réponse reçue" };
    }
    if (!verdict) {
      // Lu et sans rapport avec une étape de candidature : gardé pour ne pas redemander à l'IA à chaque relecture.
      if (answered || !opts.classify) {
        forget(mail);
      }
      continue;
    }
    // Refus arrivé avant le clic « postulé » : sans doute une candidature précédente au même poste, à vérifier par toi.
    if (verdict.kind === "REJECTION" && mail.date < app.since) review = true;
    // Même réponse déjà reçue pour cette candidature, sans nom de poste (4 refus Theodo identiques pour 4 offres) :
    // elle va à une autre candidature chez cette entreprise qui ne l'a pas encore, à vérifier par toi.
    if (app.kind === "job" && app.kinds?.includes(verdict.kind) && samePost(mail, app.title) === null) {
      const kind = verdict.kind;
      const sibling = candidates.find((a) => a !== app && a.kind === "job" && !a.kinds?.includes(kind) && mentionsCompany(full, a.company));
      if (sibling) {
        app = sibling;
        review = true;
      }
    }
    if (seen.has(dupKey(app.id, mail.from, verdict.kind, mail.date))) {
      forget(mail);
      continue;
    }
    if (career && app.kind === "spontaneous") {
      const s = sent.find((x) => x.id === app!.id)!;
      const lead = await prisma.companyLead.findUnique({ where: { id: s.leadId }, select: { notes: true } });
      if (!lead?.notes?.includes(career)) {
        await prisma.companyLead.update({ where: { id: s.leadId }, data: { notes: [lead?.notes, `Réponse : postuler sur leur site carrière ${career}`].filter(Boolean).join("\n").slice(0, 2000) } });
      }
    }

    const fresh = await save({
      messageId: mail.messageId,
      ...(app.kind === "job" ? { jobId: app.id } : { spontaneousId: app.id }),
      kind: verdict.kind,
      detail: verdict.detail,
      summary,
      needsReview: review,
      subject: mail.subject.slice(0, 500),
      fromAddress: mail.from.slice(0, 320),
      receivedAt: mail.date,
    });
    known.add(mail.messageId);
    if (!fresh) continue;
    seen.add(dupKey(app.id, mail.from, verdict.kind, mail.date));
    app.senders = [...(app.senders ?? []), mail.from];
    app.kinds = [...(app.kinds ?? []), verdict.kind];
    report.recorded++;
    // Un refus change le statut tout seul seulement si l'IA est sûre d'elle (sinon : « à vérifier »).
    if (verdict.kind === "REJECTION" && app.kind === "job" && !review) {
      const job = await prisma.job.findUnique({ where: { id: app.id }, select: { status: true } });
      if (job?.status === "APPLIED") {
        await prisma.$transaction([
          prisma.job.update({ where: { id: app.id }, data: { status: "REJECTED" } }),
          prisma.jobEvent.create({ data: { jobId: app.id, type: "STATUS_CHANGED", fromValue: "APPLIED", toValue: "REJECTED" } }),
        ]);
        report.rejected++;
      }
    }
  }
  for (const c of next) {
    await prisma.mailCursor.upsert({ where: { folder: c.folder }, create: { ...c, checkedAt: new Date() }, update: { ...c, checkedAt: new Date() } });
  }
  if (report.recorded) log(`Candidatures : ${report.recorded} réponse(s) reconnue(s) dans tes mails, ${report.rejected} refus`);
  return report;
}

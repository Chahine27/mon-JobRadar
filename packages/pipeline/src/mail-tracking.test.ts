import { describe, expect, it } from "vitest";
import {
  type ApplicationRef,
  type InboxMail,
  bounceReason,
  bouncedAddress,
  careerSiteUrl,
  classifyMail,
  outOfOffice,
  replyOnly,
  isHelpdeskReply,
  isNoise,
  matchApplication,
  movedContact,
  postInMail,
  samePost,
  candidateApplications,
} from "./mail-tracking";

describe("mauvaise adresse de candidature spontanée", () => {
  it("rejet Office 365 « Sender not allowed » (postmaster) : rejet définitif, raison précise", () => {
    const text =
      "Your message to recrutement@iliadeconsulting.com couldn't be delivered.\nThe group recrutement only accepts messages from people in its organization or on its allowed senders list.\nStatus code 550 5.7.133";
    const m = { from: "postmaster@iliadeconsulting.com", fromName: "", subject: "Candidature spontanée – Développeur full stack – Chahine MEHADJI", text };
    expect(bouncedAddress(m, ["recrutement@iliadeconsulting.com"])).toBe("recrutement@iliadeconsulting.com");
    expect(bounceReason(text)).toBe("l'adresse n'accepte pas les mails venant de l'extérieur");
    expect(bounceReason("550 5.1.1 does not exist")).toBe("adresse introuvable");
  });

  it("« X ne fait plus partie de la société, écrivez à Y » : nouvelle adresse", () => {
    const text = "Bonjour,\n\nSophie LAMBERT ne fait plus partie de la société.\nVeuillez adresser votre message à Julie MOREAU (julie.moreau@naxos.fr).";
    expect(movedContact({ from: "sophie.lambert@naxos.fr", text }, "sophie.lambert@naxos.fr", [])).toEqual({ newEmail: "julie.moreau@naxos.fr" });
    expect(movedContact({ from: "sophie.lambert@naxos.fr", text: "Sophie a quitté l'entreprise." }, "sophie.lambert@naxos.fr", [])).toEqual({ newEmail: null });
    expect(movedContact({ from: "rh@acme.fr", text: "Je suis absente jusqu'au 12 octobre." }, "rh@acme.fr", [])).toBeUndefined();
  });

  it("ticket du support client (PrestaShop Helpdesk)", () => {
    const m = {
      from: "support@prestashop.com",
      fromName: "PrestaShop Helpdesk",
      subject: "Demande #870413 : L'aide est en route",
      text: "Merci de nous avoir contactés ! Votre demande #870413 est actuellement examinée par nos équipes.",
    };
    expect(isHelpdeskReply(m)).toBe(true);
    expect(isHelpdeskReply({ ...m, fromName: "Camille, RH", from: "rh@prestashop.com" })).toBe(false);
  });

  it("renvoi vers le site carrière (sans lire le message d'origine cité)", () => {
    const text =
      "Bonjour,\n\nVous pourrez retrouver toutes les offres d'emploi sur le site : https://jobs.cmacgm-group.com/\n\nCordialement,\nCandice\n\n-----Message d'origine-----\nDe : Chahine\nVoir https://example.com";
    expect(careerSiteUrl({ text })).toBe("https://jobs.cmacgm-group.com/");
    const alteca =
      `Bonjour,

Nous avons bien reçu votre e-mail et vous remercions de l’intérêt que vous portez à notre entreprise.

Afin que votre candidature puisse être étudiée dans les meilleures conditions, nous vous invitons à postuler directement via notre site carrière en utilisant le lien ci-dessous :

Rejoignez l'aventure ALTECA
https://www.alteca.fr/rejoignez-laventure-alteca/

Cordialement`;
    expect(careerSiteUrl({ text: alteca })).toBe("https://www.alteca.fr/rejoignez-laventure-alteca/");
    expect(careerSiteUrl({ text: "Merci, nous revenons vers vous.\n-----Message d'origine-----\nretrouvez nos offres sur https://x.fr" })).toBeNull();
  });
});

describe("bouncedAddress : mail non distribué", () => {
  const sent = ["claire.bernard@agorapulse.com", "rh@acme.fr"];
  const gmail = { from: "mailer-daemon@googlemail.com", fromName: "Mail Delivery Subsystem", subject: "Delivery Status Notification (Failure)" };
  it("rejet définitif → l'adresse concernée", () => {
    expect(bouncedAddress({ ...gmail, text: "Votre message n'est pas parvenu à claire.bernard@agorapulse.com. 550 5.1.1 does not exist." }, sent)).toBe("claire.bernard@agorapulse.com");
  });
  it("retard (Gmail réessaie), autre adresse, ou mail normal → null", () => {
    expect(bouncedAddress({ ...gmail, subject: "Delivery Status Notification (Delay)", text: "rh@acme.fr : will retry. 451 4.4.1" }, sent)).toBeNull();
    expect(bouncedAddress({ ...gmail, text: "inconnu@x.fr : 550 5.1.1 does not exist" }, sent)).toBeNull();
    expect(bouncedAddress({ from: "rh@acme.fr", fromName: "Acme", subject: "Votre candidature", text: "rh@acme.fr : poste introuvable ?" }, sent)).toBeNull();
  });
});

describe("classifyMail : ce que dit le mail", () => {
  it.each([
    [
      "accusé de réception avec la phrase « sans réponse… pas retenue » (pas un refus)",
      "Votre candidature chez Escape",
      "Bonjour Chahine, nous avons bien reçu votre candidature pour le poste de Développeur Vue.js. Sans réponse de notre part sous 3 semaines, considérez que votre candidature n'a pas été retenue.",
      "ACK",
    ],
    [
      "accusé avec « si votre profil correspond… entretien » (pas une invitation)",
      "Merci pour votre candidature",
      "Merci pour votre candidature ! Si votre profil correspond à nos attentes, nous vous contacterons pour un entretien.",
      "ACK",
    ],
    ["accusé LinkedIn", "Chahine, votre candidature a été envoyée à SOLENT", "Votre candidature a été envoyée à SOLENT.", "ACK"],
    [
      "refus qui commence par « merci pour votre candidature »",
      "Suite à votre candidature",
      "Merci pour votre candidature et le temps accordé lors de notre entretien. Malheureusement, nous ne pouvons pas donner suite.",
      "REJECTION",
    ],
    [
      "refus « on garde votre CV » (compte comme un refus)",
      "Votre candidature",
      "Nous ne donnerons pas suite à votre candidature, mais nous conservons votre CV pour de futures opportunités.",
      "REJECTION",
    ],
    ["refus : autre candidat retenu", "Re: Candidature", "Nous avons retenu un autre candidat pour ce poste.", "REJECTION"],
    [
      "refus « pas de poste à pourvoir » (cas AGESYS, spontanée)",
      "TR: Tr : Candidature spontanée – Développeur full stack",
      "Nous avons bien reçu votre candidature et vous remercions de l'intérêt que vous manifestez pour notre société.\n\nCependant, aujourd'hui nous n'avons pas de poste à pourvoir.",
      "REJECTION",
    ],
    ["refus en anglais", "Your application", "Unfortunately, we have decided not to move forward with your application.", "REJECTION"],
    ["invitation à un entretien", "Entretien - Développeur Java", "Bonjour, nous aimerions vous rencontrer. Quelles sont vos disponibilités la semaine prochaine ?", "INTERVIEW"],
    ["test technique", "Prochaine étape", "Voici le lien vers le test technique sur CodinGame, à réaliser avant vendredi.", "INTERVIEW"],
    ["proposition", "Proposition", "Nous sommes heureux de vous proposer le poste ; vous trouverez la promesse d'embauche en pièce jointe.", "OFFER"],
    ["sans rapport", "Facture de septembre", "Votre facture est disponible.", null],
    [
      "phrase conditionnelle coupée par un retour à la ligne (cas ABYLSEN : accusé, pas refus)",
      "Merci de votre candidature pour le poste de Développeur C# / .NET X/ F/H",
      "Nous avons bien reçu votre candidature. Si vous n'avez pas de retour de notre part sous 15 jours, considérez\nque votre candidature ne correspond pas, à date, à notre recherche.",
      "ACK",
    ],
    [
      "avertissement anti-arnaque en bas du mail (cas ASSYSTEM : accusé, pas refus)",
      "Réception de votre candidature",
      "Nous avons bien reçu votre candidature.\n\nAttention aux tentatives de fraude : en cas de doute, nous vous recommandons de ne pas donner suite et de vous rapprocher de nos équipes via nos canaux officiels.",
      "ACK",
    ],
    [
      "refus écrit en codes HTML (cas Talan)",
      "Votre candidature chez Talan",
      "Apr&egrave;s &eacute;tude de votre candidature, nous avons le regret de vous informer que votre profil ne r&eacute;pond pas.",
      "REJECTION",
    ],
  ] as const)("%s", (_name, subject, text, expected) => {
    const v = classifyMail(subject, text);
    expect(v === null || v === "AMBIGUOUS" ? v : v.kind).toBe(expected);
  });

  it("test technique : précisé dans le détail", () => {
    expect(classifyMail("Prochaine étape", "Un test technique sur HackerRank.")).toEqual({ kind: "INTERVIEW", detail: "Test technique" });
  });

  it("accusé ET vraie invitation : à faire trancher par l'IA", () => {
    expect(classifyMail("Votre candidature", "Nous avons bien reçu votre candidature et souhaitons vous rencontrer : êtes-vous disponible mardi pour un entretien ?")).toBe("AMBIGUOUS");
  });
});

describe("isNoise : mails à ignorer", () => {
  const self = ["moi@gmail.com"];
  it.each([
    ["mails de Job Radar et tes propres envois (même compte)", { from: "moi@gmail.com", subject: "🟢 91 % — Développeur Vue.js" }, true],
    ["alertes emploi LinkedIn", { from: "jobalerts-noreply@linkedin.com", subject: "30 nouveaux emplois" }, true],
    ["« candidature consultée »", { from: "jobs-noreply@linkedin.com", subject: "Votre candidature a été consultée par Escape" }, true],
    ["accusé LinkedIn (à garder)", { from: "jobs-noreply@linkedin.com", subject: "Chahine, votre candidature a été envoyée à SOLENT" }, false],
    ["réponse d'un recruteur", { from: "rh@escape.tech", subject: "Votre candidature" }, false],
    ["création de compte sur un site de candidature", { from: "photobox@dtm.mydeltek.com", subject: "Confirmation de la création de votre compte" }, true],
  ] as const)("%s", (_name, mail, expected) => {
    expect(isNoise(mail, self)).toBe(expected);
  });
});

describe("matchApplication : à quelle candidature répond le mail", () => {
  const mail = (m: Partial<InboxMail>): InboxMail => ({
    messageId: "<m@x>", folder: "INBOX", from: "no-reply@welcomekit.co", fromName: "Welcome to the Jungle", subject: "Votre candidature",
    text: "", date: new Date("2026-10-06T10:00:00Z"), replyTo: [], ...m,
  });
  const apps: ApplicationRef[] = [
    { kind: "job", id: "escape-front", company: "Escape", title: "Développeur Frontend Svelte", since: new Date("2026-10-01") },
    { kind: "job", id: "escape-back", company: "Escape SAS", title: "Développeur Backend Node.js", since: new Date("2026-10-02") },
    { kind: "job", id: "solent", company: "SOLENT", title: "Ingénieur.e Full Stack C#", since: new Date("2026-10-03") },
    { kind: "spontaneous", id: "sp-acme", company: "Acme Industrie", since: new Date("2026-10-01"), messageId: "<sent-1@gmail.com>", sentTo: "rh@acme-industrie.fr" },
  ];

  it("réponse dans le fil d'une candidature spontanée : certaine, même sans le nom de l'entreprise", () => {
    expect(matchApplication(mail({ from: "jean@autre.fr", replyTo: ["<sent-1@gmail.com>"] }), apps)?.id).toBe("sp-acme");
  });

  it("réponse depuis l'adresse à laquelle tu as écrit", () => {
    expect(matchApplication(mail({ from: "RH@acme-industrie.fr" }), apps)?.id).toBe("sp-acme");
  });

  it("outil de recrutement (noreply) : l'entreprise est dans le texte", () => {
    expect(matchApplication(mail({ text: "Merci pour votre candidature chez SOLENT." }), apps)?.id).toBe("solent");
  });

  it("domaine de l'expéditeur = entreprise", () => {
    expect(matchApplication(mail({ from: "talent@escape.tech", text: "Backend Node.js : nous avons bien reçu ta candidature." }), apps)?.id).toBe("escape-back");
  });

  it("deux candidatures chez la même entreprise : le titre départage", () => {
    expect(matchApplication(mail({ text: "Escape : votre candidature au poste Frontend Svelte" }), apps)?.id).toBe("escape-front");
  });

  it("même entreprise en offre ET en spontanée, titre absent du mail : même expéditeur que l'accusé, sinon l'offre (cas Talan)", () => {
    const talan: ApplicationRef[] = [
      { kind: "job", id: "talan-job", company: "Talan", title: "IT Quant & Commando Front Office", since: new Date("2026-10-01") },
      { kind: "spontaneous", id: "talan-sp", company: "TALAN SAS", since: new Date("2026-10-04"), messageId: null, sentTo: "rh@talan.com" },
    ];
    const refus = mail({ from: "notifications@smartrecruiters.talan.com", text: "Talan : nous avons le regret de vous informer que votre profil ne répond pas." });
    expect(matchApplication(refus, talan)?.id).toBe("talan-job");
    const withSender = talan.map((a) => (a.id === "talan-sp" ? { ...a, senders: ["notifications@smartrecruiters.talan.com"] } : a));
    expect(matchApplication(refus, withSender)?.id).toBe("talan-sp");
  });

  it("mail antérieur à la candidature, ou entreprise inconnue : ignoré", () => {
    expect(matchApplication(mail({ text: "SOLENT", date: new Date("2026-09-01") }), apps)).toBeNull();
    expect(matchApplication(mail({ text: "Merci pour votre candidature chez Globex." }), apps)).toBeNull();
  });
});

describe("cas réel : accusé SmartRecruiters d'Eurofins", () => {
  const mail: InboxMail = {
    messageId: "<eurofins@x>",
    folder: "[Gmail]/Tous les messages",
    from: "notification@smartrecruiters.com",
    fromName: "Eurofins France Clinical Diagnostics - Biologie Médicale",
    subject: "Merci pour votre candidature",
    date: new Date("2026-10-06T16:37:00"),
    replyTo: [],
    text:
      "Madame, Monsieur,\n\nNous vous remercions pour l'intérêt que vous portez à notre laboratoire.\n\n" +
      "Votre candidature a bien été réceptionnée. Nous allons l'étudier avec attention et, si votre profil est en adéquation avec nos besoins, nous prendrons contact avec vous sous quatre à six semaines.\n\n" +
      "Passé ce délai, vous pourrez considérer que votre profil ne correspond pas aux besoins spécifiques du poste.\n\n" +
      "Sincères salutations,\nL'équipe recrutement Eurofins Clinical Diagnostics",
  };
  const job: ApplicationRef = { kind: "job", id: "j", company: "Eurofins Biologie Médicale", title: "Ingénieur Développement Logiciel & IA (F/H)", since: new Date("2026-10-06T16:37:30") };

  it("rattaché à l'offre (nom d'entreprise écrit autrement par l'expéditeur), lu comme un accusé", () => {
    expect(isNoise(mail, [])).toBe(false);
    expect(matchApplication(mail, [job])?.id).toBe("j");
    expect(classifyMail(mail.subject, mail.text)).toEqual({ kind: "ACK", detail: null });
  });

  it("offre marquée « postulé » après l'arrivée du mail : rattaché quand même", () => {
    expect(matchApplication(mail, [{ ...job, since: new Date("2026-10-06T19:00:00") }])?.id).toBe("j");
  });
});

describe("message d'absence", () => {
  const at = new Date(2026, 9, 16, 14, 13);
  const away = (text: string) => outOfOffice({ from: "alain.repiquet@seenovate.com", text, date: at }, ["moi@gmail.com"]);
  it("absent un jour précis : relance le lendemain, autre contact repris", () => {
    const r = away("Bonjour\n\nJe suis absent ce vendredi 16 octobre avec un accès limité à ma messagerie.\nEn cas d'urgence, n'hésitez pas envoyer un message à contact@seenovate.com\n\nBien cordialement.");
    expect(r).toEqual({ back: new Date(2026, 9, 17), contact: "contact@seenovate.com" });
  });
  it("« de retour le » : ce jour-là ; sans date : 7 jours", () => {
    expect(away("Je suis en congés, de retour le lundi 26 octobre.")?.back).toEqual(new Date(2026, 9, 26));
    expect(away("I am currently out of the office.")?.back).toEqual(new Date(at.getTime() + 7 * 86_400_000));
  });
  it("accusé de réception ou refus : pas une absence", () => {
    expect(away("Nous avons bien reçu votre candidature et reviendrons vers vous.")).toBeNull();
    expect(away("Malheureusement, nous ne donnerons pas suite.")).toBeNull();
  });
});

describe("réponse seule (message d'origine cité retiré)", () => {
  it("Outlook, Gmail et « > » : seule la réponse reste", () => {
    const outlook = "Malheureusement, tous nos postes sont pourvus.\n\nBien cordialement\n\n\n________________________________\nDe : Chahine MEHADJI <c@gmail.com>\nEnvoyé : vendredi 16 octobre 2026 16:18\n\nje serais heureux d'en discuter avec vous";
    expect(replyOnly(outlook)).toBe("Malheureusement, tous nos postes sont pourvus.\n\nBien cordialement");
    expect(replyOnly("Merci, bien reçu.\n\nLe ven. 16 oct. 2026 à 16:18, Chahine <c@gmail.com> a écrit :\n> votre disponibilité ?")).toBe("Merci, bien reçu.");
    expect(replyOnly("Bonjour,\nPas de poste.\n> Je serais heureux d'échanger")).toBe("Bonjour,\nPas de poste.");
    expect(replyOnly("Texte sans citation.")).toBe("Texte sans citation.");
  });
  it("le refus de MIW n'est plus lu comme une invitation (règles)", () => {
    const text = "Bonjour,\n\nMalheureusement, nous ne sommes pas en mesure de donner une suite favorable à votre candidature, tous nos postes étant pourvus.\n\n________________________________\nDe : Chahine MEHADJI\nEnvoyé : vendredi 16 octobre 2026 16:18\n\nJe serais heureux d'en discuter avec vous quand cela vous convient, vos disponibilités.";
    expect(classifyMail("RE: Candidature spontanée", replyOnly(text))).toEqual({ kind: "REJECTION", detail: null });
  });
});

describe("audit du 26/10 : poste écrit dans le mail", () => {
  const m = (subject: string, text = "") => ({ subject, text });

  it("reconnaît le même poste (Hubvisory, Otoqi, Storm, Manhattan, ISAGRI)", () => {
    expect(samePost(m("Hubvisory | Retour", "Malheureusement, ta candidature n'a pas été retenue pour le poste de Développeur Front-End React / TypeScript – H/F. Merci"), "Développeur Front-End React / TypeScript – H/F")).toBe(true);
    expect(samePost(m("Merci", "Nous vous remercions d'avoir postulé pour le poste de Full-stack Developper H/F au sein d'Otoqi."), "Full-stack Developper H/F")).toBe(true);
    expect(samePost(m("Storm Group", "Nous avons reçu votre candidature pour le poste de Développeur Frontend – H/F et vous remercions"), "Développeur Frontend – H/F (IT)")).toBe(true);
    expect(samePost(m("Application Received for Technology Associate Consultant"), "Technology Associate Consultant")).toBe(true);
    expect(samePost(m("Suite à votre candidature pour le poste Développeur Full-Stack Node/VueJS H/F"), "Développeur Full-Stack Node/VueJS F/H (CDI)")).toBe(true);
  });

  it("voit un autre poste (Theodo AI-Native, Talan, Kicklox, Basikon, Urban Linker)", () => {
    expect(postInMail(m("[Theodo] - We have received your application", "We would like to confirm that we have received your application for the AI-Native Software Engineer - CDI Paris - Theodo"))).toBe("ai-native software engineer");
    expect(samePost(m("[Theodo] - We have received your application", "we have received your application for the AI-Native Software Engineer - CDI Paris -"), "Software Engineer Fullstack - CDI Paris - Theodo Retail")).toBe(false);
    expect(samePost(m("Votre candidature", "L'offre de Développeur Junior Java - Angular H/F n'est plus disponible."), "IT Quant & Commando Front Office – BFI & Énergie - H/F")).toBe(false);
    expect(samePost(m("Re: Votre candidature pour l'offre  Développeur Full-Stack (JavaScript) H/F"), "Développeur Front-End (Vue.js) H/F")).toBe(false);
    expect(samePost(m("Votre candidature", "Nous vous remercions d'avoir postulé à notre offre d'emploi de \"Consultant développeur junior Javascript (H/F)\", à pourvoir"), "Développeur JS Full-Stack Junior (H/F)")).toBe(false);
    expect(samePost(m("Merci", "Merci d'avoir postulé à l'offre : DÉVELOPPEUR FULL STACK JUNIOR"), "Développeur JS (H/F) & Référent IA — Agence Web (Paris)")).toBe(false);
  });

  it("refus sans nom de poste (Theodo) : rien à comparer", () => {
    expect(samePost(m("[Theodo] - Merci pour ta candidature", "nous ne donnerons malheureusement pas suite pour ce poste."), "Software Engineer Fullstack - CDI Paris - Theodo FinTech")).toBeNull();
  });
});

describe("audit du 26/10 : rattachement", () => {
  const mail = (m: Partial<InboxMail>): InboxMail => ({
    messageId: "<m@x>", folder: "INBOX", from: "x@y.fr", fromName: "", subject: "Votre candidature", text: "", date: new Date("2026-10-07T10:00:00Z"), replyTo: [], ...m,
  });

  it("réponse « Fwd: » d'une autre adresse du même domaine (Synetis) : sa spontanée, sans hésiter", () => {
    const apps: ApplicationRef[] = [{ kind: "spontaneous", id: "synetis", company: "SYNETIS", since: new Date("2026-10-06T15:47:00Z"), messageId: null, sentTo: "contact@synetis.com" }];
    const reply = mail({ from: "recrutement@synetis.com", subject: "Fwd: Candidature spontanée – Développeur full stack", text: "Malheureusement, nous n'avons pas de poste de développeur full stack à pourvoir." });
    expect(candidateApplications(reply, apps).map((a) => a.id)).toEqual(["synetis"]);
    // Même domaine mais pas une réponse (alerte, newsletter) : pas certain.
    expect(matchApplication(mail({ from: "news@synetis.com", subject: "Nos actualités" }), apps)?.id).toBe("synetis");
  });

  it("intitulé exact dans le mail, entreprise écrite autrement (CNRS pour le labo)", () => {
    const apps: ApplicationRef[] = [{ kind: "job", id: "clia", company: "Centre Lasers Intenses et Applications", title: "Ingénieur d'études (H/F) en ingénierie logicielle", since: new Date("2026-10-26T13:00:00Z") }];
    const ack = mail({ from: "NePasRepondre@emploi.cnrs.fr", subject: "[Portail Emploi CNRS] Confirmation de l'enregistrement de votre candidature (Offre UMR7253-OLITOU-002 - Ingénieur d'études (H/F) en ingénierie logicielle)", date: new Date("2026-10-26T13:13:00Z") });
    expect(candidateApplications(ack, apps).map((a) => a.id)).toEqual(["clia"]);
  });

  it("site carrière sur Welcome to the Jungle (Partoo)", () => {
    expect(careerSiteUrl({ text: "Bonjour,\nToutes nos offres d'emploi sont disponibles sur Welcome to the Jungle, vous pouvez les consulter ici : https://www.welcometothejungle.com/fr/companies/partoo/jobs" })).toBe("https://www.welcometothejungle.com/fr/companies/partoo/jobs");
  });
});

describe("audit du 26/10 : intitulé écrit au féminin et au masculin", () => {
  it("« Développeur/se Full-Stack » (Advanced Schema) est bien « Développeur Full-Stack »", () => {
    const refus = { subject: "Retour candidature - Développeur/se Full-Stack chez Advanced Schema", text: "Je vous contacte suite à votre candidature au poste de Développeur/se Full-Stack chez Advanced Schema." };
    expect(samePost(refus, "Développeur Full-Stack")).toBe(true);
  });
});

describe("audit du 26/10 : relance HelloWork", () => {
  it("« Avez vous finalisé votre candidature… » : un rappel du site d'emploi, pas une réponse (lu comme un entretien chez BLG Mobility)", () => {
    expect(isNoise({ from: "emploi@emails.hellowork.com", subject: "Avez vous finalisé votre candidature au poste de Développeur Node.Js - Intégrations & Apis H/F" }, [])).toBe(true);
  });
});

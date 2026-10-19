import { describe, expect, it } from "vitest";
import { defaultMail } from "./spontaneous-mail";
import { createTestApp, login } from "./test-helpers";

// Candidat fictif.
const KIT = {
  header: "Alex Martin\n75011 Paris\n06 00 00 00 00\nalex.martin@example.com",
  city: "Paris",
  signature: "Alex MARTIN",
  cvText: "Développeur Full Stack. Alternance chez Banquo : Vue.js, TypeScript, Java Spring Boot, PostgreSQL. ".repeat(4),
  letterExample: "",
};

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const req = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
    t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  await req("POST", "/api/leads/refresh");
  const lead = (await req("GET", "/api/leads?status=all")).json().items.find((l: { name: string }) => l.name === "ALPHA LOGICIELS");
  return { ...t, req, lead, cookies };
}

describe("candidature spontanée", () => {
  it("message et objet écrits par le code, avec le téléphone de l'en-tête", () => {
    const m = defaultMail(KIT, "ALPHA LOGICIELS", "Développeur full stack");
    expect(m.subject).toBe("Candidature spontanée – Développeur full stack – Alex MARTIN");
    expect(m.message).toContain("pour un poste de développeur full stack en CDI chez ALPHA LOGICIELS.");
    expect(m.message).toContain("Vous trouverez ci-joint mon CV et ma lettre de motivation.");
    expect(m.message.trim().endsWith("Alex MARTIN\n06 00 00 00 00")).toBe(true);
  });

  it("email de contact : enregistré, vérifié", async () => {
    const { req, lead } = await setup();
    expect((await req("PATCH", `/api/leads/${lead.id}`, { contactEmail: "pas-un-email" })).statusCode).toBe(400);
    const ok = await req("PATCH", `/api/leads/${lead.id}`, { contactEmail: " RH@Alpha.fr " });
    expect(ok.json().contactEmail).toBe("rh@alpha.fr");
  });

  it("lettre écrite en mode « spontanée », puis envoi seulement quand tout est prêt ; lettre PDF + CV joints ; entreprise « Contactée »", async () => {
    const t = await setup();
    const { req, lead, aiCalls, sentMails } = t;
    await req("PUT", "/api/letter-kit", KIT);

    const first = (await req("GET", `/api/leads/${lead.id}/application`)).json();
    expect(first).toMatchObject({ application: null, kitReady: true, cvPdf: { found: false }, mail: { configured: true } });

    const written = (await req("POST", `/api/leads/${lead.id}/application/letter`, { title: "Développeur Vue.js" })).json();
    expect(aiCalls.at(-1)?.title).toBe("lettre:Développeur Vue.js");
    expect(written.application.letter).toContain("Candidature spontanée – Développeur Vue.js");

    const mail = { to: "rh@alpha.fr", subject: "Candidature spontanée", message: "Madame, Monsieur, voici ma candidature.", letter: written.application.letter };
    const noCv = await req("POST", `/api/leads/${lead.id}/application/send`, mail);
    expect(noCv.statusCode).toBe(400);
    expect(noCv.json().error).toBe("CV_PDF_MISSING");
    expect(sentMails).toHaveLength(0);

    // Le CV PDF est envoyé par le navigateur (corps binaire) ; un fichier qui n'est pas un PDF est refusé.
    const upload = (payload: string, name = "C:\\Users\\alex\\CV_Alex_Martin.pdf") =>
      t.app.inject({ method: "PUT", url: `/api/letter-kit/cv-pdf?name=${encodeURIComponent(name)}`, cookies: t.cookies, headers: { "content-type": "application/pdf" }, payload });
    expect((await upload("pas un pdf")).statusCode).toBe(400);
    expect((await upload("%PDF-1.4 faux CV")).json()).toEqual({ cvPdfName: "CV_Alex_Martin.pdf" });
    expect((await req("GET", "/api/letter-kit")).json().cvPdfName).toBe("CV_Alex_Martin.pdf");

    const sent = await req("POST", `/api/leads/${lead.id}/application/send`, mail);
    expect(sent.statusCode).toBe(200);
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]).toMatchObject({ fromName: "Alex MARTIN", to: "rh@alpha.fr", subject: "Candidature spontanée" });
    expect(sentMails[0]!.attachments.map((a) => a.filename)).toEqual(["Lettre_de_motivation.pdf", "CV_Alex_Martin.pdf"]);
    expect(sentMails[0]!.attachments[0]!.content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sent.json().application).toMatchObject({ sentTo: "rh@alpha.fr" });
    expect(sent.json().lead).toMatchObject({ status: "CONTACTED", contactEmail: "rh@alpha.fr" });

    // Pas de double envoi par erreur : il faut le demander explicitement.
    const again = await req("POST", `/api/leads/${lead.id}/application/send`, mail);
    expect(again.statusCode).toBe(409);
    expect((await req("POST", `/api/leads/${lead.id}/application/send`, { ...mail, force: true })).statusCode).toBe(200);
    expect(sentMails).toHaveLength(2);

    // Relance : même adresse, réponse dans le fil du dernier envoi, même lettre et CV ; une seule.
    const draft = (await req("GET", `/api/leads/${lead.id}/application/follow-up`)).json();
    expect(draft).toMatchObject({ to: "rh@alpha.fr", subject: "Re: Candidature spontanée – Développeur full stack – Alex MARTIN", followedUpAt: null });
    expect(draft.message).toContain("Je reviens vers vous au sujet de ma candidature spontanée envoyée le");
    const follow = await req("POST", `/api/leads/${lead.id}/application/follow-up`, { subject: draft.subject, message: draft.message });
    expect(follow.statusCode).toBe(200);
    expect(sentMails.at(-1)).toMatchObject({ to: "rh@alpha.fr", subject: draft.subject, inReplyTo: "<envoi-2@test>" });
    expect(sentMails.at(-1)!.attachments.map((a) => a.filename)).toEqual(["Lettre_de_motivation.pdf", "CV_Alex_Martin.pdf"]);
    expect((await req("POST", `/api/leads/${lead.id}/application/follow-up`, { subject: draft.subject, message: draft.message })).statusCode).toBe(409);
    expect(sentMails).toHaveLength(3);
    expect((await req("GET", "/api/applications")).json().spontaneous[0].followedUpAt).not.toBeNull();

    // Relance groupée : plus rien à relancer (déjà relancée), aucun envoi de plus.
    const batch = (await req("POST", "/api/applications/follow-up/batch", { limit: 10 })).json();
    expect(batch).toMatchObject({ running: false, total: 0 });
    expect(sentMails).toHaveLength(3);

    // Renvoyé vers leur site : « J'ai postulé sur leur site », puis annuler.
    const item = () => req("GET", "/api/applications").then((r) => r.json().spontaneous[0]);
    const id = (await item()).id;
    const outcome = (o: "applied" | "none" | null, to = id) => req("POST", `/api/applications/spontaneous/${to}/site-outcome`, { outcome: o });
    expect((await outcome("applied")).statusCode).toBe(200);
    expect(await item()).toMatchObject({ stage: "SENT", noOpeningAt: null });
    expect((await item()).appliedOnSiteAt).not.toBeNull();
    // Rien à postuler sur leur site : close (l'autre choix est effacé).
    await outcome("none");
    expect(await item()).toMatchObject({ stage: "REJECTED", appliedOnSiteAt: null });
    await outcome(null);
    expect(await item()).toMatchObject({ stage: "SENT", appliedOnSiteAt: null, noOpeningAt: null });
    expect((await outcome("applied", "inconnu")).statusCode).toBe(404);
  });

  it("préparation en lot : lettres écrites pour les entreprises « À contacter » avec email, rien n'est envoyé", async () => {
    const { req, lead, sentMails } = await setup();
    await req("PUT", "/api/letter-kit", KIT);
    await req("PATCH", `/api/leads/${lead.id}`, { contactEmail: "rh@alpha.fr" });

    expect((await req("GET", "/api/leads/applications/batch")).json()).toMatchObject({ toWrite: 1, items: [] });
    expect((await req("POST", "/api/leads/applications/batch")).json().batch).toMatchObject({ running: true, total: 1, steps: [{ leadId: lead.id, status: "writing" }] });
    await expect.poll(async () => (await req("GET", "/api/leads/applications/batch")).json().batch.running).toBe(false);

    const after = (await req("GET", "/api/leads/applications/batch")).json();
    expect(after.toWrite).toBe(0);
    expect(after.batch.steps).toMatchObject([{ name: "ALPHA LOGICIELS", status: "done" }]);
    expect(after.items.map((i: { lead: { id: string } }) => i.lead.id)).toEqual([lead.id]);
    expect(after.items[0].application.letter).toContain("Candidature spontanée");
    expect(after.items[0].application.review).toMatchObject({ problems: [] }); // relue aussi en lot
    expect(sentMails).toHaveLength(0);
  });

  it("relecture : une lettre avec un problème ne part pas tant qu'elle n'est pas validée", async () => {
    const t = await setup();
    const { req, lead, sentMails } = t;
    await req("PUT", "/api/letter-kit", KIT);
    await t.app.inject({ method: "PUT", url: "/api/letter-kit/cv-pdf?name=CV.pdf", cookies: t.cookies, headers: { "content-type": "application/pdf" }, payload: "%PDF-1.4 faux CV" });
    await req("POST", `/api/leads/${lead.id}/application/letter`, { title: "Développeur Vue.js" });
    const letter = "Madame, Monsieur,\n\nJe souhaite rejoindre Alpha Logiciels. Elle demande de comprendre le besoin métier, ce que j'ai fait chez Banquo.";
    expect((await req("PUT", `/api/leads/${lead.id}/application`, { content: letter })).json().blocked).toContain("problème");
    const mail = { to: "rh@alpha.fr", subject: "Candidature spontanée", message: "Madame, Monsieur, voici ma candidature.", letter };
    const refused = await req("POST", `/api/leads/${lead.id}/application/send`, mail);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("REVIEW_PENDING");
    expect(sentMails).toHaveLength(0);
    await req("POST", `/api/leads/${lead.id}/application/review/validate`);
    expect((await req("POST", `/api/leads/${lead.id}/application/send`, mail)).statusCode).toBe(200);
    expect(sentMails).toHaveLength(1);
  });
});

describe("relance groupée des spontanées", () => {
  it("relance les plus anciennes sans réponse (7 jours et plus), dans leur fil, puis plus rien", async () => {
    const t = await setup();
    const { req, sentMails, stores, leadRows } = t;
    await stores.letterKits.setCvPdf("u1", { name: "CV_Alex_Martin.pdf", content: Buffer.from("%PDF-1.4 faux CV") });
    const leads = [...leadRows.values()].slice(0, 2);
    const day = 86_400_000;
    // Deux envoyées il y a 10 et 9 jours ; une troisième il y a 2 jours (trop récente).
    for (const [i, l] of leads.entries()) {
      await stores.applications.save(l.id, { inputHash: "", model: "manuel", letter: `Lettre pour ${l.name}` });
      await stores.applications.markSent(l.id, `rh${i}@exemple.fr`, new Date(Date.now() - (10 - i) * day), `<premier-${i}@test>`);
    }
    const recent = [...leadRows.values()][2];
    if (recent) {
      await stores.applications.save(recent.id, { inputHash: "", model: "manuel", letter: "Lettre récente" });
      await stores.applications.markSent(recent.id, "rh-recent@exemple.fr", new Date(Date.now() - 2 * day), "<recent@test>");
    }
    const run = async () => {
      let r = (await req("POST", "/api/applications/follow-up/batch", { limit: 10 })).json();
      for (let i = 0; r.running && i < 200; i++) {
        await new Promise((ok) => setTimeout(ok, 20));
        r = (await req("GET", "/api/applications/follow-up/batch")).json();
      }
      return r;
    };
    const r = await run();
    expect(r).toMatchObject({ total: 2, done: 2, remaining: 0 });
    expect(r.steps.map((s: { status: string }) => s.status)).toEqual(["sent", "sent"]);
    expect(sentMails.map((m) => [m.to, m.inReplyTo])).toEqual([["rh0@exemple.fr", "<premier-0@test>"], ["rh1@exemple.fr", "<premier-1@test>"]]);
    expect(sentMails[0]!.subject.startsWith("Re: Candidature spontanée")).toBe(true);
    expect(await run()).toMatchObject({ total: 0, done: 0 });
  });
});

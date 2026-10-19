<script setup lang="ts">
import { ref, watch } from "vue";
import { api, errorMessage } from "../api";
import { type AnyApplication, STAGE_LABEL, STEPS, activeMails, careerUrl, daysSince, isJob, lastActivity, mailLabel, toFollowUp } from "../applications";
import { mapsUrl, place, timeAgo } from "../format";
import type { Application, ApplicationMail, ApplyInfo, JobStatus, SpontaneousItem } from "../types";
import ApplyInfoForm from "./ApplyInfoForm.vue";
import Icon from "./Icon.vue";
import SourceLogo from "./SourceLogo.vue";

/** Détail d'une candidature : étape, mails reconnus (résumé, à vérifier), actions. */
const props = defineProps<{ app: AnyApplication }>();
const emit = defineEmits<{ changed: [] }>();
const busy = ref<string | null>(null);

const stepDone = (i: number) => STEPS.findIndex((s) => s.stage === props.app.stage) >= i;
const day = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

async function act(key: string, fn: () => Promise<unknown>) {
  busy.value = key;
  try {
    await fn();
    emit("changed");
  } finally {
    busy.value = null;
  }
}
const setStatus = (status: JobStatus) => act(props.app.id, () => api.setJobStatus(props.app.id, status));
const siteOutcome = (a: SpontaneousItem, outcome: "applied" | "none" | null) => act(a.id, () => api.setSiteOutcome(a.id, outcome));
const dismiss = (m: ApplicationMail) => act(m.id, () => api.dismissApplicationMail(m.id));
const confirm = (m: ApplicationMail) => act(m.id, () => api.confirmApplicationMail(m.id));

/** Candidature d'avant la règle : canal, CV ou contrat manquant, à compléter ici. */
const CHANNEL_LABEL: Record<ApplyInfo["channel"], string> = { mail: "Mail", formulaire: "Formulaire du site", linkedin: "Candidature simplifiée LinkedIn", autre: "Autre" };
const incomplete = (a: Application) => !a.applyChannel || !a.applyCv || !a.contractType;
const infoError = ref<string | null>(null);
async function saveInfo(a: Application, info: ApplyInfo) {
  infoError.value = null;
  try {
    await act(a.id, () => api.setApplyInfo(a.id, info));
  } catch (e) {
    infoError.value = errorMessage(e, "Enregistrement impossible.");
  }
}

/** Relance (spontanée sans réponse depuis 7 jours) : texte écrit par le code, modifiable, envoyé seulement au clic. */
const draft = ref<{ to: string; subject: string; message: string } | null>(null);
const followError = ref<string | null>(null);
watch(
  () => props.app,
  async (a) => {
    draft.value = null;
    followError.value = null;
    if (!isJob(a) && toFollowUp(a)) {
      try {
        draft.value = await api.getFollowUp(a.leadId);
      } catch (e) {
        followError.value = errorMessage(e, "Impossible de préparer la relance.");
      }
    }
  },
  { immediate: true },
);
async function sendFollowUp(a: SpontaneousItem) {
  if (!draft.value) return;
  followError.value = null;
  busy.value = "follow";
  try {
    await api.sendFollowUp(a.leadId, { subject: draft.value.subject, message: draft.value.message });
    emit("changed");
  } catch (e) {
    followError.value = errorMessage(e, "La relance n'est pas partie.");
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="detail">
    <div class="meta muted small">
      <span><Icon name="pin" :size="14" /><a v-if="place(app)" :href="mapsUrl(app.company, place(app))" target="_blank" rel="noopener">{{ place(app) }}</a><template v-else>Lieu non précisé</template></span>
      <span v-if="!isJob(app) && app.sentTo"><Icon name="mail" :size="14" />{{ app.sentTo }}</span>
      <span v-if="isJob(app) && app.cvs?.length"><Icon name="file" :size="14" />CV {{ app.cvs.map((c) => (c.template === "une-colonne" ? "une colonne" : "deux colonnes")).join(" et ") }}</span>
      <span v-if="isJob(app) && app.applyChannel"><Icon name="send" :size="14" />{{ CHANNEL_LABEL[app.applyChannel] }} · {{ app.applyCv === "ats" ? "CV ATS" : "CV classique" }}</span>
      <span v-if="isJob(app)" class="origin"><SourceLogo v-for="s in app.sources" :key="s.source" :source="s.source" :size="18" /></span>
    </div>

    <section v-if="isJob(app) && incomplete(app)" class="complete">
      <strong class="small"><Icon name="alert" :size="14" />À compléter : comment tu as postulé</strong>
      <ApplyInfoForm
        :need-contract="!app.contractType"
        :busy="busy === app.id"
        :initial="{ channel: app.applyChannel ?? undefined, cv: app.applyCv ?? undefined }"
        submit-label="Enregistrer"
        @submit="(info) => saveInfo(app as Application, info)"
        @cancel="infoError = null"
      />
      <p v-if="infoError" class="small low">{{ infoError }}</p>
    </section>

    <div v-if="app.stage === 'CAREER_SITE'" class="career small">
      <Icon name="globe" :size="15" />Ils demandent de postuler sur leur site
      <a v-if="careerUrl(app)" :href="careerUrl(app)!" target="_blank" rel="noopener">{{ careerUrl(app) }}</a>
      <template v-if="!isJob(app)">
        <button type="button" class="small primary" :disabled="busy === app.id" @click="siteOutcome(app, 'applied')"><Icon name="check" :size="14" />J'ai postulé sur leur site</button>
        <button type="button" class="small ghost" :disabled="busy === app.id" title="Aucun poste ni candidature spontanée possible sur leur site : la candidature est close" @click="siteOutcome(app, 'none')">Rien à postuler sur leur site</button>
      </template>
    </div>
    <ol v-else-if="app.stage !== 'REJECTED'" class="steps" :aria-label="`Étape : ${STAGE_LABEL[app.stage]}`">
      <li v-for="(s, i) in STEPS" :key="s.stage" :class="{ done: stepDone(i), current: s.stage === app.stage }">
        <span class="dot"><Icon v-if="stepDone(i)" name="check" :size="11" /></span>{{ s.label }}
      </li>
    </ol>

    <p v-if="!isJob(app) && app.appliedOnSiteAt" class="small muted">
      Postulé sur leur site {{ timeAgo(app.appliedOnSiteAt) }} : les réponses restent suivies ·
      <button type="button" class="link" :disabled="busy === app.id" @click="siteOutcome(app, null)">annuler</button>
    </p>
    <p v-if="!isJob(app) && app.noOpeningAt" class="small muted">
      Rien à postuler sur leur site (noté {{ timeAgo(app.noOpeningAt) }}) : candidature close ·
      <button type="button" class="link" :disabled="busy === app.id" @click="siteOutcome(app, null)">annuler</button>
    </p>
    <p v-if="isJob(app) && app.noAnswer" class="small muted"><Icon name="clock" :size="14" /> Aucune nouvelle depuis {{ daysSince(lastActivity(app)) }} jours : considérée comme refusée. Si une réponse arrive, elle reprendra son vrai statut.</p>
    <section v-if="isJob(app) && toFollowUp(app)" class="relance">
      <div class="small">
        <strong>Relancer {{ app.company ?? "l'entreprise" }}</strong>
        <span class="muted">
          · pas de réponse depuis {{ daysSince(lastActivity(app)) }} jours. Relance par le même chemin que ta candidature<template v-if="app.applyChannel">
          ({{ CHANNEL_LABEL[app.applyChannel] }})</template> : un message court qui rappelle le poste et ta date d'envoi.
        </span>
      </div>
      <div class="row">
        <button type="button" class="small primary" :disabled="busy === app.id" @click="act(app.id, () => api.setJobFollowedUp(app.id, true))"><Icon name="check" :size="14" />J'ai relancé</button>
        <span class="small muted">Elle sort de « À relancer » ; sans réponse 14 jours après, elle sera comptée comme refusée.</span>
      </div>
    </section>
    <p v-if="isJob(app) && app.followedUpAt" class="small muted">
      <Icon name="send" :size="14" /> Relancée {{ timeAgo(app.followedUpAt) }} ·
      <button type="button" class="link" :disabled="busy === app.id" @click="act(app.id, () => api.setJobFollowedUp(app.id, false))">annuler</button>
    </p>
    <section v-if="!isJob(app) && toFollowUp(app)" class="relance">
      <div class="small">
        <strong>Relancer {{ app.company }}</strong>
        <span class="muted"> · pas de réponse depuis {{ daysSince(app.sentAt) }} jours. Envoi à {{ app.sentTo }}, en réponse à ton premier mail, avec ta lettre et ton CV actuel.</span>
      </div>
      <template v-if="draft">
        <label class="small">Objet<input v-model="draft.subject" type="text" maxlength="250" /></label>
        <label class="small">Message<textarea v-model="draft.message" rows="8" maxlength="5000" /></label>
        <div class="row">
          <button type="button" class="small primary" :disabled="busy === 'follow' || draft.message.trim().length < 10" @click="sendFollowUp(app)"><Icon name="send" :size="14" />Envoyer la relance</button>
          <span class="small muted">Rien ne part avant ce clic.</span>
        </div>
      </template>
      <p v-else-if="!followError" class="small muted">Préparation de la relance…</p>
      <p v-if="followError" class="small low">{{ followError }}</p>
    </section>
    <p v-if="!isJob(app) && app.followedUpAt" class="small muted"><Icon name="send" :size="14" /> Relancée {{ timeAgo(app.followedUpAt) }} : la réponse sera reconnue dans le même fil.</p>


    <ul v-if="app.mails.length" class="mails">
      <li v-for="m in app.mails" :key="m.id" :class="[`k-${m.kind}`, { dismissed: m.dismissed, review: m.needsReview && !m.dismissed }]">
        <span class="when small muted">{{ day(m.receivedAt) }}</span>
        <div class="what">
          <strong class="small">{{ mailLabel(m) }}<span v-if="m.needsReview && !m.dismissed" class="tag">à vérifier</span></strong>
          <span v-if="m.summary" class="small">{{ m.summary }}</span>
          <a class="small muted" :href="m.url" target="_blank" rel="noopener" title="Ouvrir le mail dans Gmail">« {{ m.subject }} » · {{ m.from }}</a>
        </div>
        <span v-if="m.dismissed" class="small muted">écarté</span>
        <div v-else class="row">
          <button v-if="m.needsReview" type="button" class="small primary" :disabled="busy === m.id" title="L'IA a hésité : c'est bien cette candidature et ce type de réponse" @click="confirm(m)"><Icon name="check" :size="14" />Confirmer</button>
          <button type="button" class="small ghost" :disabled="busy === m.id" title="Ce mail a été rattaché par erreur : il ne compte plus" @click="dismiss(m)">Pas lié</button>
        </div>
      </li>
    </ul>
    <p v-else class="small muted">Aucun mail reconnu pour l'instant.</p>

    <div class="row">
      <RouterLink v-if="isJob(app)" :to="{ name: 'job', params: { id: app.id } }" class="btn small"><Icon name="eye" :size="14" />Voir l'offre</RouterLink>
      <RouterLink v-else :to="{ name: 'spontaneous', params: { id: app.leadId } }" class="btn small"><Icon name="eye" :size="14" />Voir la candidature</RouterLink>
      <template v-if="isJob(app)">
        <template v-if="app.status === 'APPLIED'">
          <button type="button" class="small danger" :disabled="busy === app.id" @click="setStatus('REJECTED')"><Icon name="x" :size="14" />Refus reçu</button>
          <button type="button" class="small ghost" :disabled="busy === app.id" title="Tu n'as finalement pas postulé : l'offre revient dans « Offres »" @click="setStatus('SAVED')"><Icon name="undo" :size="14" />Je n'ai pas postulé</button>
        </template>
        <button v-else type="button" class="small ghost" :disabled="busy === app.id" @click="setStatus('APPLIED')"><Icon name="undo" :size="14" />Remettre en attente</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.detail { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.9rem 1rem 1rem; background: var(--bg); border-top: 1px solid var(--border); }
.meta { display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; }
.meta span { display: inline-flex; align-items: center; gap: 0.35rem; }
.origin { gap: 0.25rem; }
p { margin: 0; }
.complete { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.7rem 0.9rem; border-radius: 10px; background: var(--mid-bg); }
.complete strong { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--mid); }
.steps { list-style: none; display: grid; grid-template-columns: repeat(4, 1fr); margin: 0; padding: 0; max-width: 32rem; }
.steps li { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.3rem; font-size: 0.75rem; color: var(--muted); text-align: center; }
.steps li::before { content: ""; position: absolute; top: 0.55rem; left: -50%; width: 100%; height: 2px; background: var(--border); }
.steps li:first-child::before { display: none; }
.steps li.done::before { background: var(--accent); }
.steps .dot { position: relative; z-index: 1; display: grid; place-items: center; width: 1.15rem; height: 1.15rem; border-radius: 99px; background: var(--surface); border: 2px solid var(--border); color: var(--accent-contrast); }
.steps li.done .dot { background: var(--accent); border-color: var(--accent); }
.steps li.current { color: var(--text); font-weight: 650; }
.career { display: inline-flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; align-self: flex-start; padding: 0.35rem 0.7rem; border-radius: 10px; background: var(--mid-bg); overflow-wrap: anywhere; }
.relance { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem 0.85rem; border-radius: 10px; background: var(--surface); border: 1px solid var(--mid); }
.relance label { display: flex; flex-direction: column; gap: 0.25rem; }
.relance textarea { resize: vertical; font: inherit; }
.low { color: var(--low); }
button.link { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }
.mails { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.mails li { display: flex; align-items: flex-start; gap: 0.8rem; padding: 0.55rem 0.7rem; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--border); }
.mails li.k-ACK { border-left-color: var(--accent); }
.mails li.k-INTERVIEW, .mails li.k-CAREER_SITE { border-left-color: var(--mid); }
.mails li.k-OFFER { border-left-color: var(--good); }
.mails li.k-REJECTION { border-left-color: var(--low); }
.mails li.review { border-color: var(--mid); }
.mails li.dismissed { opacity: 0.5; }
.mails .when { width: 3.4rem; flex-shrink: 0; padding-top: 0.1rem; }
.mails .what { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; overflow-wrap: anywhere; }
.tag { margin-left: 0.45rem; padding: 0.05rem 0.45rem; border-radius: 99px; background: var(--mid-bg); color: var(--mid); font-size: 0.72rem; font-weight: 650; }
@media (max-width: 640px) { .mails li { flex-wrap: wrap; } }
</style>

<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";
import { type AnyApplication, STAGE_LABEL, STEPS, activeMails, careerUrl, daysSince, isJob, lastActivity, mailLabel, needsFollowUp } from "../applications";
import { mapsUrl, place, timeAgo } from "../format";
import type { ApplicationMail, JobStatus, SpontaneousItem } from "../types";
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
</script>

<template>
  <div class="detail">
    <div class="meta muted small">
      <span><Icon name="pin" :size="14" /><a v-if="place(app)" :href="mapsUrl(app.company, place(app))" target="_blank" rel="noopener">{{ place(app) }}</a><template v-else>Lieu non précisé</template></span>
      <span v-if="!isJob(app) && app.sentTo"><Icon name="mail" :size="14" />{{ app.sentTo }}</span>
      <span v-if="isJob(app) && app.cvs?.length"><Icon name="file" :size="14" />CV {{ app.cvs.map((c) => (c.template === "une-colonne" ? "une colonne" : "deux colonnes")).join(" et ") }}</span>
      <span v-if="isJob(app)" class="origin"><SourceLogo v-for="s in app.sources" :key="s.source" :source="s.source" :size="18" /></span>
    </div>

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
    <p v-if="needsFollowUp(app)" class="follow small"><Icon name="clock" :size="14" /> Pas de nouvelles depuis {{ daysSince(lastActivity(app)) }} jours : c'est le bon moment pour relancer.</p>

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
.steps { list-style: none; display: grid; grid-template-columns: repeat(4, 1fr); margin: 0; padding: 0; max-width: 32rem; }
.steps li { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.3rem; font-size: 0.75rem; color: var(--muted); text-align: center; }
.steps li::before { content: ""; position: absolute; top: 0.55rem; left: -50%; width: 100%; height: 2px; background: var(--border); }
.steps li:first-child::before { display: none; }
.steps li.done::before { background: var(--accent); }
.steps .dot { position: relative; z-index: 1; display: grid; place-items: center; width: 1.15rem; height: 1.15rem; border-radius: 99px; background: var(--surface); border: 2px solid var(--border); color: var(--accent-contrast); }
.steps li.done .dot { background: var(--accent); border-color: var(--accent); }
.steps li.current { color: var(--text); font-weight: 650; }
.career { display: inline-flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; align-self: flex-start; padding: 0.35rem 0.7rem; border-radius: 10px; background: var(--mid-bg); overflow-wrap: anywhere; }
.follow { display: flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.7rem; border-radius: 8px; background: var(--mid-bg); }
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

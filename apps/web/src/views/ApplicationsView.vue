<script setup lang="ts">
import { computed, onActivated, ref } from "vue";
import { ApiError, api } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import ScoreBadge from "../components/ScoreBadge.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { mapsUrl, timeAgo } from "../format";
import type { Application, ApplicationMail, ApplicationStage, JobStatus, MailTracking, SpontaneousItem } from "../types";

/** Au-delà, pas de nouvelles : un petit rappel pour relancer. */
const FOLLOW_UP_DAYS = 10;

/** Étapes affichées dans la frise (le refus est à part). */
const STEPS: Array<{ stage: Exclude<ApplicationStage, "REJECTED" | "CAREER_SITE">; label: string }> = [
  { stage: "SENT", label: "Envoyée" },
  { stage: "ACK", label: "Reçue" },
  { stage: "INTERVIEW", label: "Entretien" },
  { stage: "OFFER", label: "Proposition" },
];
const STAGE_LABEL: Record<ApplicationStage, string> = {
  SENT: "Envoyée",
  ACK: "Reçue par le recruteur",
  INTERVIEW: "Entretien / test",
  OFFER: "Proposition",
  REJECTED: "Refusée",
  CAREER_SITE: "À faire sur leur site",
};
const MAIL_LABEL: Record<ApplicationMail["kind"], string> = {
  ACK: "Accusé de réception",
  INTERVIEW: "Entretien",
  OFFER: "Proposition",
  REJECTION: "Refus",
  CAREER_SITE: "Candidature sur leur site",
};
const mailLabel = (m: ApplicationMail) => (m.kind === "INTERVIEW" && m.detail ? m.detail : MAIL_LABEL[m.kind]);

type Filter = "active" | "INTERVIEW" | "OFFER" | "REJECTED" | "CAREER_SITE";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "active", label: "En cours" },
  { id: "INTERVIEW", label: "Entretiens / tests" },
  { id: "OFFER", label: "Propositions" },
  { id: "REJECTED", label: "Refusées" },
  { id: "CAREER_SITE", label: "Candidature sur leur site" },
];

const jobs = ref<Application[]>([]);
const spontaneous = ref<SpontaneousItem[]>([]);
const tracking = ref<MailTracking | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const kind = ref<"offers" | "spontaneous">("offers");
const filter = ref<Filter>("active");
const busy = ref<string | null>(null);
const checking = ref(false);
const open = ref<Set<string>>(new Set());

async function load() {
  try {
    const r = await api.listApplications();
    jobs.value = r.jobs;
    spontaneous.value = r.spontaneous;
    tracking.value = r.tracking;
    error.value = null;
  } catch {
    error.value = "Impossible de charger tes candidatures.";
  } finally {
    loading.value = false;
  }
}
onActivated(load); // aussi au retour depuis une offre

const list = computed<Array<Application | SpontaneousItem>>(() => (kind.value === "offers" ? jobs.value : spontaneous.value));
// « Candidature sur leur site » : toutes les réponses qui renvoient vers leur site, que tu y aies postulé ou non.
const matches = (a: Application | SpontaneousItem, f: Filter) =>
  f === "active" ? a.stage !== "REJECTED" : f === "CAREER_SITE" ? activeMails(a).some((m) => m.kind === "CAREER_SITE") : a.stage === f;
const count = (f: Filter) => list.value.filter((a) => matches(a, f)).length;
const shown = computed(() => list.value.filter((a) => matches(a, filter.value)));

const sentAt = (a: Application | SpontaneousItem) => ("appliedAt" in a ? a.appliedAt : a.sentAt);
const activeMails = (a: Application | SpontaneousItem) => a.mails.filter((m) => !m.dismissed);
const lastMail = (a: Application | SpontaneousItem) => activeMails(a).at(-1) ?? null;
const daysSince = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null);
/** Pas de nouvelle depuis longtemps (ni refus ni entretien) : relancer. */
const needsFollowUp = (a: Application | SpontaneousItem) =>
  (a.stage === "SENT" || a.stage === "ACK") && (daysSince(lastMail(a)?.receivedAt ?? sentAt(a)) ?? 0) >= FOLLOW_UP_DAYS;
const careerUrl = (a: Application | SpontaneousItem) => activeMails(a).findLast((m) => m.kind === "CAREER_SITE")?.detail ?? null;
const stepDone = (a: Application | SpontaneousItem, i: number) => STEPS.findIndex((s) => s.stage === a.stage) >= i;

function toggle(id: string) {
  const next = new Set(open.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  open.value = next;
}

async function check() {
  checking.value = true;
  try {
    tracking.value = await api.checkApplicationMails();
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "La vérification des mails a échoué.";
  } finally {
    checking.value = false;
  }
}

async function siteOutcome(a: SpontaneousItem, outcome: "applied" | "none" | null) {
  busy.value = a.id;
  try {
    await api.setSiteOutcome(a.id, outcome);
    await load();
  } finally {
    busy.value = null;
  }
}

async function dismiss(m: ApplicationMail) {
  busy.value = m.id;
  try {
    await api.dismissApplicationMail(m.id);
    await load();
  } finally {
    busy.value = null;
  }
}

async function setStatus(j: Application, status: JobStatus) {
  busy.value = j.id;
  try {
    await api.setJobStatus(j.id, status);
    await load();
  } finally {
    busy.value = null;
  }
}

const place = (a: { city: string | null; department: string | null }) =>
  [a.city, a.department && !a.city?.includes(a.department) ? `(${a.department})` : null].filter(Boolean).join(" ");
const day = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
</script>

<template>
  <PageHeader title="Candidatures" subtitle="Où en est chaque candidature : les réponses reçues par mail mettent l'étape à jour toute seule." />

  <div class="stack">
    <!-- Suivi des mails -->
    <div v-if="tracking" class="tracking small" :class="{ off: !tracking.configured, bad: tracking.lastError }">
      <Icon :name="tracking.lastError ? 'alert' : 'mail'" :size="16" />
      <span v-if="!tracking.configured">
        Suivi des mails désactivé : ajoute <code>MAIL_TRACKING_ENABLED=true</code> dans <code>.env</code> puis redémarre l'API.
        Les étapes ne changent alors qu'à la main.
      </span>
      <span v-else-if="tracking.lastError">Dernière vérification des mails en échec : {{ tracking.lastError }}</span>
      <span v-else-if="tracking.running || checking">Lecture de tes mails en cours…</span>
      <span v-else>
        Réponses lues dans ta boîte mail (lus et non lus, spam compris), sans rien modifier.
        <template v-if="tracking.lastCheckAt">Dernière vérification {{ timeAgo(tracking.lastCheckAt) }}.</template>
      </span>
      <button v-if="tracking.configured" type="button" class="small ghost" :disabled="checking || tracking.running" @click="check">
        <Icon name="refresh" :size="14" />Vérifier maintenant
      </button>
    </div>

    <!-- Deux catégories, jamais mélangées -->
    <div class="kinds" role="tablist" aria-label="Type de candidature">
      <button type="button" role="tab" :aria-selected="kind === 'offers'" :class="{ active: kind === 'offers' }" @click="kind = 'offers'">
        <Icon name="briefcase" :size="16" />Sur une offre <span class="count">{{ jobs.length }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="kind === 'spontaneous'" :class="{ active: kind === 'spontaneous' }" @click="kind = 'spontaneous'">
        <Icon name="building" :size="16" />Spontanées <span class="count">{{ spontaneous.length }}</span>
      </button>
    </div>

    <div class="filters" role="tablist" aria-label="Étape">
      <button v-for="f in FILTERS" :key="f.id" type="button" role="tab" :aria-selected="filter === f.id" :class="['chip', `f-${f.id}`, { active: filter === f.id }]" @click="filter = f.id">
        {{ f.label }} <span class="count">{{ count(f.id) }}</span>
      </button>
    </div>

    <p v-if="error" class="alert"><Icon name="alert" :size="16" />{{ error }}</p>
    <template v-if="loading"><div v-for="n in 3" :key="n" class="skeleton" /></template>

    <div v-else-if="shown.length === 0" class="empty">
      <Icon :name="kind === 'offers' ? 'send' : 'building'" :size="40" />
      <strong>Rien ici pour l'instant</strong>
      <span v-if="kind === 'offers' && filter === 'active'" class="small">Sur la page d'une offre, clique sur « Marquer comme postulé » : elle arrivera ici.</span>
      <span v-else-if="kind === 'spontaneous' && filter === 'active'" class="small">Les candidatures spontanées envoyées depuis « Entreprises » arrivent ici.</span>
    </div>

    <article v-for="a in shown" :key="a.id" class="card app" :class="`s-${a.stage}`">
      <ScoreBadge v-if="'score' in a" :value="a.score.final" />
      <div class="body">
        <div class="top">
          <div class="stack" style="gap: 0.15rem; min-width: 0">
            <RouterLink v-if="'title' in a" :to="{ name: 'job', params: { id: a.id } }" class="title">{{ a.title }}</RouterLink>
            <RouterLink v-else :to="{ name: 'spontaneous', params: { id: a.leadId } }" class="title">{{ a.company }}</RouterLink>
            <div class="meta muted small">
              <span v-if="'title' in a"><Icon name="building" :size="14" />{{ a.company ?? "Entreprise non précisée" }}</span>
              <span><Icon name="pin" :size="14" /><a v-if="place(a)" class="map" :href="mapsUrl(a.company, place(a))" target="_blank" rel="noopener" title="Ouvrir dans Google Maps">{{ place(a) }}</a><template v-else>Lieu non précisé</template></span>
              <span v-if="sentAt(a)"><Icon name="send" :size="14" />Envoyée {{ timeAgo(sentAt(a)!) }}</span>
              <span v-if="'sentTo' in a && a.sentTo"><Icon name="mail" :size="14" />{{ a.sentTo }}</span>
              <span v-if="'cvs' in a && a.cvs?.length"><Icon name="file" :size="14" />CV {{ a.cvs.map((c) => `${c.template === "une-colonne" ? "une colonne" : "deux colonnes"}${c.exportedAt ? ` du ${new Date(c.exportedAt).toLocaleDateString("fr-FR")}` : ""}`).join(" et ") }}</span>
            </div>
          </div>
          <div v-if="'sources' in a" class="origin"><SourceLogo v-for="s in a.sources" :key="s.source" :source="s.source" :size="24" /></div>
        </div>

        <!-- Où en est la candidature -->
        <div v-if="a.stage === 'REJECTED'" class="rejected small">
          <Icon name="eyeOff" :size="15" /><template v-if="'noOpeningAt' in a && a.noOpeningAt">Close</template><template v-else>Refusée</template><template v-if="lastMail(a)?.kind === 'REJECTION'"> {{ timeAgo(lastMail(a)!.receivedAt) }}</template>
        </div>
        <div v-else-if="a.stage === 'CAREER_SITE'" class="career small">
          <Icon name="globe" :size="15" />Ils demandent de postuler sur leur site
          <a v-if="careerUrl(a)" :href="careerUrl(a)!" target="_blank" rel="noopener">{{ careerUrl(a) }}</a>
          <template v-if="'appliedOnSiteAt' in a">
            <button type="button" class="small primary" :disabled="busy === a.id" @click="siteOutcome(a, 'applied')">
              <Icon name="check" :size="14" />J'ai postulé sur leur site
            </button>
            <button type="button" class="small ghost" :disabled="busy === a.id" title="Aucun poste ni candidature spontanée possible sur leur site : la candidature est close" @click="siteOutcome(a, 'none')">
              <Icon name="eyeOff" :size="14" />Rien à postuler sur leur site
            </button>
          </template>
        </div>
        <ol v-else class="steps" :aria-label="`Étape : ${STAGE_LABEL[a.stage]}`">
          <li v-for="(s, i) in STEPS" :key="s.stage" :class="{ done: stepDone(a, i), current: s.stage === a.stage }">
            <span class="dot"><Icon v-if="stepDone(a, i)" name="check" :size="11" /></span>{{ s.label }}
          </li>
        </ol>

        <p v-if="'appliedOnSiteAt' in a && a.appliedOnSiteAt" class="last small muted">
          <Icon name="globe" :size="14" /> Postulé sur leur site {{ timeAgo(a.appliedOnSiteAt) }} : les réponses restent suivies ·
          <button type="button" class="link" :disabled="busy === a.id" @click="siteOutcome(a, null)">annuler</button>
        </p>
        <p v-if="'noOpeningAt' in a && a.noOpeningAt" class="last small muted">
          <Icon name="globe" :size="14" /> Rien à postuler sur leur site (noté {{ timeAgo(a.noOpeningAt) }}) : candidature close ·
          <button type="button" class="link" :disabled="busy === a.id" @click="siteOutcome(a, null)">annuler</button>
        </p>
        <p v-if="lastMail(a)" class="last small">
          <strong>{{ mailLabel(lastMail(a)!) }}</strong> · {{ timeAgo(lastMail(a)!.receivedAt) }} ·
          <a class="muted" :href="lastMail(a)!.url" target="_blank" rel="noopener" title="Ouvrir le mail">« {{ lastMail(a)!.subject }} »</a>
        </p>
        <p v-if="needsFollowUp(a)" class="follow small">
          <Icon name="clock" :size="14" /> Pas de nouvelles depuis {{ daysSince(lastMail(a)?.receivedAt ?? sentAt(a)) }} jours : c'est le bon moment pour relancer.
        </p>

        <div class="row actions">
          <button v-if="a.mails.length" type="button" class="small ghost" :aria-expanded="open.has(a.id)" @click="toggle(a.id)">
            <Icon name="mail" :size="14" />{{ open.has(a.id) ? "Masquer" : "Voir" }} les mails ({{ activeMails(a).length }})
          </button>
          <template v-if="'title' in a">
            <RouterLink :to="{ name: 'job', params: { id: a.id } }" class="btn small"><Icon name="eye" :size="14" />Voir l'offre</RouterLink>
            <template v-if="a.status === 'APPLIED'">
              <button type="button" class="small danger" :disabled="busy === a.id" @click="setStatus(a, 'REJECTED')"><Icon name="eyeOff" :size="14" />Refus reçu</button>
              <button type="button" class="small ghost" :disabled="busy === a.id" title="Tu n'as finalement pas postulé : l'offre revient dans « Offres »" @click="setStatus(a, 'SAVED')">
                <Icon name="undo" :size="14" />Je n'ai pas postulé
              </button>
            </template>
            <button v-else type="button" class="small ghost" :disabled="busy === a.id" @click="setStatus(a, 'APPLIED')"><Icon name="undo" :size="14" />Remettre en attente</button>
          </template>
          <RouterLink v-else :to="{ name: 'spontaneous', params: { id: a.leadId } }" class="btn small"><Icon name="eye" :size="14" />Voir la candidature</RouterLink>
        </div>

        <!-- Historique des mails reconnus -->
        <ul v-if="open.has(a.id)" class="mails">
          <li v-for="m in a.mails" :key="m.id" :class="[`k-${m.kind}`, { dismissed: m.dismissed }]">
            <span class="when small muted">{{ day(m.receivedAt) }}</span>
            <div class="what">
              <strong class="small">{{ mailLabel(m) }}</strong>
              <a class="small" :href="m.url" target="_blank" rel="noopener" title="Ouvrir le mail">« {{ m.subject }} »</a>
              <span class="small muted">{{ m.from }}</span>
            </div>
            <span v-if="m.dismissed" class="small muted">écarté</span>
            <button v-else type="button" class="small ghost" :disabled="busy === m.id" title="Ce mail a été rattaché par erreur : il ne compte plus" @click="dismiss(m)">
              Pas lié à cette candidature
            </button>
          </li>
        </ul>
      </div>
    </article>
  </div>
</template>

<style scoped>
.tracking { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; padding: 0.6rem 0.85rem; border-radius: var(--radius-sm); background: var(--good-bg); color: var(--text); }
.tracking.off { background: var(--surface-2); color: var(--muted); }
.tracking.bad { background: var(--low-bg); }
.tracking span { flex: 1; min-width: 14rem; }
.tracking code { font-size: 0.8rem; }

.kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.kinds button { justify-content: center; gap: 0.45rem; padding: 0.7rem; font-weight: 650; }
.kinds button.active { background: var(--accent); color: var(--accent-contrast); border-color: transparent; }
.kinds button.active .count { background: rgba(255, 255, 255, 0.25); }

.filters { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.filters .chip { border-radius: 99px; }
.filters .chip.active { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.filters .f-REJECTED.active { background: var(--low-bg); color: var(--low); }
.filters .f-CAREER_SITE.active { background: var(--mid-bg); color: var(--text); }
.filters .f-OFFER.active { background: var(--good-bg); color: var(--good); }
.count { display: inline-grid; place-items: center; min-width: 1.4rem; padding: 0 0.35rem; margin-left: 0.3rem; border-radius: 99px; background: var(--surface-2, var(--border)); font-size: 0.75rem; }

.app { display: flex; gap: 1rem; align-items: flex-start; border-left: 4px solid var(--border); }
.app.s-ACK { border-left-color: var(--accent); }
.app.s-INTERVIEW { border-left-color: var(--mid); }
.app.s-OFFER { border-left-color: var(--good); }
.app.s-CAREER_SITE { border-left-color: var(--mid); }
.app.s-REJECTED { border-left-color: var(--low); opacity: 0.85; }
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.55rem; }
.top { display: flex; justify-content: space-between; gap: 0.8rem; align-items: flex-start; }
.title { font-weight: 650; color: var(--text); }
.title:hover { color: var(--accent); }
.origin { display: flex; gap: 0.3rem; flex-shrink: 0; }
.meta { display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; }
.meta span { display: inline-flex; align-items: center; gap: 0.35rem; }

/* Frise : Envoyée → Reçue → Entretien → Proposition */
.steps { list-style: none; display: grid; grid-template-columns: repeat(4, 1fr); margin: 0; padding: 0; }
.steps li { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.3rem; font-size: 0.78rem; color: var(--muted); text-align: center; }
.steps li::before { content: ""; position: absolute; top: 0.55rem; left: -50%; width: 100%; height: 2px; background: var(--border); z-index: 0; }
.steps li:first-child::before { display: none; }
.steps li.done::before { background: var(--accent); }
.steps .dot { position: relative; z-index: 1; display: grid; place-items: center; width: 1.15rem; height: 1.15rem; border-radius: 99px; background: var(--surface); border: 2px solid var(--border); color: var(--accent-contrast); }
.steps li.done .dot { background: var(--accent); border-color: var(--accent); }
.steps li.current { color: var(--text); font-weight: 650; }
.s-INTERVIEW .steps li.current .dot { background: var(--mid); border-color: var(--mid); }
.s-OFFER .steps li.current .dot { background: var(--good); border-color: var(--good); }
.career { display: inline-flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; align-self: flex-start; padding: 0.3rem 0.7rem; border-radius: 12px; background: var(--mid-bg); color: var(--text); font-weight: 650; overflow-wrap: anywhere; }
.career a { font-weight: 400; }
button.link { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }
.rejected { display: inline-flex; align-items: center; gap: 0.4rem; align-self: flex-start; padding: 0.3rem 0.7rem; border-radius: 99px; background: var(--low-bg); color: var(--low); font-weight: 650; }

.last { margin: 0; }
.follow { display: flex; align-items: center; gap: 0.4rem; margin: 0; padding: 0.45rem 0.7rem; border-radius: 8px; background: var(--mid-bg); color: var(--text); }
.actions { gap: 0.4rem; flex-wrap: wrap; }

.mails { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border-top: 1px solid var(--border); }
.mails li { display: flex; align-items: center; gap: 0.8rem; padding: 0.55rem 0 0.55rem 0.6rem; border-bottom: 1px solid var(--border); border-left: 3px solid var(--border); }
.mails li.k-ACK { border-left-color: var(--accent); }
.mails li.k-INTERVIEW { border-left-color: var(--mid); }
.mails li.k-OFFER { border-left-color: var(--good); }
.mails li.k-REJECTION { border-left-color: var(--low); }
.mails li.k-CAREER_SITE { border-left-color: var(--mid); }
.mails li.dismissed { opacity: 0.5; }
.mails .when { width: 3.6rem; flex-shrink: 0; }
.mails .what { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; overflow-wrap: anywhere; }

@media (max-width: 640px) {
  .app { flex-direction: column; }
  .steps li { font-size: 0.7rem; }
  .mails li { flex-wrap: wrap; }
}
</style>

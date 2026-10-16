<script setup lang="ts">
import { computed, onActivated, ref } from "vue";
import { api, errorMessage } from "../api";
import {
  type AnyApplication,
  activeMails,
  companyOf,
  isJob,
  lastActivity,
  lastMail,
  mailLabel,
  needsFollowUp,
  sentAt,
  stageClass,
  stageLabel,
  toFollowUp,
  toReview,
} from "../applications";
import ApplicationDetail from "../components/ApplicationDetail.vue";
import Icon, { type IconName } from "../components/Icon.vue";
import { place, timeAgo } from "../format";
import type { Application, ApplicationMail, MailTracking, SpontaneousItem } from "../types";

const jobs = ref<Application[]>([]);
const spontaneous = ref<SpontaneousItem[]>([]);
const tracking = ref<MailTracking | null>(null);
const firstName = ref("");
const loading = ref(true);
const error = ref<string | null>(null);
const checking = ref(false);
const open = ref<string | null>(null);

type View = "overview" | "offers" | "spontaneous" | "followup" | "interviews" | "mails";
const view = ref<View>("overview");
type Filter = "all" | "sent" | "answered" | "interview" | "rejected";
const filter = ref<Filter>("all");

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
// Prénom pour le bonjour : celui de ta signature de lettre (« Chahine MEHADJI »).
api.getLetterKit().then((r) => (firstName.value = r.kit.signature.trim().split(/\s+/)[0] ?? "")).catch(() => {});

async function check() {
  checking.value = true;
  try {
    tracking.value = await api.checkApplicationMails();
    await load();
  } catch (e) {
    error.value = errorMessage(e, "La vérification des mails a échoué.");
  } finally {
    checking.value = false;
  }
}

const all = computed<AnyApplication[]>(() => [...jobs.value, ...spontaneous.value]);
const WEEK = 7 * 86_400_000;
const thisWeek = (d: string | null) => !!d && Date.now() - new Date(d).getTime() < WEEK;
const mailsOf = (kinds: ApplicationMail["kind"][]) => all.value.flatMap((a) => activeMails(a).filter((m) => kinds.includes(m.kind)));

const active = computed(() => all.value.filter((a) => a.stage !== "REJECTED"));
const answered = computed(() => all.value.filter((a) => activeMails(a).length > 0));
const interviews = computed(() => all.value.filter((a) => a.stage === "INTERVIEW"));
const offers = computed(() => all.value.filter((a) => a.stage === "OFFER"));
const rejected = computed(() => all.value.filter((a) => a.stage === "REJECTED"));

type Kpi = { label: string; value: number; week: number; weekLabel: string; icon: IconName; tone: string; to: Filter };
const kpis = computed<Kpi[]>(() => [
  { label: "Candidatures actives", value: active.value.length, week: all.value.filter((a) => thisWeek(sentAt(a))).length, weekLabel: "envoyée", icon: "file", tone: "accent", to: "all" },
  { label: "Réponses reçues", value: answered.value.length, week: all.value.flatMap(activeMails).filter((m) => thisWeek(m.receivedAt)).length, weekLabel: "mail", icon: "mail", tone: "accent", to: "answered" },
  { label: "Entretiens", value: interviews.value.length, week: mailsOf(["INTERVIEW"]).filter((m) => thisWeek(m.receivedAt)).length, weekLabel: "proposé", icon: "calendar", tone: "good", to: "interview" },
  { label: "Refus", value: rejected.value.length, week: mailsOf(["REJECTION"]).filter((m) => thisWeek(m.receivedAt)).length, weekLabel: "reçu", icon: "x", tone: "low", to: "rejected" },
]);
const weekText = (k: Kpi) => (k.week ? `+${k.week} ${k.weekLabel}${k.week > 1 ? "s" : ""} cette semaine` : "Rien de neuf cette semaine");

/**
 * Ordre de priorité : un mail à vérifier, un entretien ou une proposition, une relance à faire, une réponse récente,
 * puis le reste (dernière nouvelle d'abord).
 */
const priority = (a: AnyApplication) =>
  toReview(a).length ? 0 : a.stage === "INTERVIEW" || a.stage === "OFFER" ? 1 : needsFollowUp(a) ? 2 : thisWeek(lastMail(a)?.receivedAt ?? null) ? 3 : a.stage === "CAREER_SITE" ? 4 : 5;
const byLast = (x: AnyApplication, y: AnyApplication) => new Date(lastActivity(y) ?? 0).getTime() - new Date(lastActivity(x) ?? 0).getTime();

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Toutes" },
  { id: "sent", label: "Envoyées" },
  { id: "answered", label: "Réponses" },
  { id: "interview", label: "Entretiens" },
  { id: "rejected", label: "Refusées" },
];
const matches = (a: AnyApplication, f: Filter) =>
  f === "all" ? a.stage !== "REJECTED" : f === "sent" ? a.stage === "SENT" : f === "answered" ? a.stage === "ACK" || a.stage === "CAREER_SITE" : f === "interview" ? a.stage === "INTERVIEW" || a.stage === "OFFER" : a.stage === "REJECTED";
/** Vue d'ensemble : les 8 plus urgentes du filtre ; onglets : toute la liste. */
const rows = computed(() => {
  const list =
    view.value === "offers"
      ? jobs.value
      : view.value === "spontaneous"
        ? spontaneous.value
        : view.value === "followup"
          ? spontaneous.value.filter(toFollowUp)
          : view.value === "interviews"
            ? [...interviews.value, ...offers.value]
            : all.value;
  const shown = list.filter((a) => (view.value === "overview" ? matches(a, filter.value) : true));
  const sorted = [...shown].sort((x, y) => (view.value === "overview" || view.value === "interviews" ? priority(x) - priority(y) : 0) || byLast(x, y));
  return view.value === "overview" ? sorted.slice(0, 8) : sorted;
});

/** Ce qu'il y a à faire sur la ligne. */
function action(a: AnyApplication): { label: string; tone: "primary" | "" } {
  if (toReview(a).length) return { label: "Vérifier", tone: "primary" };
  if (a.stage === "INTERVIEW" || a.stage === "OFFER") return { label: "Répondre", tone: "primary" };
  if (needsFollowUp(a)) return { label: "Relancer", tone: "" };
  if (lastMail(a)) return { label: "Lire", tone: "" };
  return { label: "Voir", tone: "" };
}
const toggle = (id: string) => (open.value = open.value === id ? null : id);

/** Activité récente : les derniers mails reconnus, toutes candidatures confondues. */
type Activity = { mail: ApplicationMail; app: AnyApplication };
const activity = computed<Activity[]>(() =>
  all.value
    .flatMap((app) => activeMails(app).map((mail) => ({ mail, app })))
    .sort((x, y) => new Date(y.mail.receivedAt).getTime() - new Date(x.mail.receivedAt).getTime()),
);
const KIND_ICON: Record<ApplicationMail["kind"], IconName> = { ACK: "mail", INTERVIEW: "calendar", OFFER: "star", REJECTION: "x", CAREER_SITE: "globe" };
const reviewCount = computed(() => activity.value.filter((x) => x.mail.needsReview).length);

/** Avancement : part de tes candidatures arrivées à chaque étape. */
const progress = computed(() => {
  const total = all.value.length || 1;
  return [
    { label: "Envoyées", value: all.value.length, pct: 100, icon: "send" as IconName, tone: "accent" },
    { label: "Réponses reçues", value: answered.value.length, pct: (answered.value.length / total) * 100, icon: "mail" as IconName, tone: "accent" },
    { label: "Entretiens", value: interviews.value.length + offers.value.length, pct: ((interviews.value.length + offers.value.length) / total) * 100, icon: "calendar" as IconName, tone: "good" },
    { label: "Propositions", value: offers.value.length, pct: (offers.value.length / total) * 100, icon: "star" as IconName, tone: "mid" },
    { label: "Refusées", value: rejected.value.length, pct: (rejected.value.length / total) * 100, icon: "x" as IconName, tone: "low" },
  ];
});

const TABS: Array<{ id: View; label: string; icon: IconName; count?: () => number }> = [
  { id: "overview", label: "Vue d'ensemble", icon: "home" },
  { id: "offers", label: "Sur une offre", icon: "briefcase", count: () => jobs.value.length },
  { id: "spontaneous", label: "Spontanées", icon: "send", count: () => spontaneous.value.length },
  { id: "interviews", label: "Entretiens", icon: "calendar", count: () => interviews.value.length + offers.value.length },
  { id: "followup", label: "À relancer", icon: "clock", count: () => spontaneous.value.filter(toFollowUp).length },
  { id: "mails", label: "E-mails", icon: "mail", count: () => reviewCount.value },
];
const initial = (a: AnyApplication) => companyOf(a).trim().charAt(0).toUpperCase() || "?";
const titleOf = (a: AnyApplication) => (isJob(a) ? a.title : "Candidature spontanée");
</script>

<template>
  <header class="hello">
    <div>
      <h1>Bonjour{{ firstName ? ` ${firstName}` : "" }} <span aria-hidden="true">👋</span></h1>
      <p class="muted">Voici où tu en es dans ta recherche.</p>
    </div>
    <div class="row">
      <div v-if="tracking" class="sync small" :class="{ off: !tracking.configured, bad: tracking.lastError }">
        <span class="dot" />
        <span v-if="!tracking.configured" title="Ajoute MAIL_TRACKING_ENABLED=true dans .env puis redémarre l'API">Suivi des mails désactivé</span>
        <span v-else-if="tracking.lastError" :title="tracking.lastError">Dernière lecture des mails en échec</span>
        <span v-else-if="tracking.running || checking">Lecture de tes mails…</span>
        <span v-else>Boîte mail synchronisée<template v-if="tracking.lastCheckAt"> · {{ timeAgo(tracking.lastCheckAt) }}</template></span>
        <button v-if="tracking.configured" type="button" class="icon-btn" :disabled="checking || tracking.running" aria-label="Vérifier les mails maintenant" title="Vérifier les mails maintenant" @click="check">
          <Icon name="refresh" :size="15" />
        </button>
      </div>
      <RouterLink :to="{ name: 'add-job' }" class="btn primary"><Icon name="plus" :size="16" />Ajouter</RouterLink>
    </div>
  </header>

  <nav class="tabs" aria-label="Rubriques des candidatures">
    <button v-for="t in TABS" :key="t.id" type="button" :class="{ active: view === t.id }" :aria-current="view === t.id ? 'page' : undefined" @click="(view = t.id), (open = null)">
      <Icon :name="t.icon" :size="16" />{{ t.label }}<span v-if="t.count" class="count" :class="{ warn: (t.id === 'mails' && reviewCount) || (t.id === 'followup' && t.count!()) }">{{ t.count() }}</span>
    </button>
  </nav>

  <p v-if="error" class="alert"><Icon name="alert" :size="16" />{{ error }}</p>
  <div v-if="loading" class="stack"><div v-for="n in 3" :key="n" class="skeleton" /></div>

  <template v-else>
    <!-- Compteurs -->
    <div v-if="view === 'overview'" class="kpis">
      <button v-for="k in kpis" :key="k.label" type="button" class="kpi card" @click="filter = k.to">
        <span class="kpi-icon" :class="k.tone"><Icon :name="k.icon" :size="22" /></span>
        <span class="kpi-body">
          <span class="small">{{ k.label }}</span>
          <strong>{{ k.value }}</strong>
          <span class="small" :class="k.week ? (k.tone === 'low' ? 'low' : 'good') : 'muted'">{{ weekText(k) }}</span>
        </span>
        <Icon name="chevronRight" :size="18" class="muted" />
      </button>
    </div>

    <div :class="view === 'overview' ? 'main-grid' : ''">
      <!-- Candidatures -->
      <section v-if="view !== 'mails'" class="card panel">
        <div class="panel-head">
          <div class="panel-title">
            <Icon name="clock" :size="20" />
            <div>
              <h2>{{ view === "overview" ? "À suivre en priorité" : TABS.find((t) => t.id === view)!.label }}</h2>
              <p class="small muted">{{ view === "overview" ? "Les candidatures qui demandent ton attention" : `${rows.length} candidature${rows.length > 1 ? "s" : ""}` }}</p>
            </div>
          </div>
          <div v-if="view === 'overview'" class="seg" role="tablist" aria-label="Étape">
            <button v-for="f in FILTERS" :key="f.id" type="button" role="tab" :aria-selected="filter === f.id" :class="{ active: filter === f.id }" @click="filter = f.id">{{ f.label }}</button>
          </div>
        </div>

        <div v-if="rows.length === 0" class="empty small muted">
          <template v-if="view === 'offers' || all.length === 0">Sur la page d'une offre, clique sur « Marquer comme postulé » : elle arrivera ici.</template>
          <template v-else-if="view === 'spontaneous'">Les candidatures spontanées envoyées depuis « Entreprises » arrivent ici.</template>
          <template v-else>Rien dans cette catégorie pour l'instant.</template>
        </div>
        <div v-else class="table" role="table">
          <div class="tr th small muted" role="row">
            <span role="columnheader">Entreprise</span><span role="columnheader">Poste</span><span role="columnheader">Statut</span><span role="columnheader">Dernière activité</span><span role="columnheader">Action</span>
          </div>
          <div v-for="a in rows" :key="a.id" class="item" :class="{ open: open === a.id }">
            <div class="tr" role="row">
              <span class="company" role="cell">
                <span class="avatar" aria-hidden="true">{{ initial(a) }}</span>
                <span class="cell-text"><strong>{{ companyOf(a) }}</strong><span class="small muted">{{ place(a) ?? "Lieu non précisé" }}</span></span>
              </span>
              <span class="cell-text" role="cell">{{ titleOf(a) }}<span v-if="lastMail(a)?.summary" class="small muted clamp">{{ lastMail(a)!.summary }}</span></span>
              <span role="cell">
                <span class="status" :class="stageClass(a)"><span class="dot" />{{ stageLabel(a) }}</span>
                <span v-if="toReview(a).length" class="status s-REVIEW"><Icon name="alert" :size="12" />À vérifier</span>
              </span>
              <span class="small muted" role="cell">{{ lastActivity(a) ? timeAgo(lastActivity(a)!) : "—" }}<template v-if="needsFollowUp(a)"><br /><span class="mid">relancer</span></template></span>
              <span class="acts" role="cell">
                <button type="button" class="small" :class="action(a).tone" :aria-expanded="open === a.id" @click="toggle(a.id)">{{ action(a).label }}</button>
                <button type="button" class="icon-btn" :aria-label="`Détail de la candidature chez ${companyOf(a)}`" :aria-expanded="open === a.id" @click="toggle(a.id)"><Icon :name="open === a.id ? 'chevronDown' : 'dots'" :size="16" /></button>
              </span>
            </div>
            <ApplicationDetail v-if="open === a.id" :app="a" @changed="load" />
          </div>
        </div>
      </section>

      <!-- Activité récente (et page E-mails) -->
      <section v-if="view === 'overview' || view === 'mails'" class="card panel">
        <div class="panel-head">
          <div class="panel-title">
            <Icon name="mail" :size="20" />
            <div>
              <h2>{{ view === "mails" ? "E-mails reconnus" : "Activité récente" }}</h2>
              <p v-if="view === 'mails'" class="small muted">Résumés par l'IA. Ceux « à vérifier » attendent ta confirmation.</p>
            </div>
          </div>
          <button v-if="view === 'overview'" type="button" class="link small" @click="view = 'mails'">Voir tous les e-mails <Icon name="chevronRight" :size="14" /></button>
        </div>
        <p v-if="activity.length === 0" class="empty small muted">Aucune réponse reconnue pour l'instant.</p>
        <ol class="feed">
          <li
            v-for="x in view === 'mails' ? [...activity].sort((p, q) => Number(q.mail.needsReview) - Number(p.mail.needsReview)) : activity.slice(0, 6)"
            :key="x.mail.id"
            :class="`k-${x.mail.kind}`"
          >
            <span class="feed-icon" aria-hidden="true"><Icon :name="KIND_ICON[x.mail.kind]" :size="15" /></span>
            <div class="feed-body">
              <div class="spread">
                <strong class="small">{{ mailLabel(x.mail) }} · {{ companyOf(x.app) }}<span v-if="x.mail.needsReview" class="tag">à vérifier</span></strong>
                <span class="small muted">{{ timeAgo(x.mail.receivedAt) }}</span>
              </div>
              <span class="small muted clamp">{{ x.mail.summary ?? `« ${x.mail.subject} »` }}</span>
              <span v-if="view === 'mails'" class="row small">
                <a :href="x.mail.url" target="_blank" rel="noopener">Ouvrir dans Gmail</a>
                <button v-if="x.mail.needsReview" type="button" class="small primary" @click="api.confirmApplicationMail(x.mail.id).then(load)"><Icon name="check" :size="14" />Confirmer</button>
                <button type="button" class="small ghost" title="Ce mail a été rattaché par erreur : il ne compte plus" @click="api.dismissApplicationMail(x.mail.id).then(load)">Pas lié</button>
              </span>
            </div>
          </li>
        </ol>
      </section>
    </div>

    <!-- Avancement -->
    <section v-if="view === 'overview'" class="card panel">
      <div class="panel-head">
        <div class="panel-title">
          <Icon name="chart" :size="20" />
          <div>
            <h2>Avancement des candidatures</h2>
            <p class="small muted">Vue globale de ton parcours</p>
          </div>
        </div>
      </div>
      <div class="progress">
        <div v-for="p in progress" :key="p.label" class="step">
          <span class="kpi-icon" :class="p.tone"><Icon :name="p.icon" :size="18" /></span>
          <div class="step-body">
            <span class="small">{{ p.label }}</span>
            <strong>{{ p.value }}</strong>
            <div class="bar" :class="p.tone"><span :style="{ width: `${Math.round(p.pct)}%` }" /></div>
            <span class="small muted">{{ Math.round(p.pct) }} %</span>
          </div>
        </div>
      </div>
    </section>
  </template>
</template>

<style scoped>
.hello { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.1rem; }
.hello h1 { margin: 0; font-size: 1.85rem; }
.hello p { margin: 0.2rem 0 0; }
.sync { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.5rem 0.4rem 0.8rem; border-radius: 99px; background: var(--surface); border: 1px solid var(--border); }
.sync .dot { width: 0.55rem; height: 0.55rem; border-radius: 99px; background: var(--good); }
.sync.off .dot { background: var(--muted); }
.sync.bad .dot { background: var(--low); }
.icon-btn { padding: 0.3rem; border: 0; background: transparent; color: var(--muted); border-radius: 8px; }
.icon-btn:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); }

.tabs { display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 1rem; padding: 0.3rem; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); }
.tabs button { gap: 0.45rem; border: 0; background: transparent; color: var(--muted); padding: 0.5rem 0.85rem; }
.tabs button.active { background: var(--accent); color: var(--accent-contrast); }
.count { display: inline-grid; place-items: center; min-width: 1.4rem; padding: 0 0.35rem; border-radius: 99px; background: var(--accent-soft); font-size: 0.75rem; }
.tabs button.active .count { background: rgb(255 255 255 / 0.22); }
.count.warn { background: var(--mid-bg); color: var(--mid); }

.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
.kpi { display: flex; align-items: center; gap: 0.9rem; text-align: left; justify-content: flex-start; padding: 1.1rem 1.2rem; font-weight: 400; color: var(--text); }
.kpi:hover:not(:disabled) { border-color: var(--accent); color: var(--text); }
.kpi-body { flex: 1; display: flex; flex-direction: column; gap: 0.1rem; }
.kpi-body strong { font-size: 1.9rem; line-height: 1.15; }
.kpi-icon { display: grid; place-items: center; flex-shrink: 0; width: 2.9rem; height: 2.9rem; border-radius: 12px; background: var(--accent-soft); color: var(--accent); }
.kpi-icon.good { background: var(--good-bg); color: var(--good); }
.kpi-icon.mid { background: var(--mid-bg); color: var(--mid); }
.kpi-icon.low { background: var(--low-bg); color: var(--low); }
.good { color: var(--good); }
.low { color: var(--low); }
.mid { color: var(--mid); }

.main-grid { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr); gap: 1rem; margin-bottom: 1rem; align-items: start; }
.panel { padding: 1.1rem 1.2rem; margin-bottom: 1rem; }
.main-grid .panel { margin-bottom: 0; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 0.8rem; flex-wrap: wrap; margin-bottom: 0.8rem; }
.panel-title { display: flex; align-items: flex-start; gap: 0.7rem; }
.panel-title > .icon { margin-top: 0.15rem; color: var(--muted); }
.panel-title h2 { margin: 0; font-size: 1.1rem; }
.panel-title p { margin: 0.1rem 0 0; }
.seg { display: inline-flex; gap: 0.15rem; padding: 0.2rem; border-radius: 10px; background: var(--bg); border: 1px solid var(--border); }
.seg button { border: 0; background: transparent; padding: 0.3rem 0.6rem; font-size: 0.8rem; color: var(--muted); border-radius: 8px; }
.seg button.active { background: var(--accent); color: var(--accent-contrast); }
button.link { display: inline-flex; align-items: center; gap: 0.2rem; color: var(--accent); }

.table { display: flex; flex-direction: column; }
.tr { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.5fr) max-content minmax(5.5rem, 0.6fr) auto; gap: 0.8rem; align-items: center; padding: 0.75rem 0.4rem; }
.th span { white-space: nowrap; }
.th { padding-top: 0.2rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
.item { border-bottom: 1px solid var(--border); }
.item:last-child { border-bottom: 0; }
.item.open { background: var(--bg); border-radius: 10px; }
.company { display: flex; align-items: center; gap: 0.65rem; min-width: 0; }
.avatar { display: grid; place-items: center; flex-shrink: 0; width: 2.2rem; height: 2.2rem; border-radius: 99px; background: var(--accent-soft); color: var(--accent); font-weight: 700; }
.cell-text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; overflow-wrap: anywhere; }
.clamp { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.status { white-space: nowrap; display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.22rem 0.6rem; border-radius: 99px; font-size: 0.76rem; font-weight: 650; background: var(--accent-soft); color: var(--accent); margin: 0.1rem 0.25rem 0.1rem 0; }
.status .dot { width: 0.45rem; height: 0.45rem; border-radius: 99px; background: currentColor; }
.status.s-ACK, .status.s-CAREER_SITE { background: var(--good-bg); color: var(--good); }
.status.s-INTERVIEW, .status.s-OFFER, .status.s-REVIEW { background: var(--mid-bg); color: var(--mid); }
.status.s-REJECTED { background: var(--low-bg); color: var(--low); }
.status.s-FOLLOWED { background: rgb(168 85 247 / 0.14); color: #a855f7; }
.acts { display: inline-flex; align-items: center; gap: 0.25rem; }
.empty { padding: 1.5rem 0.5rem; text-align: center; }

.feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.feed li { position: relative; display: flex; gap: 0.75rem; padding: 0.7rem 0; border-bottom: 1px solid var(--border); }
.feed li:last-child { border-bottom: 0; }
.feed-icon { display: grid; place-items: center; flex-shrink: 0; width: 2rem; height: 2rem; border-radius: 99px; background: var(--accent-soft); color: var(--accent); }
.feed li.k-INTERVIEW .feed-icon, .feed li.k-OFFER .feed-icon, .feed li.k-CAREER_SITE .feed-icon { background: var(--mid-bg); color: var(--mid); }
.feed li.k-REJECTION .feed-icon { background: var(--low-bg); color: var(--low); }
.feed-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }
.tag { margin-left: 0.45rem; padding: 0.05rem 0.45rem; border-radius: 99px; background: var(--mid-bg); color: var(--mid); font-size: 0.72rem; font-weight: 650; }

.progress { display: grid; grid-template-columns: repeat(auto-fit, minmax(125px, 1fr)); gap: 1rem; }
.step { display: flex; gap: 0.75rem; align-items: flex-start; }
.step-body { flex: 1; display: flex; flex-direction: column; gap: 0.2rem; }
.step-body strong { font-size: 1.4rem; }
.bar { height: 0.4rem; border-radius: 99px; background: var(--ring-track); overflow: hidden; }
.bar span { display: block; height: 100%; border-radius: 99px; background: var(--accent); }
.bar.good span { background: var(--good); }
.bar.mid span { background: var(--mid); }
.bar.low span { background: var(--low); }

@media (max-width: 1100px) { .main-grid { grid-template-columns: 1fr; } }
@media (max-width: 720px) {
  .th { display: none; }
  .tr { grid-template-columns: minmax(0, 1fr) auto; }
  .tr > :nth-child(2) { grid-column: 1 / -1; order: 3; }
  .tr > :nth-child(3) { order: 4; }
  .tr > :nth-child(4) { order: 5; text-align: right; }
}
</style>

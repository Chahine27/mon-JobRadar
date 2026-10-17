<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { api, type JobQuery } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import ScoreBadge from "../components/ScoreBadge.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { REMOTE_LABELS, SOURCE_LABELS, STATUS_LABELS, formatSalary, sourceBadge, timeAgo, timeUntil, place } from "../format";
import type { AutoCheckStatus, CollectionStatus, JobSummary } from "../types";

const FILTERS_KEY = "jobradar.filters";

function loadFilters(): Required<Omit<JobQuery, "q" | "limit" | "offset">> & { q: string } {
  const defaults = { minScore: 0, status: "active" as const, includeHidden: false, q: "", sort: "score" as const, source: "", zone: "local" as const, contract: "" };
  try {
    const saved = { ...defaults, ...JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}") };
    // « Postulé » a sa propre page (Candidatures) : ancien filtre → flux normal.
    if (saved.status === "APPLIED") saved.status = "active";
    return saved;
  } catch {
    return defaults;
  }
}

const filters = reactive(loadFilters());
const jobs = ref<JobSummary[]>([]);
const loading = ref(true);
/** Téléphone : filtres repliés derrière un bouton (toujours visibles sur PC). */
const showFilters = ref(false);
const error = ref<string | null>(null);
const threshold = ref(70);

const PAGE_SIZE = 10;
const total = ref(0);
const loadingMore = ref(false);

/**
 * Recharge la liste depuis le début. `keepCount` : garde le nombre d'offres déjà affichées
 * (utile après une collecte, pour ne pas faire remonter l'utilisateur en haut).
 */
async function load(keepCount = false) {
  loading.value = !keepCount;
  error.value = null;
  try {
    const limit = keepCount ? Math.min(200, Math.max(PAGE_SIZE, jobs.value.length)) : PAGE_SIZE; // 200 = plafond de l'API
    const res = await api.listJobs({ ...filters, limit, offset: 0 });
    jobs.value = res.items;
    total.value = res.total;
    void requestCheck(res.items);
  } catch {
    error.value = "Impossible de charger les offres.";
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  loadingMore.value = true;
  try {
    const res = await api.listJobs({ ...filters, limit: PAGE_SIZE, offset: jobs.value.length });
    const known = new Set(jobs.value.map((j) => j.id));
    jobs.value = [...jobs.value, ...res.items.filter((j) => !known.has(j.id))];
    total.value = res.total;
    void requestCheck(res.items);
  } catch {
    error.value = "Impossible de charger la suite.";
  } finally {
    loadingMore.value = false;
  }
}

// ───── Vérification par l'IA des meilleures offres affichées (≥ seuil du profil) ─────
const check = ref<AutoCheckStatus | null>(null);
const pending = computed(() => new Set(check.value?.pending ?? []));
let checkPoll: ReturnType<typeof setInterval> | undefined;

/** Envoie les offres affichées : le serveur ne garde que celles au-dessus du seuil du profil pas encore vérifiées. */
async function requestCheck(items: JobSummary[]) {
  if (items.length === 0 || check.value?.enabled === false) return;
  try {
    for (let i = 0; i < items.length; i += 30) {
      check.value = await api.autoCheck(items.slice(i, i + 30).map((j) => j.id));
    }
    afterCheck();
  } catch {
    /* IA indisponible : la liste reste utilisable */
  }
}

const checkMessage = ref<string | null>(null);
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Suivi de la file de l'IA ; si Ollama était éteint, nouvel essai automatique dans 1 minute. */
function afterCheck() {
  if (check.value?.pending.length && !checkPoll) checkPoll = setInterval(pollCheck, 3000);
  if (check.value?.offline && !retryTimer) {
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void feedCheck(false);
    }, 65_000);
  }
}

/**
 * Tout le flux, pas seulement les offres affichées : les offres au-dessus du seuil du profil jamais vérifiées
 * (ou dont l'analyse est dépassée) partent à l'IA, de la meilleure à la moins bonne.
 * `retry` : clic de l'utilisateur → on réessaie même si l'IA était éteinte il y a peu.
 */
async function feedCheck(retry: boolean) {
  if (check.value?.enabled === false) return;
  try {
    const res = await api.autoCheckFeed(retry);
    check.value = res;
    if (retry && !res.offline && res.pending.length === 0) {
      checkMessage.value = `L'IA a déjà vérifié toutes les offres à ${check.value?.threshold ?? 0} % et plus.`;
      setTimeout(() => (checkMessage.value = null), 6000);
    }
    afterCheck();
  } catch {
    /* IA indisponible : la liste reste utilisable */
  }
}

async function pollCheck() {
  try {
    const before = new Set(check.value?.pending ?? []);
    const s = await api.autoCheckStatus();
    check.value = s;
    if (s.offline) afterCheck();
    // Une offre vient d'être vérifiée : on recharge (son score a pu baisser, l'ordre change).
    if ([...before].some((id) => !s.pending.includes(id))) await load(true);
    if (s.pending.length === 0) {
      clearInterval(checkPoll);
      checkPoll = undefined;
    }
  } catch {
    /* serveur injoignable : on réessaiera */
  }
}

const AI_LABELS = { forte: "IA : bonne adéquation", moyenne: "IA : adéquation moyenne", faible: "IA : adéquation faible" } as const;
const AI_TONES = { forte: "good", moyenne: "warn", faible: "bad" } as const;

let timer: ReturnType<typeof setTimeout> | undefined;
watch(filters, () => {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    /* stockage indisponible : sans importance */
  }
  clearTimeout(timer);
  timer = setTimeout(() => load(), 250);
});

// ───── Collecte : état + bouton Actualiser ─────
const collection = ref<CollectionStatus | null>(null);
const refreshMessage = ref<string | null>(null);
const clock = ref(new Date());
let lastRunId: string | null = null;
let fastPoll: ReturnType<typeof setInterval> | undefined;
let slowPoll: ReturnType<typeof setInterval> | undefined;

async function loadStatus() {
  try {
    const s = await api.collectionStatus();
    const finishedNewRun = s.lastRun && s.lastRun.id !== lastRunId && s.lastRun.status !== "running";
    // Collecte JobScraper finie (elle n'est pas dans lastRun, réservé au bouton « Actualiser ») : flux rechargé aussi.
    const scraperFinished = !!collection.value?.progress.length && s.progress.length === 0 && !s.running;
    if ((finishedNewRun && lastRunId !== null) || scraperFinished) {
      await load(true);
      void feedCheck(false); // nouvelles offres : l'IA vérifie les meilleures
    }
    if (s.lastRun && s.lastRun.status !== "running") lastRunId = s.lastRun.id;
    collection.value = s;
    // Source mémorisée mais désactivée depuis : on revient à « Toutes les sources ».
    if (filters.source && filters.source !== "manual" && !s.sources.some((x) => x.enabled && x.source === filters.source)) filters.source = "";
    clock.value = new Date();
    // Une collecte tourne (« Actualiser » ou file JobScraper) : avancement rafraîchi toutes les 2 s.
    const live = s.running || s.progress.length > 0;
    if (live && !fastPoll) fastPoll = setInterval(loadStatus, 2000);
    if (!live && fastPoll) {
      clearInterval(fastPoll);
      fastPoll = undefined;
      if (s.lastRun && refreshMessage.value) refreshMessage.value = `Collecte terminée : ${s.lastRun.created} nouvelle(s) offre(s).`;
    }
  } catch {
    /* serveur momentanément injoignable : on réessaiera */
  }
}

async function refreshNow() {
  refreshMessage.value = null;
  // Sans attendre la collecte : l'IA reprend les offres pas encore vérifiées (et réessaie si elle était éteinte).
  void feedCheck(true);
  try {
    const res = await api.refresh();
    refreshMessage.value = res.status === "started" ? "Collecte lancée…" : "Une collecte est déjà en cours…";
    if (collection.value) collection.value.running = true;
    clearInterval(fastPoll);
    fastPoll = setInterval(loadStatus, 2000);
  } catch {
    refreshMessage.value = "Impossible de lancer la collecte (aucune source active ?).";
  }
}

const running = computed(() => collection.value?.running ?? false);
const runningText = computed(() => {
  const c = collection.value;
  const r = c?.lastRun?.status === "running" ? c.lastRun : null;
  const since = r ? ` (lancée ${timeAgo(r.startedAt, clock.value)})` : "";
  if (c?.finishing) return `Collecte terminée${since} — descriptions, vérification IA et notifications…`;
  const step = c?.step ? ` — en cours : ${SOURCE_LABELS[c.step] ?? c.step}` : "";
  return `Collecte en cours${since}${step}…`;
});
const lastRunText = computed(() => {
  const r = collection.value?.lastRun;
  if (!r) return "Aucune collecte pour l'instant.";
  const when = timeAgo(r.finishedAt ?? r.startedAt, clock.value);
  const how = r.trigger === "scheduler" ? "auto" : r.trigger === "manual" ? "manuelle" : "en ligne de commande";
  const res = r.status === "failed" ? "en échec" : `${r.fetched} reçue(s), ${r.created} nouvelle(s)`;
  return `Dernière collecte : ${when} (${how}) — ${res}`;
});

onMounted(async () => {
  await load();
  await loadStatus();
  if (collection.value?.running) fastPoll = setInterval(loadStatus, 2000);
  slowPoll = setInterval(loadStatus, 30_000);
  api
    .getProfile()
    .then((p) => {
      threshold.value = p.profile.minScoreForNotification;
      contracts.value = p.profile.contracts;
      // Contrat mémorisé mais retiré du profil depuis : on revient à « Tous ».
      if (filters.contract && filters.contract !== "unknown" && !contractTabs.value.some((t) => t.value === filters.contract)) filters.contract = "";
    })
    .catch(() => {});
});

// Retour depuis une offre : son statut a pu changer, on recharge sans perdre les pages déjà affichées.
let mounted = false;
onActivated(() => {
  if (mounted) void load(true);
  mounted = true;
});

onUnmounted(() => {
  clearInterval(checkPoll);
  clearTimeout(retryTimer);
  clearInterval(fastPoll);
  clearInterval(slowPoll);
  clearTimeout(timer);
});

const MIN_SCORES = [25, 50, 65, 75];

const ZONE_TABS: Array<{ value: NonNullable<JobQuery["zone"]>; label: string }> = [
  { value: "", label: "Tout" },
  { value: "local", label: "Dans ma zone" },
  { value: "remote", label: "Full remote" },
  { value: "unknown", label: "Lieu non précisé" },
];

// Contrats cochés dans le profil (« Intérim » → INTERIM, comme le score) ; les autres sont masqués de toute façon.
const contracts = ref<string[]>([]);
const contractTabs = computed(() => [
  { value: "", label: "Tous" },
  ...contracts.value.map((c) => ({ value: c.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase(), label: c })),
  { value: "unknown", label: "Non précisé" },
]);

const STATUS_TABS:Array<{ value: NonNullable<JobQuery["status"]>; label: string }> = [
  { value: "active", label: "Actives" },
  { value: "NEW", label: "Nouvelles" },
  { value: "SAVED", label: "Sauvegardées" },
  { value: "IGNORED", label: "Ignorées" },
  { value: "EXPIRED", label: "Expirées" },
  { value: "all", label: "Toutes" },
];

/** Pastille d'une source : avancement si elle fait partie d'une collecte en cours, sinon son dernier résultat. */
const badgeOf = (s: CollectionStatus["sources"][number]) =>
  sourceBadge(s, collection.value?.progress.find((p) => p.source === s.source));
</script>

<template>
  <PageHeader title="Offres">
    <template #badge>
      <span v-if="collection?.newJobs" class="chip solid">{{ collection.newJobs }} nouvelle(s)</span>
    </template>
    <p class="subtitle">
      <template v-if="running">{{ runningText }}</template>
      <template v-else>{{ lastRunText }}</template>
    </p>
    <template #actions>
      <button type="button" class="primary" :disabled="running" :aria-label="running ? 'Collecte en cours' : 'Actualiser maintenant'" @click="refreshNow">
        <Icon name="refresh" :size="16" :class="{ spin: running }" />
        <span class="refresh-label">{{ running ? "Collecte en cours…" : "Actualiser maintenant" }}</span>
      </button>
      <span v-if="refreshMessage" class="muted small">{{ refreshMessage }}</span>
    </template>
  </PageHeader>

  <div class="stack">
    <div v-if="collection?.sources.some((x) => x.enabled)" class="sources-strip" role="radiogroup" aria-label="Afficher les offres de">
      <button
        type="button"
        role="radio"
        class="source-pill"
        :class="{ active: !filters.source }"
        :aria-checked="!filters.source"
        @click="filters.source = ''"
      >
        <Icon name="radar" :size="16" />
        <strong>Toutes les sources</strong>
      </button>
      <button
        v-for="s in collection.sources.filter((x) => x.enabled)"
        :key="s.source"
        type="button"
        role="radio"
        class="source-pill"
        :class="{ active: filters.source === s.source }"
        :aria-checked="filters.source === s.source"
        :title="s.lastError ?? `Afficher seulement les offres ${SOURCE_LABELS[s.source] ?? s.source}`"
        @click="filters.source = s.source"
      >
        <SourceLogo :source="s.source" :size="22" />
        <strong>{{ SOURCE_LABELS[s.source] ?? s.source }}</strong>
        <template v-if="badgeOf(s).busy">
          <Icon name="refresh" :size="13" class="spin muted" />
          <span class="muted">{{ badgeOf(s).text }}</span>
          <span v-if="badgeOf(s).pct !== null" class="bar pill-bar" role="progressbar" :aria-valuenow="badgeOf(s).pct!" aria-valuemin="0" aria-valuemax="100">
            <span class="good" :style="{ width: `${badgeOf(s).pct}%` }" />
          </span>
        </template>
        <template v-else>
          <span class="dot" :class="badgeOf(s).tone" />
          <span class="muted">{{ badgeOf(s).text }} · prochaine {{ timeUntil(s.nextRunAt, clock) }}</span>
        </template>
      </button>
      <button
        type="button"
        role="radio"
        class="source-pill"
        :class="{ active: filters.source === 'manual' }"
        :aria-checked="filters.source === 'manual'"
        title="Afficher seulement les offres ajoutées par toi (extension ou « Ajouter une offre »)"
        @click="filters.source = 'manual'"
      >
        <SourceLogo source="manual" :size="22" />
        <strong>{{ SOURCE_LABELS.manual }}</strong>
      </button>
    </div>

    <section class="card toolbar">
      <div class="tab-rows">
      <div class="tabs" role="tablist" aria-label="Rubrique">
        <button
          v-for="t in ZONE_TABS"
          :key="t.value"
          type="button"
          role="tab"
          :aria-selected="filters.zone === t.value"
          :class="{ active: filters.zone === t.value }"
          @click="filters.zone = t.value"
        >
          {{ t.label }}
        </button>
      </div>
      <div class="tabs" role="tablist" aria-label="Statut">
        <button
          v-for="t in STATUS_TABS"
          :key="t.value"
          type="button"
          role="tab"
          :aria-selected="filters.status === t.value"
          :class="{ active: filters.status === t.value }"
          @click="filters.status = t.value"
        >
          {{ t.label }}
        </button>
      </div>
      <div v-if="contracts.length" class="tabs contract-tabs" :class="{ open: showFilters }" role="tablist" aria-label="Contrat">
        <button
          v-for="t in contractTabs"
          :key="t.value"
          type="button"
          role="tab"
          :aria-selected="filters.contract === t.value"
          :class="{ active: filters.contract === t.value }"
          @click="filters.contract = t.value"
        >
          {{ t.label }}
        </button>
      </div>
      </div>
      <button type="button" class="small filters-toggle" :aria-expanded="showFilters" @click="showFilters = !showFilters">
        <Icon name="sliders" :size="15" />{{ showFilters ? "Masquer les filtres" : "Contrat, recherche, score, tri…" }}
      </button>
      <div class="filters" :class="{ open: showFilters }">
        <div class="field search">
          <Icon name="search" :size="16" />
          <input v-model="filters.q" type="search" placeholder="Titre, entreprise, ville…" aria-label="Recherche" />
        </div>
        <div class="range" role="radiogroup" aria-label="Compatibilité minimale">
          <span>Compatibilité min.</span>
          <div class="min-scores">
            <button
              v-for="m in MIN_SCORES"
              :key="m"
              type="button"
              role="radio"
              class="min-score"
              :class="{ active: filters.minScore === m }"
              :aria-checked="filters.minScore === m"
              :title="filters.minScore === m ? 'Cliquer pour retirer le filtre' : `Seulement les offres à ${m} % et plus`"
              @click="filters.minScore = filters.minScore === m ? 0 : m"
            >
              <ScoreBadge :value="m" :threshold="threshold" />
            </button>
          </div>
        </div>
        <label class="sort">
          <span>Trier par</span>
          <select v-model="filters.sort">
            <option value="score">Compatibilité</option>
            <option value="date">Plus récentes</option>
          </select>
        </label>
        <label class="switch"><input v-model="filters.includeHidden" type="checkbox" /> Offres masquées (contrat hors profil, senior…)</label>
      </div>
    </section>

    <p v-if="error" class="alert"><Icon name="alert" :size="16" />{{ error }}</p>
    <p v-else-if="!loading" class="muted small count">
      <strong>{{ total }}</strong> offre(s) · {{ jobs.length }} affichée(s)
      <span v-if="check?.pending.length" class="ai-status"><Icon name="sparkle" :size="14" class="spin-slow" />L'IA vérifie {{ check.pending.length }} offre(s) à {{ check.threshold }} % et plus…</span>
      <span v-else-if="check?.offline" class="ai-status off" :title="check.message ?? ''"><Icon name="sparkle" :size="14" />IA éteinte : scores non vérifiés (nouvel essai dans 1 min)</span>
      <span v-else-if="checkMessage" class="ai-status off"><Icon name="check" :size="14" />{{ checkMessage }}</span>
      <button
        v-if="check?.enabled !== false && !check?.pending.length"
        type="button"
        class="small ghost ai-btn"
        :title="`Envoie à l'IA toutes les offres à ${check?.threshold ?? 0} % et plus qu'elle n'a pas encore vérifiées`"
        @click="feedCheck(true)"
      >
        <Icon name="sparkle" :size="14" />Vérifier avec l'IA
      </button>
    </p>

    <template v-if="loading">
      <div v-for="n in 4" :key="n" class="skeleton" />
    </template>

    <div v-if="!loading && jobs.length === 0 && !error" class="empty">
      <Icon name="search" :size="40" />
      <strong>Aucune offre pour ces filtres</strong>
      <span class="small">Clique sur « Actualiser maintenant » ou élargis les filtres.</span>
    </div>

    <RouterLink
      v-for="job in jobs"
      :key="job.id"
      :to="{ name: 'job', params: { id: job.id } }"
      class="card job"
      :class="{ unread: job.status === 'NEW' }"
    >
      <ScoreBadge :value="job.score.final" :threshold="threshold" />
      <div class="body">
        <div class="top">
          <div class="row title-row">
            <strong class="title">{{ job.title }}</strong>
            <span v-if="job.status === 'NEW'" class="chip new">Nouvelle</span>
            <span v-else-if="job.status !== 'SEEN'" class="chip">{{ STATUS_LABELS[job.status] }}</span>
            <span v-if="job.score.hidden" class="chip warn">Masquée : {{ job.score.hiddenReason }}</span>
            <span
              v-if="job.abridged"
              class="chip"
              title="Adzuna / Jooble ne donnent que le début de l'annonce : score approximatif, pas vérifié par l'IA. Ouvre l'offre sur le site et envoie-la avec l'extension pour la compléter."
            ><Icon name="file" :size="12" />Extrait · score approximatif</span>
            <span v-else-if="pending.has(job.id)" class="chip accent"><Icon name="sparkle" :size="12" class="spin-slow" />IA en cours…</span>
            <span v-else-if="job.ai" class="chip" :class="AI_TONES[job.ai.adequation]" :title="job.ai.avis">
              <Icon name="sparkle" :size="12" />{{ AI_LABELS[job.ai.adequation] }}<template v-if="job.ai.before !== null"> · {{ job.ai.before }} → {{ job.score.final }} %</template>
            </span>
          </div>
          <div class="origin">
            <span v-if="job.publishedAt" class="when muted small" title="Date de publication"><Icon name="clock" :size="14" />{{ timeAgo(job.publishedAt) }}</span>
            <span v-else class="when muted small" title="Date de publication inconnue : date où Job Radar l'a trouvée"><Icon name="eye" :size="14" />vue {{ timeAgo(job.firstSeenAt) }}</span>
            <SourceLogo v-for="s in job.sources" :key="s.source" :source="s.source" :size="28" />
          </div>
        </div>
        <div class="company muted">
          <span><Icon name="building" :size="14" />{{ job.company ?? "Entreprise non précisée" }}</span>
          <span><Icon name="pin" :size="14" />{{ place(job) || "Lieu non précisé" }}</span>
        </div>
        <div class="row">
          <span class="chip"><Icon name="file" :size="13" />{{ job.contractType ?? "Contrat ?" }}</span>
          <span class="chip"><Icon name="euro" :size="13" />{{ formatSalary(job.salaryMin, job.salaryMax) ?? "Salaire non communiqué" }}</span>
          <span v-if="REMOTE_LABELS[job.remoteType]" class="chip"><Icon name="home" :size="13" />{{ REMOTE_LABELS[job.remoteType] }}</span>
          <span v-if="job.sources.some((s) => s.source === 'adzuna')" class="muted small src">Jobs by Adzuna</span>
        </div>
        <div v-if="job.matchedSkills.length || job.missingSkills.length" class="row skills">
          <span v-for="s in job.matchedSkills" :key="s" class="chip good">{{ s }}</span>
          <span v-for="s in job.missingSkills" :key="s" class="chip missing" title="Absent de ton profil">{{ s }}</span>
        </div>
      </div>
    </RouterLink>

    <div v-if="!loading && jobs.length < total" class="more">
      <button type="button" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? "Chargement…" : `Charger plus (${Math.min(PAGE_SIZE, total - jobs.length)} de plus, ${total - jobs.length} restante(s))` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ai-status { display: inline-flex; align-items: center; gap: 0.35rem; margin-left: 0.8rem; color: var(--accent); font-weight: 550; }
.ai-status.off { color: var(--muted); font-weight: 400; }
.ai-btn { margin-left: 0.6rem; }
.spin-slow { animation: spin 2.4s linear infinite; }
.sources-strip { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.source-pill {
  display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; padding: 0.35rem 0.75rem;
  background: var(--surface); border: 1px solid var(--border); border-radius: 99px;
  color: var(--text); font-weight: 400; cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.source-pill:hover { border-color: var(--border-strong); }
.source-pill.active { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 1px var(--accent) inset; }
.source-pill.active strong { color: var(--accent); }
.pill-bar { display: inline-block; width: 56px; height: 5px; }
.pill-bar > span { display: block; height: 100%; border-radius: 99px; transition: width 0.4s ease; }
.tab-rows { display: flex; flex-wrap: wrap; gap: 0.6rem; }
.toolbar { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.9rem; padding: 0.9rem 1rem; }
.filters { display: grid; grid-template-columns: minmax(220px, 2fr) minmax(180px, 1.3fr) minmax(150px, 1fr) auto; gap: 0.9rem 1.1rem; align-items: end; }
.min-scores { display: flex; gap: 0.5rem; margin-top: 0.3rem; }
.min-score { padding: 0.15rem; border-radius: 50%; background: none; border: 2px solid transparent; cursor: pointer; opacity: 0.55; transition: opacity 0.15s, border-color 0.15s; }
.min-score:hover { opacity: 0.85; }
.min-score.active { opacity: 1; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.min-score :deep(.ring) { --size: 40px; pointer-events: none; }
.filters .range span, .filters .sort span { display: flex; justify-content: space-between; gap: 0.5rem; }
.filters .switch { padding-bottom: 0.45rem; white-space: nowrap; }
@media (max-width: 900px) { .filters { grid-template-columns: 1fr 1fr; } .filters .search { grid-column: 1 / -1; } }
@media (max-width: 520px) { .filters { grid-template-columns: 1fr; } .filters .switch { white-space: normal; } }
/* Téléphone : pastilles de sources sur une ligne qui défile au doigt. */
@media (max-width: 600px) {
  .sources-strip { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin: 0 -1rem; padding: 0 1rem 0.1rem; }
  .source-pill { flex: none; white-space: nowrap; }
  .count { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.6rem; }
  .ai-status, .ai-btn { margin-left: 0; }
  .toolbar { gap: 0.5rem; padding: 0.6rem; }
  .tab-rows { gap: 0.4rem; }
  /* En-tête : bouton Actualiser réduit à son icône, à droite du titre. */
  .page-head { flex-wrap: nowrap; align-items: flex-start; }
  .refresh-label { display: none; }
  .tabs { padding: 0.15rem; }
}
.filters-toggle { display: none; }
@media (max-width: 600px) { .filters-toggle { display: inline-flex; justify-self: start; } .filters:not(.open), .contract-tabs:not(.open) { display: none; } }
.count { margin: 0.15rem 0 -0.2rem; }
.count strong { color: var(--text); }
.more { display: flex; justify-content: center; padding: 0.5rem 0 1rem; }

.job { display: flex; gap: 1.1rem; align-items: flex-start; color: inherit; transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s; }
.job:hover { text-decoration: none; border-color: var(--accent); box-shadow: var(--shadow-hover); transform: translateY(-1px); }
.job.unread { border-left: 3px solid var(--accent); }
.body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; min-width: 0; flex: 1; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
.title { font-size: 1.04rem; font-weight: 650; }
.title-row { gap: 0.45rem; }
.origin { display: flex; align-items: center; gap: 0.45rem; flex: none; }
.when { display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; }
.company { display: flex; flex-wrap: wrap; gap: 0.35rem 1.1rem; font-size: 0.9rem; }
.company span { display: inline-flex; align-items: center; gap: 0.35rem; }
.src { margin-left: 0.25rem; }
.skills { gap: 0.35rem; }
@media (max-width: 600px) { .top { flex-direction: column-reverse; gap: 0.3rem; } .origin { flex-wrap: wrap; } }
/* Après les règles de base des cartes, pour les remplacer. */
@media (max-width: 600px) {
  /* Carte d'offre compacte : contenu sur toute la largeur, petit anneau à droite du titre, seulement les compétences que tu as. */
  .job { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.35rem 0.6rem; }
  .body { display: contents; }
  .body > * { grid-column: 1 / -1; }
  .body > .top { grid-column: 1; grid-row: 1; }
  .job > :deep(.ring) { grid-column: 2; grid-row: 1; }
  .job :deep(.ring) { --size: 40px; }
  .job :deep(.ring)::before { inset: 4px; }
  .title { font-size: 0.95rem; line-height: 1.3; }
  .company { font-size: 0.8rem; gap: 0.1rem 0.8rem; }
  .job .row { gap: 0.3rem; }
  .skills .chip.missing { display: none; }
  .origin :deep(.source-logo) { width: 20px !important; height: 20px !important; }
}
</style>

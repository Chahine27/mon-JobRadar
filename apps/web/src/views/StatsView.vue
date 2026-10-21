<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../api";
import Icon from "../components/Icon.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { SOURCE_LABELS } from "../format";
import type { SkillStats } from "../types";

type Skill = SkillStats["skills"][number];

const PERIODS = [
  { days: 7, label: "7 jours" },
  { days: 30, label: "30 jours" },
  { days: 90, label: "90 jours" },
  { days: null, label: "Tout" },
] as const;
const days = ref<number | null>(30);
const stats = ref<SkillStats | null>(null);
const error = ref("");

watch(
  days,
  async (d) => {
    error.value = "";
    try {
      const s = await api.jobStats(d);
      if (d === days.value) stats.value = s; // réponse d'une période déjà quittée : ignorée
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Erreur";
    }
  },
  { immediate: true },
);

const nf = new Intl.NumberFormat("fr-FR");
const n = (x: number) => nf.format(x);
const years = (y: number) => `${y} an${y > 1 ? "s" : ""}`;
const date = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const label = (source: string) => SOURCE_LABELS[source] ?? source;

/** Écart avec la période d'avant : en points pour une part, en % pour un nombre d'offres. */
type Delta = { value: number; text: string } | null;
const delta = (cur: number, prev: number | undefined, unit: "pt" | "%" | ""): Delta => {
  if (prev === undefined) return null;
  const value = unit === "%" ? (prev ? Math.round(((cur - prev) / prev) * 100) : 0) : cur - prev;
  return { value, text: `${value > 0 ? "+" : ""}${value}${unit === "pt" ? " pt" + (Math.abs(value) > 1 ? "s" : "") : unit === "%" ? " %" : ""}` };
};

const kpis = computed(() => {
  const s = stats.value!;
  const p = s.previous ?? undefined;
  return [
    {
      icon: "code" as const,
      title: "Offres entièrement couvertes",
      value: `${s.fullMatch} %`,
      text: "des offres : tu as tous les langages et frameworks demandés.",
      delta: delta(s.fullMatch, p?.fullMatch, "pt"),
    },
    {
      icon: "target" as const,
      title: "Top 10 dans ton profil",
      value: `${s.topOwned} / 10`,
      text: "des langages et frameworks les plus demandés.",
      delta: delta(s.topOwned, p?.topOwned, ""),
    },
    {
      icon: "briefcase" as const,
      title: "Accessibles en expérience",
      value: `${s.experience.accessible} %`,
      text: `des offres demandent ${years(s.experience.max)} ou moins (ton maximum).`,
      delta: delta(s.experience.accessible, p?.accessible, "pt"),
    },
    {
      icon: "file" as const,
      title: "Offres collectées",
      value: n(s.offers),
      text: s.days
        ? `sur ${s.days} jours (${n(s.previous!.offers)} les ${s.days} jours d'avant).`
        : s.since
          ? `depuis le ${date(s.since)}, expirées comprises.`
          : "offres de développeur.",
      delta: delta(s.offers, p?.offers, "%"),
    },
  ];
});

/** Poids d'une compétence sur le marché (part des offres qui la demandent). */
const priority = (share: number) => (share >= 30 ? "high" : share >= 15 ? "mid" : "low");
const PRIORITY = { high: "Élevée", mid: "Moyenne", low: "Basse" } as const;

// Tableau des compétences : recherche, filtres, tri et pages côté navigateur.
const query = ref("");
const OWNED = [
  { id: "all", label: "Toutes" },
  { id: "yes", label: "Présentes" },
  { id: "no", label: "Manquantes" },
] as const;
const owned = ref<(typeof OWNED)[number]["id"]>("all");
const kind = ref<"all" | "core" | "tools">("all");
const sort = ref<"offers" | "label">("offers");
const perPage = ref(10);
const page = ref(1);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = (stats.value?.skills ?? []).filter(
    (s) =>
      (!q || s.label.toLowerCase().includes(q)) &&
      (owned.value === "all" || (owned.value === "yes") === s.owned) &&
      (kind.value === "all" || (kind.value === "core") === s.core),
  );
  return sort.value === "label" ? [...list].sort((a, b) => a.label.localeCompare(b.label, "fr")) : list;
});
const rank = computed(() => new Map((stats.value?.skills ?? []).map((s, i) => [s.label, i + 1])));
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / perPage.value)));
const shown = computed(() => filtered.value.slice((page.value - 1) * perPage.value, page.value * perPage.value));
/** Numéros de page : la première, la dernière et celles autour de la page courante ; 0 = « … ». */
const pageList = computed(() => {
  const out: number[] = [];
  for (let i = 1; i <= pages.value; i++) {
    if (i === 1 || i === pages.value || Math.abs(i - page.value) <= 1) out.push(i);
    else if (out[out.length - 1] !== 0) out.push(0);
  }
  return out;
});
watch([query, owned, kind, sort, perPage, stats], () => (page.value = 1));
const hasTrend = computed(() => stats.value?.skills.some((s) => s.trend !== null) ?? false);
const trendText = (t: number) => (t > 0 ? `+${t}` : `${t}`) + " pt" + (Math.abs(t) > 1 ? "s" : "");
const offersTitle = (s: Skill) => (s.accessible === null ? undefined : `${s.accessible} % de ces offres demandent ${years(stats.value!.experience.max)} d'expérience ou moins`);

// Ce qui te débloquerait le plus d'offres.
const unlockMax = computed(() => Math.max(1, ...(stats.value?.unlock ?? []).map((u) => u.offers)));
const unlockLevel = (offers: number) => {
  const share = (offers / Math.max(1, stats.value!.offers)) * 100;
  return share >= 10 ? "high" : share >= 2 ? "mid" : "low";
};
const UNLOCK_LEVEL = { high: "Élevée", mid: "Moyenne", low: "Faible" } as const;

// Catégories : part des compétences demandées que tu as (pondérée par le nombre d'offres), puis par catégorie.
const coverage = computed(() => {
  const skills = stats.value?.skills ?? [];
  const total = skills.reduce((sum, s) => sum + s.offers, 0);
  return total ? Math.round((skills.filter((s) => s.owned).reduce((sum, s) => sum + s.offers, 0) / total) * 100) : 0;
});
// Langages et frameworks : déjà dans le chiffre clé « Top 10 ».
const GROUPS = [
  { id: "devops", label: "DevOps et outils" },
  { id: "data", label: "Bases de données" },
  { id: "testing", label: "Tests" },
  { id: "other", label: "API, front et méthodes" },
] as const;
/** Pour chaque catégorie : combien des 10 compétences les plus demandées tu as. */
const groups = computed(() =>
  GROUPS.map((g) => {
    const top = (stats.value?.skills ?? []).filter((s) => s.group === g.id).slice(0, 10);
    const have = top.filter((s) => s.owned).length;
    return { ...g, have, total: top.length, share: top.length ? Math.round((have / top.length) * 100) : 0 };
  }).filter((g) => g.total > 0),
);

// Analyses détaillées : un onglet à la fois ; changer d'onglet ne touche pas aux filtres du tableau.
const TABS = [
  { id: "categories", label: "Catégories" },
  { id: "sources", label: "Sources" },
  { id: "tips", label: "Recommandations" },
] as const;
const tab = ref<(typeof TABS)[number]["id"]>("categories");
/** Flèches, Début et Fin : passent d'un onglet à l'autre (navigation clavier des onglets). */
function onTabKey(e: KeyboardEvent) {
  const i = TABS.findIndex((t) => t.id === tab.value);
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  tab.value = TABS[(next + TABS.length) % TABS.length]!.id;
  document.getElementById(`tab-${tab.value}`)?.focus();
}

const quality = (s: { offers: number; good: number }) => (s.offers ? Math.round((s.good / s.offers) * 100) : 0);
const tone = (share: number) => (share >= 10 ? "good" : share >= 4 ? "mid" : "low");

/** Recommandations tirées des chiffres ci-dessus, sans appel IA. */
const tips = computed(() => {
  const s = stats.value!;
  const out: string[] = [];
  const u = s.unlock.slice(0, 2);
  if (u.length)
    out.push(
      `Apprendre ${u.map((x) => x.label).join(" et ")} t'ouvrirait ${n(u.reduce((sum, x) => sum + x.offers, 0))} offres où c'est la seule techno qui te manque.`,
    );
  const t = s.together[0];
  if (t?.with.length) out.push(`Dans les offres ${t.label}, il te manque surtout ${t.with.slice(0, 2).map((w) => `${w.label} (${w.share} %)`).join(" et ")}.`);
  const best = s.sources.filter((x) => x.offers >= 20).sort((a, b) => quality(b) - quality(a)).slice(0, 2);
  if (best.length) out.push(`Tes sources avec le plus de bonnes offres : ${best.map((x) => `${label(x.source)} (${quality(x)} %)`).join(" et ")}.`);
  return out;
});
</script>


<template>
  <header class="stats-head">
    <div class="title">
      <span class="head-icon"><Icon name="chart" :size="22" /></span>
      <div>
        <h1>Statistiques</h1>
        <p class="muted">Analyse du marché et de ton profil</p>
      </div>
    </div>
    <div class="head-side">
      <span v-if="stats?.days" class="muted small">Écarts comparés aux {{ stats.days }} jours d'avant</span>
      <div class="tabs period" role="tablist" aria-label="Période">
        <button v-for="p in PERIODS" :key="p.label" type="button" role="tab" :aria-selected="days === p.days" :class="{ active: days === p.days }" @click="days = p.days">
          {{ p.label }}
        </button>
      </div>
    </div>
  </header>

  <p v-if="error" class="alert" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>
  <p v-else-if="!stats" class="muted">Chargement…</p>
  <p v-else-if="stats.offers === 0" class="muted">Aucune offre avec des compétences détectées sur cette période.</p>

  <div v-else class="stats-page">
    <section class="kpis" aria-label="Chiffres clés">
      <article v-for="k in kpis" :key="k.title" class="card kpi">
        <div class="kpi-title">
          <span class="icon-box sm"><Icon :name="k.icon" :size="16" /></span>
          <h2>{{ k.title }}</h2>
        </div>
        <div class="kpi-line">
          <strong class="kpi-value">{{ k.value }}</strong>
          <span v-if="k.delta" class="small" :class="k.delta.value > 0 ? 'up' : k.delta.value < 0 ? 'down' : 'muted'" :title="`Écart avec les ${stats.days} jours d'avant`">
            {{ k.delta.value > 0 ? "↑" : k.delta.value < 0 ? "↓" : "=" }} {{ k.delta.text }}
          </span>
        </div>
        <p class="muted small">{{ k.text }}</p>
      </article>
    </section>

    <div class="board">
      <section class="card panel">
        <div class="panel-head">
          <span class="icon-box"><Icon name="sparkle" :size="18" /></span>
          <div class="grow">
            <h2>Compétences les plus demandées</h2>
            <p class="muted small">Part des offres qui la demandent, et ta couverture.</p>
          </div>
          <label class="search">
            <Icon name="search" :size="15" />
            <input v-model="query" type="search" placeholder="Rechercher une compétence…" aria-label="Rechercher une compétence" />
          </label>
        </div>
        <div class="toolbar">
          <div class="tabs" role="tablist" aria-label="Dans ton profil">
            <button v-for="o in OWNED" :key="o.id" type="button" role="tab" :aria-selected="owned === o.id" :class="{ active: owned === o.id }" @click="owned = o.id">
              {{ o.label }}
            </button>
          </div>
          <div class="selects">
            <select v-model="kind" aria-label="Type de compétences">
              <option value="all">Tous types</option>
              <option value="core">Langages et frameworks</option>
              <option value="tools">Outils</option>
            </select>
            <select v-model="sort" aria-label="Trier par">
              <option value="offers">Tri : volume</option>
              <option value="label">Tri : nom</option>
            </select>
          </div>
        </div>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Compétence</th>
                <th class="num">Offres</th>
                <th>Part du marché</th>
                <th>Dans ton profil</th>
                <th>Priorité</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in shown" :key="s.label">
                <td class="muted">{{ rank.get(s.label) }}</td>
                <td class="strong">{{ s.label }}</td>
                <td class="num" :title="offersTitle(s)">{{ n(s.offers) }}</td>
                <td class="nowrap">
                  <span class="share">{{ s.share }} %</span><span class="bar inline"><div class="fill" :style="{ width: `${s.share}%` }" /></span>
                  <small v-if="hasTrend && s.trend !== null && Math.abs(s.trend) >= 3" :class="s.trend > 0 ? 'up' : 'down'" title="Part des 30 derniers jours moins celle des 30 jours d'avant">{{ trendText(s.trend) }}</small>
                </td>
                <td class="nowrap">
                  <span class="dot" :class="s.owned ? 'good' : 'low'"><Icon :name="s.owned ? 'check' : 'x'" :size="10" /></span>{{ s.owned ? "Oui" : "Non" }}
                </td>
                <td><span class="badge" :class="priority(s.share)">{{ PRIORITY[priority(s.share)] }}</span></td>
              </tr>
              <tr v-if="!shown.length">
                <td colspan="6" class="muted">Aucune compétence ne correspond.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pager">
          <nav class="pages" aria-label="Pages">
            <button type="button" class="ghost" :disabled="page === 1" aria-label="Page précédente" @click="page--">‹</button>
            <template v-for="(p, i) in pageList" :key="i">
              <span v-if="p === 0" class="muted">…</span>
              <button v-else type="button" class="ghost" :class="{ current: p === page }" :aria-current="p === page ? 'page' : undefined" @click="page = p">{{ p }}</button>
            </template>
            <button type="button" class="ghost" :disabled="page === pages" aria-label="Page suivante" @click="page++">›</button>
          </nav>
          <label class="muted small per-page">
            Voir
            <select v-model.number="perPage" aria-label="Lignes par page">
              <option :value="10">10</option>
              <option :value="25">25</option>
              <option :value="50">50</option>
            </select>
            par page
          </label>
        </div>
      </section>

      <div class="side">
        <section class="card panel">
          <div class="panel-head">
            <span class="icon-box"><Icon name="star" :size="18" /></span>
            <div class="grow">
              <h2>Ce qui te débloquerait le plus d'offres</h2>
              <p class="muted small">Seul langage ou framework qui te manque dans l'offre.</p>
            </div>
          </div>
          <ol v-if="stats.unlock.length" class="unlock">
            <li v-for="(u, i) in stats.unlock" :key="u.label">
              <span class="rank">{{ i + 1 }}</span>
              <div class="grow">
                <div class="unlock-line">
                  <strong>{{ u.label }}</strong>
                  <span class="badge" :class="unlockLevel(u.offers)">{{ UNLOCK_LEVEL[unlockLevel(u.offers)] }}</span>
                  <span class="unlock-count small">
                    {{ n(u.offers) }} offre{{ u.offers > 1 ? "s" : "" }}
                    <span class="muted" :title="u.training ? `dont ${u.training} avec formation proposée` : undefined">· {{ n(u.accessible) }} ≤ {{ years(stats.experience.max) }}</span>
                  </span>
                </div>
                <div class="bar thin"><div class="fill" :style="{ width: `${(u.offers / unlockMax) * 100}%` }" /></div>
              </div>
            </li>
          </ol>
          <p v-else class="muted small">Aucune offre où il ne te manque qu'une techno.</p>
        </section>

        <section class="card panel">
          <div class="panel-head">
            <span class="icon-box"><Icon name="briefcase" :size="18" /></span>
            <div class="grow">
              <h2>Expérience demandée</h2>
              <p class="muted small">Précisée dans {{ n(stats.experience.known) }} offres sur {{ n(stats.offers) }}.</p>
            </div>
          </div>
          <div class="ranges">
            <template v-for="r in stats.experience.ranges" :key="r.label">
              <span class="small">{{ r.label }}</span>
              <span class="bar"><div class="fill" :style="{ width: `${r.share}%` }" /></span>
              <strong class="small num">{{ r.share }} %</strong>
              <span class="small muted num">{{ n(r.offers) }} offres</span>
            </template>
          </div>
        </section>
      </div>
    </div>

    <section class="card panel details">
      <div class="panel-head">
        <span class="icon-box"><Icon name="chart" :size="18" /></span>
        <h2 class="grow">Analyses détaillées</h2>
        <div class="tabs" role="tablist" aria-label="Analyses détaillées" @keydown="onTabKey">
          <button
            v-for="t in TABS"
            :id="`tab-${t.id}`"
            :key="t.id"
            type="button"
            role="tab"
            :aria-selected="tab === t.id"
            :aria-controls="`panel-${t.id}`"
            :tabindex="tab === t.id ? 0 : -1"
            :class="{ active: tab === t.id }"
            @click="tab = t.id"
          >
            {{ t.label }}
          </button>
        </div>
      </div>

      <div v-if="tab === 'categories'" id="panel-categories" role="tabpanel" aria-labelledby="tab-categories" class="categories">
        <div class="coverage">
          <div class="metric">
            <div class="metric-line small">
              <span>Part des compétences demandées que tu maîtrises</span>
              <strong>{{ coverage }} %</strong>
            </div>
            <div class="bar"><div class="fill good" :style="{ width: `${coverage}%` }" /></div>
            <p class="muted small">Chaque compétence compte autant de fois que d'offres la demandent.</p>
          </div>
          <div class="metric">
            <div class="metric-line small">
              <span>Part des offres dont tu as tous les langages et frameworks</span>
              <strong>{{ stats.fullMatch }} %</strong>
            </div>
            <div class="bar"><div class="fill" :style="{ width: `${stats.fullMatch}%` }" /></div>
            <p class="muted small">Une seule techno principale manquante suffit à exclure l'offre.</p>
          </div>
        </div>
        <div class="groups">
          <h3 class="small">Par catégorie <span class="muted">(10 compétences les plus demandées de chacune ; langages et frameworks : voir « Top 10 »)</span></h3>
          <div v-for="g in groups" :key="g.id" class="group">
            <div class="metric-line small">
              <span>{{ g.label }}</span>
              <span class="muted">{{ g.have }} / {{ g.total }}</span>
              <strong>{{ g.share }} %</strong>
            </div>
            <div class="bar"><div class="fill" :style="{ width: `${g.share}%` }" /></div>
          </div>
        </div>
      </div>

      <div v-else-if="tab === 'sources'" id="panel-sources" role="tabpanel" aria-labelledby="tab-sources" class="scroll">
        <p class="muted small">Bonnes offres : au-dessus de ton seuil de notification, non masquées.</p>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th class="num">Offres</th>
              <th class="num">Bonnes</th>
              <th>Qualité</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in stats.sources" :key="s.source">
              <td class="ellipsis" :title="label(s.source)"><SourceLogo :source="s.source" :size="18" /> {{ label(s.source) }}</td>
              <td class="num">{{ n(s.offers) }}</td>
              <td class="num">{{ n(s.good) }}</td>
              <td class="nowrap">
                <span class="share">{{ quality(s) }} %</span><span class="bar inline"><div :class="tone(quality(s))" :style="{ width: `${Math.min(100, quality(s) * 4)}%` }" /></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else id="panel-tips" role="tabpanel" aria-labelledby="tab-tips">
        <ul v-if="tips.length" class="tips small">
          <li v-for="t in tips" :key="t"><Icon name="check" :size="14" class="up" />{{ t }}</li>
        </ul>
        <p v-else class="muted small">Pas encore assez de données pour une recommandation.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.stats-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem 1rem;
  margin-bottom: 1rem;
}
.title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.title h1,
.title p {
  margin: 0;
}
.head-icon {
  color: var(--muted);
}
/* Onglet actif bien visible : fond de la couleur d'accent. */
.tabs button.active {
  background: var(--accent);
  color: var(--accent-contrast);
}
.tabs button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.stats-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
h2 {
  margin: 0;
  font-size: 1rem;
}
h3 {
  margin: 0 0 0.25rem;
  font-weight: 600;
}
p {
  margin: 0;
}
.grow {
  flex: 1;
  min-width: 0;
}
.icon-box {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
}
.icon-box.sm {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 8px;
}
.card {
  padding: 0.9rem 1.1rem;
}

/* Chiffres clés : titre, chiffre et écart sur une ligne, une phrase courte. */
.kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}
.kpi-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.kpi-title h2 {
  font-size: 0.875rem;
}
.kpi-line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.2rem 0.75rem;
}
.kpi-value {
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
}
.head-side {
  display: flex;
  align-items: center;
  gap: 0.5rem 1rem;
  flex-wrap: wrap;
}
.up {
  color: var(--good);
}
.down {
  color: var(--low);
}

/* Zone principale : le tableau, et à côté ce qui manque et l'expérience. */
.board {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(19rem, 1fr);
  gap: 1rem;
  align-items: start;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.panel-head .muted {
  margin-top: 0.1rem;
}

/* Tableau des compétences. */
.search {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--muted);
  min-width: 11rem;
}
.search:focus-within {
  border-color: var(--accent);
}
.search input {
  border: none;
  background: transparent;
  padding: 0.35rem 0;
  min-height: 0;
  box-shadow: none;
  outline: none;
  width: 100%;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.selects {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.selects select,
.per-page select {
  min-height: 0;
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
}
.scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
th,
td {
  padding: 0.38rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
th {
  font-size: 0.75rem;
  color: var(--muted);
  font-weight: 600;
}
tbody tr:last-child td {
  border-bottom: none;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.nowrap {
  white-space: nowrap;
}
.strong {
  font-weight: 600;
}
/* Nom long (« Welcome to the Jungle (JobScraper) ») : coupé, les chiffres restent dans le cadre. */
.ellipsis {
  max-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share {
  display: inline-block;
  min-width: 2.6rem;
  font-variant-numeric: tabular-nums;
}
.bar.inline {
  display: inline-block;
  width: 4.5rem;
  height: 6px;
  vertical-align: middle;
  margin-right: 0.4rem;
}
.bar.thin {
  height: 5px;
}
.bar .fill {
  height: 100%;
  border-radius: 99px;
  background: var(--accent);
}
.bar .fill.good {
  background: var(--good);
}
.dot {
  display: inline-grid;
  place-items: center;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  margin-right: 0.35rem;
  vertical-align: -0.15rem;
  color: var(--accent-contrast);
}
.dot.good {
  background: var(--good);
}
.dot.low {
  background: var(--low);
}
.badge {
  display: inline-block;
  padding: 0.1rem 0.55rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge.high {
  background: var(--accent-soft);
  color: var(--accent);
}
.badge.mid {
  background: rgb(56 189 248 / 0.14);
  color: #0284c7;
}
.badge.low {
  background: var(--mid-bg);
  color: var(--mid);
}
.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.pages {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}
.pages button {
  min-height: 0;
  min-width: 2rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.85rem;
}
.pages button.current {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}
.per-page {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

/* Ce qui te débloquerait le plus d'offres : une ligne par techno, la barre en dessous. */
.unlock {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.unlock li {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--border);
}
.unlock li:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.rank {
  display: grid;
  place-items: center;
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: var(--surface-2);
  font-size: 0.75rem;
  font-weight: 700;
}
.unlock-line {
  display: flex;
  align-items: center;
  gap: 0.4rem 0.5rem;
  margin-bottom: 0.3rem;
  flex-wrap: wrap;
}
.unlock-count {
  margin-left: auto;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* Expérience : nom, barre, part et nombre d'offres sur une ligne. */
.ranges {
  display: grid;
  grid-template-columns: auto minmax(3rem, 1fr) auto auto;
  align-items: center;
  gap: 0.55rem 0.75rem;
}

/* Analyses détaillées. */
.categories {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.5rem;
}
.coverage {
  display: grid;
  gap: 1rem;
  align-content: start;
}
.metric,
.group {
  display: grid;
  gap: 0.3rem;
}
.metric-line {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
}
.metric-line > :first-child {
  flex: 1;
}
.groups {
  display: grid;
  gap: 0.55rem;
  align-content: start;
}
#panel-sources {
  display: grid;
  gap: 0.5rem;
}
td :deep(.source-logo) {
  vertical-align: middle;
  margin-right: 0.3rem;
}
.tips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.tips li {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}
.tips :deep(.icon) {
  flex: none;
  margin-top: 0.15rem;
}

/* Portable : cartes de chiffres clés étroites, l'icône laisse la place au titre. */
@media (max-width: 1500px) {
  .kpi .icon-box {
    display: none;
  }
}
/* Écran moyen (portable étroit, tablette) : tout sur une colonne. */
@media (max-width: 1100px) {
  .board {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
}
/* Chiffres clés en 2 × 2. */
@media (max-width: 900px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
/* Téléphone : page verticale. */
@media (max-width: 700px) {
  .kpis {
    gap: 0.6rem;
  }
  .kpi-title h2 {
    font-size: 0.8rem;
  }
  .kpi-value {
    font-size: 1.25rem;
  }
  .head-side,
  .stats-head .period,
  .details .tabs {
    width: 100%;
  }
  .stats-head .period button,
  .details .tabs button {
    flex: 1;
    padding-inline: 0.3rem;
    white-space: nowrap;
  }
  .side,
  .categories {
    grid-template-columns: minmax(0, 1fr);
  }
  .search {
    min-width: 0;
    width: 100%;
  }
  /* Le pourcentage suffit : le tableau tient dans la largeur du téléphone. */
  .board .bar.inline {
    display: none;
  }
  table {
    font-size: 0.8rem;
  }
  th,
  td {
    padding-inline: 0.22rem;
  }
}
</style>

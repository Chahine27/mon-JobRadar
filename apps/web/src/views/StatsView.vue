<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { SOURCE_LABELS } from "../format";
import type { SkillStats } from "../types";

const stats = ref<SkillStats | null>(null);
const error = ref("");
const kind = ref<"all" | "core" | "tools">("all");
const PAGE = 50;
const limit = ref(PAGE);

onMounted(async () => {
  try {
    stats.value = await api.jobStats();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Erreur";
  }
});

const filtered = computed(() =>
  (stats.value?.skills ?? []).filter((s) => kind.value === "all" || (kind.value === "core") === s.core),
);
const shown = computed(() => filtered.value.slice(0, limit.value));
/** Tes compétences hors de la partie affichée : visibles sans tout déplier. */
const ownedBelow = computed(() => filtered.value.slice(limit.value).filter((s) => s.owned));
const ownedInTop10 = computed(() => (stats.value?.skills ?? []).filter((s) => s.core).slice(0, 10).filter((s) => s.owned).length);
const hasTrend = computed(() => stats.value?.skills.some((s) => s.trend !== null) ?? false);

const date = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const trendText = (t: number) => (t > 0 ? `+${t}` : `${t}`) + " pt" + (Math.abs(t) > 1 ? "s" : "");
const years = (n: number) => `${n} an${n > 1 ? "s" : ""}`;
</script>

<template>
  <PageHeader
    title="Statistiques"
    :subtitle="stats?.since ? `${stats.offers} offres de développeur collectées depuis le ${date(stats.since)}, expirées comprises.` : 'Compétences demandées dans les offres collectées.'"
  />

  <p v-if="error" class="alert" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>
  <p v-else-if="!stats" class="muted">Chargement…</p>
  <p v-else-if="stats.offers === 0" class="muted">Aucune offre avec des compétences détectées pour l'instant.</p>

  <div v-else class="stats-page">
    <section class="card figures">
      <div>
        <strong>{{ stats.fullMatch }} %</strong>
        <span class="muted small">des offres : tu as tous les langages et frameworks demandés</span>
      </div>
      <div>
        <strong>{{ ownedInTop10 }} / 10</strong>
        <span class="muted small">des langages et frameworks les plus demandés sont dans ton profil</span>
      </div>
      <div>
        <strong>{{ stats.experience.accessible }} %</strong>
        <span class="muted small">des offres demandent {{ years(stats.experience.max) }} d'expérience ou moins (ton maximum)</span>
      </div>
      <div>
        <strong>{{ stats.recentOffers }}</strong>
        <span class="muted small">offres ces 30 derniers jours ({{ stats.previousOffers }} les 30 jours d'avant)</span>
      </div>
    </section>

    <div class="board">
      <section class="card panel skills">
        <div class="panel-head">
          <h2>Compétences les plus demandées</h2>
          <select v-model="kind" aria-label="Type de compétences" @change="limit = PAGE">
            <option value="all">Tout</option>
            <option value="core">Langages et frameworks</option>
            <option value="tools">Outils</option>
          </select>
        </div>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Compétence</th>
                <th class="num">Offres</th>
                <th>Part</th>
                <th>Toi</th>
                <th class="num" :title="`Part des offres (expérience précisée) qui demandent ${years(stats.experience.max)} ou moins`">≤ {{ years(stats.experience.max) }}</th>
                <th v-if="hasTrend" class="num" title="Part des 30 derniers jours moins celle des 30 jours d'avant">30 j</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in [...shown, ...ownedBelow]" :key="s.label" :class="{ owned: s.owned, gap: i === shown.length }">
                <td class="muted">{{ filtered.indexOf(s) + 1 }}</td>
                <td>{{ s.label }}</td>
                <td class="num">{{ s.offers }}</td>
                <td class="nowrap"><span class="bar"><span :style="{ width: `${s.share}%` }" /></span>{{ s.share }} %</td>
                <td><Icon v-if="s.owned" name="check" :size="15" class="yes" /><span v-else class="muted">—</span></td>
                <td class="num" :class="{ muted: s.accessible === null }">{{ s.accessible === null ? "—" : `${s.accessible} %` }}</td>
                <td v-if="hasTrend" class="num" :class="s.trend === null || Math.abs(s.trend) < 3 ? 'muted' : s.trend > 0 ? 'up' : 'down'">
                  {{ s.trend === null ? "—" : trendText(s.trend) }}
                </td>
              </tr>
            </tbody>
          </table>
          <button v-if="filtered.length > limit" type="button" class="small more" @click="limit += PAGE">
            Voir plus ({{ filtered.length - limit }} restantes)
          </button>
        </div>
        <p v-if="!hasTrend" class="muted small note">
          Évolution sur 30 jours affichée quand les 30 derniers jours et les 30 jours d'avant comptent chacun au moins 100 offres.
        </p>
      </section>

      <div class="column">
        <section class="card panel">
          <h2>Ce qui te débloquerait le plus d'offres</h2>
          <p class="muted small note">Seul langage ou framework qui te manque dans l'offre.</p>
          <table v-if="stats.unlock.length">
            <tbody>
              <tr v-for="u in stats.unlock" :key="u.label">
                <td>{{ u.label }}</td>
                <td class="num">{{ u.offers }} offre{{ u.offers > 1 ? "s" : "" }}</td>
                <td class="muted small">{{ u.training ? `dont ${u.training} avec formation proposée` : "" }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted small">Aucune offre où il ne te manque qu'une techno.</p>
        </section>

        <section class="card panel">
          <h2>Sources</h2>
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th class="num">Offres</th>
                <th class="num" title="Au-dessus de ton seuil de notification, non masquées">Bonnes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in stats.sources" :key="s.source">
                <td class="ellipsis" :title="SOURCE_LABELS[s.source] ?? s.source"><SourceLogo :source="s.source" :size="18" /> {{ SOURCE_LABELS[s.source] ?? s.source }}</td>
                <td class="num">{{ s.offers }}</td>
                <td class="num">{{ s.good }} <span class="muted">({{ Math.round((s.good / s.offers) * 100) }} %)</span></td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <div class="column">
        <section class="card panel">
          <h2>Ce qui te manque autour de tes compétences</h2>
          <p class="muted small note">Dans les offres de tes langages et frameworks les plus demandés.</p>
          <div v-for="t in stats.together" :key="t.label" class="together">
            <div class="small"><strong>{{ t.label }}</strong> <span class="muted">· {{ t.offers }} offres</span></div>
            <div class="chips">
              <span v-for="w in t.with" :key="w.label" class="chip">{{ w.label }} {{ w.share }} %</span>
            </div>
          </div>
          <p v-if="!stats.together.length" class="muted small">Aucune de tes compétences n'apparaît encore dans les offres.</p>
        </section>

        <section class="card panel">
          <h2>Expérience demandée</h2>
          <p class="muted small note">Précisée dans {{ stats.experience.known }} offres sur {{ stats.offers }}.</p>
          <table>
            <tbody>
              <tr v-for="r in stats.experience.ranges" :key="r.label">
                <td class="nowrap">{{ r.label }}</td>
                <td class="nowrap"><span class="bar"><span :style="{ width: `${r.share}%` }" /></span>{{ r.share }} %</td>
                <td class="num muted">{{ r.offers }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Tout tient dans l'écran : seul le tableau des compétences défile, à l'intérieur de son cadre. */
.stats-page {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.figures {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
  padding: 0.75rem 1rem;
}
.figures div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.figures strong {
  font-size: 1.4rem;
}
.board {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
}
.column {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem 1rem;
  min-width: 0;
}
.panel h2 {
  margin: 0;
  font-size: 1rem;
}
.note {
  margin: 0;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.skills {
  height: calc(100vh - 15rem);
  min-height: 22rem;
}
.scroll {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.scroll thead th {
  position: sticky;
  top: 0;
  background: var(--surface);
}
.more {
  margin-top: 0.5rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
th,
td {
  padding: 0.25rem 0.4rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
th {
  font-size: 0.75rem;
  color: var(--muted);
  font-weight: 600;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.nowrap {
  white-space: nowrap;
}
/* Nom long (« Welcome to the Jungle (JobScraper) ») : coupé, les chiffres restent dans le cadre. */
.ellipsis {
  max-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
tr.owned td:nth-child(2) {
  font-weight: 600;
}
tr.gap td {
  border-top: 2px dashed var(--border-strong);
}
.bar {
  display: inline-block;
  width: 4rem;
  height: 0.4rem;
  margin-right: 0.4rem;
  border-radius: 999px;
  background: var(--surface-3);
  vertical-align: middle;
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
}
.yes,
.up {
  color: var(--good);
}
.down {
  color: var(--low);
}
.together {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.together + .together {
  margin-top: 0.2rem;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.chips .chip {
  font-size: 0.75rem;
  padding: 0.05rem 0.45rem;
}
td :deep(.source-logo) {
  vertical-align: middle;
  margin-right: 0.3rem;
}

/* Écran moyen : le tableau en pleine largeur, les autres cadres en dessous sur deux colonnes. */
@media (max-width: 1200px) {
  .board {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .skills {
    grid-column: 1 / -1;
    height: 26rem;
  }
}
@media (max-width: 700px) {
  .board {
    grid-template-columns: minmax(0, 1fr);
  }
  /* Chiffres clés en 2 × 2. */
  .figures {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.7rem 0.9rem;
  }
  .figures strong {
    font-size: 1.25rem;
  }
  .figures .small {
    font-size: 0.75rem;
    line-height: 1.3;
  }
}
</style>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api, errorMessage } from "../api";
import Icon, { type IconName } from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { sourceBadge, timeAgo, timeUntil } from "../format";
import type { Company, SourceItem, SourceProgress } from "../types";

const sources = ref<SourceItem[]>([]);
const companies = ref<Company[]>([]);
const drafts = ref<Record<string, number>>({});
const newName = ref("");
const newUrl = ref("");
const message = ref<{ ok: boolean; text: string } | null>(null);
const busy = ref(false);

const ATS_LABELS: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", recruitee: "Recruitee" };
const HELP: Record<string, string> = {
  "france-travail": "Identifiants FRANCE_TRAVAIL_CLIENT_ID / SECRET dans .env.",
  adzuna: "Crée une clé gratuite sur developer.adzuna.com, puis ADZUNA_APP_ID / ADZUNA_APP_KEY dans .env. Quota : 250 appels par jour.",
  "company-careers": "Ajoute des entreprises ci-dessous.",
  jooble: "Crée une clé gratuite sur fr.jooble.org/api/about, puis JOOBLE_API_KEY dans .env. Une collecte par jour au plus.",
  "jobscraper:linkedin": "Installe le dépôt JobScraper et son environnement Python. Active JOBSCRAPER_ENABLED=true dans .env ; 15 min minimum entre deux collectes, indépendant du bouton « Actualiser ».",
  "jobscraper:hellowork": "Installe le dépôt JobScraper et son environnement Python. Active JOBSCRAPER_ENABLED=true dans .env ; 15 min minimum entre deux collectes, indépendant du bouton « Actualiser ».",
  "jobscraper:wttj": "Installe le dépôt JobScraper et son environnement Python. Active JOBSCRAPER_ENABLED=true dans .env ; 15 min minimum entre deux collectes, indépendant du bouton « Actualiser ».",
  "jobscraper:indeed": "Installe python-jobspy dans l'environnement Python de JobScraper (voir docs/JOBSCRAPER.md). Active JOBSCRAPER_ENABLED=true dans .env ; même file que JobScraper.",
};

async function load() {
  const [s, c] = await Promise.all([api.listSources(), api.listCompanies()]);
  sources.value = s.items;
  companies.value = c.items;
  drafts.value = Object.fromEntries(s.items.map((i) => [i.source, i.intervalMinutes]));
}
// Avancement des collectes en cours : toutes les 2 s pendant une collecte, sinon toutes les 30 s (pour voir la suivante démarrer).
const progress = ref<SourceProgress[]>([]);
let poll: ReturnType<typeof setTimeout> | undefined;
async function loadProgress() {
  try {
    const s = await api.collectionStatus();
    const wasLive = progress.value.length > 0;
    progress.value = s.progress;
    if (wasLive && s.progress.length === 0) await load(); // collecte finie : dernière réussite, erreurs, prochaine à jour
  } catch {
    /* serveur momentanément injoignable : on réessaiera */
  }
  poll = setTimeout(loadProgress, progress.value.length ? 2000 : 30_000);
}
onMounted(() => {
  void load();
  void loadProgress();
});
onUnmounted(() => clearTimeout(poll));

async function act(fn: () => Promise<unknown>, ok: string) {
  busy.value = true;
  message.value = null;
  try {
    await fn();
    message.value = { ok: true, text: ok };
    await load();
  } catch (e) {
    message.value = { ok: false, text: errorMessage(e, "Erreur inattendue.") };
  } finally {
    busy.value = false;
  }
}

function saveSource(s: SourceItem, enabled = s.enabled) {
  const interval = Math.max(Number(drafts.value[s.source]) || s.minIntervalMinutes, s.minIntervalMinutes);
  return act(() => api.updateSource(s.source, { enabled, intervalMinutes: interval }), `${s.label} : réglage enregistré.`);
}

const ICONS: Record<string, IconName> = { "france-travail": "briefcase", adzuna: "search", "company-careers": "building", jooble: "globe" };

function quotaTone(q: { used: number; limit: number }) {
  const ratio = q.used / q.limit;
  return ratio < 0.6 ? "good" : ratio < 0.9 ? "mid" : "low";
}

const isJobScraperDisabled = (s: SourceItem) => s.source.startsWith("jobscraper:") && !s.configured;

/** Pastille : avancement pendant une collecte, sinon dernier résultat (« bloquée » si le site bloque l'IP). */
function badgeOf(s: SourceItem) {
  if (isJobScraperDisabled(s)) return { tone: "", text: "désactivée dans .env", busy: false, pct: null };
  if (!s.configured) return { tone: "", text: "non configurée", busy: false, pct: null };
  return sourceBadge(s, progress.value.find((p) => p.source === s.source));
}

const addCompany = () =>
  act(async () => {
    await api.addCompany(newName.value, newUrl.value);
    newName.value = "";
    newUrl.value = "";
  }, "Entreprise ajoutée : elle sera interrogée à la prochaine collecte.");
</script>

<template>
  <PageHeader title="Sources" subtitle="D'où viennent les offres. Chaque source a sa fréquence, qui respecte ses limites." />

  <div class="stack">
    <p v-if="message" :class="message.ok ? 'success' : 'alert'" role="status">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="16" />{{ message.text }}
    </p>

    <div class="sources">
      <section v-for="s in sources" :key="s.source" class="card stack source" :class="{ wide: s.source === 'company-careers', off: !s.enabled }">
        <div class="src-head">
          <SourceLogo v-if="s.source !== 'company-careers'" :source="s.source" :size="40" />
          <span v-else class="src-icon"><Icon :name="ICONS[s.source] ?? 'rss'" :size="19" /></span>
          <div>
            <h2 style="margin: 0">{{ s.label }}</h2>
            <span class="muted small">{{ HELP[s.source] }}</span>
          </div>
          <span class="chip" :class="badgeOf(s).tone">
            <Icon v-if="badgeOf(s).busy" name="refresh" :size="13" class="spin" />
            <span v-else class="dot" :class="badgeOf(s).tone" />{{ badgeOf(s).text }}
          </span>
        </div>
        <div v-if="badgeOf(s).busy" class="bar" role="progressbar" :aria-label="`Collecte ${s.label}`" :aria-valuenow="badgeOf(s).pct ?? undefined" aria-valuemin="0" aria-valuemax="100">
          <div class="good" :class="{ indeterminate: badgeOf(s).pct === null }" :style="{ width: `${badgeOf(s).pct ?? 35}%` }" />
        </div>
        <p v-if="isJobScraperDisabled(s)" class="muted small" style="margin: 0">
          Les offres déjà importées restent dans le feed. Pour reprendre les collectes, définis <code>JOBSCRAPER_ENABLED=true</code> dans <code>.env</code>, puis redémarre l’API.
        </p>

        <div class="settings">
          <label class="switch">
            <input type="checkbox" :checked="s.enabled" :disabled="busy" @change="saveSource(s, !s.enabled)" />
            {{ isJobScraperDisabled(s) ? "Activée ici, bloquée par .env" : "Active" }}
          </label>
          <label class="inline">
            Toutes les
            <input v-model.number="drafts[s.source]" type="number" :min="s.minIntervalMinutes" max="1440" style="width: 5.5rem" />
            min
          </label>
          <button type="button" class="small" :disabled="busy" @click="saveSource(s)"><Icon name="save" :size="14" />Enregistrer</button>
          <span class="muted small">minimum {{ s.minIntervalMinutes }} min</span>
        </div>

        <div class="stats small">
          <span><Icon name="check" :size="14" />Dernière réussite : <strong>{{ s.lastSuccessAt ? timeAgo(s.lastSuccessAt) : "jamais" }}</strong></span>
          <span v-if="s.enabled && !isJobScraperDisabled(s)"><Icon name="clock" :size="14" />Prochaine : <strong>{{ timeUntil(s.nextRunAt) }}</strong></span>
          <span v-if="s.failures && !isJobScraperDisabled(s)" style="color: var(--low)"><Icon name="alert" :size="14" />{{ s.failures }} échec(s) de suite</span>
        </div>
        <div v-if="s.quota" class="quota">
          <div class="spread small">
            <span>Appels utilisés (la clé gratuite en donne {{ s.quota.limit }} au total, pas par jour)</span>
            <strong class="num">{{ s.quota.used }} / {{ s.quota.limit }}</strong>
          </div>
          <div class="bar"><div :class="quotaTone(s.quota)" :style="{ width: `${Math.min(100, (s.quota.used / s.quota.limit) * 100)}%` }" /></div>
        </div>
        <p v-if="s.lastError && s.lastStatus !== 'OK' && !isJobScraperDisabled(s)" class="alert small"><Icon name="alert" :size="15" />{{ s.lastError }}</p>
        <p v-if="s.source === 'adzuna'" class="muted small" style="margin: 0">
          Offres fournies par <a href="https://www.adzuna.fr" target="_blank" rel="noopener noreferrer">Jobs by Adzuna</a>. Les salaires
          « estimés » par Adzuna sont ignorés.
        </p>

        <template v-if="s.source === 'company-careers'">
          <div class="careers stack">
            <h2 style="margin: 0"><Icon name="building" :size="17" />Entreprises suivies</h2>
            <p class="muted small" style="margin: 0">
              Colle l'adresse de la page carrières d'une entreprise qui utilise Greenhouse, Lever, Ashby ou Recruitee (ex.
              <code>https://jobs.lever.co/nom</code>). Seuls les postes techniques sont gardés.
            </p>
            <form class="add" @submit.prevent="addCompany">
              <input v-model="newName" placeholder="Nom de l'entreprise" aria-label="Nom de l'entreprise" required />
              <input v-model="newUrl" placeholder="https://jobs.ashbyhq.com/…" aria-label="Adresse de la page carrières" required />
              <button type="submit" class="primary" :disabled="busy"><Icon name="plus" :size="16" />Ajouter</button>
            </form>
            <p v-if="companies.length === 0" class="muted small">Aucune entreprise pour l'instant.</p>
            <ul v-else class="companies">
              <li v-for="c in companies" :key="c.id">
                <label class="switch">
                  <input type="checkbox" :checked="c.enabled" :disabled="busy" @change="act(() => api.setCompanyEnabled(c.id, !c.enabled), `${c.name} mise à jour.`)" />
                  <strong>{{ c.name }}</strong>
                </label>
                <span class="chip">{{ ATS_LABELS[c.ats] ?? c.ats }} · {{ c.boardKey }}</span>
                <button type="button" class="small ghost danger" :disabled="busy" :aria-label="`Retirer ${c.name}`" @click="act(() => api.removeCompany(c.id), `${c.name} retirée.`)">
                  <Icon name="trash" :size="14" />Retirer
                </button>
              </li>
            </ul>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.bar .indeterminate { animation: slide 1.2s ease-in-out infinite alternate; }
@keyframes slide { from { margin-left: 0; } to { margin-left: 65%; } }
@media (prefers-reduced-motion: reduce) { .bar .indeterminate { animation: none; } }
.sources { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr)); gap: 1rem; }
.source.wide { grid-column: 1 / -1; }
.source.off { opacity: 0.75; }
.src-head { display: grid; grid-template-columns: auto 1fr auto; gap: 0.8rem; align-items: start; }
.src-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 11px; background: var(--accent-soft); color: var(--accent); flex: none; }
.settings { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 1.1rem; padding: 0.75rem 0.9rem; background: var(--surface-2); border-radius: var(--radius-sm); }
.stats { display: flex; flex-wrap: wrap; gap: 0.35rem 1.2rem; color: var(--muted); }
.stats span { display: inline-flex; align-items: center; gap: 0.35rem; }
.stats strong { color: var(--text); font-weight: 600; }
.quota { display: grid; gap: 0.4rem; color: var(--muted); }
.quota strong { color: var(--text); }
.careers { border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 0.25rem; }
.add { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(220px, 2fr) auto; gap: 0.5rem; }
.companies { list-style: none; margin: 0; padding: 0; display: grid; }
.companies li { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; padding: 0.55rem 0; border-top: 1px solid var(--border); }
.companies li:first-child { border-top: none; }
.companies li .chip { margin-left: auto; }
@media (max-width: 600px) { .sources { grid-template-columns: 1fr; } .add { grid-template-columns: 1fr; } }
</style>

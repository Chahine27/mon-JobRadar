<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ApiError, api } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { timeAgo } from "../format";
import type { SourceItem } from "../types";

/** Une ligne = un bouton : chaque source API, et JobScraper (tous ses sites) en une seule. */
type Row = { key: string; label: string; items: SourceItem[] };

const sources = ref<SourceItem[]>([]);
/** Lignes relancées : heure du clic. Terminé quand chaque source active a une collecte plus récente. */
const pending = ref<Record<string, number>>({});
const message = ref<{ ok: boolean; text: string } | null>(null);

const isScraper = (s: SourceItem) => s.source.startsWith("jobscraper:");
const shortLabel = (s: SourceItem) => s.label.replace(/^JobScraper · /, "");

const rows = computed<Row[]>(() => {
  const scraper = sources.value.filter(isScraper);
  return [
    ...sources.value.filter((s) => !isScraper(s)).map((s) => ({ key: s.source, label: s.label, items: [s] })),
    ...(scraper.length ? [{ key: "jobscraper", label: `JobScraper (${scraper.map(shortLabel).join(", ")})`, items: scraper }] : []),
  ];
});

const active = (r: Row) => r.items.filter((s) => s.enabled);
const failed = (r: Row) => active(r).filter((s) => s.lastStatus && s.lastStatus !== "OK");

async function load() {
  sources.value = (await api.listSources()).items;
  for (const r of rows.value) {
    const since = pending.value[r.key];
    if (since === undefined) continue;
    if (active(r).every((s) => s.lastRunAt && new Date(s.lastRunAt).getTime() >= since)) {
      delete pending.value[r.key];
      const ko = failed(r);
      message.value = ko.length
        ? { ok: false, text: `${r.label} : échec pour ${ko.map(shortLabel).join(", ")} (détail ci-dessous).` }
        : { ok: true, text: `${r.label} : collecte réussie.` };
    }
  }
}
onMounted(load);
// Pendant qu'une relance est en cours : état rechargé toutes les 4 s (JobScraper : quelques minutes, LinkedIn surtout).
const timer = setInterval(() => void (Object.keys(pending.value).length && load().catch(() => {})), 4000);
onUnmounted(() => clearInterval(timer));

const ERRORS: Record<string, string> = {
  SOURCE_DISABLED: "source inactive (page Sources) ou non configurée.",
};

async function relaunch(r: Row) {
  message.value = null;
  const clickedAt = Date.now();
  try {
    const res = await api.refreshSource(r.key);
    if (res.status === "already_running") {
      message.value = { ok: false, text: `${r.label} : une collecte est déjà en cours, réessaie dans un moment.` };
      return;
    }
    pending.value[r.key] = clickedAt;
  } catch (e) {
    message.value = { ok: false, text: `${r.label} : ${e instanceof ApiError ? (ERRORS[e.code] ?? e.code) : "erreur inattendue."}` };
  }
}

function status(r: Row): { text: string; tone: string } {
  const on = active(r);
  if (!on.length) return { text: "inactive", tone: "" };
  if (!on.some((s) => s.configured)) return { text: "non configurée", tone: "" };
  if (!on.some((s) => s.lastStatus)) return { text: "jamais lancée", tone: "" };
  return failed(r).length ? { text: "erreur", tone: "bad" } : { text: "OK", tone: "good" };
}

// Plafond du score quand l'annonce exige des années sur une techno / un produit que tu n'as pas (gardé dans le profil).
const cap = ref<number | "">("");
const savingCap = ref(false);
onMounted(async () => {
  cap.value = (await api.getProfile()).profile.productExperienceCap;
});
async function saveCap() {
  if (typeof cap.value !== "number" || cap.value < 0 || cap.value > 100) {
    message.value = { ok: false, text: "Plafond invalide : entre 0 et 100 %." };
    return;
  }
  savingCap.value = true;
  try {
    const { profile } = await api.getProfile();
    await api.saveProfile({ ...profile, productExperienceCap: Math.round(cap.value) });
    message.value = { ok: true, text: "Plafond enregistré. Les scores sont recalculés." };
  } catch {
    message.value = { ok: false, text: "Le plafond n'a pas été enregistré." };
  } finally {
    savingCap.value = false;
  }
}

/** Début de l'erreur : le détail complet reste dans l'infobulle et sur la page Sources. */
const shortError = (e: string) => (e.length > 220 ? `${e.slice(0, 220)}…` : e);
</script>

<template>
  <PageHeader title="Réglages" subtitle="Relance une source à la main si elle est en erreur, sans attendre sa prochaine collecte (ni changer son rythme)." />

  <div class="stack">
    <p v-if="message" :class="message.ok ? 'success' : 'alert'" role="status">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="16" />{{ message.text }}
    </p>

    <section class="card">
      <h2 style="margin-top: 0"><Icon name="refresh" :size="17" />Relancer une source</h2>
      <ul class="rows">
        <li v-for="r in rows" :key="r.key">
          <SourceLogo v-if="r.items.length === 1" :source="r.key" :size="32" />
          <span v-else class="src-icon"><Icon name="radar" :size="17" /></span>
          <div class="info">
            <strong>{{ r.label }}</strong>
            <span v-for="s in r.items" :key="s.source" class="muted small">
              <template v-if="r.items.length > 1">{{ shortLabel(s) }} : </template>
              <template v-if="!s.enabled">inactive</template>
              <template v-else>
                dernière réussite {{ s.lastSuccessAt ? timeAgo(s.lastSuccessAt) : "jamais" }}<template v-if="s.failures"> · {{ s.failures }} échec(s) de suite</template>
              </template>
            </span>
            <span v-for="s in failed(r)" :key="`e-${s.source}`" class="err small" :title="s.lastError ?? ''">
              <template v-if="r.items.length > 1">{{ shortLabel(s) }} : </template>{{ shortError(s.lastError ?? "erreur") }}
            </span>
          </div>
          <span class="chip" :class="status(r).tone"><span class="dot" :class="status(r).tone" />{{ status(r).text }}</span>
          <button type="button" class="small" :disabled="!active(r).length || r.key in pending" @click="relaunch(r)">
            <Icon name="refresh" :size="14" />{{ r.key in pending ? "En cours…" : "Relancer" }}
          </button>
        </li>
      </ul>
    </section>
    <section class="card stack">
      <h2 style="margin-top: 0"><Icon name="sliders" :size="17" />Score</h2>
      <form class="cap" @submit.prevent="saveCap">
        <label>
          Plafond si l'annonce exige de l'expérience sur une techno / un produit que tu n'as pas (%)
          <input v-model.number="cap" type="number" min="0" max="100" step="5" />
        </label>
        <button type="submit" class="small" :disabled="savingCap || cap === ''">{{ savingCap ? "Enregistrement…" : "Enregistrer" }}</button>
      </form>
      <p class="muted small" style="margin: 0">Ex. « 3 ans d'expérience minimum sur 3DEXPERIENCE » alors que ce produit n'est pas dans ton profil.</p>
    </section>
  </div>
</template>

<style scoped>
.rows { list-style: none; margin: 0; padding: 0; display: grid; }
.rows li { display: grid; grid-template-columns: auto 1fr auto auto; gap: 0.8rem; align-items: center; padding: 0.75rem 0; border-top: 1px solid var(--border); }
.rows li:first-child { border-top: none; }
.info { display: grid; gap: 0.15rem; min-width: 0; }
.cap { display: flex; gap: 0.8rem; align-items: end; flex-wrap: wrap; }
.err { color: var(--low); overflow-wrap: anywhere; }
.src-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); }
/* Téléphone : logo | nom + état | bouton, sur deux lignes au plus. */
@media (max-width: 600px) {
  .rows li { grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.25rem 0.6rem; padding: 0.55rem 0; }
  .rows li > :first-child { grid-row: 1 / span 2; }
  .rows .info { padding: 0; background: none; }
  .rows .chip { grid-column: 2; grid-row: 2; justify-self: start; }
  .rows button { grid-column: 3; grid-row: 1 / span 2; }
}
</style>

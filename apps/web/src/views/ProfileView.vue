<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError, api } from "../api";
import Icon from "../components/Icon.vue";
import NotificationSettingsCard from "../components/NotificationSettingsCard.vue";
import PageHeader from "../components/PageHeader.vue";
import TagInput from "../components/TagInput.vue";
import type { HomeLocation, Profile } from "../types";

const CONTRACTS = ["CDI", "CDD", "Intérim", "Alternance", "Stage", "Freelance"];

const profile = ref<Profile | null>(null);
const home = ref<{ label: string; lat: string; lng: string }>({ label: "", lat: "", lng: "" });
const status = ref<{ kind: "ok" | "error"; text: string; issues?: string[] } | null>(null);
const saving = ref(false);

// ───── Recherche d'adresse du point de départ ─────
const homeQuery = ref("");
const homeResults = ref<Array<{ label: string; lat: number; lng: number }>>([]);
const homeSearchError = ref<string | null>(null);

async function searchHome() {
  homeSearchError.value = null;
  homeResults.value = [];
  try {
    homeResults.value = (await api.geocode(homeQuery.value)).items;
    if (homeResults.value.length === 0) homeSearchError.value = "Aucune adresse trouvée. Essaie « gare de Compiègne » ou une adresse complète.";
  } catch (e) {
    homeSearchError.value = e instanceof ApiError && e.message ? e.message : "Recherche impossible.";
  }
}

function pickHome(r: { label: string; lat: number; lng: number }) {
  home.value = { label: r.label, lat: String(r.lat), lng: String(r.lng) };
  homeResults.value = [];
  homeQuery.value = "";
}

// ───── Gare d'arrivée (offres d'Île-de-France) ─────
const hubQuery = ref("");
const hubResults = ref<Array<{ label: string; lat: number; lng: number }>>([]);
const hubSearchError = ref<string | null>(null);

async function searchHub() {
  hubSearchError.value = null;
  hubResults.value = [];
  try {
    hubResults.value = (await api.geocode(hubQuery.value)).items;
    if (hubResults.value.length === 0) hubSearchError.value = "Aucun lieu trouvé. Essaie « Gare du Nord Paris ».";
  } catch (e) {
    hubSearchError.value = e instanceof ApiError && e.message ? e.message : "Recherche impossible.";
  }
}

function pickHub(r: { label: string; lat: number; lng: number }) {
  if (profile.value) profile.value.transitHub = { label: r.label, lat: r.lat, lng: r.lng };
  hubResults.value = [];
  hubQuery.value = "";
}

function clearHome() {
  home.value = { label: "", lat: "", lng: "" };
}

onMounted(async () => {
  const rec = await api.getProfile();
  profile.value = structuredClone(rec.profile);
  if (rec.home) home.value = { label: rec.home.label, lat: String(rec.home.lat), lng: String(rec.home.lng) };
});

function toggleContract(c: string) {
  if (!profile.value) return;
  const list = profile.value.contracts;
  profile.value.contracts = list.includes(c) ? list.filter((x) => x !== c) : [...list, c];
}

function addPreferred() {
  profile.value?.preferredTechs.push({ name: "", weight: 0.5 });
}
function addLocation() {
  profile.value?.locations.push({ label: "", department: "" });
}

function buildHome(): HomeLocation | null | "invalid" {
  const { label, lat, lng } = home.value;
  if (!label.trim() && !lat.trim() && !lng.trim()) return null;
  const la = Number(lat.replace(",", "."));
  const lo = Number(lng.replace(",", "."));
  if (!label.trim() || !Number.isFinite(la) || !Number.isFinite(lo) || !lat.trim() || !lng.trim()) return "invalid";
  return { label: label.trim(), lat: la, lng: lo };
}

async function save() {
  if (!profile.value) return;
  status.value = null;
  const h = buildHome();
  if (h === "invalid") {
    status.value = { kind: "error", text: "Point de départ incomplet : remplis le nom, la latitude et la longitude (ou vide les trois)." };
    return;
  }
  const payload: Profile = {
    ...profile.value,
    searchRadiusKm: Number(profile.value.searchRadiusKm) || null, // champ vidé → ""
    preferredTechs: profile.value.preferredTechs.filter((p) => p.name.trim()),
    locations: profile.value.locations.filter((l) => l.label.trim() || l.department.trim()),
    scoreRules: profile.value.scoreRules
      .filter((r) => r.value.trim().length >= 2)
      .map((r) => ({ ...r, value: r.value.trim(), points: Math.round(Number(r.points) || 0) })),
  };
  saving.value = true;
  try {
    const rec = await api.saveProfile(payload, h);
    profile.value = structuredClone(rec.profile);
    status.value = { kind: "ok", text: "Profil enregistré. Les scores sont recalculés." };
  } catch (e) {
    status.value = {
      kind: "error",
      text: "Le profil n'a pas été enregistré.",
      issues: e instanceof ApiError ? e.issues.map((i) => `${i.path || "profil"} : ${i.message}`) : [],
    };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="!profile" class="stack"><div class="skeleton" /><div class="skeleton" /></div>
  <form v-else class="stack" @submit.prevent="save">
    <div class="sticky-head">
      <PageHeader title="Profil" subtitle="Ces réglages décident du score de chaque offre.">
        <template #actions>
          <button class="primary" type="submit" :disabled="saving">
            <Icon name="save" :size="16" />{{ saving ? "Enregistrement…" : "Enregistrer" }}
          </button>
        </template>
      </PageHeader>
    </div>

    <div v-if="status" :class="status.kind === 'ok' ? 'success' : 'alert'" role="status">
      <Icon :name="status.kind === 'ok' ? 'check' : 'alert'" :size="16" />
      <div>
        {{ status.text }}
        <ul v-if="status.issues?.length" class="small">
          <li v-for="i in status.issues" :key="i">{{ i }}</li>
        </ul>
      </div>
    </div>

    <div class="grid-2">
      <section class="card stack">
        <div>
          <h2><Icon name="code" :size="17" />Compétences que je maîtrise</h2>
          <p class="muted small hint">Sert au pourcentage technique : part des compétences de l'offre que tu as.</p>
        </div>
        <TagInput v-model="profile.skills" placeholder="Ex. PostgreSQL" />
      </section>

      <section class="card stack">
        <div>
          <h2><Icon name="star" :size="17" />Technos préférées</h2>
          <p class="muted small hint">Servent aux recherches et à départager deux offres de même score. Importance de 0 à 1.</p>
        </div>
        <div v-for="(p, i) in profile.preferredTechs" :key="i" class="pref">
          <input v-model="p.name" placeholder="Techno" aria-label="Techno" />
          <input v-model.number="p.weight" type="range" min="0" max="1" step="0.1" :aria-label="`Importance ${p.name}`" />
          <span class="small num">{{ p.weight.toFixed(1) }}</span>
          <button type="button" class="icon-btn danger" :aria-label="`Retirer ${p.name}`" @click="profile.preferredTechs.splice(i, 1)"><Icon name="trash" :size="15" /></button>
        </div>
        <div><button type="button" class="small" @click="addPreferred"><Icon name="plus" :size="14" />Ajouter une techno</button></div>
      </section>
    </div>

    <section class="card stack">
      <div>
        <h2><Icon name="search" :size="17" />Recherches lancées</h2>
        <p class="muted small hint">Chaque recherche est envoyée aux sources à chaque collecte.</p>
      </div>
      <TagInput v-model="profile.searches" placeholder="Ex. Développeur Vue.js" />
    </section>

    <div class="grid-3">
      <section class="card stack">
        <h2><Icon name="file" :size="17" />Contrat</h2>
        <div class="row">
          <button
            v-for="c in CONTRACTS"
            :key="c"
            type="button"
            class="toggle"
            :class="{ on: profile.contracts.includes(c) }"
            :aria-pressed="profile.contracts.includes(c)"
            @click="toggleContract(c)"
          >
            <Icon v-if="profile.contracts.includes(c)" name="check" :size="14" />{{ c }}
          </button>
        </div>
      </section>

      <section class="card stack">
        <h2><Icon name="calendar" :size="17" />Expérience visée (années)</h2>
        <div class="row">
          <label>Min <input v-model.number="profile.experienceMin" type="number" min="0" max="30" /></label>
          <label>Max <input v-model.number="profile.experienceMax" type="number" min="0" max="30" /></label>
        </div>
      </section>

      <section class="card stack">
        <h2><Icon name="euro" :size="17" />Salaire (brut annuel, €)</h2>
        <div class="row">
          <label>Cible <input v-model.number="profile.salaryTarget" type="number" min="0" step="1000" /></label>
          <label>Minimum <input v-model.number="profile.salaryMinimum" type="number" min="0" step="1000" /></label>
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="card stack">
        <h2><Icon name="pin" :size="17" />Zones de recherche</h2>
        <div v-for="(l, i) in profile.locations" :key="i" class="zone">
          <input v-model="l.label" placeholder="Nom (ex. Oise)" aria-label="Nom de la zone" />
          <input v-model="l.department" placeholder="Département (ex. 60)" aria-label="Département" />
          <button type="button" class="icon-btn danger" :aria-label="`Retirer ${l.label}`" @click="profile.locations.splice(i, 1)"><Icon name="trash" :size="15" /></button>
        </div>
        <div><button type="button" class="small" @click="addLocation"><Icon name="plus" :size="14" />Ajouter une zone</button></div>
        <label>
          Rayon autour du point de départ (km, min. 5, vide = aucun)
          <input v-model.number="profile.searchRadiusKm" type="number" min="5" max="200" placeholder="ex. 30" />
        </label>
        <p class="muted small hint">Une offre à moins de ce rayon est dans ta zone même hors de tes départements. Les offres hors zone sont masquées.</p>
      </section>

      <section class="card stack">
        <div>
          <h2><Icon name="sliders" :size="17" />Mes règles bonus / malus</h2>
          <p class="muted small hint">
            Le score part de la technique (stack principale de l'offre, jusqu'à 80 points), puis ajoute des bonus et malus :
            techno préférée, junior, salaire, trajet… Ajoute ici les tiens. « Pas pour moi » sur une offre en propose aussi.
          </p>
        </div>
        <p v-if="!profile.scoreRules.length" class="muted small" style="margin: 0">Aucune règle pour l'instant.</p>
        <div v-for="(r, i) in profile.scoreRules" :key="i" class="rule">
          <select v-model="r.kind" aria-label="Où chercher">
            <option value="title">Mot dans le titre</option>
            <option value="text">Mot dans l'annonce</option>
            <option value="company">Entreprise</option>
          </select>
          <input v-model="r.value" maxlength="80" placeholder="ex. Angular" aria-label="Mot ou entreprise" />
          <input v-model.number="r.points" type="number" min="-100" max="50" step="5" aria-label="Points" />
          <button type="button" class="icon-btn danger" :aria-label="`Retirer la règle ${r.value}`" @click="profile.scoreRules.splice(i, 1)"><Icon name="trash" :size="15" /></button>
        </div>
        <div><button type="button" class="small" @click="profile.scoreRules.push({ kind: 'title', value: '', points: -20 })"><Icon name="plus" :size="14" />Ajouter une règle</button></div>
      </section>
    </div>

    <div class="grid-2">
      <section class="card stack">
        <h2><Icon name="target" :size="17" />Seuils</h2>
        <label>Analyse IA à partir de (%) <input v-model.number="profile.minScoreForAnalysis" type="number" min="0" max="100" /></label>
        <label>Notification à partir de (%) <input v-model.number="profile.minScoreForNotification" type="number" min="0" max="100" /></label>
      </section>

      <section class="card stack">
        <div>
          <h2><Icon name="home" :size="17" />Domicile (privé)</h2>
          <p class="muted small hint">
            Trajet <strong>en voiture</strong> pour les offres hors Île-de-France (Oise…). Reste uniquement dans ta base locale.
            Pense à cliquer sur « Enregistrer » en haut.
          </p>
        </div>
        <div v-if="home.label" class="home">
          <Icon name="pin" :size="16" />
          <div>
            <strong>{{ home.label }}</strong>
            <div class="muted small num">{{ Number(home.lat).toFixed(4) }}, {{ Number(home.lng).toFixed(4) }}</div>
          </div>
          <button type="button" class="small ghost" @click="clearHome">Effacer</button>
        </div>
        <p v-else class="muted small" style="margin: 0">Aucun point de départ : le trajet n'est pas calculé.</p>
        <div class="home-search">
          <div class="field">
            <Icon name="search" :size="16" />
            <input v-model="homeQuery" placeholder="Adresse, gare ou ville" aria-label="Adresse, gare ou ville" @keydown.enter.prevent="searchHome" />
          </div>
          <button type="button" :disabled="homeQuery.trim().length < 3" @click="searchHome">Chercher</button>
        </div>
        <p v-if="homeSearchError" class="small" style="color: var(--low); margin: 0">{{ homeSearchError }}</p>
        <ul v-if="homeResults.length" class="results">
          <li v-for="r in homeResults" :key="r.label">
            <button type="button" @click="pickHome(r)"><Icon name="pin" :size="15" />{{ r.label }}</button>
          </li>
        </ul>
      </section>
    </div>

    <section class="card stack">
      <div>
        <h2><Icon name="train" :size="17" />Gare d'arrivée à Paris</h2>
        <p class="muted small hint">
          Trajet <strong>en transports</strong> pour les offres d'Île-de-France, compté depuis cette gare : le train jusqu'à elle n'est pas compté.
          Au-delà de 30 min de transports en plus, le score baisse.
        </p>
      </div>
      <div v-if="profile.transitHub" class="home">
        <Icon name="train" :size="16" />
        <div>
          <strong>{{ profile.transitHub.label }}</strong>
          <div class="muted small num">{{ profile.transitHub.lat.toFixed(4) }}, {{ profile.transitHub.lng.toFixed(4) }}</div>
        </div>
        <button type="button" class="small ghost" @click="profile.transitHub = null">Effacer</button>
      </div>
      <p v-else class="muted small" style="margin: 0">Aucune gare : le trajet des offres d'Île-de-France n'est pas calculé.</p>
      <div class="home-search">
        <div class="field">
          <Icon name="search" :size="16" />
          <input v-model="hubQuery" placeholder="Ex. Gare du Nord, Gare Saint-Lazare" aria-label="Gare d'arrivée" @keydown.enter.prevent="searchHub" />
        </div>
        <button type="button" :disabled="hubQuery.trim().length < 3" @click="searchHub">Chercher</button>
      </div>
      <p v-if="hubSearchError" class="small" style="color: var(--low); margin: 0">{{ hubSearchError }}</p>
      <ul v-if="hubResults.length" class="results">
        <li v-for="r in hubResults" :key="r.label">
          <button type="button" @click="pickHub(r)"><Icon name="train" :size="15" />{{ r.label }}</button>
        </li>
      </ul>
    </section>
  </form>
  <div v-if="profile" style="margin-top: 1rem">
    <NotificationSettingsCard />
  </div>
</template>

<style scoped>
.sticky-head { position: sticky; top: 0; z-index: 15; background: var(--bg); margin: -0.5rem 0 -0.5rem; padding-top: 0.5rem; }
@media (max-width: 900px) { .sticky-head { top: 52px; } }
.hint { margin: -0.4rem 0 0; }
.pref { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(100px, 1fr) 2rem auto; gap: 0.6rem; align-items: center; }
.zone { display: grid; grid-template-columns: 1fr 10rem auto; gap: 0.5rem; align-items: center; }
.icon-btn.danger { color: var(--muted); border: 1px solid transparent; }
.icon-btn.danger:hover:not(:disabled) { color: var(--low); background: var(--low-bg); border-color: transparent; }
.toggle { border-radius: 99px; padding: 0.35rem 0.85rem; font-size: 0.86rem; color: var(--muted); }
.toggle.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.rule { display: grid; grid-template-columns: 10rem 1fr 5rem auto; gap: 0.5rem; align-items: center; }
@media (max-width: 520px) { .rule { grid-template-columns: 1fr 5rem auto; } .rule select { grid-column: 1 / -1; } }
.home { display: flex; align-items: center; gap: 0.7rem; padding: 0.7rem 0.85rem; background: var(--surface-2); border-radius: var(--radius-sm); }
.home > div { flex: 1; min-width: 0; }
.home > .icon { color: var(--accent); }
.home-search { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
.results { list-style: none; margin: 0; padding: 0.3rem; display: grid; border: 1px solid var(--border); border-radius: 11px; }
.results button { justify-content: flex-start; text-align: left; border: none; background: none; padding: 0.5rem 0.6rem; font-weight: 500; box-shadow: none; }
.results button .icon { color: var(--muted); }
.results button:hover:not(:disabled) { background: var(--accent-soft); color: var(--text); }
@media (max-width: 520px) { .zone { grid-template-columns: 1fr 1fr auto; } .pref { grid-template-columns: 1fr 1fr auto auto; } }
</style>

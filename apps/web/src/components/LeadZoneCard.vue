<script setup lang="ts">
import { DEPARTMENTS } from "@job-radar/shared/geo";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ApiError, api } from "../api";
import type { SpontaneousSettings } from "../types";
import Icon from "./Icon.vue";
import TagInput from "./TagInput.vue";

/** Choisir une proposition applique la zone ET lance la recherche d'entreprises tout de suite. */
const emit = defineEmits<{ apply: [] }>();

/** Attente après la dernière lettre tapée avant de chercher (évite une requête par lettre). */
const TYPING_DELAY_MS = 1000;

type Suggestion =
  | { kind: "department"; code: string; label: string }
  | { kind: "place"; label: string; lat: number; lng: number };

const s = ref<SpontaneousSettings | null>(null);
const query = ref("");
const suggestions = ref<Suggestion[]>([]);
const searching = ref(false);
const error = ref<string | null>(null);
const showRomes = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let lastQuery = "";

onMounted(async () => {
  s.value = await api.getLeadSettings();
});
onUnmounted(() => clearTimeout(timer));

const norm = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Départements proposés sans appel réseau (« oise », « 60 », « val d'oise »…). */
function departmentMatches(q: string): Suggestion[] {
  const n = norm(q);
  return Object.entries(DEPARTMENTS)
    .filter(([code, name]) => code.toLowerCase() === n || norm(name).startsWith(n))
    .slice(0, 3)
    .map(([code, name]) => ({ kind: "department", code, label: `Département : ${name} (${code})` }));
}

watch(query, (q) => {
  clearTimeout(timer);
  error.value = null;
  const text = q.trim();
  if (text.length < 2) {
    suggestions.value = [];
    return;
  }
  suggestions.value = departmentMatches(text);
  if (text.length < 3) return;
  timer = setTimeout(async () => {
    lastQuery = text;
    searching.value = true;
    try {
      const places = (await api.geocode(text)).items;
      if (lastQuery !== text) return; // l'utilisateur a continué à taper
      suggestions.value = [
        ...departmentMatches(text),
        ...places.map((p) => ({ kind: "place" as const, label: p.label, lat: p.lat, lng: p.lng })),
      ];
      if (!suggestions.value.length) error.value = "Aucun lieu trouvé.";
    } catch (e) {
      error.value = e instanceof ApiError && e.message ? e.message : "Recherche d'adresse impossible.";
    } finally {
      searching.value = false;
    }
  }, TYPING_DELAY_MS);
});

async function apply(next: SpontaneousSettings) {
  try {
    s.value = await api.saveLeadSettings(next);
    emit("apply");
  } catch (e) {
    error.value = e instanceof ApiError && e.issues.length ? e.issues.map((i) => i.message).join(" · ") : "Réglage refusé.";
  }
}

function choose(sug: Suggestion) {
  if (!s.value) return;
  clearTimeout(timer);
  suggestions.value = [];
  query.value = "";
  void apply(
    sug.kind === "department"
      ? { ...s.value, place: null, departments: [sug.code] }
      : { ...s.value, place: { label: sug.label, lat: sug.lat, lng: sug.lng }, departments: [] },
  );
}

function changeDistance(km: number) {
  if (s.value) void apply({ ...s.value, distanceKm: km });
}

function saveRomes() {
  if (s.value) void apply({ ...s.value });
}

const zone = computed(() => {
  if (!s.value) return "";
  if (s.value.place) return `${s.value.distanceKm} km autour de ${s.value.place.label}`;
  if (s.value.departments.length) {
    return s.value.departments.map((d) => `${DEPARTMENTS[d] ?? d} (${d})`).join(", ");
  }
  return "tes zones du profil";
});
</script>

<template>
  <section v-if="s" class="card stack zone">
    <div class="spread">
      <h2 style="margin: 0"><Icon name="pin" :size="17" />Où chercher ?</h2>
      <span class="chip accent"><Icon name="target" :size="12" />{{ zone }}</span>
    </div>
    <div class="search">
      <div class="field">
        <Icon name="search" :size="16" />
        <input
          v-model="query"
          type="search"
          placeholder="Tape une ville ou un département (ex. Nogent-sur-Oise, Oise, 95)"
          autocomplete="off"
          aria-label="Ville ou département"
          @keydown.enter.prevent="suggestions[0] && choose(suggestions[0])"
        />
      </div>
      <ul v-if="suggestions.length" class="suggestions" role="listbox">
        <li v-for="sug in suggestions" :key="sug.label">
          <button type="button" role="option" @click="choose(sug)">
            <Icon :name="sug.kind === 'department' ? 'globe' : 'pin'" :size="15" />{{ sug.label }}
          </button>
        </li>
      </ul>
      <p v-if="searching" class="muted small hint">Recherche…</p>
      <p v-if="error" class="small hint" style="color: var(--low)">{{ error }}</p>
    </div>

    <div class="row small">
      <label v-if="s.place" class="inline">
        Rayon
        <select :value="s.distanceKm" @change="changeDistance(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="km in [5, 10, 20, 30, 50, 80, 100]" :key="km" :value="km">{{ km }} km</option>
        </select>
      </label>
      <span class="muted">Métiers : {{ s.romes.join(", ") }}</span>
      <button type="button" class="link" @click="showRomes = !showRomes">{{ showRomes ? "Fermer" : "Modifier les métiers" }}</button>
    </div>

    <div v-if="showRomes" class="stack romes">
      <p class="muted small" style="margin: 0">
        Codes ROME : M1805 études et développement informatique · M1810 production et exploitation · M1806 conseil et maîtrise
        d'ouvrage.
      </p>
      <TagInput v-model="s.romes" placeholder="Ex. M1810" />
      <div><button type="button" class="small primary" @click="saveRomes">Appliquer les métiers</button></div>
    </div>
  </section>
</template>

<style scoped>
.search { position: relative; }
.hint { margin: 0.35rem 0 0; }
.suggestions {
  position: absolute; left: 0; right: 0; z-index: 5; list-style: none; margin: 0.3rem 0 0; padding: 0.3rem;
  background: var(--surface); border: 1px solid var(--border); border-radius: 11px; box-shadow: var(--shadow-hover);
}
.suggestions button {
  width: 100%; justify-content: flex-start; text-align: left; border: none; background: none; padding: 0.5rem 0.65rem;
  font-weight: 500; box-shadow: none;
}
.suggestions button .icon { color: var(--muted); }
.suggestions button:hover, .suggestions button:focus-visible { background: var(--accent-soft); color: var(--text); }
.romes { padding: 0.9rem; background: var(--surface-2); border-radius: var(--radius-sm); }
</style>

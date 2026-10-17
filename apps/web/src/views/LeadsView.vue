<script setup lang="ts">
import { computed, onActivated, onUnmounted, ref, watch } from "vue";
import { api, errorMessage } from "../api";
import Icon from "../components/Icon.vue";
import LeadZoneCard from "../components/LeadZoneCard.vue";
import PageHeader from "../components/PageHeader.vue";
import Ring from "../components/Ring.vue";
import { mapsUrl, timeAgo } from "../format";
import { MAX_PROMPT_COMPANIES, buildEmailPrompt, parseEmailJson } from "../lead-emails";
import type { Lead, LeadStatus } from "../types";

const STATUS_LABELS: Record<LeadStatus, string> = {
  TO_CONTACT: "À contacter",
  CONTACTED: "Contactée",
  FOLLOWED_UP: "Relancée",
  INTERVIEW: "Entretien",
  NOT_INTERESTED: "Pas intéressé",
  IGNORED: "Ignorée",
};
const STATUS_TONES: Record<LeadStatus, string> = {
  TO_CONTACT: "new",
  CONTACTED: "",
  FOLLOWED_UP: "warn",
  INTERVIEW: "good",
  NOT_INTERESTED: "",
  IGNORED: "",
};
const PAGE = 20;

const leads = ref<Lead[]>([]);
const total = ref(0);
const filter = ref<LeadStatus | "active" | "all">("active");
const emailFilter = ref<"any" | "hint" | "missing" | "noted" | "set">("any");
const sort = ref<"potential" | "distance">("potential");
const lastRefreshAt = ref<string | null>(null);
const configured = ref(true);
const loading = ref(true);
const busy = ref(false);
const message = ref<{ ok: boolean; text: string } | null>(null);
const drafts = ref<Record<string, string>>({});
const emails = ref<Record<string, string>>({});
const emailError = ref<Record<string, string | null>>({});

async function load(append = false, keepCount = false) {
  if (!append && !keepCount) loading.value = true;
  try {
    const limit = keepCount ? Math.min(100, Math.max(PAGE, leads.value.length)) : PAGE; // 100 = plafond de l'API
    const res = await api.listLeads(filter.value, sort.value, append ? leads.value.length : 0, limit, emailFilter.value, query.value.trim());
    leads.value = append ? [...leads.value, ...res.items] : res.items;
    total.value = res.total;
    lastRefreshAt.value = res.lastRefreshAt;
    configured.value = res.configured;
    for (const l of res.items) {
      drafts.value[l.id] = l.notes ?? "";
      emails.value[l.id] = l.contactEmail ?? "";
    }
  } finally {
    loading.value = false;
  }
}
// Filtres gardés dans le profil : lus avant le 1ᵉʳ chargement, réenregistrés à chaque changement.
let filtersReady = false;
async function loadFilters() {
  try {
    const f = (await api.getLeadSettings()).filters;
    filter.value = f.status;
    emailFilter.value = f.email;
    sort.value = f.sort;
  } catch {
    /* profil injoignable : filtres par défaut */
  }
}
// 1ʳᵉ visite : filtres puis chargement ; retour depuis une candidature : rechargé sans perdre les pages déjà affichées.
let mounted = false;
// Candidatures en lot : combien de lettres prêtes / à écrire (entreprises « À contacter » avec email).
const batch = ref<{ ready: number; toWrite: number; running: boolean } | null>(null);
async function loadBatch() {
  try {
    const b = await api.getApplicationBatch();
    batch.value = { ready: b.items.length, toWrite: b.toWrite, running: b.batch.running };
  } catch {
    batch.value = null;
  }
}
onActivated(async () => {
  void loadBatch();
  if (!filtersReady) await loadFilters();
  filtersReady = true;
  void load(false, mounted);
  mounted = true;
});
watch([filter, sort, emailFilter], () => {
  void load();
  if (filtersReady) void api.saveLeadFilters({ status: filter.value, email: emailFilter.value, sort: sort.value }).catch(() => {});
});
const query = ref("");
let queryTimer: ReturnType<typeof setTimeout> | undefined;
watch(query, () => {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => load(), 250);
});
onUnmounted(() => clearTimeout(queryTimer));

async function refresh() {
  busy.value = true;
  message.value = null;
  try {
    const r = await api.refreshLeads();
    message.value = { ok: true, text: `${r.found} entreprise(s) trouvée(s) (${r.around}) : ${r.created} nouvelle(s).` };
    await load();
  } catch (e) {
    message.value = { ok: false, text: errorMessage(e, "La Bonne Boîte ne répond pas.") };
  } finally {
    busy.value = false;
  }
}

async function setStatus(l: Lead, status: LeadStatus) {
  const updated = await api.updateLead(l.id, { status });
  Object.assign(l, updated);
}

// ───── Emails trouvés par une IA avec recherche web (copier le prompt → coller sa réponse JSON) ─────
// Sans email ni note : une note veut dire que la recherche a déjà été faite (site, formulaire ou introuvable).
const withoutEmail = computed(() => leads.value.filter((l) => !l.contactEmail && !l.notes?.trim()));
const promptCopied = ref(false);
const pasteOpen = ref(false);
const pasted = ref("");
const overwrite = ref(false);
const importing = ref(false);

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(buildEmailPrompt(withoutEmail.value));
    promptCopied.value = true;
    pasteOpen.value = true;
    setTimeout(() => (promptCopied.value = false), 2500);
  } catch {
    message.value = { ok: false, text: "Copie impossible : autorise le presse-papiers dans le navigateur." };
  }
}

async function importEmails() {
  importing.value = true;
  message.value = null;
  try {
    const items = parseEmailJson(pasted.value);
    if (!items.length) throw new Error("Aucune entreprise reconnue dans le JSON (SIRET manquant ?).");
    const r = await api.importLeadEmails(items, overwrite.value);
    const parts = [`${r.updated} email(s) ajouté(s)`];
    if (r.notFound) parts.push(`${r.notFound} non trouvé(s) par l'IA${r.linksOnly ? ` (dont ${r.linksOnly} avec site ou formulaire noté)` : ""}`);
    if (r.kept) parts.push(`${r.kept} déjà rempli(s), gardé(s)`);
    if (r.invalid) parts.push(`${r.invalid} adresse(s) invalide(s)`);
    if (r.unknown) parts.push(`${r.unknown} SIRET inconnu(s)`);
    message.value = { ok: r.updated > 0, text: `${parts.join(" · ")}. Vérifie la source notée dans chaque fiche avant d'envoyer.` };
    pasted.value = "";
    pasteOpen.value = false;
    // Liste rechargée : les entreprises traitées sortent du filtre, les suivantes sans email arrivent pour le prompt suivant.
    await load();
    void loadBatch();
  } catch (e) {
    message.value = { ok: false, text: e instanceof Error ? e.message : "Import impossible." };
  } finally {
    importing.value = false;
  }
}

async function saveEmail(l: Lead) {
  const contactEmail = (emails.value[l.id] ?? "").trim();
  if ((l.contactEmail ?? "") === contactEmail) return;
  emailError.value[l.id] = null;
  try {
    Object.assign(l, await api.updateLead(l.id, { contactEmail }));
  } catch {
    emailError.value[l.id] = "Adresse email invalide.";
  }
}

async function saveNotes(l: Lead) {
  const notes = drafts.value[l.id] ?? "";
  if ((l.notes ?? "") === notes.trim()) return;
  Object.assign(l, await api.updateLead(l.id, { notes }));
}

function size(l: Lead) {
  if (l.headcountMin === null && l.headcountMax === null) return "taille inconnue";
  if (l.headcountMin === l.headcountMax || l.headcountMax === null) return `${l.headcountMin} salarié(s)`;
  return `${l.headcountMin ?? 0}–${l.headcountMax} salariés`;
}

const lbbUrl = (siret: string) => `https://labonneboite.francetravail.fr/entreprise/${encodeURIComponent(siret)}`;
const searchUrl = (l: Lead) =>
  `https://www.google.com/search?q=${encodeURIComponent(`${l.name} ${l.city ?? ""} site carrière`)}`;
</script>

<template>
  <PageHeader title="Candidatures spontanées">
    <p class="subtitle">
      Entreprises qui devraient recruter des développeurs dans les 6 prochains mois, dans la zone choisie. Données
      <a href="https://labonneboite.francetravail.fr/" target="_blank" rel="noopener noreferrer">La Bonne Boîte</a> (France Travail, licence Etalab).
    </p>
    <p class="subtitle small"><Icon name="clock" :size="13" /> Dernière mise à jour : {{ lastRefreshAt ? timeAgo(lastRefreshAt) : "jamais" }}</p>
    <template #actions>
      <button type="button" class="primary" :disabled="busy || !configured" @click="refresh">
        <Icon name="refresh" :size="16" :class="{ spin: busy }" />
        {{ busy ? "Recherche…" : "Actualiser les entreprises" }}
      </button>
    </template>
  </PageHeader>

  <div class="stack">
    <LeadZoneCard @apply="refresh" />

    <p v-if="!configured" class="alert"><Icon name="alert" :size="16" />Identifiants France Travail absents de .env.</p>
    <p v-if="message" :class="message.ok ? 'success' : 'alert'" role="status">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="16" />{{ message.text }}
    </p>

    <section v-if="batch && batch.ready + batch.toWrite > 0" class="card batch">
      <Icon name="send" :size="22" class="batch-icon" />
      <div class="batch-text">
        <strong>Candidatures en lot</strong>
        <span class="muted small">
          {{ batch.ready + batch.toWrite }} entreprise(s) à contacter ont un email :
          <template v-if="batch.running">l'IA écrit les lettres…</template>
          <template v-else>{{ batch.ready }} lettre(s) prête(s), {{ batch.toWrite }} à écrire.</template>
        </span>
      </div>
      <RouterLink to="/entreprises/pretes" class="btn primary">
        <Icon :name="batch.running ? 'refresh' : batch.toWrite ? 'sparkle' : 'send'" :size="16" :class="{ spin: batch.running }" />
        {{ batch.running ? "Voir l'avancement" : batch.toWrite ? "Préparer les lettres" : "Relire et envoyer" }}
      </RouterLink>
    </section>

    <section v-if="leads.length" class="card stack finder">
      <div class="finder-head">
        <div>
          <strong><Icon name="mail" :size="16" />Trouver les emails avec une IA qui cherche sur internet</strong>
          <p class="muted small">
            Copie le prompt, colle-le dans ChatGPT, Claude ou Perplexity (recherche web activée), puis colle ici sa réponse :
            chaque email est rangé dans la bonne entreprise.
          </p>
        </div>
        <div class="row">
          <button type="button" :disabled="!withoutEmail.length" @click="copyPrompt">
            <Icon :name="promptCopied ? 'check' : 'file'" :size="15" />
            {{ promptCopied ? "Prompt copié !" : `Copier le prompt (${Math.min(withoutEmail.length, MAX_PROMPT_COMPANIES)} entreprise(s) sans email)` }}
          </button>
          <button type="button" class="ghost" @click="pasteOpen = !pasteOpen">Coller la réponse</button>
        </div>
      </div>
      <template v-if="pasteOpen">
        <textarea v-model="pasted" rows="7" placeholder='Colle ici toute la réponse de l&apos;IA : [{"siret": "…", "email": "…", "source": "…"}]' />
        <div class="row">
          <button type="button" class="primary" :disabled="importing || !pasted.trim()" @click="importEmails">
            <Icon name="check" :size="15" />{{ importing ? "Import…" : "Ranger les emails" }}
          </button>
          <label class="switch small"><input v-model="overwrite" type="checkbox" /> Remplacer les emails déjà saisis</label>
        </div>
      </template>
    </section>

    <section class="card toolbar">
      <label>
        Entreprise
        <input v-model="query" type="search" placeholder="Nom de l'entreprise…" aria-label="Rechercher une entreprise" />
      </label>
      <label>
        Afficher
        <select v-model="filter" aria-label="Suivi">
          <option value="active">À traiter (sans les écartées)</option>
          <option v-for="(label, key) in STATUS_LABELS" :key="key" :value="key">{{ label }}</option>
          <option value="all">Toutes</option>
        </select>
      </label>
      <label>
        Email
        <select v-model="emailFilter">
          <option value="any">Toutes</option>
          <option value="hint">« Email sur la fiche » La Bonne Boîte (pas encore saisi)</option>
          <option value="set">Avec email saisi</option>
          <option value="missing">Sans email, encore à chercher</option>
          <option value="noted">Sans email, avec une note (introuvable, site ou formulaire)</option>
        </select>
      </label>
      <label>
        Trier par
        <select v-model="sort">
          <option value="potential">Potentiel d'embauche</option>
          <option value="distance">Du plus proche au plus loin</option>
        </select>
      </label>
      <span class="muted small total"><strong>{{ total }}</strong> entreprise(s) dans la zone</span>
    </section>

    <template v-if="loading">
      <div v-for="n in 3" :key="n" class="skeleton" />
    </template>
    <div v-else-if="leads.length === 0" class="empty">
      <Icon name="building" :size="40" />
      <strong>Aucune entreprise pour l'instant</strong>
      <span class="small">Choisis une zone puis clique sur « Actualiser les entreprises ».</span>
    </div>

    <article v-for="l in leads" :key="l.id" class="card lead">
      <Ring
        :value="l.hiringPotential"
        :tone="l.isHighPotential ? 'good' : 'accent'"
        caption="/ 100"
        class="md"
        :title="`Potentiel d'embauche : ${l.hiringPotential ?? '?'} / 100`"
      />
      <div class="stack body">
        <div class="top">
          <div class="row">
            <strong class="name">{{ l.name }}</strong>
            <span v-if="l.officeName" class="muted small">({{ l.officeName }})</span>
            <span v-if="l.isHighPotential" class="chip good"><Icon name="star" :size="12" />Fort potentiel</span>
          </div>
          <span class="chip" :class="STATUS_TONES[l.status]">{{ STATUS_LABELS[l.status] }}</span>
        </div>
        <div class="meta muted small">
          <span><Icon name="briefcase" :size="14" />{{ l.nafLabel ?? "Secteur inconnu" }}</span>
          <span><Icon name="users" :size="14" />{{ size(l) }}</span>
          <span><Icon name="pin" :size="14" /><a class="map" :href="mapsUrl(l.name, l.postcode, l.city)" target="_blank" rel="noopener" title="Ouvrir dans Google Maps">{{ l.city ?? "?" }} ({{ l.postcode ?? l.department ?? "?" }})</a><template v-if="l.distanceKm !== null"> · à {{ l.distanceKm }} km</template></span>
          <span v-if="l.contactedAt"><Icon name="send" :size="14" />contactée {{ timeAgo(l.contactedAt) }}</span>
        </div>
        <div class="row links small">
          <a :href="lbbUrl(l.siret)" target="_blank" rel="noopener noreferrer"><Icon name="external" :size="14" />Fiche La Bonne Boîte</a>
          <span v-if="l.hasEmail" class="chip accent"><Icon name="mail" :size="12" />email sur la fiche</span>
          <a :href="searchUrl(l)" target="_blank" rel="noopener noreferrer"><Icon name="globe" :size="14" />Chercher leur site</a>
        </div>
        <div class="edit">
          <select :value="l.status" aria-label="Suivi" @change="setStatus(l, ($event.target as HTMLSelectElement).value as LeadStatus)">
            <option v-for="(label, key) in STATUS_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
          <input
            v-model="drafts[l.id]"
            placeholder="Notes (contact, date de relance…)"
            aria-label="Notes"
            @blur="saveNotes(l)"
            @keydown.enter="saveNotes(l)"
          />
        </div>
        <div class="apply">
          <input
            v-model="emails[l.id]"
            type="email"
            placeholder="Email de contact (collé depuis la fiche ou leur site)"
            aria-label="Email de contact"
            @blur="saveEmail(l)"
            @keydown.enter="saveEmail(l)"
          />
          <RouterLink :to="`/entreprises/${l.id}/candidature`" class="btn" :class="{ primary: !!l.contactEmail }">
            <Icon name="mail" :size="15" />Préparer la candidature
          </RouterLink>
        </div>
        <p v-if="emailError[l.id]" class="alert small">{{ emailError[l.id] }}</p>
      </div>
    </article>

    <div v-if="!loading && leads.length < total" class="more">
      <button type="button" @click="load(true)">Charger plus ({{ total - leads.length }} restante(s))</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 0.9rem 1.2rem; padding: 0.9rem 1rem; }
.toolbar .total { margin-left: auto; padding-bottom: 0.5rem; }
.toolbar .total strong { color: var(--text); }
.lead { display: flex; gap: 1.1rem; align-items: flex-start; transition: border-color 0.15s, box-shadow 0.15s; }
.lead:hover { border-color: var(--border-strong); box-shadow: var(--shadow-hover); }
.body { min-width: 0; flex: 1; gap: 0.55rem; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
.name { font-size: 1.02rem; font-weight: 650; }
.meta { display: flex; flex-wrap: wrap; gap: 0.3rem 1.1rem; }
.meta span, .links a { display: inline-flex; align-items: center; gap: 0.35rem; }
.links { gap: 0.5rem 1.1rem; }
.edit { display: grid; grid-template-columns: 11rem 1fr; gap: 0.5rem; }
.apply { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
.finder { gap: 0.7rem; }
.batch { display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap; border-color: var(--accent-soft); }
.batch-icon { color: var(--accent); flex: none; }
.batch-text { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; min-width: 14rem; }
.finder-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.6rem 1rem; align-items: flex-start; }
.finder-head strong { display: inline-flex; align-items: center; gap: 0.4rem; }
.finder-head p { margin: 0.25rem 0 0; max-width: 46rem; }
.finder textarea { width: 100%; font-family: ui-monospace, monospace; font-size: 0.82rem; }
.more { display: flex; justify-content: center; padding: 0.5rem 0 1rem; }
/* Téléphone : contenu sur toute la largeur, petit anneau à droite du nom. */
@media (max-width: 600px) {
  .lead { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.4rem 0.6rem; }
  .body { display: contents; }
  .body > * { grid-column: 1 / -1; }
  .body > .top { grid-column: 1; grid-row: 1; flex-direction: column; gap: 0.25rem; }
  .lead > :deep(.ring) { grid-column: 2; grid-row: 1; --size: 44px; }
  .lead > :deep(.ring)::before { inset: 4px; }
  .lead > :deep(.ring) small { display: none; }
  .meta { gap: 0.15rem 0.8rem; }
  .links { gap: 0.3rem 0.9rem; }
  .edit { grid-template-columns: 8.5rem minmax(0, 1fr); gap: 0.4rem; }
  .apply { grid-template-columns: 1fr; gap: 0.4rem; }
  .toolbar { gap: 0.5rem 0.8rem; padding: 0.6rem; }
}
</style>

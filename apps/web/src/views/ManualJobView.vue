<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ApiError, api, errorMessage } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import ScoreBadge from "../components/ScoreBadge.vue";
import { SOURCE_LABELS, STATUS_LABELS, mapsUrl, originLabel, timeAgo, place } from "../format";
import type { JobDetail, JobSummary, JobTextAnalysis, ManualJobForm, RemoteType } from "../types";

const DRAFT_KEY = "jobradar.manualDraft";
const CONTRACTS = [
  { value: "CDI", label: "CDI" },
  { value: "CDD", label: "CDD" },
  { value: "INTERIM", label: "Intérim" },
  { value: "ALTERNANCE", label: "Alternance" },
  { value: "STAGE", label: "Stage" },
  { value: "FREELANCE", label: "Freelance" },
] as const;
const REMOTES: Array<{ value: RemoteType; label: string }> = [
  { value: "unknown", label: "Je ne sais pas" },
  { value: "onsite", label: "Sur site" },
  { value: "hybrid", label: "Hybride" },
  { value: "remote", label: "Télétravail complet" },
];

type Draft = {
  url: string;
  title: string;
  company: string;
  location: string;
  address: string;
  contractType: string;
  salaryMin: number | "";
  salaryMax: number | "";
  remoteType: RemoteType;
  experienceYears: number | "";
  description: string;
};
const empty = (): Draft => ({
  url: "",
  title: "",
  company: "",
  location: "",
  address: "",
  contractType: "",
  salaryMin: "",
  salaryMax: "",
  remoteType: "unknown",
  experienceYears: "",
  description: "",
});

function loadDraft(): Draft {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") };
  } catch {
    return empty();
  }
}

const form = reactive<Draft>(loadDraft());
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const result = ref<{ job: JobDetail; duplicate: boolean; otherSources: string[] } | null>(null);
const failure = ref<string | null>(null);
const items = ref<JobSummary[]>([]);
const loadingList = ref(true);

// ───── Lecture automatique de l'annonce collée (sans IA) ─────
type Field = "title" | "company" | "location" | "address" | "contractType" | "remoteType" | "salaryMin" | "salaryMax" | "experienceYears";
const FIELDS: Field[] = ["title", "company", "location", "address", "contractType", "remoteType", "salaryMin", "salaryMax", "experienceYears"];
/** Champs modifiés à la main : la lecture automatique ne les écrase jamais. */
const touched = reactive(new Set<Field>());
/** Champs remplis par la lecture automatique (petit badge « lu dans l'annonce »). */
const detected = reactive(new Set<Field>());
const analysis = ref<JobTextAnalysis | null>(null);
const analyzing = ref(false);
let analyzeTimer: ReturnType<typeof setTimeout> | undefined;
let lastAnalyzed = "";

function touch(f: Field) {
  touched.add(f);
  detected.delete(f);
}

/** Remplit les cases lues (lecture simple ou IA), sauf celles modifiées à la main ; badge « lu » sur celles trouvées. */
function fill(values: Record<Field, unknown>) {
  for (const f of FIELDS) {
    if (touched.has(f)) continue;
    (form as Record<Field, unknown>)[f] = values[f];
    const found = f === "remoteType" ? values[f] !== "unknown" : values[f] !== "";
    if (found) detected.add(f);
    else detected.delete(f);
  }
}

/** Brouillon effacé une fois l'offre ajoutée (stockage indisponible : sans importance). */
function forgetDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* rien */
  }
}

watch(
  () => form.description,
  (text) => {
    clearTimeout(analyzeTimer);
    if (text.trim().length < 60) {
      analysis.value = null;
      return;
    }
    analyzeTimer = setTimeout(() => void analyze(text), 500);
  },
);

async function analyze(text: string) {
  if (text === lastAnalyzed || text === aiText) return; // offre confiée à l'IA : pas de lecture simple
  lastAnalyzed = text;
  readBy.value = "rules";
  analyzing.value = true;
  try {
    const a = await api.analyzeJobText(text);
    if (form.description !== text) return; // le texte a encore changé entre-temps
    analysis.value = a;
    fill({
      title: a.title ?? "",
      company: a.company ?? "",
      location: a.location ?? "",
      contractType: a.contractType ?? "",
      remoteType: a.remoteType,
      salaryMin: a.salaryMin ?? "",
      salaryMax: a.salaryMax ?? "",
      experienceYears: a.experienceYears ?? "",
      address: form.address,
    });
    applyHints();
  } catch {
    /* lecture impossible : on remplit à la main */
  } finally {
    analyzing.value = false;
  }
}

// ───── Offre reçue de l'extension navigateur « Envoyer à Job Radar » ─────
type Hints = Partial<Record<"title" | "company" | "location" | "contractType" | "salaryMin" | "salaryMax", unknown>>;
/** Ce que la page de l'offre disait clairement (titre, entreprise…) : prioritaire sur la lecture du texte. */
const pageHints = ref<Hints>({});
const importedFrom = ref<string | null>(null);

function sanitizeHints(h: unknown): Hints {
  if (!h || typeof h !== "object") return {};
  const o = h as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 8000 && v <= 500_000 ? Math.round(v) : undefined);
  const contract = CONTRACTS.some((c) => c.value === o.contractType) ? (o.contractType as string) : undefined;
  return {
    title: str(o.title, 200),
    company: str(o.company, 150),
    location: str(o.location, 150),
    contractType: contract,
    salaryMin: num(o.salaryMin),
    salaryMax: num(o.salaryMax),
  };
}

function applyHints() {
  if (readBy.value === "ai") return; // l'IA a déjà tenu compte des infos de la page
  for (const [f, v] of Object.entries(pageHints.value) as Array<[Field, unknown]>) {
    if (v === undefined || touched.has(f)) continue;
    (form as Record<Field, unknown>)[f] = v;
    detected.add(f);
  }
}

// ───── Lecture par l'IA locale : l'offre de l'extension lui est confiée directement ─────
/** Qui a rempli les cases : l'IA, ou la lecture simple (secours quand Ollama est éteint). */
const readBy = ref<"ai" | "rules">("rules");
const aiReading = ref(false);
const aiSeconds = ref(0);
const aiError = ref<string | null>(null);
/** Texte confié à l'IA : la lecture simple ne s'en mêle pas. */
let aiText = "";

async function readWithAi(text: string, hints: { title?: string | null; company?: string | null } = {}): Promise<boolean> {
  aiText = text;
  aiReading.value = true;
  aiError.value = null;
  aiSeconds.value = 0;
  const tick = setInterval(() => aiSeconds.value++, 1000);
  try {
    const res = await api.aiReadJob(text, hints);
    if (form.description !== text) return false; // l'utilisateur a changé le texte entre-temps
    const f = res.fields;
    readBy.value = "ai";
    analysis.value = { ...f, text: res.text };
    fill({
      title: f.title ?? "",
      company: f.company ?? "",
      location: f.location ?? "",
      contractType: f.contractType ?? "",
      remoteType: f.remoteType,
      salaryMin: f.salaryMin ?? "",
      salaryMax: f.salaryMax ?? "",
      experienceYears: f.experienceYears ?? "",
      address: f.address ?? "",
    });
    // Texte nettoyé (menus, boutons retirés) : c'est lui qui sera enregistré.
    aiText = res.text;
    form.description = res.text;
    return true;
  } catch (e) {
    // IA indisponible : lecture simple + infos de la page, comme avant.
    aiError.value = errorMessage(e, "L'IA n'a pas pu lire l'annonce.");
    aiText = "";
    lastAnalyzed = "";
    await analyze(text);
    return false;
  } finally {
    clearInterval(tick);
    aiReading.value = false;
  }
}

// ───── Mode automatique : extension → lecture IA → ajout → analyse IA → page de l'offre ─────
const AUTO_KEY = "jobradar.autoAdd";
function loadAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "false";
  } catch {
    return true;
  }
}
const autoMode = ref(loadAuto());
watch(autoMode, (v) => {
  try {
    localStorage.setItem(AUTO_KEY, String(v));
  } catch {
    /* stockage indisponible : sans importance */
  }
});
type Step = "read" | "add" | "analyze";
const autoStep = ref<Step | null>(null);
const autoSeconds = ref(0);
const autoNote = ref<string | null>(null);

async function autoPipeline(hints: { title?: string | null; company?: string | null }) {
  autoNote.value = null;
  autoSeconds.value = 0;
  const tick = setInterval(() => autoSeconds.value++, 1000);
  try {
    autoStep.value = "read";
    const ok = await readWithAi(form.description, hints);
    if (!ok || !form.title.trim()) {
      // IA éteinte ou titre introuvable : on laisse la main (formulaire à vérifier).
      autoNote.value = ok ? "Titre du poste introuvable : complète-le, puis ajoute l'offre." : null;
      return;
    }
    autoStep.value = "add";
    // Offre déjà connue par un simple extrait (Adzuna, Jooble) : on la complète au lieu d'en créer une autre.
    const found = await api
      .findAbridged({ url: form.url.trim(), title: form.title.trim(), company: form.company.trim() })
      .catch(() => ({ job: null }));
    let jobId: string;
    if (found.job) {
      await api.completeJob(found.job.id, form.description, form.experienceYears === "" ? null : Number(form.experienceYears), formInfo());
      jobId = found.job.id;
    } else {
      jobId = (await api.addManualJob(payload())).job.id;
    }
    autoStep.value = "analyze";
    await api.analyzeJob(jobId).catch(() => null); // IA occupée ou en panne : l'offre est quand même ajoutée
    clearForm();
    forgetDraft();
    await router.push({ name: "job", params: { id: jobId } });
  } catch (e) {
    autoNote.value =
      e instanceof ApiError && e.issues.length
        ? "L'offre n'a pas pu être ajoutée automatiquement : vérifie les champs en rouge."
        : "L'offre n'a pas pu être ajoutée automatiquement : vérifie les champs, puis ajoute-la.";
    if (e instanceof ApiError && e.issues.length) errors.value = Object.fromEntries(e.issues.map((i) => [i.path || "form", i.message]));
  } finally {
    clearInterval(tick);
    autoStep.value = null;
  }
}

/** Lit l'offre déposée dans la page par l'extension (élément #jobradar-import), une seule fois. */
async function consumeImport() {
  const el = document.getElementById("jobradar-import");
  if (!el) return;
  el.remove();
  let p: { url?: unknown; text?: unknown; source?: unknown; hints?: unknown };
  try {
    p = JSON.parse(el.textContent ?? "");
  } catch {
    return;
  }
  const text = typeof p.text === "string" ? p.text.slice(0, 30_000) : "";
  if (!text.trim()) return;
  const url = typeof p.url === "string" && /^https?:\/\//i.test(p.url) ? p.url.slice(0, 2000) : "";
  // Déjà en base avec le même lien : on ouvre l'offre au lieu de la relire.
  const inBase = url ? (await api.findByUrl(url).catch(() => ({ job: null }))).job : null;
  // Page plus longue que l'annonce en base (résumé JobScraper…) : elle la remplace, puis nouveau score.
  if (inBase && text.length > inBase.descriptionLength) {
    importedFrom.value = originLabel(url) ?? "la page";
    autoStep.value = "add";
    try {
      await api.completeJob(inBase.id, text);
      autoStep.value = "analyze";
      await api.analyzeJob(inBase.id).catch(() => null); // IA occupée : l'annonce est quand même complétée
      await router.replace({ name: "job", params: { id: inBase.id }, query: { complete: "1" } });
      return;
    } catch {
      // texte refusé (trop court une fois nettoyé…) : on ouvre l'offre telle quelle
    } finally {
      autoStep.value = null;
    }
  }
  if (inBase) {
    await router.replace({ name: "job", params: { id: inBase.id }, query: { deja: "1" } });
    return;
  }
  clearForm();
  form.url = url;
  pageHints.value = sanitizeHints(p.hints);
  importedFrom.value = originLabel(url) ?? (typeof p.source === "string" ? p.source : "la page");
  aiText = text; // l'IA lit l'offre : pas de lecture simple en parallèle
  form.description = text;
  const h = pageHints.value;
  const hints = {
    title: typeof h.title === "string" ? h.title : null,
    company: typeof h.company === "string" ? h.company : null,
  };
  if (autoMode.value) void autoPipeline(hints);
  else void readWithAi(text, hints);
}

onMounted(() => {
  void consumeImport();
  window.addEventListener("jobradar-import", consumeImport);
});
onUnmounted(() => window.removeEventListener("jobradar-import", consumeImport));

// ───── Offre déjà connue par un simple extrait (Adzuna, Jooble) : on la complète au lieu d'en créer une autre ─────
const router = useRouter();
const known = ref<{ id: string; title: string; company: string | null; sources: string[] } | null>(null);
const completing = ref(false);
const completeError = ref<string | null>(null);
let findTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => [form.url, form.title, form.company],
  () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(async () => {
      const page = { url: form.url.trim(), title: form.title.trim(), company: form.company.trim() };
      if (!page.url && !(page.title && page.company)) {
        known.value = null;
        return;
      }
      known.value = (await api.findAbridged(page).catch(() => ({ job: null }))).job;
    }, 500);
  },
);

/** Contrat, télétravail et salaire du formulaire (lus par l'IA) : complètent l'offre déjà connue. */
function formInfo() {
  return {
    contractType: form.contractType || null,
    remoteType: form.remoteType,
    salaryMin: form.salaryMin === "" ? null : Number(form.salaryMin),
    salaryMax: form.salaryMax === "" ? null : Number(form.salaryMax),
  };
}

async function completeKnown() {
  if (!known.value) return;
  completing.value = true;
  completeError.value = null;
  try {
    await api.completeJob(known.value.id, form.description, form.experienceYears === "" ? null : Number(form.experienceYears), formInfo());
    const id = known.value.id;
    clearForm();
    forgetDraft();
    await router.push({ name: "job", params: { id } });
  } catch (e) {
    completeError.value = errorMessage(e, "Impossible de compléter l'offre.");
  } finally {
    completing.value = false;
  }
}

const REMOTE_SHORT: Record<RemoteType, string> = { remote: "Télétravail complet", hybrid: "Hybride", onsite: "Sur site", unknown: "" };

// Brouillon gardé si tu quittes la page avant d'avoir ajouté l'offre.
watch(form, () => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
  } catch {
    /* stockage indisponible : sans importance */
  }
});

async function loadList() {
  try {
    items.value = (await api.listManualJobs()).items;
  } finally {
    loadingList.value = false;
  }
}
onMounted(loadList);

const origin = computed(() => originLabel(form.url.trim()));
const autoLabel = computed(() => (readBy.value === "ai" ? "lu par l'IA" : "lu dans l'annonce"));
const canSubmit = computed(() => form.title.trim().length >= 2 && form.description.trim().length >= 20 && !saving.value);

function payload(): ManualJobForm {
  const p: ManualJobForm = { title: form.title.trim(), description: form.description.trim(), remoteType: form.remoteType };
  if (form.url.trim()) p.url = form.url.trim();
  if (form.company.trim()) p.company = form.company.trim();
  if (form.location.trim()) p.location = form.location.trim();
  if (form.address.trim()) p.address = form.address.trim();
  if (form.contractType) p.contractType = form.contractType as ManualJobForm["contractType"];
  if (form.salaryMin !== "") p.salaryMin = Number(form.salaryMin);
  if (form.salaryMax !== "") p.salaryMax = Number(form.salaryMax);
  if (form.experienceYears !== "") p.experienceYears = Number(form.experienceYears);
  return p;
}

async function submit() {
  if (!canSubmit.value) return;
  saving.value = true;
  errors.value = {};
  failure.value = null;
  result.value = null;
  try {
    result.value = await api.addManualJob(payload());
    clearForm();
    forgetDraft();
    await loadList();
  } catch (e) {
    if (e instanceof ApiError && e.issues.length) {
      errors.value = Object.fromEntries(e.issues.map((i) => [i.path || "form", i.message]));
      failure.value = "Vérifie les champs en rouge.";
    } else {
      failure.value = "Impossible d'ajouter l'offre (serveur injoignable ?).";
    }
  } finally {
    saving.value = false;
  }
}

function resetDetection() {
  touched.clear();
  detected.clear();
  pageHints.value = {};
  importedFrom.value = null;
  analysis.value = null;
  lastAnalyzed = "";
  aiText = "";
  aiError.value = null;
  readBy.value = "rules";
}

function clearForm() {
  Object.assign(form, empty());
  resetDetection();
  errors.value = {};
  failure.value = null;
}

async function remove(job: JobSummary) {
  if (!window.confirm(`Retirer « ${job.title} » de tes offres ajoutées ?`)) return;
  await api.removeManualJob(job.id);
  if (result.value?.job.id === job.id) result.value = null;
  await loadList();
}

const manualUrl = (j: JobSummary) => j.sources.find((s) => s.source === "manual")?.url ?? "";
</script>

<template>
  <PageHeader
    title="Ajouter une offre"
    subtitle="Une annonce vue sur LinkedIn, Indeed ou ailleurs ? Colle-la ici : elle reçoit un score comme les autres et elle est gardée dans « Sauvegardées »."
  >
    <template #actions>
      <label class="inline auto-toggle" title="Offres envoyées par l'extension : lues, ajoutées et analysées par l'IA sans passer par le formulaire">
        <input v-model="autoMode" type="checkbox" /> Ajout automatique depuis l'extension
      </label>
    </template>
  </PageHeader>

  <section v-if="autoStep" class="card auto-run" aria-live="polite">
    <strong><Icon name="sparkle" :size="18" class="spin-slow" /> Offre reçue<template v-if="importedFrom"> depuis {{ importedFrom }}</template> : l'IA s'en occupe… <span class="num muted">{{ autoSeconds }} s</span></strong>
    <ol class="steps">
      <li :class="{ on: autoStep === 'read', done: autoStep !== 'read' }">Lecture de l'annonce (titre, lieu, contrat, salaire, expérience…)</li>
      <li :class="{ on: autoStep === 'add', done: autoStep === 'analyze' }">Ajout à tes offres (ou complément d'une offre déjà connue dont l'annonce était incomplète)</li>
      <li :class="{ on: autoStep === 'analyze' }">Analyse et score vérifié par l'IA</li>
    </ol>
    <p class="muted small">Tu arriveras directement sur la page de l'offre. Compte 20 à 40 secondes.</p>
  </section>
  <p v-if="autoNote" class="alert"><Icon name="alert" :size="16" />{{ autoNote }}</p>

  <div class="layout">
    <form class="card stack form" @submit.prevent="submit" @keydown.ctrl.enter.prevent="submit" @keydown.meta.enter.prevent="submit">
      <div v-if="result" class="success result" role="status">
        <Icon name="check" :size="18" />
        <div class="stack" style="gap: 0.35rem">
          <strong>Offre ajoutée : {{ result.job.score.final }} % compatible.</strong>
          <span v-if="result.duplicate" class="small">
            Elle était déjà dans Job Radar ({{ result.otherSources.map((s) => SOURCE_LABELS[s] ?? s).join(", ") || "ajout précédent" }}) :
            pas de doublon, elle est simplement gardée dans « Sauvegardées ».
          </span>
          <div>
            <RouterLink :to="{ name: 'job', params: { id: result.job.id } }" class="btn small primary">Voir l'offre</RouterLink>
          </div>
        </div>
      </div>
      <div v-if="known && !result" class="known" role="status">
        <Icon name="sparkle" :size="18" />
        <div class="stack" style="gap: 0.45rem">
          <strong>Cette offre est déjà dans Job Radar, mais avec un simple extrait ({{ known.sources.map((x) => SOURCE_LABELS[x] ?? x).join(", ") }}).</strong>
          <span class="small">« {{ known.title }} »<template v-if="known.company"> · {{ known.company }}</template>. Complète-la avec cette annonce entière : son score et l'IA seront justes, sans créer de doublon.</span>
          <p v-if="completeError" class="alert small"><Icon name="alert" :size="15" />{{ completeError }}</p>
          <div>
            <button type="button" class="primary" :disabled="completing || form.description.trim().length < 50" @click="completeKnown">
              <Icon name="check" :size="16" />{{ completing ? "Enregistrement…" : "Compléter l'offre existante" }}
            </button>
          </div>
        </div>
      </div>
      <p v-if="importedFrom && !result" class="info imported" role="status">
        <Icon name="check" :size="16" />
        <span>Offre reçue depuis <strong>{{ importedFrom }}</strong> grâce à l'extension. Vérifie les champs, puis clique sur « Ajouter l'offre ».</span>
      </p>
      <p v-if="failure" class="alert" role="alert"><Icon name="alert" :size="16" />{{ failure }}</p>

      <!-- 1. Coller -->
      <label class="paste">
        <span class="step"><b>1</b> Colle toute l'annonce <span class="req">*</span></span>
        <textarea
          v-model="form.description"
          rows="10"
          placeholder="Sélectionne toute l'annonce sur LinkedIn, Indeed… (Ctrl + A puis Ctrl + C) et colle-la ici (Ctrl + V)."
          :class="{ bad: errors.description }"
        />
        <span v-if="errors.description" class="err">{{ errors.description }}</span>
        <span v-else class="hint">
          Tu peux tout sélectionner (Ctrl + A) : menus, formulaire de candidature et « offres similaires » du bas de page sont ignorés. Sur LinkedIn, commence au nom de l'entreprise pour avoir aussi le titre.
          <span class="num">{{ form.description.trim().length }} caractères</span>
        </span>
      </label>

      <div v-if="aiReading" class="analysis ai-reading" aria-live="polite">
        <Icon name="sparkle" :size="16" class="spin-slow" />
        <span>L'IA lit l'annonce et remplit les cases… <span class="num">{{ aiSeconds }} s</span></span>
      </div>
      <p v-else-if="aiError" class="info small"><Icon name="info" :size="15" /><span>{{ aiError }} Lecture simple à la place : vérifie bien les cases.</span></p>

      <div v-if="!aiReading && (analyzing || analysis)" class="analysis" aria-live="polite">
        <template v-if="analyzing && !analysis"><Icon name="refresh" :size="15" class="spin" /> Lecture de l'annonce…</template>
        <template v-else-if="analysis">
          <div class="row">
            <strong class="small"><Icon :name="readBy === 'ai' ? 'sparkle' : 'search'" :size="14" /> {{ readBy === "ai" ? "Lu par l'IA :" : "Lu dans l'annonce :" }}</strong>
            <span v-if="analysis.company" class="chip good">{{ analysis.company }}</span>
            <span v-if="analysis.location" class="chip good"><Icon name="pin" :size="12" />{{ analysis.location }}</span>
            <span v-if="analysis.contractType" class="chip good">{{ analysis.contractType }}</span>
            <span v-if="analysis.remoteType !== 'unknown'" class="chip good"><Icon name="home" :size="12" />{{ REMOTE_SHORT[analysis.remoteType] }}</span>
            <span v-if="analysis.salaryMin" class="chip good"><Icon name="euro" :size="12" />{{ Math.round(analysis.salaryMin / 1000) }}k<template v-if="analysis.salaryMax && analysis.salaryMax !== analysis.salaryMin">–{{ Math.round(analysis.salaryMax / 1000) }}k</template></span>
            <span v-if="analysis.experienceYears !== null" class="chip good"><Icon name="star" :size="12" />{{ analysis.experienceYears }} an(s) d'expérience</span>
            <span v-if="analysis.skills.length" class="chip good"><Icon name="code" :size="12" />{{ analysis.skills.length }} compétence(s)</span>
          </div>
          <p v-if="analysis.skills.length" class="muted small skills">{{ analysis.skills.join(" · ") }}</p>
          <p v-if="!form.title" class="warn-line small">
            <Icon name="alert" :size="14" /> Titre du poste pas trouvé dans le texte : recopie-le ci-dessous (c'est la ligne en gros en haut de l'annonce).
          </p>
          <p v-if="!form.contractType" class="muted small">Contrat non écrit dans l'annonce : choisis-le si tu le connais.</p>
          <button v-if="readBy === 'rules'" type="button" class="ghost small ai-btn" @click="readWithAi(form.description)">
            <Icon name="sparkle" :size="14" />Relire avec l'IA (plus fiable, 5 à 20 s)
          </button>
        </template>
      </div>

      <!-- 2. Vérifier -->
      <span class="step"><b>2</b> Vérifie et complète</span>

      <label>
        <span>Titre du poste <span class="req">*</span> <span v-if="detected.has('title')" class="auto">{{ autoLabel }}</span></span>
        <input v-model="form.title" placeholder="Développeur Frontend Vue.js (H/F)" :class="{ bad: errors.title, missing: analysis && !form.title }" required @input="touch('title')" />
        <span v-if="errors.title" class="err">{{ errors.title }}</span>
      </label>

      <div class="two">
        <label>
          <span>Entreprise <span v-if="detected.has('company')" class="auto">{{ autoLabel }}</span></span>
          <div class="field"><Icon name="building" :size="16" /><input v-model="form.company" placeholder="Acme" @input="touch('company')" /></div>
        </label>
        <label>
          <span>Lieu <span v-if="detected.has('location')" class="auto">{{ autoLabel }}</span></span>
          <div class="field"><Icon name="pin" :size="16" /><input v-model="form.location" placeholder="Creil, ou Oise (60)" @input="touch('location')" /></div>
        </label>
      </div>

      <div class="two">
        <label>
          <span>Contrat <span v-if="detected.has('contractType')" class="auto">{{ autoLabel }}</span></span>
          <select v-model="form.contractType" @change="touch('contractType')">
            <option value="">Je ne sais pas</option>
            <option v-for="c in CONTRACTS" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
        </label>
        <label>
          <span>Télétravail <span v-if="detected.has('remoteType')" class="auto">{{ autoLabel }}</span></span>
          <select v-model="form.remoteType" @change="touch('remoteType')">
            <option v-for="r in REMOTES" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
        </label>
      </div>

      <div class="two">
        <label>
          <span>Salaire minimum <span class="opt">brut annuel, €</span> <span v-if="detected.has('salaryMin')" class="auto">{{ readBy === "ai" ? "IA" : "lu" }}</span></span>
          <input v-model.number="form.salaryMin" type="number" min="0" step="1000" placeholder="36000" @input="touch('salaryMin')" />
        </label>
        <label>
          <span>Salaire maximum <span class="opt">brut annuel, €</span> <span v-if="detected.has('salaryMax')" class="auto">{{ readBy === "ai" ? "IA" : "lu" }}</span></span>
          <input v-model.number="form.salaryMax" type="number" min="0" step="1000" placeholder="42000" :class="{ bad: errors.salaryMax }" @input="touch('salaryMax')" />
          <span v-if="errors.salaryMax" class="err">{{ errors.salaryMax }}</span>
        </label>
      </div>

      <label>
        <span>Adresse du lieu de travail <span class="opt">facultatif : trajet plus précis</span> <span v-if="detected.has('address')" class="auto">{{ autoLabel }}</span></span>
        <div class="field"><Icon name="pin" :size="16" /><input v-model="form.address" placeholder="48 Boulevard des Batignolles, 75017 Paris" @input="touch('address')" /></div>
      </label>

      <label class="exp">
        <span>Expérience demandée <span class="opt">en années</span> <span v-if="detected.has('experienceYears')" class="auto">{{ autoLabel }}</span></span>
        <input v-model.number="form.experienceYears" type="number" min="0" max="30" step="1" placeholder="1" @input="touch('experienceYears')" />
      </label>

      <label>
        <span>Lien de l'annonce <span class="opt">facultatif</span></span>
        <div class="field">
          <Icon name="globe" :size="16" />
          <input v-model="form.url" type="url" inputmode="url" placeholder="https://www.linkedin.com/jobs/view/…" :class="{ bad: errors.url }" />
        </div>
        <span v-if="errors.url" class="err">{{ errors.url }}</span>
        <span v-else-if="origin" class="hint"><Icon name="check" :size="13" /> Source reconnue : <strong>{{ origin }}</strong></span>
      </label>

      <div class="actions">
        <button type="button" class="ghost" :disabled="saving" @click="clearForm">Effacer</button>
        <button type="submit" class="primary" :disabled="!canSubmit">
          <Icon name="plus" :size="16" />{{ saving ? "Ajout…" : "Ajouter l'offre" }}
        </button>
      </div>
      <p class="muted small kbd-hint">Astuce : Ctrl + Entrée pour ajouter. Le formulaire est gardé si tu changes de page.</p>
    </form>

    <aside class="card stack list">
      <h2 style="margin: 0"><Icon name="bookmark" :size="17" />Mes offres ajoutées <span class="chip">{{ items.length }}</span></h2>
      <template v-if="loadingList">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 70px" />
      </template>
      <div v-else-if="items.length === 0" class="empty small">
        <Icon name="plus" :size="32" />
        Aucune offre ajoutée pour l'instant.
      </div>
      <ul v-else class="items">
        <li v-for="j in items" :key="j.id">
          <ScoreBadge :value="j.score.final" />
          <div class="body">
            <RouterLink :to="{ name: 'job', params: { id: j.id } }" class="title">{{ j.title }}</RouterLink>
            <span class="muted small">{{ j.company ?? "Entreprise ?" }}<template v-if="place(j)"> · <a class="map" :href="mapsUrl(j.company, place(j))" target="_blank" rel="noopener" title="Ouvrir dans Google Maps">{{ place(j) }}</a></template></span>
            <span class="row small">
              <span v-if="originLabel(manualUrl(j))" class="chip">{{ originLabel(manualUrl(j)) }}</span>
              <span class="chip">{{ STATUS_LABELS[j.status] }}</span>
              <span class="muted">ajoutée {{ timeAgo(j.firstSeenAt) }}</span>
            </span>
          </div>
          <button type="button" class="icon-btn del" :aria-label="`Retirer ${j.title}`" title="Retirer" @click="remove(j)">
            <Icon name="trash" :size="15" />
          </button>
        </li>
      </ul>
    </aside>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr); gap: 1rem; align-items: start; }
@media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } }
.form { gap: 1rem; }
.form label > span:first-child { color: var(--text); font-weight: 600; font-size: 0.86rem; }
.form input, .form select, .form textarea { width: 100%; }
.form textarea { resize: vertical; min-height: 12rem; line-height: 1.5; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }
.req { color: var(--low); }
.opt { color: var(--muted); font-weight: 400; font-size: 0.78rem; margin-left: 0.25rem; }
.auto-toggle { font-size: 0.85rem; }
.auto-run { display: flex; flex-direction: column; gap: 0.7rem; margin-bottom: 1rem; border-color: var(--accent); }
.auto-run strong { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--accent); }
.steps { margin: 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.35rem; color: var(--muted); }
.steps li.on { color: var(--text); font-weight: 600; }
.steps li.done { color: var(--good); }
.steps li.done::marker { content: "✓  "; }
.ai-reading { display: flex; align-items: center; gap: 0.5rem; color: var(--accent); font-weight: 550; }
.spin-slow { animation: spin 2.4s linear infinite; }
.ai-btn { margin-top: 0.5rem; }
.exp input { max-width: 9rem; }
.known { display: flex; gap: 0.7rem; align-items: flex-start; padding: 0.9rem 1rem; border-radius: 12px; background: var(--accent-soft); color: var(--text); }
.known > :first-child { color: var(--accent); flex-shrink: 0; margin-top: 0.1rem; }
.hint { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; font-weight: 400; font-size: 0.8rem; color: var(--muted); }
.hint .num { margin-left: auto; }
.err { font-weight: 500; font-size: 0.8rem; color: var(--low); }
.bad { border-color: var(--low) !important; }
.actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
.kbd-hint { margin: -0.5rem 0 0; text-align: right; }
.result { align-items: flex-start; }
.step { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; font-size: 0.95rem; color: var(--text); }
.step b {
  display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: 50%;
  background: var(--accent); color: var(--accent-contrast); font-size: 0.8rem;
}
.paste textarea { min-height: 14rem; }
.analysis { display: grid; gap: 0.45rem; padding: 0.8rem 0.95rem; border-radius: var(--radius-sm); background: var(--accent-soft); font-size: 0.9rem; }
.analysis p { margin: 0; }
.analysis strong { display: inline-flex; align-items: center; gap: 0.3rem; }
.analysis .skills { line-height: 1.5; }
.warn-line { display: flex; align-items: center; gap: 0.35rem; color: var(--mid); font-weight: 600; }
.auto { font-size: 0.7rem; font-weight: 600; color: var(--good); background: var(--good-bg); padding: 0.05rem 0.45rem; border-radius: 99px; margin-left: 0.35rem; }
.missing { border-color: var(--mid) !important; box-shadow: 0 0 0 3px var(--mid-bg); }
.list { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow: auto; }
@media (max-width: 1000px) { .list { position: static; max-height: none; } }
.items { list-style: none; margin: 0; padding: 0; display: grid; }
.items li { display: flex; gap: 0.75rem; align-items: center; padding: 0.7rem 0; border-top: 1px solid var(--border); }
.items li:first-child { border-top: none; }
.items :deep(.ring) { --size: 46px; }
.items .body { display: grid; gap: 0.2rem; min-width: 0; flex: 1; }
.items .title { font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.items .title:hover { color: var(--accent); text-decoration: none; }
.del { color: var(--muted); }
.del:hover:not(:disabled) { color: var(--low); background: var(--low-bg); border-color: transparent; }
/* Téléphone (en fin de fichier pour passer après les règles de base). */
@media (max-width: 600px) {
  .two { gap: 0.6rem; }
  .paste textarea { min-height: 9rem; }
  .items li { gap: 0.55rem; padding: 0.5rem 0; }
  .items :deep(.ring) { --size: 38px; }
  .items :deep(.ring)::before { inset: 4px; }
  .items .body { gap: 0.1rem; }
}
</style>

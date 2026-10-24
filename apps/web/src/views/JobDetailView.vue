<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ApiError, api, errorMessage } from "../api";
import AiAnalysisCard from "../components/AiAnalysisCard.vue";
import ApplyInfoForm from "../components/ApplyInfoForm.vue";
import CoverLetterCard from "../components/CoverLetterCard.vue";
import CvCard from "../components/CvCard.vue";
import Icon from "../components/Icon.vue";
import ScoreBadge from "../components/ScoreBadge.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { SOURCE_LABELS, REMOTE_LABELS, STATUS_LABELS, formatSalary, linkLabel, mapsUrl, safeUrl, skillRuleKind, timeAgo } from "../format";
import type { ApplyInfo, JobDetail, JobEdits, JobStatus, RemoteType } from "../types";
import type { ScoreRule } from "@job-radar/shared";
import { goBack } from "../router";

const props = defineProps<{ id: string }>();
const job = ref<JobDetail | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const added = ref<string[]>([]);
/** Arrivée depuis l'extension : cette offre était déjà en base. */
const alreadyKnown = useRoute().query.deja === "1";
/** Arrivée depuis l'extension : l'annonce en base était trop courte, la page l'a complétée. */
const completedByPage = useRoute().query.complete === "1";

async function load() {
  try {
    job.value = await api.getJob(props.id);
    const pending = job.value.travelPending;
    if (job.value.status === "NEW") job.value = { ...(await api.setJobStatus(props.id, "SEEN")), travelPending: pending };
    if (pending) void waitForTravel();
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 404 ? "Offre introuvable." : "Impossible de charger l'offre.";
  }
}
onMounted(load);

/** Trajet calculé en différé : on redemande l'offre (le serveur attend le calcul en cours) et on ne met à jour que ce qui en dépend. */
async function waitForTravel() {
  for (let i = 0; i < 4 && job.value?.travelPending; i++) {
    const fresh = await api.getJob(props.id).catch(() => null);
    if (!fresh || !job.value || job.value.id !== fresh.id) return;
    const { travelMinutes, travelMode, travelIssue, travelPending, score, scoreSteps, reasons, warnings } = fresh;
    job.value = { ...job.value, travelMinutes, travelMode, travelIssue, travelPending, score, scoreSteps, reasons, warnings };
  }
  if (job.value?.travelPending) job.value = { ...job.value, travelPending: false };
}

/** Erreur d'une action (statut, compétence, « Pas pour moi »…) : sans elle, le bouton ne faisait rien en silence. */
const actionError = ref<string | null>(null);

/** Lance une action : bouton occupé pendant l'appel, message si le serveur refuse ou ne répond pas. */
async function act(fn: () => Promise<void>) {
  busy.value = true;
  actionError.value = null;
  try {
    await fn();
  } catch (e) {
    actionError.value = errorMessage(e, "Action impossible : le serveur ne répond pas. Réessaie dans un instant.");
  } finally {
    busy.value = false;
  }
}

const setStatus = (status: JobStatus) =>
  act(async () => {
    job.value = await api.setJobStatus(props.id, status);
  });

/**
 * « Marquer comme postulé » ouvre le formulaire (canal, CV, contrat s'il manque). Déjà postulé à la même offre vue
 * sur un autre site : le bandeau le dit, et le bouton « Oui, postuler quand même » vaut confirmation.
 */
const applying = ref(false);
async function markApplied(info: ApplyInfo) {
  await act(async () => {
    try {
      job.value = await api.setJobStatus(props.id, "APPLIED", { ...info, confirmDuplicate: !!job.value?.appliedTwins.length });
      applying.value = false;
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "ALREADY_APPLIED")) throw e;
      await reloadJob(); // candidature faite entre-temps (autre onglet) : le bandeau s'affiche, on redemande
    }
  });
}
const frDate = (d: string) => new Date(d).toLocaleDateString("fr-FR");

/** Avant de postuler : score sous 60 ou plus de 2 ans d'expérience demandés (profil junior). */
const MIN_APPLY_SCORE = 60;
const MAX_JUNIOR_YEARS = 2;
const applyWarnings = computed(() => {
  const j = job.value;
  if (!j || j.status === "APPLIED" || j.status === "REJECTED") return [];
  const out: string[] = [];
  if (j.score.final < MIN_APPLY_SCORE) out.push(`Score Job Radar de ${j.score.final} %, sous ${MIN_APPLY_SCORE} % : l'offre colle peu à ton profil.`);
  if ((j.experienceMinYrs ?? 0) > MAX_JUNIOR_YEARS) out.push(`L'offre demande ${j.experienceMinYrs} ans d'expérience minimum (plus de ${MAX_JUNIOR_YEARS} ans) : ta candidature junior risque d'être écartée.`);
  return out;
});

/** Après une analyse IA : le score a pu être corrigé. */
async function reloadJob() {
  const fresh = await api.getJob(props.id).catch(() => null);
  if (fresh) job.value = fresh;
}

/** Toute l'offre (id, sources, description, score détaillé, avis IA) en JSON, à coller à Claude pour signaler un souci. */
const copiedAll = ref(false);
async function copyAll() {
  await act(async () => {
    const { analysis, upToDate } = await api.getJobAnalysis(props.id).catch(() => ({ analysis: null, upToDate: false }));
    const dump = { job: job.value, aiAnalysis: analysis, aiAnalysisUpToDate: upToDate, page: location.href, copiedAt: new Date().toISOString() };
    await navigator.clipboard.writeText(JSON.stringify(dump, null, 2));
    copiedAll.value = true;
    setTimeout(() => (copiedAll.value = false), 2000);
  });
}

// ───── Annonce complète (Adzuna / Jooble ne donnent qu'un extrait) ─────
const completing = ref(false);
const fullText = ref("");
const completeError = ref<string | null>(null);

async function complete() {
  busy.value = true;
  completeError.value = null;
  try {
    job.value = { ...(await api.completeJob(props.id, fullText.value)), travelIssue: job.value?.travelIssue ?? null };
    completing.value = false;
    fullText.value = "";
  } catch (e) {
    completeError.value = errorMessage(e, "Enregistrement impossible.");
  } finally {
    busy.value = false;
  }
}

// ───── Description modifiée à la main (même enregistrement que l'annonce complète) ─────
const editingDesc = ref(false);
const descText = ref("");
const descError = ref<string | null>(null);

async function saveDescription() {
  busy.value = true;
  descError.value = null;
  try {
    job.value = { ...(await api.completeJob(props.id, descText.value)), travelIssue: job.value?.travelIssue ?? null };
    editingDesc.value = false;
  } catch (e) {
    descError.value = errorMessage(e, "Enregistrement impossible.");
  } finally {
    busy.value = false;
  }
}

const resetFull = () =>
  act(async () => {
    job.value = { ...(await api.resetFullText(props.id)), travelIssue: job.value?.travelIssue ?? null };
  });

// ───── Infos corrigées à la main (entreprise, lieu, contrat, salaire… manquants ou faux) ─────
const CONTRACTS = ["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE"];
const editing = ref(false);
const editError = ref<string | null>(null);
const form = ref({ title: "", company: "", city: "", address: "", department: "", contractType: "", remoteType: "" as RemoteType | "", salaryMin: "", salaryMax: "", experienceMinYrs: "" });

/** Valeurs affichées actuellement : seules celles que tu changes deviennent des corrections. */
function currentValues(j: JobDetail) {
  const exp = j.userEdits?.experienceMinYrs ?? Number(j.experienceText?.match(/\d+/)?.[0] ?? NaN);
  return {
    title: j.title,
    company: j.company ?? "",
    city: j.city ?? "",
    address: j.address ?? "",
    department: j.department ?? "",
    contractType: j.contractType ?? "",
    remoteType: j.remoteType === "unknown" ? "" : j.remoteType,
    salaryMin: j.salaryMin?.toString() ?? "",
    salaryMax: j.salaryMax?.toString() ?? "",
    experienceMinYrs: Number.isNaN(exp) ? "" : String(exp),
  } as typeof form.value;
}

function startEdit() {
  form.value = currentValues(job.value!);
  editError.value = null;
  editing.value = true;
}

async function saveEdits(reset = false) {
  const before = currentValues(job.value!);
  const edits: Record<string, string | number> = reset ? {} : { ...job.value!.userEdits };
  if (!reset) {
    for (const [k, v] of Object.entries(form.value) as Array<[keyof typeof before, string]>) {
      const value = v.trim();
      if (value === before[k] || !value) continue; // inchangé, ou vidé : garde la valeur de la source
      edits[k] = ["salaryMin", "salaryMax", "experienceMinYrs"].includes(k) ? Number(value) : value;
    }
  }
  busy.value = true;
  editError.value = null;
  try {
    const addressChanged = edits.address !== job.value!.userEdits?.address;
    job.value = { ...(await api.editJob(props.id, edits as JobEdits)), travelIssue: job.value?.travelIssue ?? null };
    editing.value = false;
    // Nouvelle adresse : l'ouverture de l'offre recalcule le trajet jusqu'à elle.
    if (addressChanged) {
      job.value = await api.getJob(props.id);
      if (job.value.travelPending) void waitForTravel();
    }
  } catch (e) {
    editError.value = errorMessage(e, "Enregistrement impossible.");
  } finally {
    busy.value = false;
  }
}

/** « J'ai cette compétence » : l'ajoute au profil, le score se recalcule. */
const addSkill = (skill: string) =>
  act(async () => {
    const { profile } = await api.getProfile();
    if (!profile.skills.some((s) => s.toLowerCase() === skill.toLowerCase())) {
      await api.saveProfile({ ...profile, skills: [...profile.skills, skill] });
    }
    added.value.push(skill);
    job.value = await api.getJob(props.id);
  });

/** « Je peux l'apprendre vite » : l'ajoute à ta liste du profil, le score se recalcule. */
const addLearnable = (skill: string) =>
  act(async () => {
    const { profile } = await api.getProfile();
    if (!profile.learnableSkills.some((s) => s.toLowerCase() === skill.toLowerCase())) {
      await api.saveProfile({ ...profile, learnableSkills: [...profile.learnableSkills, skill] });
    }
    job.value = await api.getJob(props.id);
  });

const links = computed(() =>
  (job.value?.sources ?? []).map((s) => ({ ...s, safe: safeUrl(s.url) })).filter((s) => s.safe),
);
// ───── « Pas pour moi » : ignore l'offre et, au choix, ajoute une règle pour les prochaines ─────
type NotForMeReason = "stack" | "role" | "company" | "other";
const notForMe = ref(false);
const nfmReason = ref<NotForMeReason>("stack");
const nfmSkills = ref<string[]>([]);
const nfmWord = ref("");
const nfmRemember = ref(true);
/** Points retirés par défaut selon la raison (modifiables ensuite dans le profil). */
const NFM_POINTS: Record<Exclude<NotForMeReason, "other">, number> = { stack: -30, role: -40, company: -50 };

function openNotForMe() {
  const j = job.value!;
  // Technos absentes de ton profil citées dans le titre : sans doute la stack principale.
  nfmSkills.value = j.missingSkills.filter((s) => skillRuleKind(j.title, s) === "title");
  nfmReason.value = j.missingSkills.length ? "stack" : "role";
  nfmWord.value = "";
  nfmRemember.value = true;
  notForMe.value = true;
}

function toggleSkill(s: string) {
  nfmSkills.value = nfmSkills.value.includes(s) ? nfmSkills.value.filter((x) => x !== s) : [...nfmSkills.value, s];
}

const nfmRules = computed<ScoreRule[]>(() => {
  const j = job.value;
  if (!j || !nfmRemember.value) return [];
  if (nfmReason.value === "stack") return nfmSkills.value.map((value) => ({ kind: skillRuleKind(j.title, value), value, points: NFM_POINTS.stack }));
  if (nfmReason.value === "role" && nfmWord.value.trim().length >= 2) return [{ kind: "title", value: nfmWord.value.trim(), points: NFM_POINTS.role }];
  if (nfmReason.value === "company" && j.company) return [{ kind: "company", value: j.company, points: NFM_POINTS.company }];
  return [];
});

const confirmNotForMe = () =>
  act(async () => {
    if (nfmRules.value.length) {
      const { profile } = await api.getProfile();
      const same = (a: ScoreRule, b: ScoreRule) => a.kind === b.kind && a.value.toLowerCase() === b.value.toLowerCase();
      const added = nfmRules.value.filter((r) => !profile.scoreRules.some((x) => same(x, r)));
      if (added.length) await api.saveProfile({ ...profile, scoreRules: [...profile.scoreRules, ...added] });
    }
    job.value = await api.setJobStatus(props.id, "IGNORED");
    notForMe.value = false;
  });

const ruleLabel = (r: ScoreRule) =>
  `${r.points} pts si « ${r.value} » ${r.kind === "title" ? "est dans le titre" : r.kind === "text" ? "est dans l'annonce" : "est l'entreprise"}`;
</script>

<template>
  <RouterLink to="/" class="back small" @click.prevent="goBack('/')"><Icon name="arrowLeft" :size="15" /> Retour</RouterLink>
  <p v-if="error" class="alert"><Icon name="alert" :size="16" />{{ error }}</p>
  <div v-else-if="!job" class="stack"><div class="skeleton" style="height: 180px" /><div class="skeleton" /></div>

  <div v-else class="stack detail">
    <section class="card hero">
      <div class="stack" style="gap: 0.55rem; min-width: 0">
        <div class="row">
          <span class="chip" :class="job.status === 'NEW' ? 'new' : job.status === 'EXPIRED' ? 'bad' : ''">{{ STATUS_LABELS[job.status] }}</span>
          <span class="muted small">Publiée {{ timeAgo(job.publishedAt) }} · vue la 1ʳᵉ fois {{ timeAgo(job.firstSeenAt) }}</span>
        </div>
        <h1>{{ job.title }}</h1>
        <div class="company muted">
          <span><Icon name="building" :size="15" />{{ job.company ?? "Entreprise non précisée" }}</span>
          <a v-if="job.address" :href="mapsUrl(job.address)" target="_blank" rel="noopener" title="Ouvrir dans Google Maps (le trajet est calculé jusqu'ici)"><Icon name="pin" :size="15" />{{ job.address }}</a>
          <a v-else-if="job.city || job.department" :href="mapsUrl(job.company, job.city, job.department)" target="_blank" rel="noopener" title="Ouvrir dans Google Maps">
            <Icon name="pin" :size="15" />{{ job.city ?? "Département" }}<template v-if="job.department"> ({{ job.department }})</template>
          </a>
          <span v-else><Icon name="pin" :size="15" />Lieu non précisé</span>
        </div>
        <div class="row facts">
          <span class="chip"><Icon name="file" :size="13" />{{ job.contractType ?? "Contrat non précisé" }}</span>
          <span class="chip"><Icon name="euro" :size="13" />{{ formatSalary(job.salaryMin, job.salaryMax) ?? "Salaire non communiqué" }}</span>
          <span v-if="REMOTE_LABELS[job.remoteType]" class="chip"><Icon name="home" :size="13" />{{ REMOTE_LABELS[job.remoteType] }}</span>
          <span class="chip"><Icon name="star" :size="13" />Expérience : {{ job.experienceText ?? "non précisée" }}</span>
          <span class="chip" :title="job.travelIssue ?? (job.travelMode === 'car' ? 'Voiture depuis ton domicile, sans trafic' : job.travelMode === 'transit' ? 'Transports en commun depuis ta gare d\'arrivée (Profil)' : '')">
            <Icon :name="job.travelMode === 'car' ? 'car' : 'train'" :size="13" />Trajet :
            {{ job.travelPending ? "calcul…" : job.travelMinutes === null ? "non calculé" : job.travelMode === "car" ? `≈ ${job.travelMinutes} min en voiture` : job.travelMode === "transit" ? `≈ ${job.travelMinutes} min depuis ta gare` : `≈ ${job.travelMinutes} min` }}
          </span>
        </div>
      </div>
      <div class="hero-side">
        <ScoreBadge :value="job.score.final" large />
        <button v-if="!editing" type="button" class="ghost small" @click="startEdit"><Icon name="edit" :size="14" />Modifier les infos</button>
      </div>
    </section>

    <section v-if="editing" class="card stack edit">
      <div>
        <h2 style="margin: 0"><Icon name="edit" :size="17" />Modifier les infos de l'offre</h2>
        <p class="muted small" style="margin: 0.3rem 0 0">Complète ce qui manque ou corrige ce qui est faux : tes corrections priment sur la source et le score est recalculé. Un champ vidé reprend la valeur de la source.</p>
      </div>
      <div class="edit-grid">
        <label class="wide">Intitulé<input v-model="form.title" /></label>
        <label>Entreprise<input v-model="form.company" /></label>
        <label>Ville<input v-model="form.city" /></label>
        <label class="wide">Adresse<input v-model="form.address" placeholder="ex. 78 Av. des Champs-Élysées, 75008 Paris" /></label>
        <label>Département<input v-model="form.department" placeholder="ex. 60" maxlength="3" /></label>
        <label>Contrat
          <select v-model="form.contractType"><option value="">Non précisé</option><option v-for="c in CONTRACTS" :key="c" :value="c">{{ c }}</option></select>
        </label>
        <label>Télétravail
          <select v-model="form.remoteType"><option value="">Non précisé</option><option v-for="(l, k) in REMOTE_LABELS" v-show="l" :key="k" :value="k">{{ l }}</option></select>
        </label>
        <label>Salaire min (€ brut/an)<input v-model="form.salaryMin" type="number" min="8000" step="1000" /></label>
        <label>Salaire max (€ brut/an)<input v-model="form.salaryMax" type="number" min="8000" step="1000" /></label>
        <label>Expérience demandée (ans)<input v-model="form.experienceMinYrs" type="number" min="0" max="30" /></label>
      </div>
      <p v-if="editError" class="alert small"><Icon name="alert" :size="15" />{{ editError }}</p>
      <div class="row">
        <button type="button" class="primary" :disabled="busy" @click="saveEdits()"><Icon name="check" :size="16" />Enregistrer</button>
        <button type="button" class="ghost" :disabled="busy" @click="editing = false">Annuler</button>
        <button v-if="job.userEditsAt" type="button" class="ghost danger" :disabled="busy" @click="saveEdits(true)"><Icon name="undo" :size="16" />Revenir aux infos de la source</button>
      </div>
    </section>
    <p v-else-if="job.userEditsAt" class="info small">
      <Icon name="edit" :size="16" />
      <span>Infos corrigées à la main {{ timeAgo(job.userEditsAt) }} : le score les utilise.</span>
    </p>

    <p v-if="alreadyKnown" class="info small">
      <Icon name="info" :size="16" />
      <span>Cette offre est déjà dans ton Job Radar : la voici, sans nouvelle analyse.</span>
    </p>
    <p v-if="completedByPage" class="info small">
      <Icon name="info" :size="16" />
      <span>L'annonce était incomplète : elle a été remplacée par le texte de la page, et l'IA l'a relue.</span>
    </p>

    <p v-if="actionError" class="alert" role="alert"><Icon name="alert" :size="16" />{{ actionError }}</p>
    <div v-if="applyWarnings.length" class="alert" role="status">
      <Icon name="alert" :size="16" />
      <span>
        <strong>Avant de postuler :</strong>
        <template v-for="w in applyWarnings" :key="w"><br />{{ w }}</template>
      </span>
    </div>
    <div v-if="job.appliedTwins.length && job.status !== 'APPLIED'" class="alert twin" role="status">
      <Icon name="alert" :size="16" />
      <span>
        Tu as déjà postulé à cette offre, vue sur un autre site :
        <template v-for="(t, n) in job.appliedTwins" :key="t.id">
          <template v-if="n">, </template>
          <RouterLink :to="`/offres/${t.id}`">« {{ t.title }} »</RouterLink> le {{ frDate(t.appliedAt) }} ({{ t.sources.join(", ") }})
        </template>.
        <template v-if="applying"><br /><strong>Si c'est bien une autre candidature, valide avec « Oui, postuler quand même ».</strong></template>
      </span>
    </div>
    <section class="card actions">
      <a v-for="l in links" :key="l.url" class="btn primary" :href="l.safe!" target="_blank" rel="noopener noreferrer">
        <SourceLogo :source="l.source" :size="22" /> Voir l'offre sur {{ linkLabel(l.source, l.url) }}
        <Icon name="external" :size="15" />
      </a>
      <span class="sep" />
      <button type="button" :disabled="busy || job.status === 'SAVED'" @click="setStatus('SAVED')"><Icon name="bookmark" :size="16" />Sauvegarder</button>
      <button type="button" :disabled="busy || job.status === 'APPLIED'" @click="applying = true"><Icon name="send" :size="16" />Marquer comme postulé</button>
      <button type="button" class="danger" :disabled="busy || job.status === 'IGNORED'" @click="openNotForMe"><Icon name="eyeOff" :size="16" />Pas pour moi</button>
      <button v-if="job.status !== 'SEEN'" type="button" class="ghost" :disabled="busy" @click="setStatus('SEEN')"><Icon name="undo" :size="16" />Remettre à « vue »</button>
      <button type="button" class="ghost" :disabled="busy" title="Copie tout (id, description, score, avis IA) pour signaler un souci à Claude" @click="copyAll">
        <Icon :name="copiedAll ? 'check' : 'file'" :size="16" />{{ copiedAll ? "Copiée !" : "Copier l'offre" }}
      </button>
    </section>

    <section v-if="applying && job.status !== 'APPLIED'" class="card apply">
      <h2><Icon name="send" :size="17" />Ta candidature</h2>
      <p class="muted small">Pour suivre ce qui marche : par où tu l'as envoyée, et avec quel CV.</p>
      <ApplyInfoForm
        :need-contract="!job.contractType"
        :busy="busy"
        :submit-label="job.appliedTwins.length ? 'Oui, postuler quand même' : 'Enregistrer la candidature'"
        @submit="markApplied"
        @cancel="applying = false"
      />
    </section>

    <section v-if="notForMe" class="card not-for-me">
      <h2><Icon name="eyeOff" :size="17" />Pourquoi ce n'est pas pour toi ?</h2>
      <label class="choice"><input v-model="nfmReason" type="radio" value="stack" />Je ne maîtrise pas la stack principale</label>
      <div v-if="nfmReason === 'stack'" class="sub">
        <span v-if="!job.missingSkills.length" class="muted small">Aucune techno manquante détectée : choisis « Le métier ne correspond pas » et écris le mot du titre.</span>
        <button v-for="s in job.missingSkills" :key="s" type="button" class="chip" :class="{ on: nfmSkills.includes(s) }" @click="toggleSkill(s)">{{ s }}</button>
      </div>
      <label class="choice"><input v-model="nfmReason" type="radio" value="role" />Le métier ne correspond pas à ce que je fais</label>
      <div v-if="nfmReason === 'role'" class="sub">
        <input v-model="nfmWord" type="text" maxlength="80" placeholder="Mot du titre, ex. support, analyste, Windev" />
      </div>
      <label class="choice" :class="{ muted: !job.company }"><input v-model="nfmReason" type="radio" value="company" :disabled="!job.company" />L'entreprise {{ job.company ? `(${job.company})` : "(non précisée)" }}</label>
      <label class="choice"><input v-model="nfmReason" type="radio" value="other" />Autre raison (doublon, contexte…)</label>
      <label v-if="nfmReason !== 'other'" class="choice small"><input v-model="nfmRemember" type="checkbox" />Baisser aussi le score des prochaines offres similaires</label>
      <ul v-if="nfmRules.length" class="clean small muted">
        <li v-for="r in nfmRules" :key="r.kind + r.value">Règle ajoutée : {{ ruleLabel(r) }}</li>
      </ul>
      <div class="row">
        <button type="button" class="danger" :disabled="busy || (nfmReason === 'stack' && nfmRemember && !nfmSkills.length && job.missingSkills.length > 0)" @click="confirmNotForMe">
          <Icon name="eyeOff" :size="16" />Ignorer l'offre
        </button>
        <button type="button" class="ghost" :disabled="busy" @click="notForMe = false">Annuler</button>
      </div>
    </section>

    <p v-if="job.sources.some((s) => s.source === 'adzuna')" class="info small">
      <Icon name="info" :size="16" />
      <span>Offre fournie par <a href="https://www.adzuna.fr" target="_blank" rel="noopener noreferrer">Jobs by Adzuna</a>.</span>
    </p>

    <section v-if="job.abridged || completing" class="card complete">
      <div class="complete-head">
        <Icon name="alert" :size="18" />
        <div class="stack" style="gap: 0.2rem">
          <strong v-if="!job.description.trim()">Annonce non récupérée : la source n'a donné que le titre, pas la description.</strong>
          <strong v-else>Annonce incomplète : {{ job.sources.some((s) => s.source === "jooble") ? "Jooble" : "Adzuna" }} ne donne que le début du texte.</strong>
          <span class="muted small">
            Score approximatif, et l'IA ne le vérifie pas tant que l'annonce est incomplète.
            Le plus simple : « Voir l'offre », puis clique sur l'extension <strong>Envoyer à Job Radar</strong> → « Compléter l'offre existante ».
            Sinon : Ctrl + A, Ctrl + C sur l'annonce, et colle tout ici.
          </span>
        </div>
        <button v-if="!completing" type="button" class="primary" @click="completing = true"><Icon name="plus" :size="16" />Compléter l'annonce</button>
      </div>
      <template v-if="completing">
        <textarea v-model="fullText" rows="8" placeholder="Colle ici toute la page de l'annonce (Ctrl + V). Menus et « offres similaires » sont retirés tout seuls." />
        <p v-if="completeError" class="alert small"><Icon name="alert" :size="15" />{{ completeError }}</p>
        <div class="row">
          <button type="button" class="primary" :disabled="busy || fullText.trim().length < 50" @click="complete"><Icon name="check" :size="16" />Enregistrer l'annonce complète</button>
          <button type="button" class="ghost" :disabled="busy" @click="completing = false; completeError = null">Annuler</button>
        </div>
      </template>
    </section>
    <p v-else-if="job.fullTextAt" class="info small">
      <Icon name="check" :size="16" />
      <span>Annonce complète collée {{ timeAgo(job.fullTextAt) }} : le score et l'IA l'utilisent.
      <button type="button" class="link" :disabled="busy" @click="resetFull">Revenir à l'extrait</button></span>
    </p>
    <p v-if="job.travelMinutes === null && job.travelIssue" class="info small">
      <Icon name="train" :size="16" />
      <span>Trajet non calculé : {{ job.travelIssue }}.
      <RouterLink v-if="/point de départ|gare d'arrivée/.test(job.travelIssue)" to="/profil">Renseigner dans mon profil</RouterLink></span>
    </p>
    <p v-if="job.score.hidden" class="info"><Icon name="eyeOff" :size="16" />Masquée du flux principal : {{ job.score.hiddenReason }}.</p>

    <div class="layout">
      <div class="stack main">
        <AiAnalysisCard :key="`ai-${job.fullTextAt}`" :job-id="job.id" :to-learn="job.toLearn" :adequation="job.ai?.adequation ?? null" @analyzed="reloadJob" />

        <div class="grid-2">
          <section class="card">
            <h2><Icon name="check" :size="17" />Pourquoi ça correspond</h2>
            <p v-if="job.reasons.length === 0" class="muted small">Rien de particulier.</p>
            <ul class="clean reasons">
              <li v-for="r in job.reasons" :key="r">{{ r }}</li>
            </ul>
          </section>
          <section class="card">
            <h2><Icon name="alert" :size="17" />Points de vigilance</h2>
            <p v-if="job.warnings.length === 0" class="muted small">Aucun.</p>
            <ul class="clean warnings">
              <li v-for="w in job.warnings" :key="w">{{ w }}</li>
            </ul>
          </section>
        </div>

        <CoverLetterCard :key="`letter-${job.fullTextAt}`" :job-id="job.id" :title="job.title" :company="job.company" />
        <CvCard :key="`cv-${job.id}-${job.fullTextAt}`" :job-id="job.id" />

        <section class="card">
          <div class="desc-head">
            <h2><Icon name="file" :size="17" />Description</h2>
            <button v-if="!editingDesc" type="button" class="ghost small" @click="descText = job.description; descError = null; editingDesc = true">
              <Icon name="edit" :size="14" />Modifier
            </button>
          </div>
          <template v-if="editingDesc">
            <textarea v-model="descText" rows="18" class="desc-edit" placeholder="Complète ou corrige la description (ou colle toute l'annonce)." />
            <p class="muted small" style="margin: 0.4rem 0">Le score et l'IA utilisent ce texte. « Revenir à l'extrait » (en haut) rétablit la description de la source.</p>
            <p v-if="descError" class="alert small"><Icon name="alert" :size="15" />{{ descError }}</p>
            <div class="row" style="margin-bottom: 0.9rem">
              <button type="button" class="primary" :disabled="busy || descText.trim() === job.description.trim()" @click="saveDescription"><Icon name="check" :size="16" />Enregistrer</button>
              <button type="button" class="ghost" :disabled="busy" @click="editingDesc = false">Annuler</button>
            </div>
          </template>
          <p v-else-if="job.description.trim()" class="description">{{ job.description }}</p>
          <p v-else class="muted">Aucune description récupérée par la source : clique sur « Modifier » pour la coller.</p>
          <p class="muted small" style="margin: 0">Règles de score : version {{ job.rulesVersion }}</p>
        </section>
      </div>

      <aside class="stack side">
        <section class="card">
          <h2><Icon name="target" :size="17" />Détail du score</h2>
          <ol class="steps small">
            <li v-for="(st, i) in job.scoreSteps" :key="i" :class="st.kind">
              <span>{{ st.label }}<Icon v-if="st.kind === 'base' && job.aiSkills" name="sparkle" :size="11" class="ai-mark" /></span>
              <strong class="num" :class="st.kind === 'adjust' ? (st.value > 0 ? 'plus' : 'minus') : ''">
                {{ st.kind === "adjust" ? (st.value > 0 ? `+${st.value}` : `−${-st.value}`) : st.kind === "base" ? st.value : `${st.value} %` }}
              </strong>
            </li>
          </ol>
          <p class="muted small" style="margin: 0.5rem 0 0">
            Technique : la stack du titre compte triple ; une techno à apprendre (junior, formation) compte à moitié.
            <RouterLink to="/profil">Mes règles bonus/malus</RouterLink>
          </p>
          <p v-if="job.aiSkills || job.ai" class="muted small ai-note"><Icon name="sparkle" :size="12" /> Critères ajustés avec la lecture de l'IA.</p>
        </section>

        <section class="card">
          <h2><Icon name="code" :size="17" />Compétences</h2>
          <div v-if="job.matchedSkills.length" class="stack" style="gap: 0.4rem; margin-bottom: 0.9rem">
            <span class="muted small">Tu as :</span>
            <div class="row"><span v-for="s in job.matchedSkills" :key="s" class="chip good">{{ s }}</span></div>
          </div>
          <span class="muted small">Absentes de ton profil :</span>
          <p v-if="job.missingSkills.length === 0" class="muted small">Aucune : tu as toutes les compétences détectées.</p>
          <template v-else>
            <div class="row" style="margin-top: 0.4rem">
              <span v-for="s in job.missingSkills" :key="s" class="chip missing">
                {{ s }}
                <button type="button" :disabled="busy" :title="`J'ai ${s}`" @click="addSkill(s)">+ je l'ai</button>
                <span v-if="job.toLearn.includes(s)" class="muted">à apprendre</span>
                <button v-else type="button" :disabled="busy" :title="`Je peux apprendre ${s} vite`" @click="addLearnable(s)">+ je peux l'apprendre</button>
              </span>
            </div>
            <p class="muted small">Si tu les maîtrises, ajoute-les à ton profil et mets-les en avant dans ton CV et ta lettre.</p>
          </template>
          <p v-if="added.length" class="success small"><Icon name="check" :size="15" />Ajouté au profil : {{ added.join(", ") }}</p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--muted); font-weight: 550; margin-bottom: 1rem; }
.back:hover { color: var(--accent); text-decoration: none; }
.hero { display: flex; justify-content: space-between; align-items: center; gap: 1.5rem; padding: 1.4rem 1.5rem; }
.hero-side { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; flex-shrink: 0; }
.edit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0.7rem; }
.edit-grid label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; font-weight: 550; }
.edit-grid .wide { grid-column: 1 / -1; }
.hero h1 { font-size: 1.55rem; }
.company { display: flex; flex-wrap: wrap; gap: 0.35rem 1.2rem; }
.company span, .company a { display: inline-flex; align-items: center; gap: 0.4rem; }
.company a { color: inherit; }
.facts { margin-top: 0.2rem; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.8rem 1rem; }
.actions .sep { flex: 1; }
.actions .btn.primary { padding-left: 0.55rem; }
.actions .btn.primary :deep(.source-logo) { border-color: transparent; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 1rem; align-items: start; }
.side { position: sticky; top: 1rem; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
.steps li { display: flex; justify-content: space-between; gap: 0.6rem; color: var(--muted); }
.steps li.base { color: var(--text); }
.steps li.total { color: var(--text); font-weight: 600; border-top: 1px dashed var(--border); padding-top: 0.45rem; margin-top: 0.2rem; }
.steps .plus { color: var(--good); }
.steps .minus { color: var(--low); }
.not-for-me { display: flex; flex-direction: column; gap: 0.7rem; border-color: var(--low); }
.not-for-me label.choice { display: flex; align-items: center; gap: 0.5rem; font-weight: 550; }
.not-for-me .sub { margin-left: 1.6rem; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
.not-for-me .chip { cursor: pointer; }
.not-for-me .chip.on { border-color: var(--low); color: var(--low); }
.ai-mark { margin-left: 0.3rem; color: var(--accent); vertical-align: -1px; }
.ai-note { display: flex; align-items: center; gap: 0.3rem; margin: 0.5rem 0 0; }
.desc-head { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; }
.desc-edit { width: 100%; line-height: 1.6; }
.description { white-space: pre-wrap; margin: 0 0 0.9rem; line-height: 1.65; }
.complete { display: flex; flex-direction: column; gap: 0.8rem; border-color: var(--mid); }
.complete-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.7rem; color: var(--mid); }
.complete-head strong { color: var(--text); }
.complete-head .stack { flex: 1 1 320px; }
.complete-head button { margin-left: auto; flex-shrink: 0; }
.complete textarea { width: 100%; }
button.link { background: none; border: 0; padding: 0; min-height: 0; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; }
@media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } .side { position: static; } }
/* Téléphone : score à droite du titre, actions en grille de 2. */
@media (max-width: 600px) {
  .back { margin-bottom: 0.5rem; }
  .hero { display: block; position: relative; padding: 0.85rem; }
  .hero > .stack > :first-child, .hero h1 { padding-right: 4.6rem; }
  .hero h1 { font-size: 1.2rem; }
  .hero-side { position: absolute; top: 0.85rem; right: 0.85rem; flex-direction: row; align-items: flex-start; gap: 0; }
  .hero-side :deep(.ring) { --size: 60px; }
  .hero-side :deep(.ring)::before { inset: 5px; }
  /* « Modifier les infos » réduit à son crayon, collé à l'anneau. */
  .hero-side button { position: absolute; top: 3.4rem; right: -0.35rem; font-size: 0; gap: 0; padding: 0.3rem; min-height: 0; }
  .company { font-size: 0.88rem; gap: 0.2rem 0.9rem; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.45rem; padding: 0.6rem; }
  .actions .btn.primary { grid-column: 1 / -1; }
  .actions .sep { display: none; }
  .actions button { font-size: 0.84rem; padding: 0.35rem 0.5rem; line-height: 1.2; }
  .description { font-size: 0.92rem; line-height: 1.55; }
}
</style>

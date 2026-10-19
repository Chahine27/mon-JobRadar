<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ApiError, api, errorMessage } from "../api";
import type { LetterState } from "../types";
import Icon from "./Icon.vue";

/** Carte « Lettre de motivation » d'une offre : écrite par l'IA, à relire et modifier. */
const props = defineProps<{ jobId: string; title: string; company: string | null }>();

const state = ref<LetterState | null>(null);
const draft = ref("");
const loading = ref(true);
const running = ref(false);
const saving = ref(false);
const seconds = ref(0);
const error = ref<string | null>(null);
const offline = ref(false);
const copied = ref(false);
const pdfSaved = ref<string | null>(null);
const pdfSaving = ref(false);
const confirmRedo = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

function apply(s: LetterState) {
  state.value = s;
  draft.value = s.letter?.content ?? "";
}

/** La zone de texte grandit avec la lettre : toute la lettre est visible, sans barre de défilement. */
const box = ref<HTMLTextAreaElement | null>(null);
function fit() {
  const el = box.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 4}px`;
}
watch(draft, () => nextTick(fit));
watch(box, () => nextTick(fit));

onMounted(async () => {
  try {
    apply(await api.getLetter(props.jobId));
  } catch {
    error.value = "Impossible de charger la lettre.";
  } finally {
    loading.value = false;
  }
});
onUnmounted(() => clearInterval(timer));

const dirty = computed(() => !!state.value?.letter && draft.value !== state.value.letter.content);

async function write(force: boolean) {
  if (force && (dirty.value || state.value?.letter?.edited) && !confirmRedo.value) {
    confirmRedo.value = true;
    return;
  }
  confirmRedo.value = false;
  running.value = true;
  error.value = null;
  offline.value = false;
  seconds.value = 0;
  timer = setInterval(() => seconds.value++, 1000);
  try {
    apply(await api.writeLetter(props.jobId, force));
  } catch (e) {
    if (e instanceof ApiError && e.code === "AI_UNAVAILABLE") offline.value = true;
    error.value = errorMessage(e, "L'écriture de la lettre a échoué.");
  } finally {
    clearInterval(timer);
    running.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = null;
  try {
    apply(await api.editLetter(props.jobId, draft.value));
  } catch {
    error.value = "Enregistrement impossible.";
  } finally {
    saving.value = false;
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(draft.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    error.value = "Copie impossible : sélectionne le texte et fais Ctrl + C.";
  }
}

/** PDF créé par le serveur, téléchargé par le navigateur (dossier Téléchargements). */
async function savePdf() {
  pdfSaving.value = true;
  pdfSaved.value = null;
  error.value = null;
  try {
    pdfSaved.value = await api.downloadLetterPdf(props.jobId, draft.value);
    setTimeout(() => (pdfSaved.value = null), 8000);
  } catch (e) {
    error.value = errorMessage(e, "Création du PDF impossible.");
  } finally {
    pdfSaving.value = false;
  }
}


const when = computed(() =>
  state.value?.letter ? new Date(state.value.letter.updatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "",
);
</script>

<template>
  <section class="card letter">
    <div class="head">
      <h2><Icon name="mail" :size="17" />Lettre de motivation</h2>
      <span v-if="state?.letter?.edited" class="chip">Modifiée par toi</span>
    </div>

    <div v-if="loading" class="skeleton" style="height: 60px" />

    <div v-else-if="running" class="waiting">
      <Icon name="refresh" :size="18" class="spin" />
      <span>L'IA écrit ta lettre… <span class="num">{{ seconds }} s</span></span>
      <span class="muted small">Ça prend en général entre 20 secondes et 1 minute.</span>
    </div>

    <template v-else>
      <div v-if="error" class="alert small">
        <Icon name="alert" :size="16" />
        <span>
          {{ error }}
          <template v-if="offline"><br />L'IA ne répond pas pour l'instant : réessaie dans un moment.</template>
        </span>
      </div>

      <div v-if="state && !state.kitReady && !state.letter" class="empty">
        <p class="muted small">Pour écrire une lettre adaptée à cette offre, l'IA a besoin de ton CV (et si possible d'une lettre que tu as déjà écrite).</p>
        <RouterLink to="/candidature" class="btn primary"><Icon name="file" :size="16" />Coller mon CV</RouterLink>
      </div>

      <div v-else-if="state && !state.letter" class="empty">
        <p class="muted small">
          L'IA écrit une lettre pour CETTE offre à partir de ton CV, dans le style de ta lettre exemple. Tu la relis, tu la modifies ici,
          puis tu la copies ou tu l'enregistres en PDF.
        </p>
        <button type="button" class="primary" @click="write(false)"><Icon name="sparkle" :size="16" />Écrire la lettre avec l'IA</button>
      </div>

      <div v-else-if="state?.letter" class="result">
        <p v-if="!state.upToDate" class="info small">
          <Icon name="info" :size="15" />
          <span>Ton CV, ta lettre exemple ou l'annonce a changé depuis cette lettre.</span>
        </p>

        <div v-if="state.warnings.length" class="warn-box small">
          <strong><Icon name="alert" :size="15" />À vérifier avant d'envoyer</strong>
          <ul class="clean"><li v-for="w in state.warnings" :key="w">{{ w }}</li></ul>
        </div>

        <textarea ref="box" v-model="draft" rows="12" spellcheck="true" lang="fr" aria-label="Texte de la lettre" />

        <div class="row buttons">
          <button type="button" class="primary" @click="copy"><Icon :name="copied ? 'check' : 'file'" :size="16" />{{ copied ? "Copiée !" : "Copier" }}</button>
          <button type="button" :disabled="pdfSaving" @click="savePdf">
            <Icon :name="pdfSaved ? 'check' : 'save'" :size="16" />{{ pdfSaving ? "Création…" : pdfSaved ? "PDF téléchargé !" : "Télécharger en PDF" }}
          </button>
          <button v-if="dirty" type="button" :disabled="saving" @click="save"><Icon name="check" :size="16" />Enregistrer mes modifications</button>
          <span class="sep" />
          <button type="button" :class="confirmRedo ? 'danger' : 'ghost'" @click="write(true)">
            <Icon name="refresh" :size="15" />{{ confirmRedo ? "Sûr ? Tes modifications seront perdues" : "Réécrire" }}
          </button>
          <button v-if="confirmRedo" type="button" class="ghost" @click="confirmRedo = false">Annuler</button>
        </div>

        <p v-if="pdfSaved" class="success small" role="status"><Icon name="check" :size="15" />{{ pdfSaved }} est dans tes téléchargements.</p>

        <p class="muted small foot">
          {{ state.letter.edited ? "Modifiée" : "Écrite" }} le {{ when }} · IA {{ state.letter.model }}.
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.letter { display: flex; flex-direction: column; gap: 0.9rem; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.head h2 { margin: 0; }
.waiting { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.6rem; color: var(--accent); font-weight: 550; }
.waiting .muted { flex-basis: 100%; font-weight: 400; }
.empty { display: flex; flex-direction: column; align-items: flex-start; gap: 0.6rem; }
.empty p { margin: 0; }
.result { display: flex; flex-direction: column; gap: 0.8rem; }
textarea { width: 100%; font-family: inherit; font-size: 0.93rem; line-height: 1.6; resize: vertical; overflow: hidden; }
.buttons { gap: 0.5rem; }
.buttons .sep { flex: 1; }
.warn-box { background: var(--mid-bg); color: var(--text); border-radius: 10px; padding: 0.7rem 0.9rem; display: flex; flex-direction: column; gap: 0.35rem; }
.warn-box strong { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--mid); }
.warn-box li { padding-left: 0.9rem; position: relative; }
.warn-box li::before { content: "•"; position: absolute; left: 0.1rem; color: var(--mid); }
.foot { margin: 0; }
</style>

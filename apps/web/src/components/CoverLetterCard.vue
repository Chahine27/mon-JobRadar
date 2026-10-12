<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ApiError, api } from "../api";
import type { LetterState } from "../types";
import Icon from "./Icon.vue";

/** Carte « Lettre de motivation » d'une offre : écrite par l'IA sur le PC, à relire et modifier. */
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
    error.value = e instanceof ApiError ? e.message : "L'écriture de la lettre a échoué.";
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

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** PDF enregistré directement dans le dossier choisi (« CV & lettre »), en remplaçant l'ancien. Sinon : fenêtre d'impression. */
async function savePdf() {
  pdfSaving.value = true;
  pdfSaved.value = null;
  error.value = null;
  try {
    pdfSaved.value = (await api.saveLetterPdf(props.jobId, draft.value)).file;
    setTimeout(() => (pdfSaved.value = null), 8000);
  } catch (e) {
    if (e instanceof ApiError && e.code === "PDF_FOLDER_MISSING") printPdf();
    else error.value = e instanceof ApiError ? e.message : "Enregistrement du PDF impossible.";
  } finally {
    pdfSaving.value = false;
  }
}

/** Fenêtre d'impression : choisir « Enregistrer au format PDF ». Marges de page à 0 = pas d'en-tête ni de pied de page du navigateur. */
function printPdf() {
  const blocks = draft.value
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const cls = /^(À .+, )?le \d{2}\/\d{2}\/\d{4}$/i.test(b) ? ' class="date"' : /^Objet\s*:/i.test(b) ? ' class="objet"' : "";
      return `<p${cls}>${esc(b).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
  const name = `Lettre de motivation - ${props.company ?? props.title}`.replace(/[\\/:*?"<>|]/g, " ");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(name)}</title><style>
    @page { size: A4; margin: 0; }
    body { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #111; margin: 0; padding: 2cm 2.2cm; }
    p { margin: 0 0 0.85em; text-align: justify; }
    p:first-child { text-align: left; }
    .date { text-align: right; margin: 1.4em 0; }
    .objet { font-weight: bold; text-align: left; margin-bottom: 1.4em; }
  </style></head><body>${blocks}</body></html>`;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  // Le titre de la page principale sert aussi de nom de fichier dans certains navigateurs.
  const previous = document.title;
  document.title = name;
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    document.title = previous;
    setTimeout(() => frame.remove(), 1000);
  }, 100);
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
      <span>L'IA écrit ta lettre sur ton PC… <span class="num">{{ seconds }} s</span></span>
      <span class="muted small">Ça prend en général entre 20 secondes et 1 minute.</span>
    </div>

    <template v-else>
      <div v-if="error" class="alert small">
        <Icon name="alert" :size="16" />
        <span>
          {{ error }}
          <template v-if="offline"><br />Ouvre l'appli Ollama (icône en bas à droite de Windows), puis réessaie.</template>
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
            <Icon :name="pdfSaved ? 'check' : 'save'" :size="16" />{{ pdfSaving ? "Enregistrement…" : pdfSaved ? "PDF enregistré !" : "Enregistrer en PDF" }}
          </button>
          <button v-if="dirty" type="button" :disabled="saving" @click="save"><Icon name="check" :size="16" />Enregistrer mes modifications</button>
          <span class="sep" />
          <button type="button" :class="confirmRedo ? 'danger' : 'ghost'" @click="write(true)">
            <Icon name="refresh" :size="15" />{{ confirmRedo ? "Sûr ? Tes modifications seront perdues" : "Réécrire" }}
          </button>
          <button v-if="confirmRedo" type="button" class="ghost" @click="confirmRedo = false">Annuler</button>
        </div>

        <p v-if="pdfSaved" class="success small" role="status"><Icon name="check" :size="15" />Enregistré dans {{ pdfSaved }}</p>

        <p class="muted small foot">
          {{ state.letter.edited ? "Modifiée" : "Écrite" }} le {{ when }} · IA {{ state.letter.model }} sur ton PC.
          Le PDF va dans le dossier choisi dans « CV & lettre » (sinon, choisis « Enregistrer au format PDF » comme imprimante).
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

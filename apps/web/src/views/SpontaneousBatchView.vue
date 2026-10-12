<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { goBack } from "../router";
import { ApiError, api } from "../api";
import Icon, { type IconName } from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import type { SpontaneousApplicationState, SpontaneousBatchState } from "../types";

/**
 * Candidatures spontanées préparées en lot : l'IA écrit les lettres des entreprises « À contacter » qui ont un email,
 * tu les relis ici puis tu envoies (une par une ou la sélection). Rien ne part sans ton clic.
 */
type WriteStatus = SpontaneousBatchState["batch"]["steps"][number]["status"];
type SendStep = { id: string; name: string; to: string; status: "waiting" | "sending" | "sent" | "failed"; error: string | null };

const state = ref<SpontaneousBatchState | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const selected = ref<Set<string>>(new Set());
const confirmSend = ref(false);
const sendSteps = ref<SendStep[]>([]);
const sendingAll = ref(false);
/** Secondes avant le mail suivant (envoi groupé espacé). */
const nextIn = ref(0);
let poll: ReturnType<typeof setTimeout> | undefined;

// Horloge pour le chrono de la lettre en cours d'écriture.
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 1000);
const writingSince = new Map<string, number>();

async function load() {
  clearTimeout(poll);
  try {
    state.value = await api.getApplicationBatch();
    error.value = null;
    for (const s of state.value.batch.steps) if (s.status === "writing" && !writingSince.has(s.leadId)) writingSince.set(s.leadId, Date.now());
  } catch {
    error.value = "Impossible de charger les candidatures.";
  } finally {
    loading.value = false;
  }
  // Lettres en cours d'écriture : la liste se complète toute seule.
  if (state.value?.batch.running) poll = setTimeout(load, 2000);
}
onMounted(load);
onUnmounted(() => {
  clearTimeout(poll);
  clearInterval(clock);
});

async function prepare() {
  error.value = null;
  try {
    await api.prepareApplicationBatch();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "Préparation impossible.";
  }
  await load();
}

const batch = computed(() => state.value?.batch ?? null);
const writeProgress = computed(() => {
  const steps = batch.value?.steps ?? [];
  const finished = steps.filter((s) => s.status !== "waiting" && s.status !== "writing").length;
  return steps.length ? Math.round((finished / steps.length) * 100) : 0;
});
const elapsed = (leadId: string) => Math.max(0, Math.round((now.value - (writingSince.get(leadId) ?? now.value)) / 1000));
const WRITE_LABEL: Record<WriteStatus, string> = {
  waiting: "En attente",
  writing: "L'IA écrit la lettre…",
  done: "Lettre prête",
  failed: "Échec",
  stopped: "Non écrite (IA arrêtée)",
};

const sentIds = computed(() => new Set(sendSteps.value.filter((s) => s.status === "sent").map((s) => s.id)));
const canSend = computed(() => !!state.value && state.value.mail.configured && state.value.cvPdf.found);
const items = computed(() => (state.value?.items ?? []).filter((i) => !sentIds.value.has(i.lead.id)));
const allSelected = computed(() => items.value.length > 0 && items.value.every((i) => selected.value.has(i.lead.id)));
function toggleAll() {
  selected.value = new Set(allSelected.value ? [] : items.value.map((i) => i.lead.id));
}
function toggle(id: string) {
  const s = new Set(selected.value);
  if (!s.delete(id)) s.add(id);
  selected.value = s;
}

async function deliver(i: SpontaneousApplicationState, step: SendStep) {
  step.status = "sending";
  try {
    await api.sendApplication(i.lead.id, {
      to: i.lead.contactEmail!,
      subject: i.defaults.subject,
      message: i.defaults.message,
      letter: i.application!.letter,
    });
    step.status = "sent";
    selected.value.delete(i.lead.id);
  } catch (e) {
    step.status = "failed";
    step.error = e instanceof ApiError ? e.message : "L'email n'est pas parti.";
  }
}

const stepOf = (i: SpontaneousApplicationState): SendStep => ({ id: i.lead.id, name: i.lead.name, to: i.lead.contactEmail ?? "", status: "waiting", error: null });

async function sendOne(i: SpontaneousApplicationState) {
  const step = stepOf(i);
  sendSteps.value = [...sendSteps.value.filter((s) => s.id !== i.lead.id), step];
  await deliver(i, sendSteps.value.at(-1)!);
}

/** Envoi de la sélection dans l'ordre, une toutes les 7 s : sous la limite du serveur (10/min) et sans rafale vers Gmail. */
async function sendSelected() {
  if (!confirmSend.value) {
    confirmSend.value = true;
    return;
  }
  confirmSend.value = false;
  const todo = items.value.filter((i) => selected.value.has(i.lead.id));
  sendSteps.value = todo.map(stepOf);
  sendingAll.value = true;
  try {
    for (const [n, i] of todo.entries()) {
      if (n > 0) {
        for (nextIn.value = 7; nextIn.value > 0; nextIn.value--) await new Promise((r) => setTimeout(r, 1000));
      }
      await deliver(i, sendSteps.value[n]!);
    }
  } finally {
    sendingAll.value = false;
    nextIn.value = 0;
  }
}

const sendDone = computed(() => sendSteps.value.filter((s) => s.status === "sent" || s.status === "failed").length);
const SEND_LABEL: Record<SendStep["status"], string> = { waiting: "En attente", sending: "Envoi…", sent: "Envoyée", failed: "Échec" };
const ICON: Record<WriteStatus | SendStep["status"], IconName> = {
  waiting: "clock",
  writing: "refresh",
  sending: "refresh",
  done: "check",
  sent: "check",
  failed: "alert",
  stopped: "power",
};
</script>

<template>
  <PageHeader title="Candidatures en lot" subtitle="Entreprises « À contacter » avec un email : l'IA écrit les lettres, tu relis et tu envoies.">
    <template #actions>
      <RouterLink to="/entreprises" class="btn ghost" @click.prevent="goBack('/entreprises')"><Icon name="undo" :size="16" />Retour</RouterLink>
    </template>
  </PageHeader>

  <div v-if="loading" class="stack"><div class="skeleton" style="height: 120px" /></div>

  <div v-else-if="state && batch" class="stack">
    <p v-if="error" class="alert" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>
    <p v-if="!state.mail.configured" class="alert small"><Icon name="alert" :size="15" />Envoi d'email non configuré : SMTP à remplir dans .env.</p>
    <p v-if="!state.cvPdf.found" class="alert small"><Icon name="alert" :size="15" />CV PDF introuvable : indique son chemin dans « CV & lettre ».</p>

    <!-- Étape 1 : écriture des lettres -->
    <section class="card stack">
      <div class="head">
        <h2><span class="step">1</span>Écrire les lettres</h2>
        <template v-if="!batch.running">
          <RouterLink v-if="!state.kitReady" to="/candidature" class="btn primary"><Icon name="file" :size="16" />Coller mon CV d'abord</RouterLink>
          <button v-else-if="state.toWrite" type="button" class="primary" :disabled="!state.enabled" @click="prepare">
            <Icon name="sparkle" :size="16" />Écrire {{ state.toWrite }} lettre(s)
          </button>
        </template>
      </div>
      <p class="muted small">
        <template v-if="batch.running">L'IA écrit les lettres sur ton PC, une par une. Tu peux quitter la page : une notification te prévient à la fin.</template>
        <template v-else-if="state.toWrite">{{ state.toWrite }} entreprise(s) avec email n'ont pas encore de lettre. Une lettre déjà écrite (ou modifiée par toi) n'est jamais réécrite.</template>
        <template v-else>Toutes les entreprises avec email ont leur lettre.</template>
      </p>
      <p v-if="batch.error && !batch.running" class="alert small"><Icon name="alert" :size="15" />{{ batch.error }}</p>

      <template v-if="batch.steps.length">
        <div class="progress" role="progressbar" :aria-valuenow="writeProgress" aria-valuemin="0" aria-valuemax="100">
          <span :style="{ width: `${writeProgress}%` }" />
        </div>
        <span class="muted small">{{ batch.done }} / {{ batch.total }} lettre(s) écrite(s)</span>
        <ol class="clean steps">
          <li v-for="s in batch.steps" :key="s.leadId" :class="s.status">
            <Icon :name="ICON[s.status]" :size="16" :class="{ spin: s.status === 'writing' }" />
            <span class="name">{{ s.name }}</span>
            <span class="status small">
              {{ WRITE_LABEL[s.status] }}<template v-if="s.status === 'writing'"> <span class="num">{{ elapsed(s.leadId) }} s</span></template>
            </span>
            <span v-if="s.error" class="err small">{{ s.error }}</span>
          </li>
        </ol>
      </template>
    </section>

    <!-- Étape 2 : relecture et envoi -->
    <section class="card stack">
      <div class="head">
        <h2><span class="step">2</span>Relire et envoyer</h2>
        <span class="muted small"><strong>{{ items.length }}</strong> prête(s)</span>
      </div>

      <template v-if="sendSteps.length">
        <div class="progress" role="progressbar">
          <span :style="{ width: `${Math.round((sendDone / sendSteps.length) * 100)}%` }" />
        </div>
        <span class="muted small">
          {{ sendDone }} / {{ sendSteps.length }} traitée(s)<template v-if="nextIn"> · mail suivant dans {{ nextIn }} s</template>
        </span>
        <ol class="clean steps">
          <li v-for="s in sendSteps" :key="s.id" :class="s.status">
            <Icon :name="ICON[s.status]" :size="16" :class="{ spin: s.status === 'sending' }" />
            <span class="name">{{ s.name }}</span>
            <span class="status small">{{ SEND_LABEL[s.status] }}<template v-if="s.status === 'sent'"> à {{ s.to }}</template></span>
            <span v-if="s.error" class="err small">{{ s.error }}</span>
          </li>
        </ol>
      </template>

      <div v-if="items.length" class="toolbar">
        <label class="switch small"><input type="checkbox" :checked="allSelected" :disabled="sendingAll" @change="toggleAll" /> Tout sélectionner</label>
        <span class="sep" />
        <button type="button" :class="confirmSend ? 'danger' : 'primary'" :disabled="!canSend || !selected.size || sendingAll" @click="sendSelected">
          <Icon name="send" :size="16" />
          {{ sendingAll ? "Envoi en cours…" : confirmSend ? `Oui, envoyer les ${selected.size} candidature(s)` : `Envoyer la sélection (${selected.size})` }}
        </button>
        <button v-if="confirmSend" type="button" class="ghost" @click="confirmSend = false">Annuler</button>
      </div>
      <p v-else-if="!sendSteps.length" class="muted small">Aucune lettre prête pour l'instant.</p>

      <article v-for="i in items" :key="i.lead.id" class="item stack">
        <div class="top">
          <label class="row pick">
            <input type="checkbox" :checked="selected.has(i.lead.id)" :disabled="sendingAll" @change="toggle(i.lead.id)" />
            <strong>{{ i.lead.name }}</strong>
            <span class="muted small">{{ i.lead.city ?? "" }}</span>
          </label>
          <span class="muted small"><Icon name="mail" :size="13" /> {{ i.lead.contactEmail }}</span>
        </div>
        <div v-if="i.warnings.length" class="warn-box small">
          <strong><Icon name="alert" :size="15" />À vérifier avant d'envoyer</strong>
          <ul class="clean"><li v-for="w in i.warnings" :key="w">{{ w }}</li></ul>
        </div>
        <details>
          <summary class="small">Lire la lettre</summary>
          <p class="letter">{{ i.application?.letter }}</p>
        </details>
        <div class="row buttons">
          <RouterLink :to="`/entreprises/${i.lead.id}/candidature`" class="btn ghost small"><Icon name="edit" :size="15" />Relire / modifier</RouterLink>
          <button type="button" class="small" :disabled="!canSend || sendingAll" @click="sendOne(i)"><Icon name="send" :size="15" />Envoyer</button>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
h2 { display: flex; align-items: center; gap: 0.55rem; margin: 0; }
.step { display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 0.8rem; }
.head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.6rem 1rem; }
.progress { height: 6px; border-radius: 99px; background: var(--border); overflow: hidden; }
.progress span { display: block; height: 100%; background: var(--accent); transition: width 0.4s ease; }
.steps { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.steps li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.2rem 0.6rem; padding: 0.55rem 0.8rem; }
.steps li + li { border-top: 1px solid var(--border); }
.steps .name { font-weight: 550; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.steps .err { grid-column: 2 / -1; color: var(--low); }
.steps .waiting, .steps .stopped { color: var(--muted, inherit); opacity: 0.7; }
.steps .writing, .steps .sending { color: var(--accent); background: var(--accent-soft); }
.steps .done, .steps .sent { color: var(--good, var(--accent)); }
.steps .failed { color: var(--low); }
.steps .name { color: var(--text); }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 1rem; padding-top: 0.2rem; }
.sep { flex: 1; }
.item { border-top: 1px solid var(--border); padding-top: 0.8rem; gap: 0.5rem; }
.top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.4rem 1rem; align-items: center; }
.pick { gap: 0.5rem; cursor: pointer; }
.letter { white-space: pre-wrap; font-size: 0.9rem; line-height: 1.55; margin: 0.6rem 0 0; }
.buttons { gap: 0.5rem; }
.warn-box { background: var(--mid-bg); color: var(--text); border-radius: 10px; padding: 0.7rem 0.9rem; display: flex; flex-direction: column; gap: 0.35rem; }
.warn-box strong { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--mid); }
@media (max-width: 600px) { .steps li { grid-template-columns: auto 1fr; } .steps .status { grid-column: 2; } }
</style>

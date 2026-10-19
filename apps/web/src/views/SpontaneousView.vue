<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { goBack } from "../router";
import { api, errorMessage } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import type { SpontaneousApplicationState } from "../types";

/** Candidature spontanée : lettre écrite par l'IA, relue et modifiée ici, puis envoyée par email avec le CV. Rien ne part sans le clic. */
const props = defineProps<{ id: string }>();

const state = ref<SpontaneousApplicationState | null>(null);
const title = ref("");
const letter = ref("");
const to = ref("");
const subject = ref("");
const message = ref("");
const loading = ref(true);
const running = ref(false);
const seconds = ref(0);
const saving = ref(false);
const sending = ref(false);
const confirmSend = ref(false);
const confirmRedo = ref(false);
const error = ref<string | null>(null);
const sentNow = ref(false);
/** Résultat de l'envoi : affiché à côté du bouton (en haut de page, il passait inaperçu). */
const sendError = ref<string | null>(null);
const result = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

function apply(s: SpontaneousApplicationState, resetMail = false) {
  state.value = s;
  letter.value = s.application?.letter ?? "";
  if (!title.value) title.value = s.title;
  if (resetMail || !to.value) to.value = s.lead.contactEmail ?? s.application?.sentTo ?? "";
  if (resetMail || !subject.value) subject.value = s.defaults.subject;
  if (resetMail || !message.value) message.value = s.defaults.message;
}

onMounted(async () => {
  try {
    apply(await api.getApplication(props.id), true);
  } catch {
    error.value = "Impossible de charger cette entreprise.";
  } finally {
    loading.value = false;
  }
});
onUnmounted(() => clearInterval(timer));

/** La zone de texte grandit avec la lettre. */
const box = ref<HTMLTextAreaElement | null>(null);
function fit() {
  const el = box.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 4}px`;
}
watch(letter, () => nextTick(fit));
watch(box, () => nextTick(fit));

const dirty = computed(() => !!state.value?.application && letter.value !== state.value.application.letter);
const emailOk = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.value.trim()));
const cvName = computed(() => state.value?.cvPdf.name ?? "");
const checks = computed(() => {
  const s = state.value;
  if (!s) return [];
  return [
    { ok: !!letter.value.trim(), text: "Lettre écrite et relue" },
    { ok: emailOk.value, text: "Email de contact de l'entreprise" },
    { ok: s.cvPdf.found, text: s.cvPdf.found ? `CV joint : ${cvName.value}` : "CV PDF : envoie-le dans « CV & lettre »" },
    { ok: s.mail.configured, text: s.mail.configured ? `Envoi depuis ${s.mail.from}` : "Envoi d'email : SMTP à remplir dans .env" },
  ];
});
const ready = computed(() => checks.value.every((c) => c.ok) && subject.value.trim().length > 2 && message.value.trim().length > 9);
const sentAt = computed(() => (state.value?.application?.sentAt ? new Date(state.value.application.sentAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : null));

async function write() {
  if ((dirty.value || state.value?.application?.edited) && !confirmRedo.value) {
    confirmRedo.value = true;
    return;
  }
  confirmRedo.value = false;
  running.value = true;
  error.value = null;
  seconds.value = 0;
  timer = setInterval(() => seconds.value++, 1000);
  try {
    apply(await api.writeApplicationLetter(props.id, title.value.trim() || state.value!.title));
  } catch (e) {
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
    apply(await api.editApplicationLetter(props.id, letter.value));
  } catch {
    error.value = "Enregistrement impossible.";
  } finally {
    saving.value = false;
  }
}

async function send() {
  if (!confirmSend.value) {
    confirmSend.value = true;
    return;
  }
  confirmSend.value = false;
  sending.value = true;
  error.value = null;
  sendError.value = null;
  try {
    apply(
      await api.sendApplication(props.id, {
        to: to.value.trim(),
        subject: subject.value.trim(),
        message: message.value.trim(),
        letter: letter.value.trim(),
        force: !!state.value?.application?.sentAt,
      }),
    );
    sentNow.value = true;
  } catch (e) {
    sendError.value = errorMessage(e, "L'email n'est pas parti.");
  } finally {
    sending.value = false;
    await nextTick();
    result.value?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
</script>

<template>
  <PageHeader
    title="Candidature spontanée"
    :subtitle="state ? `${state.lead.name} · ${state.lead.nafLabel ?? 'secteur inconnu'} · ${state.lead.city ?? ''}` : ''"
  >
    <template #actions>
      <RouterLink to="/entreprises" class="btn ghost" @click.prevent="goBack('/entreprises')"><Icon name="undo" :size="16" />Retour</RouterLink>
    </template>
  </PageHeader>

  <div v-if="loading" class="stack"><div class="skeleton" style="height: 120px" /><div class="skeleton" style="height: 320px" /></div>

  <div v-else-if="state" class="stack">
    <p v-if="error" class="alert" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>
    <p v-if="sentAt && !sentNow" class="info small"><Icon name="info" :size="15" />Déjà envoyée le {{ sentAt }} à {{ state.application?.sentTo }}.</p>

    <section class="card stack">
      <h2><span class="step">1</span>La lettre</h2>
      <label class="title">
        Poste proposé
        <input v-model="title" maxlength="120" placeholder="Développeur full stack" />
      </label>

      <div v-if="!state.kitReady" class="empty">
        <p class="muted small">L'IA a besoin de ton CV pour écrire la lettre.</p>
        <RouterLink to="/candidature" class="btn primary"><Icon name="file" :size="16" />Coller mon CV</RouterLink>
      </div>

      <div v-else-if="running" class="waiting">
        <Icon name="refresh" :size="18" class="spin" />
        <span>L'IA écrit ta lettre… <span class="num">{{ seconds }} s</span></span>
      </div>

      <div v-else-if="!state.application" class="empty">
        <p class="muted small">
          Il n'y a pas d'offre : l'IA ne connaît que le nom, le secteur, la ville et la taille de l'entreprise. Elle met en avant ton CV
          sans rien inventer sur eux.
        </p>
        <button type="button" class="primary" @click="write"><Icon name="sparkle" :size="16" />Écrire la lettre avec l'IA</button>
      </div>

      <template v-else>
        <p v-if="!state.upToDate" class="info small"><Icon name="info" :size="15" />Ton CV, tes règles ou le poste proposé ont changé depuis cette lettre.</p>
        <div v-if="state.warnings.length" class="warn-box small">
          <strong><Icon name="alert" :size="15" />À vérifier avant d'envoyer</strong>
          <ul class="clean"><li v-for="w in state.warnings" :key="w">{{ w }}</li></ul>
        </div>
        <textarea ref="box" v-model="letter" rows="14" spellcheck="true" lang="fr" aria-label="Texte de la lettre" />
        <div class="row buttons">
          <button v-if="dirty" type="button" :disabled="saving" @click="save"><Icon name="check" :size="16" />Enregistrer mes modifications</button>
          <span class="sep" />
          <button type="button" :class="confirmRedo ? 'danger' : 'ghost'" @click="write">
            <Icon name="refresh" :size="15" />{{ confirmRedo ? "Sûr ? Tes modifications seront perdues" : "Réécrire" }}
          </button>
          <button v-if="confirmRedo" type="button" class="ghost" @click="confirmRedo = false">Annuler</button>
        </div>
      </template>
    </section>

    <section class="card stack">
      <h2><span class="step">2</span>L'email</h2>
      <label>
        À
        <input v-model="to" type="email" maxlength="200" placeholder="contact@entreprise.fr" />
      </label>
      <label>
        Objet
        <input v-model="subject" maxlength="250" />
      </label>
      <label>
        Message
        <textarea v-model="message" rows="10" maxlength="5000" />
      </label>
      <div class="attach small">
        <strong>Pièces jointes</strong>
        <span><Icon name="file" :size="14" />{{ state.letterPdfName }} <span class="muted">(la lettre ci-dessus, en PDF)</span></span>
        <span :class="{ bad: !state.cvPdf.found }"><Icon name="file" :size="14" />{{ state.cvPdf.found ? cvName : "CV PDF introuvable" }}</span>
      </div>
    </section>

    <section class="card stack">
      <h2><span class="step">3</span>Envoyer</h2>
      <ul class="clean checks small">
        <li v-for="c in checks" :key="c.text" :class="c.ok ? 'ok' : 'ko'"><Icon :name="c.ok ? 'check' : 'alert'" :size="15" />{{ c.text }}</li>
      </ul>
      <div ref="result" class="stack" style="gap: 0.5rem">
        <p v-if="sendError" class="alert" role="alert"><Icon name="alert" :size="16" />{{ sendError }}</p>
        <p v-if="sentNow" class="success" role="status"><Icon name="check" :size="16" />Envoyée à {{ state.application?.sentTo }}. L'entreprise est passée en « Contactée ».</p>
      </div>
      <div v-if="sentNow" class="row buttons">
        <RouterLink to="/entreprises" class="btn primary" @click.prevent="goBack('/entreprises')"><Icon name="building" :size="16" />Retour aux entreprises</RouterLink>
      </div>
      <div v-else class="row buttons">
        <button type="button" :class="confirmSend ? 'danger' : 'primary'" :disabled="!ready || sending || running" @click="send">
          <Icon name="send" :size="16" />
          {{ sending ? "Envoi…" : confirmSend ? `Oui, envoyer à ${to.trim()}` : sentAt ? "Renvoyer" : "Envoyer la candidature" }}
        </button>
        <button v-if="confirmSend" type="button" class="ghost" @click="confirmSend = false">Annuler</button>
      </div>
      <p class="muted small">L'email part de ton adresse ; tu le retrouveras dans « Messages envoyés » de Gmail.</p>
    </section>
  </div>
</template>

<style scoped>
h2 { display: flex; align-items: center; gap: 0.55rem; margin: 0; }
.step { display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 0.8rem; }
.title { max-width: 26rem; }
.empty { display: flex; flex-direction: column; align-items: flex-start; gap: 0.6rem; }
.empty p { margin: 0; }
.waiting { display: flex; align-items: center; gap: 0.6rem; color: var(--accent); font-weight: 550; }
textarea { width: 100%; font-family: inherit; font-size: 0.93rem; line-height: 1.6; resize: vertical; font-weight: 400; color: var(--text); }
.buttons { gap: 0.5rem; }
.buttons .sep { flex: 1; }
.warn-box { background: var(--mid-bg); color: var(--text); border-radius: 10px; padding: 0.7rem 0.9rem; display: flex; flex-direction: column; gap: 0.35rem; }
.warn-box strong { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--mid); }
.warn-box li { padding-left: 0.9rem; position: relative; }
.warn-box li::before { content: "•"; position: absolute; left: 0.1rem; color: var(--mid); }
.attach { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 1.1rem; }
.attach span { display: inline-flex; align-items: center; gap: 0.35rem; }
.attach .bad { color: var(--low); }
.checks { display: flex; flex-direction: column; gap: 0.35rem; }
.checks li { display: flex; align-items: center; gap: 0.45rem; }
.checks .ok { color: var(--good, var(--accent)); }
.checks .ko { color: var(--low); }
</style>

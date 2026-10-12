<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ApiError, api } from "../api";
import type { StoredAiAnalysis } from "../types";
import Icon from "./Icon.vue";

/** Carte « Analyse IA » d'une offre : l'IA tourne sur le PC (Ollama), rien ne part sur Internet. */
const props = defineProps<{ jobId: string }>();
/** Nouvelle analyse faite : le score de l'offre a pu changer (l'IA baisse un score trop optimiste). */
const emit = defineEmits<{ analyzed: [] }>();

const stored = ref<StoredAiAnalysis | null>(null);
const upToDate = ref(true);
const loading = ref(true);
const running = ref(false);
const seconds = ref(0);
const lastDuration = ref<number | null>(null);
const error = ref<string | null>(null);
const offline = ref(false);
const mySkills = ref<string[]>([]);
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  try {
    const [a, p] = await Promise.all([api.getJobAnalysis(props.jobId), api.getProfile().catch(() => null)]);
    stored.value = a.analysis;
    upToDate.value = a.upToDate;
    mySkills.value = p?.profile.skills.map((s) => s.toLowerCase()) ?? [];
  } catch {
    // pas grave : on propose simplement de lancer l'analyse
  } finally {
    loading.value = false;
  }
});
onUnmounted(() => clearInterval(timer));

async function run(force: boolean) {
  running.value = true;
  error.value = null;
  offline.value = false;
  seconds.value = 0;
  timer = setInterval(() => seconds.value++, 1000);
  try {
    const res = await api.analyzeJob(props.jobId, force);
    stored.value = res.analysis;
    upToDate.value = true;
    emit("analyzed");
    lastDuration.value = res.durationMs !== undefined ? Math.round(res.durationMs / 1000) : null;
  } catch (e) {
    if (e instanceof ApiError && e.code === "AI_UNAVAILABLE") offline.value = true;
    error.value = e instanceof ApiError ? e.message : "L'analyse a échoué.";
  } finally {
    clearInterval(timer);
    running.value = false;
  }
}

const a = computed(() => stored.value?.result ?? null);
/** « Vue.js » = « vue » = « VueJS », mais « TanStack » ≠ « Stack » : on compare des mots entiers. */
const key = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.?js\b/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
const has = (skill: string) => {
  const s = key(skill);
  return mySkills.value.some((raw) => {
    const m = key(raw);
    if (!m || !s) return false;
    if (m === s) return true;
    const words = (x: string) => ` ${x} `;
    return (m.length >= 3 && words(s).includes(words(m))) || (s.length >= 3 && words(m).includes(words(s)));
  });
};
const NIVEAU: Record<string, string> = { junior: "Junior", confirme: "Confirmé", senior: "Senior", inconnu: "Niveau non précisé" };
const ADEQUATION: Record<string, { label: string; tone: string }> = {
  forte: { label: "Bonne adéquation", tone: "good" },
  moyenne: { label: "Adéquation moyenne", tone: "warn" },
  faible: { label: "Adéquation faible", tone: "bad" },
};
const when = computed(() =>
  stored.value ? new Date(stored.value.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "",
);
</script>

<template>
  <section class="card ai">
    <div class="head">
      <h2><Icon name="sparkle" :size="17" />Analyse IA</h2>
      <button v-if="a && !running" type="button" class="ghost small" @click="run(true)">
        <Icon name="refresh" :size="14" />Relancer
      </button>
    </div>

    <div v-if="loading" class="skeleton" style="height: 60px" />

    <div v-else-if="running" class="waiting">
      <Icon name="refresh" :size="18" class="spin" />
      <span>L'IA lit l'annonce sur ton PC… <span class="num">{{ seconds }} s</span></span>
      <span class="muted small">Ça prend en général entre 15 secondes et 1 minute.</span>
    </div>

    <template v-else>
      <div v-if="error" class="alert small">
        <Icon name="alert" :size="16" />
        <span>
          {{ error }}
          <template v-if="offline"><br />Ouvre l'appli Ollama (icône en bas à droite de Windows), puis réessaie.</template>
        </span>
      </div>

      <div v-if="!a" class="empty">
        <p class="muted small">
          L'IA lit l'annonce pour toi : ce qu'on attend vraiment, les compétences exigées et les « plus »,
          les pièges (ESN, niveau caché…). Tout se passe sur ton PC, rien n'est envoyé sur Internet.
        </p>
        <button type="button" class="primary" @click="run(false)"><Icon name="sparkle" :size="16" />Analyser avec l'IA</button>
      </div>

      <div v-else class="result">
        <p v-if="!upToDate" class="info small">
          <Icon name="info" :size="15" />
          <span>L'annonce ou ton profil a changé depuis cette analyse. <button type="button" class="link" @click="run(true)">La refaire</button></span>
        </p>

        <div class="row">
          <span class="chip" :class="ADEQUATION[a.adequation]?.tone">{{ ADEQUATION[a.adequation]?.label }}</span>
          <span class="chip">{{ NIVEAU[a.niveau] }}</span>
          <span v-if="a.experience_min_ans !== null" class="chip">{{ a.experience_min_ans }} an{{ a.experience_min_ans > 1 ? "s" : "" }} d'expérience min.</span>
          <span v-if="a.employeur === 'esn_ou_cabinet'" class="chip warn">ESN ou cabinet</span>
          <span v-else-if="a.employeur === 'direct'" class="chip">Employeur direct</span>
        </div>

        <p class="resume">{{ a.resume }}</p>
        <p class="avis"><strong>Avis :</strong> {{ a.avis }}</p>

        <div v-if="a.missions.length">
          <h3>Missions</h3>
          <ul class="clean list"><li v-for="m in a.missions" :key="m">{{ m }}</li></ul>
        </div>

        <div class="grid-2">
          <div>
            <h3>Compétences exigées</h3>
            <p v-if="!a.competences_obligatoires.length" class="muted small">Aucune précisée.</p>
            <div class="row">
              <span v-for="s in a.competences_obligatoires" :key="s" class="chip" :class="has(s) ? 'good' : 'missing'" :title="has(s) ? 'Dans ton profil' : 'Absente de ton profil'">{{ s }}</span>
            </div>
          </div>
          <div>
            <h3>Les « plus »</h3>
            <p v-if="!a.competences_bonus.length" class="muted small">Aucun.</p>
            <div class="row">
              <span v-for="s in a.competences_bonus" :key="s" class="chip" :class="has(s) ? 'good' : 'missing'">{{ s }}</span>
            </div>
          </div>
        </div>

        <div v-if="a.points_attention.length">
          <h3>Points d'attention</h3>
          <ul class="clean list warn-list"><li v-for="p in a.points_attention" :key="p">{{ p }}</li></ul>
        </div>

        <p class="muted small foot">
          Fait le {{ when }} par {{ stored!.model }} (sur ton PC)<template v-if="lastDuration !== null"> en {{ lastDuration }} s</template>.
          L'IA peut se tromper : vérifie sur l'annonce.
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.head h2 { margin: 0; }
.ai { display: flex; flex-direction: column; gap: 0.9rem; }
.waiting { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.6rem; color: var(--accent); font-weight: 550; }
.waiting .muted { flex-basis: 100%; font-weight: 400; }
.empty { display: flex; flex-direction: column; align-items: flex-start; gap: 0.6rem; }
.empty p { margin: 0; }
.result { display: flex; flex-direction: column; gap: 0.9rem; }
.result h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 0.45rem; }
.resume { margin: 0; line-height: 1.6; }
.avis { margin: 0; line-height: 1.55; }
.list { display: flex; flex-direction: column; gap: 0.3rem; }
.list li { padding-left: 1rem; position: relative; line-height: 1.5; }
.list li::before { content: "•"; position: absolute; left: 0.2rem; color: var(--accent); }
.warn-list li::before { color: var(--mid); }
.foot { margin: 0; }
button.link { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; min-height: 0; }
</style>

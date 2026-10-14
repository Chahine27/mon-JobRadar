<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ApiError, api, errorMessage } from "../api";
import type { CvMaster, CvOverrides, CvPicked, CvState, CvTemplateInfo, TemplateId } from "../types";
import Icon from "./Icon.vue";

/**
 * « CV pour cette offre » : choix des morceaux du CV complet par des règles fixes, expliqué, modifiable
 * (retirer, remettre, autre version, ordre), puis validé et exporté en PDF. Jamais de texte libre ici.
 */
const props = defineProps<{ jobId: string }>();

const templates = ref<CvTemplateInfo[]>([]);
const tab = ref<TemplateId>("une-colonne");
const state = ref<CvState | null>(null);
const master = ref<CvMaster | null>(null);
const skills = ref(new Map<string, string>());
const loading = ref(true);
const busy = ref<string | null>(null);
const error = ref<string | null>(null);
const exported = ref<string | null>(null);
const previewKey = ref(0);

const cv = computed(() => state.value?.cv ?? null);
const draft = computed(() => cv.value?.draft ?? null);
/** Aperçu : la page A4 (794 px de large) est réduite à la largeur disponible. */
const frameBox = ref<HTMLElement | null>(null);
const box = ref({ w: 397, h: 562 });
const observer = new ResizeObserver(([e]) => e && (box.value = { w: e.contentRect.width, h: e.contentRect.height }));
/** Grand écran (Échap pour sortir) : la page entière tient dans l'écran, centrée. */
const full = ref(false);
const onFullscreen = () => (full.value = document.fullscreenElement === frameBox.value);
document.addEventListener("fullscreenchange", onFullscreen);
onUnmounted(() => {
  observer.disconnect();
  document.removeEventListener("fullscreenchange", onFullscreen);
});
const toggleFull = () => (full.value ? document.exitFullscreen() : frameBox.value?.requestFullscreen());
const scale = computed(() => (full.value ? Math.min(box.value.w / 794, box.value.h / 1123) : box.value.w / 794));
const frameStyle = computed(() => ({
  transform: `scale(${scale.value})`,
  left: full.value ? `${(box.value.w - 794 * scale.value) / 2}px` : "0",
}));
const watchBox = (el: unknown) => {
  if (el instanceof HTMLElement && frameBox.value !== el) {
    frameBox.value = el;
    observer.observe(el);
  }
};
const label = (id: string) => skills.value.get(id) ?? id.replace(/^custom:/, "");

async function load() {
  error.value = null;
  try {
    state.value = await api.getJobCv(props.jobId, tab.value);
    previewKey.value++;
  } catch (e) {
    state.value = null;
    error.value = errorMessage(e, "Impossible de charger le CV adapté.");
  }
}

onMounted(async () => {
  try {
    const [t, sk, m] = await Promise.all([api.cvTemplates(), api.cvSkills(), api.getCvMaster()]);
    templates.value = t.templates;
    tab.value = t.templates.find((x) => x.role === "ats")?.id ?? "une-colonne";
    skills.value = new Map(sk.skills.map((s) => [s.id, s.label]));
    master.value = m.master;
    await load();
  } finally {
    loading.value = false;
  }
});

async function run(what: string, fn: () => Promise<unknown>) {
  busy.value = what;
  error.value = null;
  exported.value = null;
  try {
    await fn();
  } catch (e) {
    error.value = errorMessage(e, "L'opération a échoué.");
    if (e instanceof ApiError && e.code === "CHECKS_FAILED") await load();
  } finally {
    busy.value = null;
  }
}

const switchTab = (t: TemplateId) => {
  tab.value = t;
  void load();
};
const make = () => run("make", async () => ((state.value = await api.makeJobCv(props.jobId, tab.value)), previewKey.value++));

/** Applique un choix manuel (le CV est recalculé ; il faudra le valider à nouveau). */
function change(edit: (o: CvOverrides) => void) {
  const o = structuredClone(cv.value?.overrides ?? { add: [], remove: [], variants: {}, titleId: null, order: {} });
  edit(o);
  return run("change", async () => ((state.value = await api.saveJobCv(props.jobId, tab.value, o)), previewKey.value++));
}
const without = (xs: string[], id: string) => xs.filter((x) => x !== id);
const remove = (id: string) => change((o) => ((o.remove = [...without(o.remove, id), id]), (o.add = without(o.add, id))));
const putBack = (id: string) => change((o) => ((o.add = [...without(o.add, id), id]), (o.remove = without(o.remove, id))));
function move(container: string, ids: string[], id: string, dir: -1 | 1) {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= ids.length) return;
  const next = [...ids];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return change((o) => (o.order[container] = next));
}
const setVariant = (id: string, vid: string) => change((o) => (o.variants[id] = vid));
const setTitle = (tid: string) => change((o) => (o.titleId = tid || null));
const validate = () =>
  run("validate", async () => ((state.value = await api.saveJobCv(props.jobId, tab.value, cv.value!.overrides, true)), previewKey.value++));

async function exportPdf(both: boolean) {
  await run(both ? "both" : "pdf", async () => {
    const res = await api.exportJobCv(props.jobId, both ? templates.value.map((t) => t.id) : [tab.value]);
    exported.value = res.results.filter((r) => r.path).map((r) => r.path).join(" et ");
    await load();
  });
}
const openFolder = () => run("folder", () => api.openJobCvFolder(props.jobId));

/** Variantes validées d'une ligne ou d'un projet (pour « autre version »). */
function variantsOf(id: string) {
  const m = master.value;
  if (!m) return [];
  const list = m.experiences.flatMap((e) => e.bullets).find((b) => b.id === id)?.variants ?? m.projects.find((p) => p.id === id)?.descriptions ?? [];
  return list.filter((v) => !v.toValidate);
}
const titles = computed(() => master.value?.titles.filter((t) => !t.toValidate) ?? []);

const absentFromCv = computed(() => draft.value?.match?.missing.filter((s) => !draft.value!.match!.notShown.includes(s)) ?? []);
const pickedOf = (kind: CvPicked["kind"], id: string) => draft.value?.picked.find((p) => p.kind === kind && p.id === id);
const why = (p: CvPicked | undefined) =>
  p?.reasons.length
    ? p.reasons.map((r) => `${label(r.skillId)} (${r.points >= 5 ? "exigé" : r.points >= 4 ? "plus" : "cité"})`).join(", ")
    : p?.fill
      ? "place libre sur la page"
      : p?.rule === "always"
      ? "toujours affichée"
      : "pour atteindre le minimum";
const dropped = computed(() => draft.value?.dropped.filter((d) => d.kind === "bullet" || d.kind === "project") ?? []);
const failed = computed(() => draft.value?.checks.filter((c) => c.ok === false) ?? []);
const role = (t: TemplateId) => templates.value.find((x) => x.id === t)?.role;
const STATUS = { DRAFT: "Brouillon", VALIDATED: "Validé", EXPORTED: "Exporté" } as const;
</script>

<template>
  <section id="cv" class="card cvcard">
    <div class="spread">
      <h2><Icon name="file" :size="17" />CV pour cette offre</h2>
      <div class="tabs" role="tablist">
        <button v-for="t in templates" :key="t.id" type="button" :class="{ active: tab === t.id }" @click="switchTab(t.id)">
          {{ t.role === "ats" ? "ATS" : "E-mail" }} · {{ t.label }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="skeleton" style="height: 80px" />
    <template v-else>
      <p v-if="error" class="alert small"><Icon name="alert" :size="15" /><span>{{ error }}</span></p>
      <p v-if="error && !master" class="small"><RouterLink to="/cv">Ouvrir « CV complet »</RouterLink></p>

      <div v-if="master && !cv" class="empty-cv">
        <p class="muted small">Choisit dans ton CV complet les lignes et projets qui collent le plus à l'offre (règles fixes, sans IA, rien d'inventé), puis te montre pourquoi.</p>
        <button type="button" class="primary" :disabled="!!busy" @click="make"><Icon name="sparkle" :size="16" />{{ busy ? "Calcul…" : "Adapter mon CV" }}</button>
      </div>

      <template v-else-if="cv && draft">
        <p v-if="state?.stale" class="info small">
          <Icon name="info" :size="15" /><span>Ton CV complet ou l'offre a changé ({{ state.staleReasons.join(", ") }}).</span>
          <button type="button" class="small" :disabled="!!busy" @click="make"><Icon name="refresh" :size="14" />Régénérer</button>
        </p>

        <div class="layout">
          <div :ref="watchBox" class="preview" :class="{ full }">
            <iframe :key="previewKey" :src="api.jobCvPreviewUrl(jobId, tab)" title="Aperçu du CV" :style="frameStyle" />
            <!-- Tout l'aperçu est le bouton : un clic l'ouvre en grand écran, un autre clic (ou Échap) le referme. -->
            <button type="button" class="zoom" :aria-label="full ? 'Quitter le grand écran' : 'Voir le CV en grand écran'" :title="full ? 'Cliquer ou Échap pour fermer' : 'Cliquer pour voir en grand écran'" @click="toggleFull" />
          </div>

          <div class="explain stack">
            <div class="row">
              <span class="chip" :class="cv.status === 'DRAFT' ? 'warn' : 'good'">{{ STATUS[cv.status] }}</span>
              <span class="muted small">Modèle {{ role(tab) === "ats" ? "ATS" : "e-mail" }} · règles {{ draft.rulesVersion }}</span>
            </div>

            <label class="small">Titre
              <select :value="cv.overrides.titleId ?? ''" :disabled="!!busy" @change="setTitle(($event.target as HTMLSelectElement).value)">
                <option value="">Automatique ({{ pickedOf('title', draft.picked.find((p) => p.kind === 'title')?.id ?? '')?.label }}{{ draft.offerTitle ? " — intitulé de l'offre" : "" }})</option>
                <option v-for="t in titles" :key="t.id" :value="t.id">{{ t.text }}</option>
              </select>
            </label>

            <div v-for="e in draft.sections.experiences" :key="e.id" class="block">
              <strong class="small">{{ e.role }}</strong>
              <div v-for="b in e.bullets" :key="b.id" class="kept">
                <div class="small">{{ b.text }}</div>
                <div class="muted tiny">gardée car : {{ why(pickedOf("bullet", b.id)) }}</div>
                <div class="row tools">
                  <button type="button" class="link tiny" title="Monter" :disabled="!!busy" @click="move(e.id, e.bullets.map((x) => x.id), b.id, -1)">↑</button>
                  <button type="button" class="link tiny" title="Descendre" :disabled="!!busy" @click="move(e.id, e.bullets.map((x) => x.id), b.id, 1)">↓</button>
                  <select v-if="variantsOf(b.id).length > 1" class="tiny" :value="cv.overrides.variants[b.id] ?? ''" :disabled="!!busy" @change="setVariant(b.id, ($event.target as HTMLSelectElement).value)">
                    <option value="" disabled>Autre version…</option>
                    <option v-for="v in variantsOf(b.id)" :key="v.id" :value="v.id">{{ v.style }} : {{ v.text.slice(0, 50) }}…</option>
                  </select>
                  <button type="button" class="link tiny" :disabled="!!busy" @click="remove(b.id)">Retirer</button>
                </div>
              </div>
            </div>

            <div class="block">
              <strong class="small">Projets</strong>
              <div v-for="p in draft.sections.projects" :key="p.id" class="kept">
                <div class="small">{{ p.name }}</div>
                <div class="muted tiny">gardé car : {{ why(pickedOf("project", p.id)) }}</div>
                <div class="row tools">
                  <button type="button" class="link tiny" :disabled="!!busy" @click="move('projects', draft.sections.projects.map((x) => x.id), p.id, -1)">↑</button>
                  <button type="button" class="link tiny" :disabled="!!busy" @click="move('projects', draft.sections.projects.map((x) => x.id), p.id, 1)">↓</button>
                  <button type="button" class="link tiny" :disabled="!!busy" @click="remove(p.id)">Retirer</button>
                </div>
              </div>
            </div>

            <details v-if="dropped.length" class="block">
              <summary class="small"><strong>Laissé de côté ({{ dropped.length }})</strong></summary>
              <div v-for="d in dropped" :key="d.kind + d.id" class="row dropped tiny">
                <span class="num">{{ d.score }}</span><span class="grow">{{ d.label }} <span class="muted">— {{ d.why }}</span></span>
                <button v-if="d.why !== 'aucune phrase validée' && d.why !== 'aucune description validée'" type="button" class="small" :disabled="!!busy" @click="putBack(d.id)">Remettre</button>
              </div>
            </details>

            <div v-if="draft.match?.offer.length" class="block">
              <strong class="small">
                Correspondance avec l'offre : {{ draft.match.percent }} %
                <span class="muted">({{ draft.match.found.length }} compétences sur {{ draft.match.offer.length }} écrites dans ce CV)</span>
              </strong>
              <p v-if="draft.match.notShown.length" class="small" style="margin: 0">
                <strong>Dans ton CV complet mais pas sur cette page :</strong> {{ draft.match.notShown.map(label).join(", ") }}
              </p>
              <p v-if="absentFromCv.length" class="small muted" style="margin: 0">Absentes de ton CV : {{ absentFromCv.map(label).join(", ") }}</p>
            </div>

            <div v-if="draft.missing.absent.length" class="block">
              <strong class="small">Demandé dans l'offre mais absent de ton CV</strong>
              <div v-for="s in draft.missing.absent" :key="s" class="row tiny">
                <span class="chip missing">{{ label(s) }}</span>
                <RouterLink :to="{ path: '/cv', query: { section: 'experiences', skill: s } }">J'ai fait ça → ajouter une phrase dans mon CV complet</RouterLink>
              </div>
            </div>
            <p v-if="draft.missing.onlyCourse.length" class="small"><strong>Seulement vu en cours :</strong> {{ draft.missing.onlyCourse.map(label).join(", ") }}</p>
            <p v-if="draft.missing.forbidden.length" class="small"><strong>Choisi de ne pas l'afficher :</strong> {{ draft.missing.forbidden.map(label).join(", ") }}</p>
            <p v-if="draft.fromProfile?.length" class="small"><strong>Ajouté depuis ton profil :</strong> {{ draft.fromProfile.map(label).join(", ") }}</p>
            <p v-if="draft.substitutions.length" class="small"><strong>Écrit comme dans l'offre :</strong> {{ draft.substitutions.map((s) => `${s.from} → ${s.to}`).join(", ") }}</p>

            <ul class="clean checks small">
              <li v-for="c in draft.checks" :key="c.id" :class="c.ok === true ? 'ok' : c.ok === false ? 'ko' : 'todo'">
                <Icon :name="c.ok === true ? 'check' : c.ok === false ? 'alert' : 'clock'" :size="14" />{{ c.label }}
                <span v-if="c.details.length" class="muted"> — {{ c.details.join(" ; ") }}</span>
              </li>
            </ul>
            <ul v-if="draft.warnings.length" class="clean warns small"><li v-for="w in draft.warnings" :key="w"><Icon name="alert" :size="14" />{{ w }}</li></ul>
          </div>
        </div>

        <div class="row buttons">
          <button type="button" class="primary" :disabled="!!busy || state?.stale || cv.status !== 'DRAFT' || failed.length > 0" @click="validate">
            <Icon name="check" :size="16" />{{ cv.status === "DRAFT" ? "Valider" : "Validé" }}
          </button>
          <button type="button" :disabled="!!busy || cv.status === 'DRAFT' || state?.stale || !state?.pdfAvailable" @click="exportPdf(false)">
            <Icon name="save" :size="16" />{{ busy === "pdf" ? "Création du PDF…" : "Exporter en PDF" }}
          </button>
          <button type="button" :disabled="!!busy || !state?.pdfAvailable" title="Les deux modèles doivent être validés" @click="exportPdf(true)">
            <Icon name="save" :size="16" />{{ busy === "both" ? "Création…" : "Exporter les deux" }}
          </button>
          <button v-if="cv.pdfPath" type="button" class="ghost" :disabled="!!busy" @click="openFolder"><Icon name="external" :size="15" />Ouvrir le dossier</button>
        </div>
        <p v-if="exported" class="success small" role="status"><Icon name="check" :size="15" />Enregistré : {{ exported }}</p>
        <p v-else-if="cv.exportedAt" class="muted small">Exporté le {{ new Date(cv.exportedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) }}{{ cv.sentAt ? " · envoyé (offre marquée « Postulé »)" : "" }}.</p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.cvcard { display: flex; flex-direction: column; gap: 0.9rem; }
.cvcard h2 { margin: 0; }
.empty-cv { display: flex; flex-direction: column; align-items: flex-start; gap: 0.6rem; }
.empty-cv p { margin: 0; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; align-items: start; }
/* Page A4 (794 × 1123 px) réduite pour l'aperçu. */
.preview { position: relative; width: 100%; aspect-ratio: 210 / 297; overflow: hidden; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
.preview iframe { position: absolute; top: 0; left: 0; width: 794px; height: 1123px; border: 0; transform-origin: 0 0; }
.preview.full { background: #3a3f4b; border: 0; border-radius: 0; }
/* Calque transparent au-dessus de l'aperçu (l'iframe ne reçoit pas les clics). */
.zoom { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; cursor: zoom-in; }
.zoom:hover:not(:disabled) { background: rgb(79 70 229 / 0.06); border: 0; }
.preview.full .zoom { cursor: zoom-out; }
.preview.full .zoom:hover { background: transparent; }
.explain { max-height: 80vh; overflow: auto; gap: 0.7rem; }
.block { display: flex; flex-direction: column; gap: 0.35rem; }
.kept { padding: 0.35rem 0.5rem; border-left: 3px solid var(--accent-soft); }
.tools { gap: 0.6rem; }
.tiny { font-size: 0.78rem; }
.grow { flex: 1; }
.dropped { align-items: baseline; }
.dropped .num { min-width: 1.8rem; text-align: right; color: var(--muted); }
.checks li, .warns li { display: flex; gap: 0.35rem; align-items: baseline; }
.checks .ok { color: var(--good); }
.checks .ko { color: var(--low); }
.checks .todo { color: var(--muted); }
.warns li { color: var(--mid); }
.buttons { gap: 0.5rem; }
label.small { display: flex; flex-direction: column; gap: 0.25rem; color: var(--muted); }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>

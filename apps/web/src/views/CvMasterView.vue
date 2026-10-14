<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ApiError, api, errorMessage } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import SkillPicker from "../components/SkillPicker.vue";
import TagInput from "../components/TagInput.vue";
import VariantList from "../components/VariantList.vue";
import type { CvMaster, JobSummary } from "../types";

/**
 * CV complet découpé en morceaux : chaque phrase, ses étiquettes, son niveau et sa règle.
 * Le CV adapté à une offre ne reprend que des phrases d'ici, validées, mot pour mot.
 */
const route = useRoute();
const m = ref<CvMaster | null>(null);
let saved = "";
const loading = ref(true);
const saving = ref(false);
const importing = ref(false);
const message = ref<{ ok: boolean; text: string } | null>(null);
const issues = ref<Array<{ path: string; message: string }>>([]);
const skills = ref<Array<{ id: string; label: string }>>([]);
const savedJobs = ref<JobSummary[] | null>(null);

/** Section ouverte (lien « ajouter une phrase » depuis une offre : ?section=experiences&skill=docker). */
const open = ref<string>(typeof route.query.section === "string" ? route.query.section : "");
const askedSkill = computed(() => (typeof route.query.skill === "string" ? skills.value.find((s) => s.id === route.query.skill)?.label ?? route.query.skill : null));

const SECTIONS = [
  ["todo", "Points à trancher"],
  ["identity", "En-tête"],
  ["titles", "Titres"],
  ["summaries", "Profils (résumés)"],
  ["experiences", "Expériences (lignes)"],
  ["projects", "Projets"],
  ["skills", "Compétences"],
  ["education", "Formation"],
  ["languages", "Langues et loisirs"],
  ["rules", "Règles"],
] as const;

function load(master: CvMaster | null, iss: typeof issues.value = []) {
  m.value = master ? structuredClone(master) : null;
  saved = JSON.stringify(m.value);
  issues.value = iss;
}

onMounted(async () => {
  try {
    const [res, sk] = await Promise.all([api.getCvMaster(), api.cvSkills()]);
    skills.value = sk.skills;
    load(res.master, res.issues);
  } finally {
    loading.value = false;
  }
});

const dirty = computed(() => !loading.value && JSON.stringify(m.value) !== saved);

/** Phrases proposées pas encore validées (ignorées par le choix tant qu'elles le restent). */
const toValidate = computed(() => {
  const x = m.value;
  if (!x) return 0;
  return [
    ...x.headline,
    ...x.titles,
    ...x.summaries,
    ...x.experiences.flatMap((e) => e.bullets.flatMap((b) => b.variants)),
    ...x.projects.flatMap((p) => p.descriptions),
    ...x.education.flatMap((e) => e.lines),
  ].filter((v) => v.toValidate).length;
});

async function save() {
  if (!m.value) return;
  saving.value = true;
  message.value = null;
  try {
    const res = await api.saveCvMaster(m.value);
    load(res.master);
    message.value = { ok: true, text: "CV complet enregistré. Les CV adaptés déjà faits seront marqués « à refaire »." };
  } catch (e) {
    if (e instanceof ApiError && e.issues.length) issues.value = e.issues;
    message.value = { ok: false, text: e instanceof ApiError && e.status === 400 ? "Rien n'est enregistré : corrige les points ci-dessous." : "Enregistrement impossible." };
  } finally {
    saving.value = false;
  }
}

async function importSeed() {
  importing.value = true;
  message.value = null;
  try {
    const res = await api.importCvSeed();
    load(res.master);
    message.value = { ok: true, text: `Fichier de départ importé. ${res.toValidate} phrase(s) à valider.` };
  } catch (e) {
    if (e instanceof ApiError && e.issues.length) issues.value = e.issues;
    message.value = { ok: false, text: errorMessage(e, "Import impossible.") };
  } finally {
    importing.value = false;
  }
}

async function loadSavedJobs() {
  savedJobs.value = (await api.listJobs({ status: "SAVED", limit: 30, sort: "score" })).items;
}

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;
const LEVELS = [
  ["pro", "Pro (entreprise)"],
  ["projet", "Projet (fait moi-même)"],
  ["cours", "Cours (vu, pas codé moi-même)"],
] as const;
const JOB_TYPES = ["frontend", "backend", "fullstack", "mobile", "other"] as const;
const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const issuesFor = (prefix: string) => issues.value.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));
</script>

<template>
  <PageHeader title="CV complet" subtitle="Toutes tes phrases de CV, découpées en morceaux. Le CV adapté à une offre n'utilise que des phrases d'ici, validées, mot pour mot.">
    <template #badge>
      <span v-if="m && toValidate" class="chip warn">{{ toValidate }} phrase{{ toValidate > 1 ? "s" : "" }} à valider</span>
      <span v-else-if="m" class="chip good"><Icon name="check" :size="13" />Tout est validé</span>
    </template>
    <template #actions>
      <button v-if="m" type="button" class="primary" :disabled="saving || !dirty" @click="save">
        <Icon name="save" :size="16" />{{ saving ? "Enregistrement…" : "Enregistrer" }}
      </button>
    </template>
  </PageHeader>

  <div v-if="loading" class="stack"><div class="skeleton" style="height: 120px" /><div class="skeleton" style="height: 320px" /></div>

  <div v-else class="stack">
    <p v-if="message" :class="message.ok ? 'success' : 'alert'" role="status">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="16" /><span>{{ message.text }}</span>
    </p>
    <div v-if="issues.length" class="alert small issues">
      <strong>Le CV complet est incohérent :</strong>
      <ul class="clean"><li v-for="i in issues" :key="i.path + i.message"><code>{{ i.path || "—" }}</code> {{ i.message }}</li></ul>
    </div>
    <p v-if="askedSkill" class="info small">
      <Icon name="info" :size="15" /><span>L'offre demande <b>{{ askedSkill }}</b>. Si tu l'as vraiment fait, ajoute une phrase (avec l'étiquette {{ askedSkill }}) dans la bonne section. Rien n'est ajouté tout seul.</span>
    </p>

    <section v-if="!m" class="card empty">
      <Icon name="file" :size="34" />
      <p>Pas encore de CV complet. Importe le fichier de départ (<code>data/cv/cv-master.seed.yaml</code>) : il ne remplace jamais un CV complet existant.</p>
      <button type="button" class="primary" :disabled="importing" @click="importSeed">
        <Icon name="plus" :size="16" />{{ importing ? "Import…" : "Importer le fichier de départ" }}
      </button>
    </section>

    <template v-else>
      <section class="card row test">
        <span class="muted small">Pour voir l'effet d'une modification, enregistre puis ouvre une offre sauvegardée :</span>
        <button type="button" class="small" @click="loadSavedJobs"><Icon name="target" :size="14" />Tester sur une offre</button>
        <div v-if="savedJobs" class="jobs">
          <span v-if="!savedJobs.length" class="muted small">Aucune offre sauvegardée.</span>
          <RouterLink v-for="j in savedJobs" :key="j.id" :to="`/offres/${j.id}#cv`" class="chip">{{ j.title }} · {{ j.company ?? "?" }}</RouterLink>
        </div>
      </section>

      <details v-for="[key, label] in SECTIONS" :key="key" class="card section" :open="open === key || (!open && key === 'todo')">
        <summary><h2>{{ label }}</h2></summary>

        <!-- Points à trancher -->
        <div v-if="key === 'todo'" class="stack">
          <label v-for="t in m.todo" :key="t.id" class="check"><input v-model="t.done" type="checkbox" /><span :class="{ done: t.done }">{{ t.text }}</span></label>
          <label class="inline">
            Modèle envoyé aux logiciels de tri (CV ATS) :
            <select v-model="m.atsTemplate">
              <option value="une-colonne">Une colonne</option>
              <option value="deux-colonnes">Deux colonnes</option>
            </select>
            <span class="muted small">L'autre sert pour les e-mails.</span>
          </label>
        </div>

        <!-- En-tête -->
        <div v-else-if="key === 'identity'" class="stack">
          <div class="grid-3">
            <label>Nom complet<input v-model="m.identity.fullName" /></label>
            <label>Téléphone<input v-model="m.identity.phone" /></label>
            <label>E-mail<input v-model="m.identity.email" type="email" /></label>
            <label>LinkedIn<input v-model="m.identity.linkedin" /></label>
            <label>Ville<input v-model="m.identity.city" /></label>
          </div>
          <span class="small strong">Ligne sous le titre (Bac+5…)</span>
          <VariantList v-model="m.headline" />
        </div>

        <!-- Titres -->
        <div v-else-if="key === 'titles'" class="stack">
          <div v-for="(t, i) in m.titles" :key="t.id" class="piece" :class="{ pending: t.toValidate }">
            <div class="row">
              <input v-model="t.text" class="grow" @input="t.toValidate = false" />
              <label class="check"><input type="radio" name="default-title" :checked="t.isDefault" @change="m.titles.forEach((x) => (x.isDefault = x === t))" />Par défaut</label>
              <button v-if="t.toValidate" type="button" class="small primary" @click="t.toValidate = false"><Icon name="check" :size="14" />Je valide ce titre</button>
              <button type="button" class="small ghost" :disabled="m.titles.length <= 1" @click="m.titles.splice(i, 1)"><Icon name="trash" :size="14" /></button>
            </div>
            <div class="row small">
              <span class="muted">Postes :</span>
              <label v-for="jt in JOB_TYPES" :key="jt" class="check"><input type="checkbox" :checked="t.jobTypes.includes(jt)" @change="t.jobTypes = toggleIn(t.jobTypes, jt)" />{{ jt }}</label>
            </div>
            <SkillPicker v-model="t.skills" :skills="skills" placeholder="Compétences du titre…" />
          </div>
          <button type="button" class="small" @click="m.titles.push({ id: uid('t'), text: 'Développeur', skills: [], jobTypes: ['fullstack'], toValidate: false })"><Icon name="plus" :size="14" />Ajouter un titre</button>
        </div>

        <!-- Résumés -->
        <div v-else-if="key === 'summaries'" class="stack">
          <div v-for="(s, i) in m.summaries" :key="s.id" class="piece" :class="{ pending: s.toValidate }">
            <div class="row small">
              <label>Modèle
                <select v-model="s.template"><option value="any">Les deux</option><option value="une-colonne">Une colonne</option><option value="deux-colonnes">Deux colonnes</option></select>
              </label>
              <label class="check"><input type="checkbox" :checked="s.jobTypes === 'any'" @change="s.jobTypes = s.jobTypes === 'any' ? ['fullstack'] : 'any'" />Tous les postes</label>
              <template v-if="s.jobTypes !== 'any'">
                <label v-for="jt in JOB_TYPES" :key="jt" class="check"><input type="checkbox" :checked="s.jobTypes.includes(jt)" @change="s.jobTypes = toggleIn(s.jobTypes as typeof JOB_TYPES[number][], jt)" />{{ jt }}</label>
              </template>
              <span class="grow" />
              <button v-if="s.toValidate" type="button" class="small primary" @click="s.toValidate = false"><Icon name="check" :size="14" />Je valide ce profil</button>
              <button type="button" class="small ghost" :disabled="m.summaries.length <= 1" @click="m.summaries.splice(i, 1)"><Icon name="trash" :size="14" /></button>
            </div>
            <textarea v-model="s.text" rows="4" lang="fr" @input="s.toValidate = false" />
          </div>
          <button type="button" class="small" @click="m.summaries.push({ id: uid('s'), template: 'any', jobTypes: 'any', text: '', toValidate: false })"><Icon name="plus" :size="14" />Ajouter un profil</button>
        </div>

        <!-- Expériences -->
        <div v-else-if="key === 'experiences'" class="stack">
          <div v-for="e in m.experiences" :key="e.id" class="stack exp">
            <div class="grid-3">
              <label>Poste<input v-model="e.role" /></label>
              <label>Entreprise<input v-model="e.company" /></label>
              <label>Contrat<input v-model="e.contract" /></label>
              <label>Début (AAAA-MM ou AAAA)<input v-model="e.start" /></label>
              <label>Fin<input v-model="e.end" /></label>
              <label>Lignes (min – max)<span class="row"><input v-model.number="e.minBullets" type="number" min="0" class="num-in" /> – <input v-model.number="e.maxBullets" type="number" min="0" class="num-in" /></span></label>
            </div>
            <div v-for="(b, bi) in e.bullets" :key="b.id" class="piece">
              <div class="row small">
                <code>{{ b.id }}</code>
                <select v-model="b.rule"><option value="always">Toujours</option><option value="ifRelevant">Si utile pour l'offre</option></select>
                <select v-model="b.level"><option v-for="[v, l] in LEVELS" :key="v" :value="v">{{ l }}</option></select>
                <span class="grow" />
                <button type="button" class="small ghost" @click="e.bullets.splice(bi, 1)"><Icon name="trash" :size="14" />Retirer la ligne</button>
              </div>
              <VariantList v-model="b.variants" />
              <SkillPicker v-model="b.skills" :skills="skills" />
            </div>
            <button type="button" class="small" @click="e.bullets.push({ id: uid('l'), variants: [{ id: 'v1', style: 'verbe', text: '', toValidate: false }], skills: [], level: 'pro', rule: 'ifRelevant' })">
              <Icon name="plus" :size="14" />Ajouter une ligne à « {{ e.role }} »
            </button>
          </div>
        </div>

        <!-- Projets -->
        <div v-else-if="key === 'projects'" class="stack">
          <div v-for="(p, pi) in m.projects" :key="p.id" class="piece">
            <div class="grid-3">
              <label>Nom<input v-model="p.name" /></label>
              <label>Contexte<input v-model="p.context" /></label>
              <label>Équipe<input v-model="p.team" /></label>
              <label>Mon rôle (facultatif)<input :value="p.roleNote ?? ''" @input="p.roleNote = ($event.target as HTMLInputElement).value || undefined" /></label>
            </div>
            <span class="small strong">Description (courte « nom », longue avec « Ma part » « verbe »)</span>
            <VariantList v-model="p.descriptions" />
            <span class="small strong">Technologies du projet (affichées, dans l'ordre)</span>
            <TagInput v-model="p.technologies" placeholder="React + Vite…" />
            <span class="small strong">Fait par moi (compte pour la note)</span>
            <SkillPicker v-model="p.ownSkills" :skills="skills" />
            <span class="small strong">Fait par l'équipe seulement (ne compte pas)</span>
            <SkillPicker v-model="p.teamOnlySkills" :skills="skills" />
            <button type="button" class="small ghost" @click="m.projects.splice(pi, 1)"><Icon name="trash" :size="14" />Retirer le projet</button>
          </div>
          <button type="button" class="small" @click="m.projects.push({ id: uid('p'), name: 'Nouveau projet', context: '', team: '', descriptions: [{ id: 'd1', style: 'nom', text: '', toValidate: false }], technologies: [], ownSkills: [], teamOnlySkills: [], rule: 'ifRelevant' })">
            <Icon name="plus" :size="14" />Ajouter un projet
          </button>
        </div>

        <!-- Compétences -->
        <div v-else-if="key === 'skills'" class="stack">
          <div v-for="(g, gi) in m.skillGroups" :key="g.id" class="piece">
            <div class="row"><input v-model="g.label" class="group" /><span class="grow" /><button type="button" class="small ghost" @click="m.skillGroups.splice(gi, 1)"><Icon name="trash" :size="14" /></button></div>
            <div v-for="(it, ii) in g.items" :key="it.skillId + ii" class="row item">
              <select v-model="it.skillId"><option v-for="s in skills" :key="s.id" :value="s.id">{{ s.label }}</option></select>
              <input v-model="it.label" placeholder="Libellé affiché" />
              <select v-model="it.level"><option v-for="[v, l] in LEVELS" :key="v" :value="v">{{ l }}</option></select>
              <button type="button" class="small ghost" @click="g.items.splice(ii, 1)"><Icon name="trash" :size="14" /></button>
            </div>
            <button type="button" class="small ghost" @click="g.items.push({ skillId: skills[0]?.id ?? 'javascript', label: '', level: 'pro' })"><Icon name="plus" :size="14" />Compétence</button>
          </div>
          <button type="button" class="small" @click="m.skillGroups.push({ id: uid('g'), label: 'Nouveau groupe', items: [] })"><Icon name="plus" :size="14" />Ajouter un groupe</button>
        </div>

        <!-- Formation -->
        <div v-else-if="key === 'education'" class="stack">
          <div v-for="(e, ei) in m.education" :key="e.id" class="piece">
            <div class="row small">
              <label>Début<input v-model="e.start" class="date-in" /></label>
              <label>Fin<input v-model="e.end" class="date-in" /></label>
              <span class="muted">« — » sépare le diplôme de l'école (alignée à droite).</span>
              <span class="grow" />
              <button type="button" class="small ghost" @click="m.education.splice(ei, 1)"><Icon name="trash" :size="14" /></button>
            </div>
            <VariantList v-model="e.lines" />
          </div>
          <button type="button" class="small" @click="m.education.push({ id: uid('f'), start: '2024', end: '2025', rule: 'always', lines: [{ id: 'l1', style: 'nom', text: '', toValidate: false }] })"><Icon name="plus" :size="14" />Ajouter une formation</button>
        </div>

        <!-- Langues et loisirs -->
        <div v-else-if="key === 'languages'" class="stack">
          <span class="small strong">Langues</span>
          <TagInput v-model="m.languages" placeholder="Anglais : B1+" />
          <span class="small strong">Loisirs (retirés en premier si la place manque)</span>
          <TagInput v-model="m.hobbies" placeholder="Voyage" />
        </div>

        <!-- Règles -->
        <div v-else-if="key === 'rules'" class="stack">
          <span class="small strong">Compétences jamais affichées, même si l'offre les demande</span>
          <SkillPicker v-model="m.rules.forbiddenSkills" :skills="skills" />
          <span class="small strong">Mots forts (« maîtrise », « expert »…)</span>
          <TagInput v-model="m.rules.strongWords" />
          <span class="small strong">…autorisés seulement à côté de :</span>
          <SkillPicker v-model="m.rules.strongWordsAllowedFor" :skills="skills" />
          <div class="grid-3">
            <label>Projets min<input v-model.number="m.rules.minProjects" type="number" min="0" /></label>
            <label>Projets max<input v-model.number="m.rules.maxProjects" type="number" min="0" /></label>
            <label>Compétences max par groupe<input v-model.number="m.rules.maxSkillsPerGroup" type="number" min="1" /></label>
          </div>
          <label class="switch"><input v-model="m.rules.titleTechSuffix.enabled" type="checkbox" />Ajouter au titre les technos exigées (« | Vue.js, Java »), au plus <input v-model.number="m.rules.titleTechSuffix.max" type="number" min="0" max="5" class="num-in" /></label>
          <label class="switch"><input v-model="m.rules.allowLabelSubstitution" type="checkbox" />Écrire une compétence comme l'offre (« VueJS » au lieu de « Vue.js ») dans les listes de compétences</label>
        </div>

        <ul v-if="issuesFor(key === 'skills' ? 'skillGroups' : key).length" class="clean alert small"><li v-for="i in issuesFor(key === 'skills' ? 'skillGroups' : key)" :key="i.path + i.message">{{ i.path }} : {{ i.message }}</li></ul>
      </details>
    </template>
  </div>
</template>

<style scoped>
.section summary { cursor: pointer; list-style: none; }
.section summary::-webkit-details-marker { display: none; }
.section summary h2 { margin: 0; display: inline; }
.section summary::before { content: "▸"; margin-right: 0.5rem; color: var(--muted); }
.section[open] summary::before { content: "▾"; }
.section[open] summary { margin-bottom: 0.9rem; }
.piece { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.7rem; border: 1px solid var(--border); border-radius: 11px; }
.piece.pending { background: var(--mid-bg); border-color: var(--mid); }
.exp { padding-bottom: 0.8rem; border-bottom: 1px dashed var(--border-strong); }
.grow { flex: 1; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: var(--muted); }
label.check, label.inline, label.switch { flex-direction: row; align-items: center; gap: 0.4rem; color: var(--text); }
label.inline { flex-wrap: wrap; }
.done { text-decoration: line-through; color: var(--muted); }
.strong { font-weight: 600; }
textarea { width: 100%; font-family: inherit; font-size: 0.9rem; line-height: 1.5; resize: vertical; }
.num-in { width: 4.2rem; }
.date-in { width: 7rem; }
.group { font-weight: 600; max-width: 16rem; }
.item select:first-child { max-width: 14rem; }
.item input { flex: 1; min-width: 10rem; }
.test .jobs { display: flex; flex-wrap: wrap; gap: 0.35rem; flex-basis: 100%; }
.issues ul { margin: 0.3rem 0 0; }
.empty { display: flex; flex-direction: column; align-items: center; gap: 0.7rem; text-align: center; }
</style>

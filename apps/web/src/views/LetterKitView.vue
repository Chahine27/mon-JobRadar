<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ApiError, api } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import type { LetterKit } from "../types";

const kit = reactive<LetterKit>({ header: "", city: "", signature: "", cvText: "", letterExample: "", rules: "", mastered: "", closing: "", bannedWords: "", pdfFolder: "", pdfName: "Lettre_de_motivation.pdf", cvPdfPath: "", cvFolder: "", cvSubfolder: true, cvReplace: true });
let saved = "";
const loading = ref(true);
const saving = ref(false);
const message = ref<{ ok: boolean; text: string } | null>(null);

onMounted(async () => {
  try {
    const res = await api.getLetterKit();
    Object.assign(kit, res.kit);
    saved = JSON.stringify(kit);
  } finally {
    loading.value = false;
  }
});

const dirty = computed(() => !loading.value && JSON.stringify(kit) !== saved);
const cvOk = computed(() => kit.cvText.trim().length >= 200);

async function save() {
  saving.value = true;
  message.value = null;
  try {
    const res = await api.saveLetterKit({ ...kit });
    Object.assign(kit, res.kit);
    saved = JSON.stringify(kit);
    message.value = res.ready
      ? { ok: true, text: "Enregistré. Tu peux maintenant écrire une lettre depuis la page de n'importe quelle offre." }
      : { ok: false, text: "Enregistré, mais ton CV est trop court : colle-le en entier pour que l'IA puisse écrire une lettre." };
  } catch (e) {
    message.value = { ok: false, text: e instanceof ApiError && e.status === 400 ? "Un des textes est trop long." : "Enregistrement impossible." };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PageHeader
    title="CV & lettre"
    subtitle="Ce dont l'IA a besoin pour écrire tes lettres de motivation. Tout reste dans Job Radar, sur ton PC."
  >
    <template #actions>
      <button type="button" class="primary" :disabled="saving || loading || !dirty" @click="save">
        <Icon name="save" :size="16" />{{ saving ? "Enregistrement…" : "Enregistrer" }}
      </button>
    </template>
  </PageHeader>

  <div v-if="loading" class="stack"><div class="skeleton" style="height: 160px" /><div class="skeleton" style="height: 260px" /></div>

  <form v-else class="stack" @submit.prevent="save">
    <p v-if="message" :class="message.ok ? 'success' : 'alert'" role="status">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="16" />{{ message.text }}
    </p>

    <section class="card stack">
      <h2><span class="step">1</span>Ton CV <span class="req">*</span></h2>
      <label>
        <textarea v-model="kit.cvText" rows="14" maxlength="15000" placeholder="Ouvre ton CV (PDF ou Word), Ctrl + A, Ctrl + C, puis colle ici (Ctrl + V)." />
        <span class="hint">
          Pas grave si la mise en page est un peu cassée : l'IA s'y retrouve. C'est la seule source qu'elle utilise sur toi,
          elle n'invente rien d'autre.
          <span class="num" :class="{ bad: kit.cvText && !cvOk }">{{ kit.cvText.trim().length }} caractères</span>
        </span>
      </label>
    </section>

    <section class="card stack">
      <h2><span class="step">2</span>Une lettre que tu as déjà écrite <span class="muted small">(conseillé)</span></h2>
      <label>
        <textarea v-model="kit.letterExample" rows="12" maxlength="10000" placeholder="Colle une lettre de motivation qui te plaît." />
        <span class="hint">
          Elle sert seulement à copier ton style (ton, longueur, façon de tourner les phrases). Le nom de l'entreprise et les détails
          de cette ancienne offre ne sont pas repris ; si ça arrive, Job Radar te le signale.
        </span>
      </label>
    </section>

    <section class="card stack">
      <h2><span class="step">3</span>En-tête et signature</h2>
      <div class="grid-2">
        <label>
          En-tête (en haut à gauche, une info par ligne)
          <textarea v-model="kit.header" rows="5" maxlength="600" placeholder="Prénom Nom&#10;Code postal Ville&#10;Téléphone&#10;Email" />
        </label>
        <div class="stack" style="gap: 0.8rem">
          <label>
            Ville pour « À …, le 30/09/2026 »
            <input v-model="kit.city" maxlength="80" placeholder="Ta ville" />
          </label>
          <label>
            Signature (en bas de la lettre)
            <input v-model="kit.signature" maxlength="80" placeholder="Prénom NOM" />
          </label>
        </div>
      </div>
    </section>

    <section class="card stack">
      <h2><span class="step">4</span>Tes règles pour la lettre <span class="muted small">(conseillé)</span></h2>
      <label>
        Tes règles (structure, phrases que tu utilises, faits à mettre en avant)
        <textarea v-model="kit.rules" rows="12" maxlength="15000" placeholder="Ex. : 5 paragraphes. Paragraphe 2 : toujours LUSIS, le plus long…" />
        <span class="hint">L'IA les suit en priorité, avant ses règles générales. Ce que tu écris ici compte comme vrai, au même titre que ton CV.</span>
      </label>
      <label>
        Technos que tu maîtrises vraiment (séparées par des virgules)
        <input v-model="kit.mastered" maxlength="400" placeholder="Vue.js, TypeScript, Java Spring Boot, API REST" />
        <span class="hint">Seules celles-ci peuvent être écrites « je maîtrise ». Pour le reste, la lettre dira « j'ai travaillé avec ». Vide = jamais « maîtrise ».</span>
      </label>
      <label>
        Dernier paragraphe, toujours le même
        <textarea v-model="kit.closing" rows="3" maxlength="500" placeholder="Je serais heureux d'échanger avec vous… {entreprise}." />
        <span class="hint">Ajouté tel quel à la fin de chaque lettre ; {entreprise} est remplacé par le nom de l'entreprise.</span>
      </label>
      <label>
        Mots à ne jamais écrire (séparés par des virgules)
        <textarea v-model="kit.bannedWords" rows="3" maxlength="1500" placeholder="je candidate, Concernant, De plus" />
      </label>
    </section>

    <section class="card stack">
      <h2><span class="step">5</span>Où enregistrer le PDF de la lettre</h2>
      <div class="grid-2">
        <label>
          Dossier sur ton PC
          <input v-model="kit.pdfFolder" maxlength="300" placeholder="C:\Users\…\Documents\pour postuler" />
          <span class="hint">Dans l'Explorateur Windows : clic sur la barre d'adresse du dossier, Ctrl + C, puis colle ici.</span>
        </label>
        <label>
          Nom du fichier
          <input v-model="kit.pdfName" maxlength="120" placeholder="Lettre_de_motivation.pdf" />
          <span class="hint">Toujours le même : chaque nouvelle lettre remplace l'ancienne.</span>
        </label>
      </div>
      <label>
        Ton CV en PDF (pour les candidatures spontanées envoyées par email)
        <input v-model="kit.cvPdfPath" maxlength="400" placeholder="C:\Users\…\Documents\CV.pdf" />
        <span class="hint">Dans l'Explorateur Windows : Maj + clic droit sur ton CV → « Copier en tant que chemin d'accès », puis colle ici (les guillemets sont retirés tout seuls).</span>
      </label>
    </section>

    <section class="card stack">
      <h2><span class="step">6</span>Où enregistrer le PDF du CV adapté à une offre</h2>
      <label>
        Dossier sur ton PC
        <input v-model="kit.cvFolder" maxlength="300" :placeholder="kit.pdfFolder || 'C:\Users\…\Documents\pour postuler'" />
        <span class="hint">Vide = le même dossier que les lettres (point 5). Dans l'Explorateur Windows : clic sur la barre d'adresse du dossier, Ctrl + C, puis colle ici.</span>
      </label>
      <label class="switch"><input v-model="kit.cvSubfolder" type="checkbox" />Un sous-dossier par candidature (« Entreprise_AAAA-MM-JJ »)</label>
      <div class="choices">
        <label class="switch"><input v-model="kit.cvReplace" type="radio" :value="true" />Remplacer le fichier s'il existe déjà</label>
        <label class="switch"><input v-model="kit.cvReplace" type="radio" :value="false" />Garder l'ancien et enregistrer à côté (« _2 », « _3 »…)</label>
      </div>
      <span class="hint">Nom du fichier : NOM_PRÉNOM.pdf (avec « _ATS » pour la version ATS quand les deux modèles sont dans le même dossier).</span>
    </section>

    <div>
      <button type="submit" class="primary" :disabled="saving || !dirty"><Icon name="save" :size="16" />Enregistrer</button>
      <span v-if="dirty" class="muted small" style="margin-left: 0.7rem">Modifications non enregistrées</span>
    </div>
  </form>
</template>

<style scoped>
h2 { display: flex; align-items: center; gap: 0.55rem; margin: 0; }
.step { display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 0.8rem; }
.req { color: var(--low); }
textarea { font-weight: 400; color: var(--text); line-height: 1.5; }
.choices { display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; }
.hint { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; font-weight: 400; font-size: 0.8rem; color: var(--muted); }
.hint .num { margin-left: auto; }
.hint .num.bad { color: var(--low); }
</style>

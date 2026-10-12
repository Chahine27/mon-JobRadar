<script setup lang="ts">
import type { CvMaster } from "../types";
import Icon from "./Icon.vue";

type Variant = CvMaster["headline"][number];

/**
 * Versions d'une phrase (style « verbe » pour le CV une colonne, « nom » pour le deux colonnes).
 * Une phrase « à valider » est en orange : jamais utilisée tant que tu ne l'as pas validée. La modifier la valide aussi.
 */
const model = defineModel<Variant[]>({ required: true });
defineProps<{ min?: number }>();

const nextId = () => {
  let i = model.value.length + 1;
  while (model.value.some((v) => v.id === `v${i}`)) i++;
  return `v${i}`;
};
</script>

<template>
  <div class="variants">
    <div v-for="v in model" :key="v.id" class="variant" :class="{ pending: v.toValidate }">
      <select v-model="v.style" aria-label="Style">
        <option value="verbe">Verbe (une colonne)</option>
        <option value="nom">Nom (deux colonnes)</option>
      </select>
      <textarea v-model="v.text" rows="2" spellcheck="true" lang="fr" @input="v.toValidate = false" />
      <div class="row">
        <button v-if="v.toValidate" type="button" class="small primary" @click="v.toValidate = false"><Icon name="check" :size="14" />Je valide cette phrase</button>
        <button type="button" class="small ghost" :disabled="model.length <= (min ?? 1)" @click="model = model.filter((x) => x !== v)"><Icon name="trash" :size="14" />Retirer</button>
      </div>
    </div>
    <button type="button" class="small ghost add" @click="model = [...model, { id: nextId(), style: 'nom', text: '', toValidate: false }]">
      <Icon name="plus" :size="14" />Autre version
    </button>
  </div>
</template>

<style scoped>
.variants { display: flex; flex-direction: column; gap: 0.45rem; }
.variant { display: grid; grid-template-columns: 11rem 1fr auto; gap: 0.5rem; align-items: start; padding: 0.35rem; border-radius: 9px; }
.variant.pending { background: var(--mid-bg); outline: 1px solid var(--mid); }
.variant textarea { width: 100%; font-family: inherit; font-size: 0.88rem; line-height: 1.45; resize: vertical; }
.variant select { font-size: 0.82rem; }
.add { align-self: flex-start; }
@media (max-width: 760px) { .variant { grid-template-columns: 1fr; } }
</style>

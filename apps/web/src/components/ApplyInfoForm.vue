<script setup lang="ts">
import { ref } from "vue";
import type { ApplyInfo } from "../types";
import Icon from "./Icon.vue";

/** Infos obligatoires d'une candidature : canal d'envoi, CV utilisé, et contrat quand l'offre ne le dit pas. */
const props = defineProps<{ needContract: boolean; busy: boolean; submitLabel: string; initial?: Partial<ApplyInfo> }>();
const emit = defineEmits<{ submit: [ApplyInfo]; cancel: [] }>();

const CHANNELS: Array<[ApplyInfo["channel"], string]> = [
  ["mail", "Mail"],
  ["formulaire", "Formulaire du site"],
  ["linkedin", "Candidature simplifiée LinkedIn"],
  ["autre", "Autre"],
];
const CVS: Array<[ApplyInfo["cv"], string]> = [
  ["classique", "CV classique"],
  ["ats", "CV ATS"],
];
const CONTRACTS = ["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE"] as const;

const channel = ref(props.initial?.channel ?? "");
const cv = ref(props.initial?.cv ?? "");
const contractType = ref(props.initial?.contractType ?? "");
const ready = () => !!channel.value && !!cv.value && (!props.needContract || !!contractType.value);

function submit() {
  if (!ready()) return;
  emit("submit", {
    channel: channel.value as ApplyInfo["channel"],
    cv: cv.value as ApplyInfo["cv"],
    ...(props.needContract ? { contractType: contractType.value as ApplyInfo["contractType"] } : {}),
  });
}
</script>

<template>
  <form class="apply-info" @submit.prevent="submit">
    <label>
      Envoyée par
      <select v-model="channel" required>
        <option value="" disabled>Choisir…</option>
        <option v-for="[v, l] in CHANNELS" :key="v" :value="v">{{ l }}</option>
      </select>
    </label>
    <label>
      CV utilisé
      <select v-model="cv" required>
        <option value="" disabled>Choisir…</option>
        <option v-for="[v, l] in CVS" :key="v" :value="v">{{ l }}</option>
      </select>
    </label>
    <label v-if="props.needContract">
      Contrat (l'offre ne le dit pas)
      <select v-model="contractType" required>
        <option value="" disabled>Choisir…</option>
        <option v-for="c in CONTRACTS" :key="c" :value="c">{{ c }}</option>
      </select>
    </label>
    <div class="row">
      <button type="submit" class="primary small" :disabled="props.busy || !ready()"><Icon name="check" :size="14" />{{ props.submitLabel }}</button>
      <button type="button" class="ghost small" :disabled="props.busy" @click="emit('cancel')">Annuler</button>
    </div>
  </form>
</template>

<style scoped>
.apply-info { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.6rem 0.9rem; }
.apply-info label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
.row { gap: 0.5rem; }
</style>

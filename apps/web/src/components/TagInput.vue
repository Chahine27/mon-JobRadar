<script setup lang="ts">
import { ref } from "vue";
import Icon from "./Icon.vue";

const model = defineModel<string[]>({ required: true });
defineProps<{ placeholder?: string }>();
const draft = ref("");

function add() {
  const value = draft.value.trim();
  if (value && !model.value.some((v) => v.toLowerCase() === value.toLowerCase())) {
    model.value = [...model.value, value];
  }
  draft.value = "";
}
function remove(i: number) {
  model.value = model.value.filter((_, idx) => idx !== i);
}
</script>

<template>
  <div class="stack">
    <div class="row">
      <span v-for="(tag, i) in model" :key="tag" class="chip">
        {{ tag }}
        <button type="button" :aria-label="`Retirer ${tag}`" @click="remove(i)">×</button>
      </span>
      <span v-if="model.length === 0" class="muted small">Aucun élément pour l'instant.</span>
    </div>
    <div class="add">
      <input v-model="draft" :placeholder="placeholder ?? 'Ajouter…'" @keydown.enter.prevent="add" />
      <button type="button" :disabled="!draft.trim()" @click="add"><Icon name="plus" :size="15" />Ajouter</button>
    </div>
  </div>
</template>

<style scoped>
.add { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; max-width: 480px; }
</style>

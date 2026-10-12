<script setup lang="ts">
import { computed, ref } from "vue";

/** Étiquettes de compétences, choisies dans le dictionnaire (recherche par nom). */
const model = defineModel<string[]>({ required: true });
const props = defineProps<{ skills: Array<{ id: string; label: string }>; placeholder?: string }>();
const draft = ref("");
const listId = `skills-${Math.random().toString(36).slice(2, 8)}`;

const labelOf = (id: string) => props.skills.find((s) => s.id === id)?.label ?? id;
const options = computed(() => props.skills.filter((s) => !model.value.includes(s.id)));

function add() {
  const v = draft.value.trim().toLowerCase();
  const hit = props.skills.find((s) => s.label.toLowerCase() === v || s.id === v);
  if (hit && !model.value.includes(hit.id)) model.value = [...model.value, hit.id];
  if (hit) draft.value = "";
}
</script>

<template>
  <div class="picker">
    <span v-for="id in model" :key="id" class="chip">
      {{ labelOf(id) }}
      <button type="button" :aria-label="`Retirer ${labelOf(id)}`" @click="model = model.filter((x) => x !== id)">×</button>
    </span>
    <input v-model="draft" :list="listId" :placeholder="placeholder ?? 'Ajouter une compétence…'" @change="add" @keydown.enter.prevent="add" />
    <datalist :id="listId">
      <option v-for="s in options" :key="s.id" :value="s.label" />
    </datalist>
  </div>
</template>

<style scoped>
.picker { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
.picker input { min-width: 12rem; flex: 1; max-width: 18rem; padding: 0.3rem 0.55rem; font-size: 0.85rem; }
</style>

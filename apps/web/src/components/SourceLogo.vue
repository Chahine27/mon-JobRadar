<script setup lang="ts">
import { computed } from "vue";
import { SOURCE_LABELS } from "../format";
import Icon from "./Icon.vue";

/** Logo de l'origine d'une offre (France Travail, Adzuna…), sur une pastille blanche lisible en clair comme en sombre. */
const LOGOS: Record<string, string> = {
  "france-travail": "/logos/france-travail.png",
  adzuna: "/logos/adzuna.png",
  "jobscraper:linkedin": "/logos/linkedin.png",
  "jobscraper:wttj": "/logos/wttj.png",
  "jobscraper:hellowork": "/logos/hellowork.png",
  "jobscraper:indeed": "/logos/indeed.png",
};

const props = withDefaults(defineProps<{ source: string; size?: number }>(), { size: 24 });
const label = computed(() => SOURCE_LABELS[props.source] ?? props.source);
const logo = computed(() => LOGOS[props.source]);
</script>

<template>
  <span class="source-logo" :style="{ width: `${size}px`, height: `${size}px` }" :title="label" role="img" :aria-label="label">
    <img v-if="logo" :src="logo" alt="" />
    <Icon v-else-if="source === 'company-careers'" name="building" :size="Math.round(size * 0.62)" />
    <Icon v-else-if="source === 'manual'" name="plus" :size="Math.round(size * 0.62)" />
    <span v-else class="initial">{{ label.charAt(0) }}</span>
  </span>
</template>

<style scoped>
.source-logo {
  display: inline-grid; place-items: center; flex: none; border-radius: 7px; background: #fff;
  border: 1px solid var(--border); overflow: hidden; color: #475569;
}
.source-logo img { width: 84%; height: 84%; object-fit: contain; }
.initial { font-weight: 700; font-size: 0.75em; }
</style>

<script setup lang="ts">
import { computed } from "vue";
import { scoreTone } from "../format";
import Ring from "./Ring.vue";

const props = defineProps<{ value: number; threshold?: number; large?: boolean }>();
const tone = computed(() => scoreTone(props.value, props.threshold));
</script>

<template>
  <Ring :value="value" :tone="tone" unit="%" :large="large" :caption="large ? 'compatible' : undefined" :aria-label="`Compatibilité ${value} %`" />
</template>

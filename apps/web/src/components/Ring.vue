<script setup lang="ts">
/** Anneau de progression 0-100 avec le chiffre au centre. */
defineProps<{ value: number | null; tone?: string; caption?: string; large?: boolean; unit?: string }>();
</script>

<template>
  <div class="ring" :class="[tone ?? 'accent', { lg: large }]" :style="{ '--p': value ?? 0 }">
    <span>
      <strong>{{ value === null ? "?" : Math.round(value) }}<template v-if="unit && value !== null">{{ unit }}</template></strong>
      <small v-if="caption">{{ caption }}</small>
    </span>
  </div>
</template>

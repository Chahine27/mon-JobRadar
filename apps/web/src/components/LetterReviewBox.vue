<script setup lang="ts">
import type { LetterReview } from "../types";
import Icon from "./Icon.vue";

/**
 * Relecture automatique d'une lettre (sujets sans référent, bouts de l'annonce, répétitions, fautes) :
 * tant qu'un problème n'est pas corrigé ou validé, la lettre ne part pas (PDF, envoi).
 */
const props = defineProps<{ review: LetterReview | null; blocked: string | null; dirty: boolean; busy: boolean }>();
const emit = defineEmits<{ validate: []; rerun: [] }>();

const KIND: Record<LetterReview["problems"][number]["kind"], string> = {
  sujet: "Sujet qui ne renvoie à rien",
  fragment: "Bout de phrase ou de l'annonce",
  repetition: "Répétition",
  faute: "Faute",
  fait: "Fait non prouvé",
};
</script>

<template>
  <div v-if="props.dirty" class="review info small">
    <Icon name="info" :size="15" />
    <span>Enregistre tes modifications : la lettre sera relue automatiquement avant de pouvoir partir.</span>
  </div>

  <div v-else-if="props.busy" class="review info small">
    <Icon name="refresh" :size="15" class="spin" />
    <span>Relecture en cours…</span>
  </div>

  <div v-else-if="!props.review" class="review bad small">
    <strong><Icon name="alert" :size="15" />Lettre pas encore relue</strong>
    <span>Elle a été écrite avant la relecture automatique.</span>
    <div class="row"><button type="button" class="small" @click="emit('rerun')"><Icon name="refresh" :size="14" />Relire maintenant</button></div>
  </div>

  <div v-else-if="!props.review.problems.length && !props.review.errors.length" class="review ok small">
    <strong><Icon name="check" :size="15" />Relecture : rien à signaler</strong>
  </div>

  <div v-else class="review small" :class="props.blocked ? 'bad' : 'ok'">
    <strong>
      <Icon :name="props.blocked ? 'alert' : 'check'" :size="15" />
      {{ props.blocked ? "Relecture : à corriger avant d'envoyer" : "Relecture validée par toi" }}
    </strong>
    <ul class="clean">
      <li v-for="(p, n) in props.review.problems" :key="n">
        <span class="kind">{{ KIND[p.kind] }}</span> · « {{ p.excerpt }} »<br /><span class="muted">{{ p.detail }}</span>
      </li>
      <li v-for="e in props.review.errors" :key="e" class="muted">{{ e }}</li>
    </ul>
    <div v-if="props.blocked" class="row">
      <button type="button" class="small" @click="emit('validate')"><Icon name="check" :size="14" />J'ai relu, envoyer quand même</button>
      <button v-if="props.review.errors.length" type="button" class="small ghost" @click="emit('rerun')"><Icon name="refresh" :size="14" />Relancer la relecture</button>
    </div>
    <p v-if="props.blocked" class="muted">Corrige le texte puis enregistre : la relecture repasse toute seule.</p>
  </div>
</template>

<style scoped>
.review { border-radius: 10px; padding: 0.7rem 0.9rem; display: flex; flex-direction: column; gap: 0.4rem; }
.review.info { flex-direction: row; align-items: center; gap: 0.4rem; background: var(--mid-bg); }
.review.bad { background: var(--low-bg); }
.review.ok { background: var(--good-bg); }
.review strong { display: inline-flex; align-items: center; gap: 0.4rem; }
.review.bad strong { color: var(--low); }
.review.ok strong { color: var(--good); }
.review ul { display: flex; flex-direction: column; gap: 0.35rem; margin: 0; }
.review li { display: block; }
.review p { margin: 0; }
.kind { font-weight: 600; }
.row { gap: 0.5rem; flex-wrap: wrap; }
</style>

<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError, api } from "../api";
import Icon from "../components/Icon.vue";
import { currentEmail } from "../session";

const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

async function submit() {
  error.value = null;
  loading.value = true;
  try {
    const res = await api.login(email.value, password.value);
    currentEmail.value = res.user.email;
    const redirect = typeof route.query.redirect === "string" && route.query.redirect.startsWith("/") ? route.query.redirect : "/";
    await router.push(redirect);
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) error.value = "Trop de tentatives. Réessaie dans une minute.";
    else if (e instanceof ApiError && e.status === 401) error.value = "Email ou mot de passe incorrect.";
    else error.value = "Serveur injoignable. As-tu lancé « pnpm dev » ?";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="card login stack" @submit.prevent="submit">
      <div class="head">
        <span class="brand-logo big"><Icon name="radar" :size="26" color="#fff" /></span>
        <h1>Job Radar</h1>
        <p class="muted small">Espace privé. Connecte-toi avec l'email et le mot de passe de ton fichier .env.</p>
      </div>
      <label>Email
        <div class="field"><Icon name="mail" :size="16" /><input v-model="email" type="email" autocomplete="username" required /></div>
      </label>
      <label>Mot de passe
        <div class="field"><Icon name="lock" :size="16" /><input v-model="password" type="password" autocomplete="current-password" required /></div>
      </label>
      <p v-if="error" class="alert" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>
      <button class="primary" type="submit" :disabled="loading">{{ loading ? "Connexion…" : "Se connecter" }}</button>
    </form>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh; display: grid; place-items: center; padding: 1rem;
  background:
    radial-gradient(800px 400px at 15% 10%, rgb(99 102 241 / 0.18), transparent 60%),
    radial-gradient(700px 400px at 85% 90%, rgb(34 211 238 / 0.14), transparent 60%),
    var(--bg);
}
.login { width: 100%; max-width: 400px; padding: 2rem; gap: 1rem; }
.head { display: grid; justify-items: center; gap: 0.5rem; text-align: center; margin-bottom: 0.5rem; }
.head p { margin: 0; }
.brand-logo.big { width: 52px; height: 52px; border-radius: 15px; }
.login button.primary { padding: 0.65rem; }
</style>

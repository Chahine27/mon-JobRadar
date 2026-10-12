<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError, api } from "./api";
import Icon, { type IconName } from "./components/Icon.vue";
import { resyncPush } from "./push";
import { currentEmail, setLoggedOut } from "./session";
import { setTheme, themeMode, type ThemeMode } from "./theme";

const router = useRouter();
const route = useRoute();
const menuOpen = ref(false);
watch(() => route.fullPath, () => (menuOpen.value = false));

const NAV: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/", label: "Offres", icon: "briefcase" },
  { to: "/postule", label: "Candidatures", icon: "send" },
  { to: "/ajouter", label: "Ajouter une offre", icon: "plus" },
  { to: "/entreprises", label: "Entreprises", icon: "building" },
  { to: "/sources", label: "Sources", icon: "rss" },
  { to: "/candidature", label: "CV & lettre", icon: "file" },
  { to: "/cv", label: "CV complet", icon: "star" },
  { to: "/statistiques", label: "Statistiques", icon: "target" },
  { to: "/profil", label: "Profil", icon: "user" },
  { to: "/reglages", label: "Réglages", icon: "sliders" },
];
const THEMES: Array<{ mode: ThemeMode; label: string; icon: IconName }> = [
  { mode: "auto", label: "Auto", icon: "monitor" },
  { mode: "light", label: "Clair", icon: "sun" },
  { mode: "dark", label: "Sombre", icon: "moon" },
];

/** « Offres » reste en surbrillance sur la page d'une offre. */
const isActive = (to: string) => (to === "/" ? route.path === "/" || route.path.startsWith("/offres/") : route.path.startsWith(to));
const initial = computed(() => currentEmail.value?.[0] ?? "?");

// Page visible ET fenêtre active : signalée au serveur (toutes les 10 s) pour ne pas notifier une lettre terminée sous tes yeux.
// Sans hasFocus(), un navigateur resté derrière une autre fenêtre compte encore comme « visible » sous Windows.
function ping() {
  if (currentEmail.value && document.visibilityState === "visible" && document.hasFocus()) void api.presence(route.path).catch(() => {});
}
let pingTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  pingTimer = setInterval(ping, 10_000);
  document.addEventListener("visibilitychange", ping);
  window.addEventListener("focus", ping);
});
onUnmounted(() => {
  clearInterval(pingTimer);
  document.removeEventListener("visibilitychange", ping);
  window.removeEventListener("focus", ping);
});
watch(() => route.path, ping);

// Notifications navigateur : réabonne ce navigateur s'il a perdu son abonnement (sans redemander la permission).
watch(currentEmail, (email) => email && void resyncPush(api).catch(() => {}), { immediate: true });

// Bouton « Arrêter Job Radar » : le lanceur (caché) arrête le serveur et le site.
const stopped = ref(false);
async function stopApp() {
  const question = "Arrêter Job Radar ?\n\nLa collecte des offres et les alertes s'arrêtent jusqu'au prochain lancement (raccourci « Job Radar »).";
  if (!window.confirm(question)) return;
  try {
    await api.stopApp();
    stopped.value = true;
  } catch (e) {
    window.alert(
      e instanceof ApiError && e.status === 404
        ? "Job Radar a été lancé avec « pnpm dev » : arrête-le dans son terminal (Ctrl + C)."
        : "Arrêt impossible : le serveur ne répond pas.",
    );
  }
}

async function logout() {
  await api.logout().catch(() => {});
  setLoggedOut();
  await router.push({ name: "login" });
}
</script>

<template>
  <div v-if="currentEmail" class="shell">
    <aside class="sidebar" :class="{ open: menuOpen }">
      <RouterLink to="/" class="brand">
        <span class="brand-logo"><Icon name="radar" :size="19" color="#fff" /></span>
        Job Radar
      </RouterLink>

      <div class="nav-title">Menu</div>
      <RouterLink
        v-for="item in NAV"
        :key="item.to"
        :to="item.to"
        class="nav-link"
        :class="{ 'router-link-active': isActive(item.to) }"
      >
        <Icon :name="item.icon" />
        {{ item.label }}
      </RouterLink>

      <div class="spacer" />

      <div class="side-footer">
        <div class="theme-switch" role="group" aria-label="Thème">
          <button
            v-for="t in THEMES"
            :key="t.mode"
            type="button"
            :class="{ active: themeMode === t.mode }"
            :aria-pressed="themeMode === t.mode"
            @click="setTheme(t.mode)"
          >
            <Icon :name="t.icon" :size="14" /> {{ t.label }}
          </button>
        </div>
        <button type="button" class="stop-btn" @click="stopApp"><Icon name="power" :size="16" />Arrêter Job Radar</button>
        <div class="user-row">
          <span class="avatar">{{ initial }}</span>
          <span class="email" :title="currentEmail">{{ currentEmail }}</span>
          <button class="icon-btn" type="button" title="Déconnexion" aria-label="Déconnexion" @click="logout">
            <Icon name="logout" :size="17" />
          </button>
        </div>
      </div>
    </aside>
    <div class="backdrop" :class="{ open: menuOpen }" @click="menuOpen = false" />

    <div class="content">
      <div class="mobile-bar">
        <button class="icon-btn" type="button" aria-label="Ouvrir le menu" @click="menuOpen = true"><Icon name="menu" /></button>
        <span class="brand-logo"><Icon name="radar" :size="16" color="#fff" /></span>
        Job Radar
      </div>
      <main class="page">
        <!-- Listes gardées en mémoire : filtres, onglets, offres déjà chargées et défilement retrouvés au retour. -->
        <RouterView v-slot="{ Component }">
          <KeepAlive include="DashboardView,ApplicationsView,LeadsView"><component :is="Component" /></KeepAlive>
        </RouterView>
      </main>
    </div>
  </div>
  <div v-if="stopped" class="stopped" role="alertdialog" aria-labelledby="stopped-title">
    <div class="card">
      <h2 id="stopped-title"><Icon name="power" :size="18" />Job Radar est arrêté</h2>
      <p class="muted">Tu peux fermer cet onglet. Pour le relancer : raccourci « Job Radar » (ou « Lancer Job Radar.cmd »).</p>
    </div>
  </div>
  <main v-else-if="!currentEmail" class="auth-page">
    <RouterView />
  </main>
</template>

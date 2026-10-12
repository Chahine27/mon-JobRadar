import { createRouter, createWebHistory, type RouteLocationRaw } from "vue-router";
import { ensureSession } from "./session";

export const router = createRouter({
  history: createWebHistory(),
  // Retour arrière : on revient à la position quittée. Les listes sont gardées en mémoire (cf. App.vue) ;
  // les autres pages rechargent leur contenu : on attend qu'il soit assez haut (2 s max).
  scrollBehavior: (_to, _from, saved) =>
    saved
      ? new Promise((resolve) => {
          const start = Date.now();
          const tick = () =>
            document.documentElement.scrollHeight >= saved.top + window.innerHeight || Date.now() - start > 2000
              ? resolve(saved)
              : requestAnimationFrame(tick);
          tick();
        })
      : { top: 0 },
  routes: [
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
    { path: "/", name: "jobs", component: () => import("./views/DashboardView.vue") },
    { path: "/postule", name: "applications", component: () => import("./views/ApplicationsView.vue") },
    { path: "/ajouter", name: "add-job", component: () => import("./views/ManualJobView.vue") },
    { path: "/offres/:id", name: "job", component: () => import("./views/JobDetailView.vue"), props: true },
    { path: "/entreprises", name: "leads", component: () => import("./views/LeadsView.vue") },
    { path: "/entreprises/pretes", name: "spontaneous-batch", component: () => import("./views/SpontaneousBatchView.vue") },
    { path: "/entreprises/:id/candidature", name: "spontaneous", component: () => import("./views/SpontaneousView.vue"), props: true },
    { path: "/sources", name: "sources", component: () => import("./views/SourcesView.vue") },
    { path: "/candidature", name: "letter-kit", component: () => import("./views/LetterKitView.vue") },
    { path: "/cv", name: "cv-master", component: () => import("./views/CvMasterView.vue") },
    { path: "/reglages", name: "settings", component: () => import("./views/SettingsView.vue") },
    { path: "/statistiques", name: "stats", component: () => import("./views/StatsView.vue") },
    { path: "/profil", name: "profile", component: () => import("./views/ProfileView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  const loggedIn = await ensureSession();
  if (!to.meta.public && !loggedIn) return { name: "login", query: { redirect: to.fullPath } };
  if (to.name === "login" && loggedIn) return { name: "jobs" };
});

/** Lien « Retour » : revient à la page précédente (et à sa position) ; page ouverte directement → `fallback`. */
export function goBack(fallback: RouteLocationRaw) {
  return window.history.state?.back ? router.back() : router.push(fallback);
}

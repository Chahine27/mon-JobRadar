import { ref } from "vue";

/** auto = suit le réglage clair/sombre de Windows. */
export type ThemeMode = "auto" | "light" | "dark";
const KEY = "jobradar.theme";

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export const themeMode = ref<ThemeMode>(read());

function apply(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "auto") delete root.dataset.theme;
  else root.dataset.theme = mode;
}

export function setTheme(mode: ThemeMode) {
  themeMode.value = mode;
  apply(mode);
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* stockage indisponible : le choix vaut pour cette visite */
  }
}

export function initTheme() {
  apply(themeMode.value);
}

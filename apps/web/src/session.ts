import { ref } from "vue";
import { api } from "./api";

export const currentEmail = ref<string | null>(null);
let checked = false;

/** Vérifie une seule fois au chargement si une session existe déjà. */
export async function ensureSession(): Promise<boolean> {
  if (!checked) {
    checked = true;
    try {
      currentEmail.value = (await api.me()).user.email;
    } catch {
      currentEmail.value = null;
    }
  }
  return currentEmail.value !== null;
}

export function setLoggedOut() {
  currentEmail.value = null;
}

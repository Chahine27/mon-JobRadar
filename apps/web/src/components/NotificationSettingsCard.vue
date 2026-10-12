<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError, api } from "../api";
import { currentSubscription, pushSupported, rememberPushOff, subscribeThisBrowser, unsubscribeThisBrowser } from "../push";
import type { NotificationSettings } from "../types";
import Icon from "./Icon.vue";

const s = ref<NotificationSettings | null>(null);
const emailTo = ref("");
const thisBrowser = ref(false);
const busy = ref(false);
const message = ref<{ ok: boolean; text: string } | null>(null);

async function load() {
  s.value = await api.getNotificationSettings();
  emailTo.value = s.value.emailTo ?? "";
  thisBrowser.value = (await currentSubscription().catch(() => null)) !== null;
}
onMounted(load);

async function run(fn: () => Promise<unknown>, ok: string) {
  busy.value = true;
  message.value = null;
  try {
    await fn();
    message.value = { ok: true, text: ok };
    await load();
  } catch (e) {
    message.value = { ok: false, text: e instanceof Error ? e.message : String(e) };
  } finally {
    busy.value = false;
  }
}

const save = () =>
  run(
    () =>
      api.saveNotificationSettings({
        emailEnabled: s.value!.emailEnabled,
        pushEnabled: s.value!.pushEnabled,
        emailTo: emailTo.value.trim() || null,
      }),
    "Réglages des notifications enregistrés.",
  );

const enableBrowser = () =>
  run(async () => {
    const sub = await subscribeThisBrowser(s.value!.vapidPublicKey!);
    await api.subscribePush(sub);
    rememberPushOff(false);
  }, "Ce navigateur recevra les notifications.");

const disableBrowser = () =>
  run(async () => {
    const endpoint = await unsubscribeThisBrowser();
    if (endpoint) await api.unsubscribePush(endpoint);
    rememberPushOff(true);
  }, "Ce navigateur ne recevra plus de notifications.");

const test = (channel: "email" | "webpush") =>
  run(async () => {
    try {
      await api.testNotification(channel);
    } catch (e) {
      if (e instanceof ApiError && e.code === "SEND_FAILED") throw new Error(`Échec de l'envoi : ${e.message}`);
      throw e;
    }
  }, channel === "email" ? "Email de test envoyé : vérifie ta boîte (et les spams)." : "Notification de test envoyée.");
</script>

<template>
  <section class="card stack">
    <div>
      <h2><Icon name="bell" :size="17" />Notifications</h2>
      <p class="muted small" style="margin: -0.4rem 0 0">
        Une alerte arrive quand une <strong>nouvelle</strong> offre dépasse ton seuil de notification. Jamais deux fois pour la même offre.
      </p>
    </div>
    <div v-if="!s" class="muted small">Chargement…</div>
    <template v-else>
      <div class="grid-2">
        <div class="channel stack">
          <label class="switch"><input v-model="s.emailEnabled" type="checkbox" /><Icon name="mail" :size="16" /> Par email</label>
          <p v-if="!s.emailConfigured" class="small warn-text">
            Email non configuré : remplis SMTP_HOST, SMTP_USER et SMTP_PASSWORD dans .env, puis relance « pnpm dev ».
          </p>
          <label>Adresse de réception <input v-model="emailTo" type="email" placeholder="Par défaut : NOTIFY_EMAIL_TO du .env" /></label>
        </div>

        <div class="channel stack">
          <label class="switch"><input v-model="s.pushEnabled" type="checkbox" /><Icon name="monitor" :size="16" /> Dans le navigateur</label>
          <p v-if="!s.pushConfigured" class="small warn-text">
            Notifications navigateur non configurées : lance « pnpm setup:push » puis relance « pnpm dev ».
          </p>
          <p v-else-if="!pushSupported()" class="small warn-text">Ce navigateur ne gère pas les notifications.</p>
          <div v-else class="stack" style="gap: 0.5rem">
            <span class="small muted">
              <span class="dot" :class="thisBrowser ? 'good' : ''" style="display: inline-block; margin-right: 0.4rem" />
              {{ thisBrowser ? "Ce navigateur est abonné." : "Ce navigateur n'est pas abonné." }} ({{ s.subscriptions }} abonné(s) au total)
            </span>
            <div>
              <button v-if="!thisBrowser" type="button" class="small" :disabled="busy" @click="enableBrowser">Activer sur ce navigateur</button>
              <button v-else type="button" class="small" :disabled="busy" @click="disableBrowser">Désactiver ici</button>
            </div>
          </div>
        </div>
      </div>

      <div class="row">
        <button type="button" class="primary" :disabled="busy" @click="save"><Icon name="save" :size="16" />Enregistrer les réglages</button>
        <button type="button" :disabled="busy || !s.emailConfigured" @click="test('email')">Tester l'email</button>
        <button type="button" :disabled="busy || !s.pushConfigured || !thisBrowser" @click="test('webpush')">Tester le navigateur</button>
      </div>
      <p v-if="message" :class="message.ok ? 'success' : 'alert'" role="status">
        <Icon :name="message.ok ? 'check' : 'alert'" :size="16" />{{ message.text }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.channel { padding: 0.9rem 1rem; background: var(--surface-2); border-radius: var(--radius-sm); align-content: start; }
.warn-text { color: var(--mid); margin: 0; }
</style>

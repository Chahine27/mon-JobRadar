/** Abonnement de CE navigateur aux notifications (service worker + Push API). */

function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function subscribeThisBrowser(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  if (!pushSupported()) throw new Error("Ce navigateur ne gère pas les notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Autorisation refusée : active les notifications pour localhost dans ton navigateur.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(vapidPublicKey) }));
  return sub.toJSON();
}

export async function unsubscribeThisBrowser(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

/** « Désactiver ici » (Profil → Notifications) : ce navigateur ne doit plus être réabonné tout seul. */
const OFF_KEY = "job-radar.push-off";
export function rememberPushOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {}
}

/**
 * Au chargement : le navigateur perd parfois son abonnement (le serveur reçoit alors « 410 » et l'oublie).
 * Si la permission est toujours accordée, on se réabonne sans rien demander et on le renvoie au serveur.
 */
export async function resyncPush(api: {
  getNotificationSettings(): Promise<{ pushConfigured: boolean; vapidPublicKey: string | null }>;
  subscribePush(sub: PushSubscriptionJSON): Promise<unknown>;
}) {
  let off = false;
  try {
    off = localStorage.getItem(OFF_KEY) === "1";
  } catch {}
  if (off || !pushSupported() || Notification.permission !== "granted") return;
  const s = await api.getNotificationSettings();
  if (!s.pushConfigured || !s.vapidPublicKey) return;
  await api.subscribePush(await subscribeThisBrowser(s.vapidPublicKey));
}

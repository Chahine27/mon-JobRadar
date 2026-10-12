// Service worker de Job Radar : affiche les notifications envoyées par le serveur.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Job Radar", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Job Radar", {
      body: data.body || "",
      tag: data.tag,
      icon: "/favicon.svg",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  if (url.origin !== self.location.origin) return; // n'ouvre que Job Radar
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client && "navigate" in client) {
          return client.navigate(url.href).then((c) => (c ?? client).focus());
        }
      }
      return self.clients.openWindow(url.href);
    }),
  );
});

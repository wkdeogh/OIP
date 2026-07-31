/* global self, clients */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let message = {
    title: "OIP",
    body: "새 일정 알림이 도착했습니다.",
    url: "/",
  };

  try {
    if (event.data) message = { ...message, ...event.data.json() };
  } catch {
    if (event.data) message.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/oip_logo.png",
      badge: "/oip_logo.png",
      tag: message.date ? `oip-calendar-${message.date}` : "oip-notification",
      data: { url: message.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  );

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windowClients) => {
        const currentClient = windowClients[0];
        if (currentClient) {
          if ("navigate" in currentClient) {
            await currentClient.navigate(targetUrl.href);
          }
          return currentClient.focus();
        }
        return clients.openWindow(targetUrl.href);
      }),
  );
});

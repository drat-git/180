/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  precacheAndRoute,
  createHandlerBoundToURL,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));
clientsClaim();
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});
self.addEventListener("push", (event) => {
  let tag = "180-checklist";
  try {
    const data = event.data?.json();
    if (typeof data?.tag === "string") tag = data.tag.slice(0, 150);
  } catch {
    /* Always display a valid fallback notification. */
  }
  event.waitUntil(
    self.registration.showNotification("Daily checklist", {
      body: "Take a moment to record your day.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag,
      data: { url: "/?view=today" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: "OPEN_TODAY" });
      } else
        await self.clients.openWindow(
          new URL("/?view=today", self.location.origin).href,
        );
    })(),
  );
});

"use client";

import { useEffect } from "react";

const CACHE_PREFIX = "teams-static-";

// Dev builds share the origin with production runs, so a production SW left behind
// would serve stale chunks to `next dev`. Remove it and its caches there.
async function removeServiceWorker(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
  }
}

// Registers the PWA service worker in production builds only (dev HMR would fight it).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const task = process.env.NODE_ENV === "production"
      ? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      : removeServiceWorker();
    task.catch((error: unknown) => console.warn("service worker setup failed", error));
  }, []);
  return null;
}

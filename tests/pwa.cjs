/* eslint-disable @typescript-eslint/no-require-imports -- Local-only PWA check (manifest, service worker, icons). */
// Runs against a local production server (the service worker registers only in production).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { installGameWorldMock } = require("./helpers/game-world-mock.cjs");
const baseURL = process.env.TEST_BASE_URL || "http://localhost:3001";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Only a local test server is allowed.");

const PUBLIC_PATHS = ["/manifest.webmanifest", "/sw.js", "/icons/icon-192.png", "/offline.html"];
const CACHE_ALLOWED = ["/_next/static/", "/icons/", "/offline.html"];

/** Width and height from a PNG IHDR chunk. */
function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG", "not a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function checkStatic() {
  // T1 manifest
  const res = await fetch(`${baseURL}/manifest.webmanifest`);
  assert.equal(res.status, 200, "manifest status");
  assert.match(res.headers.get("content-type") || "", /manifest\+json/);
  const manifest = await res.json();
  assert.ok(manifest.name && manifest.short_name, "manifest names");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.theme_color && manifest.background_color, "manifest colors");
  const icons = manifest.icons || [];
  assert.ok(icons.some((i) => i.sizes === "192x192" && (i.purpose || "any") === "any"), "192 any icon");
  assert.ok(icons.some((i) => i.sizes === "512x512" && (i.purpose || "any") === "any"), "512 any icon");
  assert.ok(icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"), "512 maskable icon");

  // T3 icons exist with matching sizes
  for (const icon of icons) {
    const r = await fetch(new URL(icon.src, baseURL));
    assert.equal(r.status, 200, `icon ${icon.src}`);
    assert.match(r.headers.get("content-type") || "", /image\/png/);
    const { width, height } = pngSize(Buffer.from(await r.arrayBuffer()));
    assert.equal(`${width}x${height}`, icon.sizes, `icon size ${icon.src}`);
  }

  // T4 reachable without any session cookie
  for (const p of PUBLIC_PATHS) {
    const r = await fetch(`${baseURL}${p}`, { redirect: "manual" });
    assert.equal(r.status, 200, `public ${p}`);
  }

  // T5 sw.js headers and no push handler
  const sw = await fetch(`${baseURL}/sw.js`);
  assert.match(sw.headers.get("content-type") || "", /javascript/);
  assert.match(sw.headers.get("cache-control") || "", /no-cache/);
  assert.doesNotMatch(await sw.text(), /addEventListener\(\s*["']push["']/, "no push listener");
  return manifest;
}

async function cachedUrls(page) {
  return page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) out.push(req.url);
    }
    return out;
  });
}

async function checkBrowser() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "Asia/Seoul", locale: "en-US" });
    await installGameWorldMock(context);
    let probeHits = 0;
    await context.route("**/api/pwa-probe", (route) => {
      probeHits++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ n: probeHits }) });
    });
    await context.addInitScript(() => { try { localStorage.setItem("teams-hub-view", "garage"); } catch { /* storage blocked */ } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });

    // T2 head tags
    assert.equal(await page.locator('link[rel="manifest"][href="/manifest.webmanifest"]').count(), 1, "manifest link");
    assert.ok(await page.locator('meta[name="theme-color"]').count() >= 1, "theme-color meta");

    // T6 registration (ready never settles without a registration, so race a timeout)
    const reg = await page.evaluate(async () => {
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 15000));
      const r = await Promise.race([navigator.serviceWorker.ready, timeout]);
      return r && { scope: r.scope, script: r.active && r.active.scriptURL };
    });
    assert.ok(reg, "no service worker registered — run against a production build (next start)");
    assert.equal(reg.scope, `${baseURL}/`);
    assert.ok(reg.script && reg.script.endsWith("/sw.js"), "active sw.js");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });

    // T7 API never served from cache
    const bodies = await page.evaluate(async () => {
      const a = await (await fetch("/api/pwa-probe")).text();
      const b = await (await fetch("/api/pwa-probe")).text();
      return [a, b];
    });
    assert.equal(probeHits, 2, "API hit network twice");
    assert.notEqual(bodies[0], bodies[1], "API responses differ");

    // Requests that must bypass the cache even though they are same-origin GETs.
    await page.evaluate(async () => {
      await fetch("/", { headers: { Authorization: "Bearer test" } }).catch(() => {});
      await fetch("/?_rsc=pwa").catch(() => {});
      await fetch("/_next/static/pwa-probe.js", { headers: { Authorization: "Bearer test" } }).catch(() => {});
    });

    // T7/T8 cache only holds static assets (cache.put is async, so poll for static chunks)
    await page.reload({ waitUntil: "load" });
    let urls = [];
    for (let i = 0; i < 20; i++) {
      urls = await cachedUrls(page);
      if (urls.some((u) => new URL(u).pathname.startsWith("/_next/static/"))) break;
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(500);
    urls = await cachedUrls(page);
    assert.ok(urls.some((u) => new URL(u).pathname.startsWith("/_next/static/")), "static chunks cached");
    assert.ok(!urls.some((u) => u.includes("pwa-probe")), "Authorization request cached");
    for (const url of urls) {
      const { pathname, search, origin } = new URL(url);
      assert.equal(origin, new URL(baseURL).origin, `cross-origin cached ${url}`);
      assert.ok(CACHE_ALLOWED.some((p) => pathname.startsWith(p)), `unexpected cached ${url}`);
      assert.ok(!search.includes("_rsc"), `rsc cached ${url}`);
    }

    // T10 garage still renders under SW control
    await page.getByTestId("garage").first().waitFor({ timeout: 15000 });

    // T9 offline fallback
    await context.setOffline(true);
    await page.goto(`${baseURL}/?offline-check=1`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.getByTestId("offline-page").waitFor({ timeout: 10000 });
    assert.equal(await page.title(), "Teams — 오프라인");
    await context.setOffline(false);
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.getByTestId("garage").first().waitFor({ timeout: 15000 });

    assert.deepEqual(errors, [], "page errors");
  } finally {
    await browser.close();
  }
}

(async () => {
  await checkStatic();
  console.log("PASS pwa static (manifest, icons, public access, sw headers)");
  await checkBrowser();
  console.log("PASS pwa browser (registration, no API/HTML cache, offline, garage)");
})().catch((error) => {
  console.error(`FAIL pwa: ${error.message}`);
  process.exitCode = 1;
});

/* eslint-disable @typescript-eslint/no-require-imports -- One-off icon generator (run manually, output is committed). */
// Usage: node scripts/generate-pwa-icons.cjs
// Needs sharp, which is present as Next's optional dependency (not declared in package.json).
// After changing icons, bump VERSION in public/sw.js so installed apps refresh them.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const svg = fs.readFileSync(path.join(__dirname, "pwa-icon.svg"));
const outDir = path.join(root, "public", "icons");
const BG = "#171717";

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await sharp(svg).resize(512, 512).png().toFile(path.join(outDir, "icon-512.png"));
  await sharp(svg).resize(192, 192).png().toFile(path.join(outDir, "icon-192.png"));
  // Maskable: shrink artwork to 60% so it stays inside the 80% safe circle.
  const inner = 308;
  const pad = (512 - inner) / 2;
  await sharp(svg).resize(inner, inner).extend({ top: pad, bottom: pad, left: pad, right: pad, background: BG })
    .png().toFile(path.join(outDir, "icon-maskable-512.png"));
  console.log("icons written to", outDir);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

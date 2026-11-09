/* eslint-disable @typescript-eslint/no-require-imports -- Pure healing helpers, no network. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/team/healing.ts"), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const storage = new Map();
const sandbox = { exports: {}, module: { exports: {} }, window: { localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } } };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(outputText, sandbox);
const h = sandbox.module.exports;

assert.equal(h.weatherEffect(0), "clear");
assert.equal(h.weatherEffect(3), "cloudy");
assert.equal(h.weatherEffect(45), "fog");
assert.equal(h.weatherEffect(61), "rain");
assert.equal(h.weatherEffect(81), "rain");
assert.equal(h.weatherEffect(95), "rain");
assert.equal(h.weatherEffect(73), "snow");
assert.equal(h.weatherEffect(86), "snow");
assert.equal(h.sceneForWeather({ effect: "clear", isDay: true }), "beach");
assert.equal(h.sceneForWeather({ effect: "rain", isDay: true }), "rooftop");
assert.equal(h.sceneForWeather({ effect: "snow", isDay: true }), "snow-forest");
assert.equal(h.sceneForWeather({ effect: "clear", isDay: false }), "rooftop-night");
assert.equal(h.formatRemaining(600_000), "10:00");
assert.equal(h.formatRemaining(61_001), "1:02");
assert.equal(h.formatRemaining(-5), "0:00");
assert.deepEqual({ ...h.parseWeather({ current: { weather_code: 61, is_day: 1, temperature_2m: 12.6 } }) }, { effect: "rain", isDay: true, temperature: 12.6, label: "비" });
assert.equal(h.parseWeather({ current: { weather_code: 0, is_day: 0 } }).temperature, null);
assert.throws(() => h.parseWeather({}), /날씨 응답/);
assert.throws(() => h.parseWeather(null), /날씨 응답/);
assert.equal(h.findScene("nope").id, "beach");
for (const scene of h.HEALING_SCENES) assert.ok(fs.existsSync(path.resolve(__dirname, "../public", `.${scene.image}`)), scene.image);

assert.deepEqual({ ...h.loadHealingPrefs() }, { sceneId: "auto", cityId: "seoul", minutes: 10 });
h.saveHealingPrefs({ sceneId: "fishing", cityId: "busan", minutes: 15 });
assert.deepEqual({ ...h.loadHealingPrefs() }, { sceneId: "fishing", cityId: "busan", minutes: 15 });
storage.set("teams:healing", JSON.stringify({ sceneId: "<script>", cityId: "mars", minutes: 999 }));
assert.deepEqual({ ...h.loadHealingPrefs() }, { sceneId: "beach", cityId: "seoul", minutes: 10 });
storage.set("teams:healing", "{broken");
assert.equal(h.loadHealingPrefs().sceneId, "auto");
sandbox.window.localStorage.setItem = () => { throw new Error("quota"); };
assert.doesNotThrow(() => h.saveHealingPrefs({ sceneId: "auto", cityId: "seoul", minutes: 5 }));
console.log("PASS: healing weather mapping, scene suggestion, timer text, weather parsing, bundled panoramas, safe preferences.");

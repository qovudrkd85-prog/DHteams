/* eslint-disable @typescript-eslint/no-require-imports -- Node verification launcher. */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const root = path.resolve(__dirname, "..");
const suites = ["account-browser.cjs", "department-dashboard.cjs", "team-workspace.cjs", "project-workspace.cjs"];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

(async () => {
  let server;
  let log;
  try {
    let baseURL = process.env.TEST_BASE_URL;
    if (!baseURL) {
      if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) throw new Error("Run npm run build before browser verification.");
      const port = await freePort();
      baseURL = `http://127.0.0.1:${port}`;
      fs.mkdirSync(path.join(root, "artifacts", "logs"), { recursive: true });
      log = fs.openSync(path.join(root, "artifacts", "logs", "browser-server.log"), "w");
      server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, stdio: ["ignore", log, log] });
      server.on("error", (error) => { console.error(error.message); });
      let ready = false;
      for (let attempt = 0; attempt < 90; attempt++) {
        if (server.exitCode !== null) throw new Error("Test server stopped. See artifacts/logs/browser-server.log.");
        try {
          const result = await fetch(baseURL, { signal: AbortSignal.timeout(1000) });
          if (result.ok) { ready = true; break; }
        } catch { /* Wait for the isolated server to become ready. */ }
        await delay(500);
      }
      if (!ready) throw new Error("Test server did not start. See artifacts/logs/browser-server.log.");
    }
    for (const suite of suites) {
      console.log(`\nRunning ${suite}`);
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(root, "tests", suite)], { cwd: root, env: { ...process.env, TEST_BASE_URL: baseURL }, stdio: "inherit", windowsHide: true });
        child.once("error", reject);
        child.once("exit", (exitCode) => resolve(exitCode));
      });
      if (code !== 0) throw new Error(`${suite} failed.`);
    }
  } finally {
    if (server && server.exitCode === null) {
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
    }
    if (log !== undefined) fs.closeSync(log);
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

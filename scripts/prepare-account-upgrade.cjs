/* eslint-disable @typescript-eslint/no-require-imports -- Generates the SQL Editor handoff. */
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const sources = ["schema-team-workspace.sql", "schema-accounts.sql"];
const content = sources.map((name) => {
  const sql = fs.readFileSync(path.join(root, "supabase", name), "utf8");
  if ((sql.match(/^begin;\s*$/gm) || []).length !== 1 || (sql.match(/^commit;\s*$/gm) || []).length !== 1) {
    throw new Error(`Expected one outer transaction in ${name}. Review before generating.`);
  }
  return `-- SOURCE: supabase/${name}\n${sql.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "").trim()}`;
});
const folder = path.join(root, "artifacts", "setup");
fs.mkdirSync(folder, { recursive: true });
const target = path.join(folder, "teams-account-upgrade.sql");
fs.writeFileSync(target, `-- DH Teams: existing installation office + account upgrade.\n-- Run the ENTIRE file in Supabase SQL Editor. Existing department_events is required.\n-- Generated from the source migrations. One transaction: any error rolls everything back.\n-- After success, turn off Auth Confirm Email and deploy the account-enabled app.\nbegin;\n\n${content.join("\n\n")}\n\ncommit;\n`, "utf8");
console.log(`Prepared: ${target}`);

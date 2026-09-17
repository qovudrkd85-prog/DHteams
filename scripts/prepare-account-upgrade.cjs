/* eslint-disable @typescript-eslint/no-require-imports -- Generates the SQL Editor handoff. */
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const sources = ["schema-team-workspace.sql", "schema-accounts.sql", "schema-office-presence.sql"];
const content = new Map(sources.map((name) => {
  const sql = fs.readFileSync(path.join(root, "supabase", name), "utf8");
  if ((sql.match(/^begin;\s*$/gm) || []).length !== 1 || (sql.match(/^commit;\s*$/gm) || []).length !== 1) {
    throw new Error(`Expected one outer transaction in ${name}. Review before generating.`);
  }
  return [name, `-- SOURCE: supabase/${name}\n${sql.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "").trim()}`];
}));
const folder = path.join(root, "artifacts", "setup");
fs.mkdirSync(folder, { recursive: true });
const bundles = [
  {
    name: "teams-account-upgrade.sql",
    description: "existing installation office + account + world upgrade",
    prerequisite: "Existing base tables and department_events are required. Office presence is applied LAST.",
    sources,
  },
  {
    name: "teams-office-world-upgrade.sql",
    description: "office world upgrade for an account-enabled installation",
    prerequisite: "The team workspace and account migrations must already be installed.",
    sources: ["schema-office-presence.sql"],
  },
];
for (const bundle of bundles) {
  const target = path.join(folder, bundle.name);
  const sql = bundle.sources.map((name) => content.get(name)).join("\n\n");
  fs.writeFileSync(target, `-- DH Teams: ${bundle.description}.\n-- Run the ENTIRE file manually in Supabase SQL Editor BEFORE deploying the matching app.\n-- ${bundle.prerequisite}\n-- Generated locally; this command never applies SQL to a database.\n-- One transaction: any error rolls everything back. Existing records are preserved.\nbegin;\n\n${sql}\n\ncommit;\n`, "utf8");
  console.log(`Prepared: ${target}`);
}

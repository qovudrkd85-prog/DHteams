/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL personal notes / PC file checks. */
// Local in-memory PostgreSQL only. No .env reads or Supabase connections.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");

const ids = {
  alice: "40000000-0000-0000-0000-000000000001",
  bob: "40000000-0000-0000-0000-000000000002",
};
const setupSql = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key, email text unique, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
`;
const baseSchemas = ["schema", "schema-open-mode", "schema-update-all", "schema-trash", "schema-department-events", "schema-team-workspace", "schema-accounts", "schema-office-presence", "schema-teams", "schema-team-memberships"];
const tables = ["personal_note_folders", "personal_notes", "pc_folders", "pc_files", "pc_file_memos"];

const readSql = (name) => fs.readFileSync(path.resolve(__dirname, `../supabase/${name}.sql`), "utf8");

async function openDb() {
  const db = new PGlite();
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const rejects = async (sql, params = [], code = "42501") => assert.rejects(db.query(sql, params), (error) => {
    assert.equal(error.code, code, `${sql}: ${error.message}`);
    return true;
  });
  const session = async (userId) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ""]);
    await db.exec("set role authenticated");
  };
  const admin = () => db.exec("reset role");
  await db.exec(setupSql);
  for (const schema of baseSchemas) await db.exec(readSql(schema));
  const members = {};
  for (const [username, id] of Object.entries(ids)) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)", [id, `${username}@members.dhteams.invalid`, JSON.stringify({ username })]);
    members[username] = await one("update team_members set profile_completed = true where user_id = $1 returning *", [id]);
  }
  return { db, one, rows, rejects, session, admin, members };
}

const tableCount = async (one) => Number((await one(
  `select count(*) as n from unnest($1::text[]) as t(name) where to_regclass('public.' || t.name) is not null`, [tables])).n);

(async () => {
  const { db, one, rows, rejects, session, admin, members } = await openDb();
  const { alice, bob } = members;

  // 1. Install twice is safe and creates the five tables.
  await db.exec(readSql("schema-personal-library"));
  await db.exec(readSql("schema-personal-library"));
  assert.equal(await tableCount(one), 5, "All five personal tables must exist.");

  // 2. owner_id fills itself from the signed-in member.
  await session(ids.alice);
  const note = await one("insert into personal_notes(title, content) values ('첫 메모', '본문') returning *");
  assert.equal(note.owner_id, alice.id, "owner_id must default to the current member.");
  assert.ok(note.client_id, "client_id must default to a uuid text.");

  // 3. Other people see and change nothing, and cannot write rows for someone else.
  await session(ids.bob);
  assert.equal((await rows("select id from personal_notes")).length, 0, "Bob must not see Alice's notes.");
  assert.equal((await rows("update personal_notes set title = 'x' returning id")).length, 0, "Bob must not update Alice's notes.");
  await rejects("insert into personal_notes(owner_id, title) values ($1, 'x')", [alice.id]);
  await rejects("insert into pc_file_memos(owner_id, file_path, memo) values ($1, 'C:/a.txt', 'x')", [alice.id]);

  // 4. Same client_id upsert twice keeps one row and moves updated_at; owner/client_id are fixed.
  await session(ids.alice);
  const upsert = "insert into personal_notes(client_id, title) values ('c1', $1) on conflict (owner_id, client_id) do update set title = excluded.title returning *";
  await one(upsert, ["v1"]);
  const firstStamp = (await one("select updated_at::text as t from personal_notes where client_id = 'c1'")).t;
  const second = await one(upsert, ["v2"]);
  assert.equal((await rows("select id from personal_notes where client_id = 'c1'")).length, 1, "Upsert must keep one row.");
  assert.equal(second.title, "v2");
  assert.equal((await one("select updated_at > $1::timestamptz as moved from personal_notes where client_id = 'c1'", [firstStamp])).moved, true, "updated_at must move on update.");
  await rejects("update personal_notes set owner_id = $1 where client_id = 'c1'", [bob.id]);
  await rejects("update personal_notes set client_id = 'c2' where client_id = 'c1'");
  // 4b. An upsert with identical content is a no-op: updated_at stays (no sync ping-pong).
  const secondStamp = (await one("select updated_at::text as t from personal_notes where client_id = 'c1'")).t;
  await one(upsert, ["v2"]);
  assert.equal((await one("select updated_at::text as t from personal_notes where client_id = 'c1'")).t, secondStamp, "Unchanged upsert must keep updated_at.");

  // 4c. Indexes: sync pulls (tombstones included) and the pinned-first list are covered; no duplicate memo index.
  await admin();
  const indexDefs = (await rows("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1::text[])", [tables]))
    .reduce((all, row) => ({ ...all, [row.indexname]: row.indexdef }), {});
  for (const name of ["personal_notes_sync_idx", "pc_file_memos_sync_idx"]) {
    assert.match(indexDefs[name] || "", /\(owner_id, updated_at\)$/, `${name} must index (owner_id, updated_at) without a deleted_at filter.`);
  }
  assert.match(indexDefs.personal_notes_list_idx || "", /\(owner_id, pinned DESC, updated_at DESC\) WHERE/, "List index must match pinned desc, updated_at desc.");
  assert.match(indexDefs.personal_notes_folder_idx || "", /\(folder_id, owner_id\) WHERE \(folder_id IS NOT NULL\)/, "Folder index must cover the composite FK.");
  assert.match(indexDefs.pc_files_folder_idx || "", /\(folder_id, owner_id\)$/, "PC file folder index must cover the composite FK.");
  assert.equal(indexDefs.pc_file_memos_owner_idx, undefined, "Duplicate memo owner index must be gone.");
  await session(ids.alice);

  // 4d. Bad sizes are rejected: negative counts, over-long ids and byte-heavy paths.
  await rejects("insert into pc_folders(path, depth) values ('C:/neg', -1)", [], "23514");
  await rejects("insert into pc_folders(path, file_count) values ('C:/neg', -1)", [], "23514");
  await rejects("insert into pc_folders(path, device_id) values ('C:/long', $1)", ["d".repeat(101)], "23514");
  await rejects("insert into pc_file_memos(file_path) values ($1)", ["가".repeat(800)], "23514");
  await rejects("insert into personal_notes(client_id) values ($1)", ["c".repeat(101)], "23514");

  // 5. Notes are soft-deleted only; PC file lists are really deleted, folders cascade to files.
  await rejects("delete from personal_notes where client_id = 'c1'");
  const folder = await one("insert into pc_folders(path, name, depth) values ('C:/work', 'work', 1) returning *");
  const file = await one("insert into pc_files(folder_id, file_name, file_path) values ($1, 'a.txt', 'C:/work/a.txt') returning *", [folder.id]);
  assert.equal(file.device_id, "", "device_id must default to empty text.");
  assert.equal((await rows("delete from pc_files where id = $1 returning id", [file.id])).length, 1, "Owner deletes own PC file rows.");
  await one("insert into pc_files(folder_id, file_name, file_path) values ($1, 'b.txt', 'C:/work/b.txt') returning id", [folder.id]);
  await one("delete from pc_folders where id = $1 returning id", [folder.id]);
  assert.equal((await rows("select id from pc_files")).length, 0, "Deleting a folder removes its files.");

  // 6. Replacing a folder's file list keeps file memos (memos follow the path, not the row).
  const folder2 = await one("insert into pc_folders(path, name, depth) values ('C:/docs', 'docs', 1) returning *");
  await one("insert into pc_files(folder_id, file_name, file_path) values ($1, 'r.hwp', 'C:/docs/r.hwp') returning id", [folder2.id]);
  await one("insert into pc_file_memos(file_path, memo) values ('C:/docs/r.hwp', '검토 중') returning id");
  await rows("delete from pc_files where folder_id = $1", [folder2.id]);
  await one("insert into pc_files(folder_id, file_name, file_path) values ($1, 'r.hwp', 'C:/docs/r.hwp') returning id", [folder2.id]);
  assert.equal((await rows("select memo from pc_file_memos where file_path = 'C:/docs/r.hwp'")).length, 1, "File memo must survive list replacement.");
  await one("insert into personal_note_folders(name) values ('업무') returning id");

  // 7. Switching or leaving teams keeps personal rows (they belong to the person, not the team).
  const teamA = await one("select * from create_team('A팀')");
  await session(ids.bob);
  await one("select * from join_team($1)", [teamA.invite_code]);
  await one("insert into personal_notes(title) values ('밥 메모') returning id");
  await rejects("insert into pc_files(folder_id, file_name, file_path) values ($1, 'x', 'C:/x')", [folder2.id], "23503");
  await one("select leave_team()");
  assert.equal((await rows("select id from personal_notes")).length, 1, "Bob keeps his note after leaving a team.");
  await session(ids.alice);
  await one("select * from create_team('B팀')");
  await one("select switch_team($1)", [teamA.id]);
  assert.equal((await rows("select id from personal_notes")).length, 2, "Alice keeps her notes after switching teams.");

  // 8. Anonymous visitors are blocked.
  await admin();
  await db.exec("set role anon");
  for (const table of tables) await rejects(`select * from ${table}`);

  // 9. Rollback removes only the five tables and helpers; other data stays; reinstall works.
  await admin();
  const before = await one("select (select count(*) from team_members) as members, (select count(*) from teams) as teams");
  await db.exec(readSql("rollback-personal-library"));
  assert.equal(await tableCount(one), 0, "Rollback must drop all five tables.");
  const fns = await one("select to_regprocedure('public.touch_personal_row()') as touch, to_regprocedure('public.stamp_personal_owner()') as stamp");
  assert.equal(fns.touch, null);
  assert.equal(fns.stamp, null);
  assert.deepEqual(await one("select (select count(*) from team_members) as members, (select count(*) from teams) as teams"), before, "Rollback must keep other tables.");
  await db.exec(readSql("schema-personal-library"));
  assert.equal(await tableCount(one), 5, "Reinstall after rollback must work.");

  await db.close();
  console.log("PASS: personal library — install twice, owner fill, isolation, upsert, deletes, memos, teams, anon, rollback.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

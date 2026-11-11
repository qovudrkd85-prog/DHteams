/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL checks for schedule conflict guard and memo items. */
// Local in-memory PostgreSQL only. No .env reads or Supabase connections.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");

const ids = {
  alice: "40000000-0000-0000-0000-000000000001",
  bob: "40000000-0000-0000-0000-000000000002",
  carol: "40000000-0000-0000-0000-000000000003",
};
const setupSql = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key, email text unique, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
`;
const baseSchemas = ["schema", "schema-open-mode", "schema-update-all", "schema-trash", "schema-department-events", "schema-team-workspace", "schema-accounts", "schema-office-presence", "schema-teams", "schema-team-memberships"];

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
  // SQL Editor: superuser without a JWT, so auth.uid() is null.
  const admin = async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  };
  await db.exec(setupSql);
  for (const schema of baseSchemas) await db.exec(readSql(schema));
  const members = {};
  for (const [username, id] of Object.entries(ids)) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)", [id, `${username}@members.dhteams.invalid`, JSON.stringify({ username })]);
    members[username] = await one("update team_members set profile_completed = true where user_id = $1 returning *", [id]);
  }
  // alice+bob in team A, carol in team B.
  await session(ids.alice);
  const teamA = await one("select * from create_team('A팀')");
  const projectA = await one("insert into projects(name,owner_id) values ('A 과업',$1) returning *", [ids.alice]);
  const projectA2 = await one("insert into projects(name,owner_id) values ('A 둘째 과업',$1) returning *", [ids.alice]);
  await session(ids.bob);
  await one("select * from join_team($1)", [teamA.invite_code]);
  await session(ids.carol);
  await one("select * from create_team('B팀')");
  const projectB = await one("insert into projects(name,owner_id) values ('B 과업',$1) returning *", [ids.carol]);
  await admin();
  return { db, one, rows, rejects, session, admin, members, projectA, projectA2, projectB };
}

// D6: schedules.updated_at + touch trigger for optimistic conflict checks.
async function scheduleSuite() {
  const { db, one, rows, session, admin, projectA } = await openDb();
  try {
    const legacy = await one("insert into schedules(project_id,title,due_date) values ($1,'기존 일정','2026-11-20') returning id", [projectA.id]);
    await db.exec(readSql("schema-schedules-updated-at"));
    await db.exec(readSql("schema-schedules-updated-at"));
    const filled = await one("select updated_at::text as t from schedules where id = $1", [legacy.id]);
    assert.ok(filled.t, "existing row gets updated_at");

    await session(ids.alice);
    const t0 = filled.t;
    const first = await one("update schedules set title = '수정 1' where id = $1 returning updated_at::text as t", [legacy.id]);
    const second = await one("update schedules set title = '수정 2' where id = $1 returning updated_at::text as t", [legacy.id]);
    assert.equal((await one("select $1::timestamptz < $2::timestamptz and $2::timestamptz < $3::timestamptz as ok", [t0, first.t, second.t])).ok, true, "each update increases updated_at");

    const stale = await rows("update schedules set title = '옛 값 기준' where id = $1 and updated_at = $2::timestamptz returning id", [legacy.id, first.t]);
    assert.equal(stale.length, 0, "update conditioned on old updated_at affects 0 rows");
    const fresh = await rows("update schedules set title = '최신 기준' where id = $1 and updated_at = $2::timestamptz returning id", [legacy.id, second.t]);
    assert.equal(fresh.length, 1, "update conditioned on current updated_at succeeds");

    await session(ids.carol);
    const cross = await rows("update schedules set title = '침입' where id = $1 returning id", [legacy.id]);
    assert.equal(cross.length, 0, "other team cannot update");
    await admin();
    assert.equal((await one("select title from schedules where id = $1", [legacy.id])).title, "최신 기준");
  } finally {
    await db.close();
  }
}

// D7: project_memo_items table, migration from project_memos, server-stamped authors, team scope.
async function memoItemSuite() {
  const { db, one, rows, rejects, session, admin, members, projectA, projectA2, projectB } = await openDb();
  try {
    await db.query("insert into project_memos(project_id,month,content) values ($1,'2026-11',$2)", [projectA.id, "- 가\n\n나\n"]);
    await db.exec(readSql("schema-memo-items"));
    await db.exec(readSql("schema-memo-items"));
    const migrated = await rows("select content, creator_name, created_by from project_memo_items where project_id = $1 and month = '2026-11' and deleted_at is null order by created_at desc", [projectA.id]);
    assert.deepEqual(migrated.map((r) => [r.content, r.creator_name, r.created_by]), [["가", "이전 메모", null], ["나", "이전 메모", null]], "re-run adds no duplicates, lines kept in order");

    const aliceName = (await one("select name from team_members where id = $1", [members.alice.id])).name;
    await session(ids.alice);
    const item = await one("insert into project_memo_items(project_id,month,content,created_by,creator_name) values ($1,'2026-11','새 항목',$2,'위조') returning *, updated_at::text as t", [projectA.id, members.bob.id]);
    assert.equal(item.created_by, members.alice.id, "created_by stamped by server");
    assert.equal(item.creator_name, aliceName, "creator_name stamped by server");

    await session(ids.bob);
    const edited = await one("update project_memo_items set content = '고친 항목', created_by = $2, creator_name = '바꿈', month = '2026-12', project_id = $3 where id = $1 returning *, updated_at::text as t", [item.id, members.bob.id, projectA2.id]);
    assert.equal(edited.content, "고친 항목");
    assert.equal(edited.created_by, members.alice.id, "created_by kept on update");
    assert.equal(edited.creator_name, aliceName, "creator_name kept on update");
    assert.equal(edited.month, "2026-11", "month kept on update");
    assert.equal(edited.project_id, projectA.id, "project_id kept on update");
    await admin();
    assert.equal((await one("select $1::timestamptz < $2::timestamptz as ok", [item.t, edited.t])).ok, true, "updated_at increases on update");
    await session(ids.bob);
    const stale = await rows("update project_memo_items set content = 'x' where id = $1 and updated_at = $2::timestamptz returning id", [item.id, item.t]);
    assert.equal(stale.length, 0, "update conditioned on old updated_at affects 0 rows");

    await session(ids.carol);
    assert.equal((await rows("select * from project_memo_items")).length, 0, "other team sees nothing");
    await rejects("insert into project_memo_items(project_id,month,content) values ($1,'2026-11','침입')", [projectA.id]);
    // RLS USING hides other-team rows, so an update finds nothing instead of raising.
    assert.equal((await rows("update project_memo_items set content = '침입' where id = $1 returning id", [item.id])).length, 0, "other team cannot update");
    // Moving an own row into team A is blocked (project_id is pinned by the trigger, then RLS keeps it in team B).
    const own = await one("insert into project_memo_items(project_id,month,content) values ($1,'2026-11','B 항목') returning id", [projectB.id]);
    assert.equal((await one("update project_memo_items set project_id = $2 where id = $1 returning project_id", [own.id, projectA.id])).project_id, projectB.id);

    await session(ids.alice);
    await rejects("delete from project_memo_items where id = $1", [item.id]);
    const softDeleted = await rows("update project_memo_items set deleted_at = now() where id = $1 returning id", [item.id]);
    assert.equal(softDeleted.length, 1, "soft delete via deleted_at");

    // Rollback drops the table and function, project_memos stays.
    await admin();
    await db.exec(readSql("rollback-memo-items"));
    assert.equal((await one("select to_regclass('public.project_memo_items') is null as gone")).gone, true);
    assert.equal((await one("select count(*)::int as n from pg_proc where proname = 'stamp_project_memo_item'")).n, 0);
    assert.equal((await one("select content from project_memos where project_id = $1", [projectA.id])).content, "- 가\n\n나\n");
  } finally {
    await db.close();
  }
}

(async () => {
  await scheduleSuite();
  await memoItemSuite();
  console.log("PASS: schedules.updated_at (repeatable SQL, existing rows filled, increases per update, stale condition matches 0 rows, other team cannot update).");
  console.log("PASS: project_memo_items (repeatable migration without duplicates, line order, server-stamped author, pinned columns on update, team isolation, no hard delete, rollback).");
})().catch((error) => { console.error(error); process.exitCode = 1; });

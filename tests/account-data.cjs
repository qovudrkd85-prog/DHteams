/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local PostgreSQL security checks. */
// Never reads .env, creates real accounts, or contacts Supabase.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");

const tables = ["projects", "nodes", "file_logs", "schedules", "project_memos", "office_layouts", "department_events", "team_members", "team_attendance", "project_members"];
const aliceId = "10000000-0000-0000-0000-000000000001";
const bobId = "10000000-0000-0000-0000-000000000002";
const outsiderId = "10000000-0000-0000-0000-000000000003";

(async () => {
  const db = new PGlite();
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const reject = async (sql, params = [], code = "42501") => {
    await assert.rejects(db.query(sql, params), (error) => {
      assert.equal(error.code, code, `${sql}: ${error.message}`);
      return true;
    }, sql);
  };
  const session = async (userId, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ""]);
    await db.exec(`set role ${role}`);
  };
  const signup = (id, email, metadata) => one(
    "insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3::jsonb) returning id",
    [id, email, JSON.stringify(metadata)],
  );
  const readSql = (name) => fs.readFileSync(path.resolve(__dirname, `../supabase/${name}.sql`), "utf8");

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        email text unique,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
    `);
    for (const schema of ["schema", "schema-open-mode", "schema-update-all", "schema-trash", "schema-department-events", "schema-team-workspace"]) {
      await db.exec(readSql(schema));
    }
    // Supabase's historical defaults and extra grants must not survive the migration.
    await db.exec(`
      grant all privileges on all tables in schema public to anon, authenticated;
      grant select (name), update (name) on public.team_members to public, anon;
      create policy accidentally_public on public.team_members for all to public using (true) with check (true);
    `);
    const legacy = await one("insert into team_members(name, role) values ('alice', '기존 팀장') returning *");
    const legacyProject = await one("insert into projects(name) values ('기존 공유 과업') returning id");
    const legacyEvent = await one("insert into department_events(title, category, starts_on, ends_on, created_by) values ('기존 일정', 'work', '2026-09-01', '2026-09-02', $1) returning *", [legacy.id]);
    const legacyAttendance = await one("insert into team_attendance(member_id) values ($1) returning *", [legacy.id]);
    await signup(outsiderId, "prior@example.com", { username: "alice", member_id: legacy.id });

    const migration = readSql("schema-accounts");
    execFileSync(process.execPath, [path.resolve(__dirname, "../scripts/prepare-account-upgrade.cjs")], { windowsHide: true, stdio: "pipe" });
    const bundle = fs.readFileSync(path.resolve(__dirname, "../artifacts/setup/teams-account-upgrade.sql"), "utf8");
    await db.exec(bundle);
    await db.exec(migration);
    assert.deepEqual(await one("select * from team_members where id = $1", [legacy.id]), {
      ...legacy, user_id: null, username: null, profile_completed: false,
    });
    assert.deepEqual(await one("select * from department_events where id = $1", [legacyEvent.id]), legacyEvent);
    assert.deepEqual(await one("select * from team_attendance where id = $1", [legacyAttendance.id]), legacyAttendance);

    await signup(aliceId, "alice@members.dhteams.invalid", { username: "alice", name: "임의 이름", role: "관리자", member_id: legacy.id, profile_completed: true });
    await signup(bobId, "bob@members.dhteams.invalid", { username: "bob" });
    const alice = await one("select * from team_members where user_id = $1", [aliceId]);
    const bob = await one("select * from team_members where user_id = $1", [bobId]);
    assert.notEqual(alice.id, legacy.id, "Same display name must never claim a legacy member");
    assert.equal(alice.username, "alice");
    assert.equal(alice.name, "alice");
    assert.equal(alice.role, "");
    assert.equal(alice.profile_completed, false);
    for (const [email, metadata] of [
      ["missing@members.dhteams.invalid", {}],
      ["123@members.dhteams.invalid", { username: 123 }],
      ["ab@members.dhteams.invalid", { username: "ab" }],
      ["_bad@members.dhteams.invalid", { username: "_bad" }],
      ["mismatch@members.dhteams.invalid", { username: "valid_name" }],
      ["Upper@members.dhteams.invalid", { username: "upper" }],
      [`${"a".repeat(25)}@members.dhteams.invalid`, { username: "a".repeat(25) }],
    ]) {
      await reject("insert into auth.users(email, raw_user_meta_data) values ($1, $2::jsonb)", [email, JSON.stringify(metadata)], "23514");
      assert.equal((await one("select count(*)::int as n from auth.users where email = $1", [email])).n, 0);
    }
    await reject("update team_members set user_id = $1, username = 'claimed' where id = $2", [outsiderId, legacy.id], "23514");
    await reject("select public.handle_team_account_signup()", [], "0A000");
    await reject("delete from auth.users where id = $1", [aliceId], "23001");

    await session(null, "anon");
    assert.equal((await one("select public.account_registration_ready() as ready")).ready, true);
    for (const table of tables) await reject(`select * from public.${table}`);
    await reject("select name from team_members");
    await reject("update team_members set name = '변조' where id = $1", [legacy.id]);
    await reject("insert into projects(name) values ('익명 과업')");
    await reject("select public.has_team_account()");
    await reject("select public.current_team_member_id()");
    await reject("select public.handle_team_account_signup()");

    await session(outsiderId);
    assert.deepEqual(await one("select public.has_team_account() as linked, public.current_team_member_id() as member"), { linked: false, member: null });
    for (const table of tables) assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0, table);
    await reject("insert into projects(name) values ('미등록 과업')");
    await reject("insert into team_members(name, user_id, username) values ('자체 등록', $1, 'outsider')", [outsiderId]);
    assert.equal((await db.query("update team_members set name = '기존 팀원 탈취' where id = $1 returning id", [legacy.id])).rows.length, 0);

    await session(aliceId);
    assert.deepEqual(await one("select public.has_team_account() as linked, public.current_team_member_id() as member"), { linked: true, member: alice.id });
    assert.equal((await one("select count(*)::int as n from team_members")).n, 3);
    assert.equal((await one("select name from projects where id = $1", [legacyProject.id])).name, "기존 공유 과업");
    const profile = await one("update team_members set name = '김민지', role = '디자이너', avatar = '👩‍💻', color = '#5B7FA6', profile_completed = true where id = $1 returning *", [alice.id]);
    assert.equal(profile.profile_completed, true);
    assert.equal(profile.name, "김민지");
    assert.equal(profile.role, "디자이너");
    for (const target of [bob.id, legacy.id]) {
      assert.equal((await db.query("update team_members set name = '다른 팀원 수정' where id = $1 returning id", [target])).rows.length, 0);
    }
    await reject("insert into team_members(name) values ('별도 팀원')");
    await reject("delete from team_members where id = $1", [alice.id]);
    await reject("update team_members set user_id = $1 where id = $2", [bobId, alice.id]);
    await reject("update team_members set id = gen_random_uuid() where id = $1", [alice.id]);
    await reject("update team_members set username = 'renamed' where id = $1", [alice.id]);
    await reject("update team_members set created_at = now() where id = $1", [alice.id]);
    await reject("update team_members set name = '   ' where id = $1", [alice.id], "23514");
    await reject("update team_members set role = repeat('가', 61) where id = $1", [alice.id], "23514");
    await reject("select public.handle_team_account_signup()");
    await reject("select public.protect_team_account_identity()");
    await reject("select public.add_project_member($1, 'prior@example.com', 'owner')", [legacyProject.id]);
    await reject("select public.is_project_member($1)", [legacyProject.id]);
    await reject("select public.can_edit_project($1)", [legacyProject.id]);

    const attendance = await one("insert into team_attendance(member_id) values ($1) returning *", [alice.id]);
    assert.equal(attendance.checked_out_at, null);
    assert.equal((await one("select work_date = (clock_timestamp() at time zone 'Asia/Seoul')::date as today from team_attendance where id = $1", [attendance.id])).today, true);
    await reject("insert into team_attendance(member_id) values ($1)", [bob.id]);
    await reject("insert into team_attendance(member_id) values ($1)", [legacy.id]);
    await reject("insert into team_attendance(member_id) values ($1)", [alice.id], "23505");
    await reject("update team_attendance set member_id = $1 where id = $2", [bob.id, attendance.id]);
    await reject("update team_attendance set checked_in_at = now() where id = $1", [attendance.id]);
    assert.equal((await db.query("update team_attendance set checked_out_at = now() where id = $1 returning id", [legacyAttendance.id])).rows.length, 0);

    const event = await one("insert into department_events(title, category, starts_on, ends_on, created_by, creator_name, creator_color) values ('민지 업무', 'work', '2026-09-17', '2026-09-17', $1, '위조 이름', '#000000') returning *", [alice.id]);
    assert.equal(event.creator_name, profile.name);
    assert.equal(event.creator_color, profile.color);
    await reject("insert into department_events(title, category, starts_on, ends_on, created_by) values ('대리 등록', 'work', '2026-09-17', '2026-09-17', $1)", [bob.id]);
    await reject("insert into department_events(title, starts_on, ends_on) values ('등록자 없음', '2026-09-17', '2026-09-17')");
    await one("update team_members set name = '새 이름', color = '#AABBCC' where id = $1 returning id", [alice.id]);

    const project = await one("insert into projects(name) values ('새 공유 과업') returning id");
    const node = await one("insert into nodes(project_id, kind, name) values ($1, 'file', '공유 파일') returning id", [project.id]);
    const log = await one("insert into file_logs(node_id, actor) values ($1, '민지') returning id", [node.id]);
    const schedule = await one("insert into schedules(project_id, title, due_date) values ($1, '업무', '2026-09-17') returning id", [project.id]);
    await db.query("insert into project_memos(project_id, month, content) values ($1, '2026-09', '공유 메모')", [project.id]);
    const layout = await one("insert into office_layouts(name, items) values ('공유 사무실', $1::jsonb) returning id", [JSON.stringify([{ id: "desk-1", kind: "desk", x: 200, y: 200, rotation: 0, label: "민지 자리", member_id: alice.id }])]);

    await session(bobId);
    assert.equal((await one("select name from team_members where id = $1", [alice.id])).name, "새 이름");
    assert.equal((await db.query("update team_attendance set checked_out_at = now() where id = $1 returning id", [attendance.id])).rows.length, 0);
    await reject("insert into team_attendance(member_id) values ($1)", [alice.id]);
    await one("insert into team_attendance(member_id) values ($1) returning id", [bob.id]);
    await reject("update department_events set created_by = $1 where id = $2", [bob.id, event.id], "23514");
    await reject("update department_events set creator_name = '다른 사람' where id = $1", [event.id], "23514");
    await reject("update department_events set creator_color = '#000000' where id = $1", [event.id], "23514");
    const editedEvent = await one("update department_events set title = '공유 일정 수정', deleted_at = now() where id = $1 returning created_by, creator_name, creator_color", [event.id]);
    assert.deepEqual(editedEvent, { created_by: alice.id, creator_name: profile.name, creator_color: profile.color });
    await one("update department_events set deleted_at = null where id = $1 returning id", [event.id]);
    assert.equal((await one("select created_by from department_events where id = $1", [legacyEvent.id])).created_by, legacy.id);
    await one("update projects set name = '함께 수정한 과업' where id = $1 returning id", [project.id]);
    await one("update nodes set name = '함께 수정한 파일' where id = $1 returning id", [node.id]);
    await one("update file_logs set detail = '공유 이력' where id = $1 returning id", [log.id]);
    await one("update schedules set done = true where id = $1 returning id", [schedule.id]);
    await one("update project_memos set content = '함께 수정한 메모' where project_id = $1 returning project_id", [project.id]);
    await one("update office_layouts set name = '함께 꾸민 사무실' where id = $1 returning id", [layout.id]);
    assert.equal((await one("select name from projects where id = $1", [project.id])).name, "함께 수정한 과업");
    assert.equal((await one("select detail from file_logs where id = $1", [log.id])).detail, "공유 이력");
    assert.equal((await one("select done from schedules where id = $1", [schedule.id])).done, true);
    await one("delete from office_layouts where id = $1 returning id", [layout.id]);
    await one("delete from projects where id = $1 returning id", [project.id]);
    assert.equal((await db.query("select id from nodes where id = $1", [node.id])).rows.length, 0);

    await session(aliceId);
    const checkout = await one("update team_attendance set checked_out_at = '2000-01-01T00:00:00Z' where id = $1 returning checked_out_at >= checked_in_at as ordered", [attendance.id]);
    assert.equal(checkout.ordered, true);
    await reject("update team_attendance set checked_out_at = null where id = $1", [attendance.id], "23514");
    await reject("delete from team_attendance where id = $1", [attendance.id]);

    await db.exec("reset role");
    await db.query("update auth.users set raw_user_meta_data = $1::jsonb where id = $2", [JSON.stringify({ username: "bob", member_id: bob.id, role: "admin" }), aliceId]);
    const beforeRerun = await one("select * from team_members where id = $1", [alice.id]);
    await db.exec(migration);
    assert.deepEqual(await one("select * from team_members where id = $1", [alice.id]), beforeRerun);
    // Older production installations may never have created the legacy invite RPC.
    await db.exec("drop function public.add_project_member(uuid, text, text)");
    await db.exec(bundle);
    assert.equal((await one("select to_regprocedure('public.add_project_member(uuid, text, text)') is null as missing")).missing, true);
    assert.deepEqual(await one("select * from team_members where id = $1", [alice.id]), beforeRerun);
    assert.equal((await one("select count(*)::int as n from team_members")).n, 3);
    const helpers = (await db.query("select proname, prosecdef, provolatile, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname in ('has_team_account', 'current_team_member_id') order by proname")).rows;
    assert.equal(helpers.length, 2);
    for (const helper of helpers) {
      assert.equal(helper.prosecdef, true);
      assert.equal(helper.provolatile, "s");
      assert.deepEqual(helper.proconfig, ['search_path=""']);
    }
    await session(aliceId);
    assert.deepEqual(await one("select public.current_team_member_id() as id, public.has_team_account() as linked"), { id: alice.id, linked: true });
    assert.equal((await one("select creator_name from department_events where id = $1", [event.id])).creator_name, profile.name);
    console.log("PASS: repeatable account migration, legacy preservation, atomic signup, anonymous denial, account-only shared access, own profile/attendance, immutable identity/authorship, safe helper/RPC privileges.");
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

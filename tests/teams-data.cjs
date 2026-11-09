/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL team isolation checks. */
// Local in-memory PostgreSQL only. No .env reads or Supabase connections.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");

const aliceId = "20000000-0000-0000-0000-000000000001";
const bobId = "20000000-0000-0000-0000-000000000002";
const carolId = "20000000-0000-0000-0000-000000000003";
const daveId = "20000000-0000-0000-0000-000000000004";
const setupSql = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key, email text unique, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
`;
const schemas = ["schema", "schema-open-mode", "schema-update-all", "schema-trash", "schema-department-events", "schema-team-workspace", "schema-accounts", "schema-office-presence"];
const event = (title, visibility) => ({ title, visibility, starts_on: "2026-11-10", ends_on: "2026-11-10" });

(async () => {
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
  const readSql = (name) => fs.readFileSync(path.resolve(__dirname, `../supabase/${name}.sql`), "utf8");
  const addEvent = (e, memberId) => one(
    "insert into department_events(title,visibility,starts_on,ends_on,created_by,team_id) values ($1,$2,$3,$4,$5,$6) returning *",
    [e.title, e.visibility, e.starts_on, e.ends_on, memberId, e.team_id ?? null],
  );
  try {
    await db.exec(setupSql);
    for (const schema of schemas) await db.exec(readSql(schema));
    await db.exec(readSql("schema-teams"));
    await db.exec(readSql("schema-teams"));
    // Older SQL re-run after teams would reopen access: it must refuse and roll back.
    for (const stale of ["schema-accounts", "schema-office-presence"]) {
      await assert.rejects(db.exec(readSql(stale)), (error) => error.code === "P0001");
      await db.exec("rollback");
    }
    const members = {};
    for (const [id, username] of [[aliceId, "alice"], [bobId, "bob"], [carolId, "carol"], [daveId, "dave"]]) {
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)", [id, `${username}@members.dhteams.invalid`, JSON.stringify({ username })]);
      members[username] = await one("update team_members set profile_completed = $2 where user_id = $1 returning *", [id, username !== "dave"]);
    }
    const legacyRooms = (await one("select count(*)::int as n from office_layouts where team_id is null")).n;
    assert.equal(legacyRooms, 6);

    // No team yet: nothing shared is visible, profile still readable.
    await session(aliceId);
    assert.equal((await rows("select * from office_layouts")).length, 0);
    assert.equal((await rows("select * from team_members")).length, 1);
    assert.equal((await one("select public.has_team_account() as ok")).ok, false);
    await rejects("insert into projects(name,owner_id) values ('팀 없음',$1)", [aliceId]);
    await rejects("insert into department_events(title,visibility,starts_on,ends_on,created_by) values ('x','team','2026-11-10','2026-11-10',$1)", [members.alice.id]);
    await rejects("update team_members set team_id = gen_random_uuid() where user_id = $1", [aliceId]);

    await session(daveId);
    await rejects("select * from create_team('미완료 프로필')");

    await session(aliceId);
    await rejects("select * from create_team('   ')", [], "22023");
    const teamA = await one("select * from create_team(' A팀 ')");
    assert.equal(teamA.name, "A팀");
    assert.match(teamA.invite_code, /^[A-HJKMNP-Z2-9]{8}$/);
    await rejects("select * from create_team('두 번째')", [], "23514");
    const roomsA = await rows("select * from office_layouts order by room_key");
    assert.deepEqual(roomsA.map((room) => room.room_key), ["cafe", "office-1", "office-2", "office-3", "office-4", "outdoor"]);
    assert.ok(roomsA.every((room) => room.team_id === teamA.id));
    // Custom rooms have no room_key; several per team must be allowed.
    for (const name of ["회의실", "창고"]) await one("insert into office_layouts(name,items) values ($1,'[]') returning id", [name]);
    assert.equal((await one("select count(*)::int as n from office_layouts where room_key is null")).n, 2);
    await db.query("delete from office_layouts where room_key is null");

    await session(bobId);
    await rejects("select * from join_team('ABC')", [], "22023");
    await rejects("select * from join_team('ZZZZZZZZ')", [], "P0002");
    const lowered = teamA.invite_code.toLowerCase();
    const joined = await one("select * from join_team($1)", [` ${lowered.slice(0, 4)}-${lowered.slice(4)} `]);
    assert.equal(joined.id, teamA.id);
    await rejects("select * from join_team($1)", [teamA.invite_code], "23514");

    await session(carolId);
    const teamB = await one("select * from create_team('B팀')");
    assert.notEqual(teamB.invite_code, teamA.invite_code);
    assert.equal((await rows("select * from teams")).length, 1);

    // Projects and children stay inside the team.
    await session(aliceId);
    const project = await one("insert into projects(name,owner_id) values ('A 과업',$1) returning *", [aliceId]);
    assert.equal(project.team_id, teamA.id);
    const node = await one("insert into nodes(project_id,name,kind) values ($1,'폴더','folder') returning *", [project.id]);
    await session(bobId);
    assert.equal((await rows("select * from projects")).length, 1);
    assert.equal((await rows("select * from nodes")).length, 1);
    await session(carolId);
    assert.equal((await rows("select * from projects")).length, 0);
    assert.equal((await rows("select * from nodes")).length, 0);
    await rejects("insert into projects(name,owner_id,team_id) values ('침입',$1,$2)", [carolId, teamA.id]);
    await rejects("insert into nodes(project_id,name,kind) values ($1,'침입','folder')", [project.id]);
    await rejects("insert into schedules(project_id,title,due_date) values ($1,'침입','2026-11-10')", [project.id]);
    assert.equal((await db.query("update projects set name = '변조' where id = $1", [project.id])).affectedRows, 0);
    assert.equal((await rows("select * from team_members")).map((m) => m.username).join(), "carol");
    const carolProject = await one("insert into projects(name,owner_id) values ('B 과업',$1) returning *", [carolId]);
    await rejects("update projects set team_id = $2 where id = $1", [carolProject.id, teamA.id]);
    void node;

    // Seats and presence cannot cross teams.
    const officeA = roomsA.find((room) => room.room_key === "office-1");
    await rejects("select * from claim_office_seat($1,'desk-1')", [officeA.id], "P0002");
    await rejects("insert into team_presence(member_id,layout_id,x,y) values ($1,$2,10,10)", [members.carol.id, officeA.id], "23503");

    // Team vs private schedules.
    await session(aliceId);
    const teamEvent = await addEvent({ ...event("A 회의", "team"), team_id: teamB.id }, members.alice.id);
    assert.equal(teamEvent.team_id, teamA.id, "client team_id is ignored");
    const privateEvent = await addEvent({ ...event("병원", "private"), team_id: teamA.id }, members.alice.id);
    assert.equal(privateEvent.team_id, null);
    await rejects("insert into department_events(title,visibility,starts_on,ends_on,created_by) values ('남 대신','private','2026-11-10','2026-11-10',$1)", [members.bob.id]);
    await session(bobId);
    assert.deepEqual((await rows("select title from department_events")).map((r) => r.title), ["A 회의"]);
    assert.equal((await db.query("update department_events set title = '변조' where id = $1", [privateEvent.id])).affectedRows, 0);
    await rejects("update department_events set visibility = 'private' where id = $1", [teamEvent.id]);
    assert.equal((await one("update department_events set title = 'A 회의(수정)' where id = $1 returning team_id", [teamEvent.id])).team_id, teamA.id);
    const bobPrivate = await addEvent(event("bob 개인", "private"), members.bob.id);
    await session(carolId);
    assert.equal((await rows("select * from department_events")).length, 0);
    await session(aliceId);
    assert.deepEqual((await rows("select title from department_events order by title")).map((r) => r.title), ["A 회의(수정)", "병원"]);
    const switched = await one("update department_events set visibility = 'private' where id = $1 returning *", [teamEvent.id]);
    assert.equal(switched.team_id, null);
    await one("update department_events set visibility = 'team' where id = $1 returning *", [teamEvent.id]);

    // Invite code rotation is creator-only while the creator is still in the team.
    await session(bobId);
    await rejects("select * from regenerate_team_code()");
    await session(aliceId);
    const rotated = await one("select * from regenerate_team_code()");
    assert.notEqual(rotated.invite_code, teamA.invite_code);
    await session(daveId);
    await rejects("select * from join_team($1)", [teamA.invite_code]);

    // Attendance stays with the team of check-in time.
    await session(bobId);
    const bobCheckIn = await one("insert into team_attendance(member_id) values ($1) returning *", [members.bob.id]);
    assert.equal(bobCheckIn.team_id, teamA.id);
    await session(carolId);
    assert.equal((await rows("select * from team_attendance")).length, 0);

    // Leaving clears the seat, keeps private schedules with the person.
    await session(bobId);
    const seated = await one("select * from claim_office_seat($1,'desk-2')", [officeA.id]);
    assert.equal(seated.items.find((entry) => entry.id === "desk-2").member_id, members.bob.id);
    await one("insert into team_presence(member_id,layout_id,x,y) values ($1,$2,10,10) returning *", [members.bob.id, officeA.id]);
    await db.query("select public.leave_team()");
    assert.equal((await rows("select * from projects")).length, 0);
    assert.deepEqual((await rows("select title from department_events")).map((r) => r.title), ["bob 개인"]);
    assert.equal((await one("select public.has_team_account() as ok")).ok, false);
    await rejects("select public.leave_team()", [], "P0002");
    await rejects("select * from claim_office_seat($1,'desk-2')", [officeA.id]);
    // Only member_id is insertable; the team guard must fire before the daily unique key.
    await assert.rejects(db.query("insert into team_attendance(member_id) values ($1)", [members.bob.id]), (error) => error.code === "42501" && /팀에 참가/.test(error.message));
    assert.equal((await db.query("update team_attendance set checked_out_at = now() where id = $1", [bobCheckIn.id])).affectedRows, 0);
    // Moving to another team must not expose the old team's attendance.
    await one("select * from join_team($1)", [teamB.invite_code]);
    assert.equal((await rows("select * from team_attendance")).length, 0);
    await session(carolId);
    assert.equal((await rows("select * from team_attendance")).length, 0);
    await session(bobId);
    await db.query("select public.leave_team()");
    await session(aliceId);
    const officeAfter = await one("select items from office_layouts where id = $1", [officeA.id]);
    assert.equal(officeAfter.items.find((entry) => entry.id === "desk-2").member_id, null);
    assert.equal((await rows("select * from team_presence")).length, 0);
    assert.equal((await rows("select * from team_members")).length, 1);
    void bobPrivate;

    // Creator gone: remaining members may rotate the code.
    await session(bobId);
    await one("select * from join_team($1)", [rotated.invite_code]);
    await session(aliceId);
    await db.query("select public.leave_team()");
    await session(bobId);
    const rotatedByBob = await one("select * from regenerate_team_code()");
    assert.notEqual(rotatedByBob.invite_code, rotated.invite_code);
    assert.equal((await rows("select * from projects")).length, 1);

    await db.exec("reset role");
    const codes = new Set();
    for (let i = 0; i < 300; i += 1) codes.add((await one("select public.generate_team_invite_code() as c")).c);
    assert.ok(codes.size >= 299);
    for (const code of codes) assert.match(code, /^[A-HJKMNP-Z2-9]{8}$/);
    console.log("PASS: team create/join/leave, invite code rules, cross-team isolation for projects/nodes/seats/presence/members, team vs private schedules, creator-only code rotation, repeatable SQL.");
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

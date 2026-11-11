/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL multi-team membership checks. */
// Local in-memory PostgreSQL only. No .env reads or Supabase connections.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");

const ids = {
  alice: "30000000-0000-0000-0000-000000000001",
  bob: "30000000-0000-0000-0000-000000000002",
  carol: "30000000-0000-0000-0000-000000000003",
  dave: "30000000-0000-0000-0000-000000000004",
};
const setupSql = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key, email text unique, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
`;
const baseSchemas = ["schema", "schema-open-mode", "schema-update-all", "schema-trash", "schema-department-events", "schema-team-workspace", "schema-accounts", "schema-office-presence", "schema-teams"];

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

// M1: membership table, migration of existing single-team data, active-team invariant.
async function migrationSuite() {
  const { db, one, rows, rejects, session, admin, members } = await openDb();
  try {
    // Legacy single-team data: alice+bob in A, carol in B, dave without a team.
    await session(ids.alice);
    const teamA = await one("select * from create_team('A팀')");
    const projectA = await one("insert into projects(name,owner_id) values ('A 과업',$1) returning *", [ids.alice]);
    await one("insert into nodes(project_id,name,kind) values ($1,'폴더','folder') returning id", [projectA.id]);
    const officeA = await one("select * from office_layouts where room_key = 'office-1'");
    await one("select * from claim_office_seat($1,'desk-1')", [officeA.id]);
    await one("insert into team_presence(member_id,layout_id,x,y) values ($1,$2,10,10) returning member_id", [members.alice.id, officeA.id]);
    await session(ids.bob);
    await one("select * from join_team($1)", [teamA.invite_code]);
    await session(ids.carol);
    const teamB = await one("select * from create_team('B팀')");
    await one("insert into projects(name,owner_id) values ('B 과업',$1) returning id", [ids.carol]);
    const officeB = await one("select * from office_layouts where room_key = 'office-1'");
    await one("insert into team_presence(member_id,layout_id,x,y) values ($1,$2,10,10) returning member_id", [members.carol.id, officeB.id]);

    await admin();
    await db.exec(readSql("schema-team-memberships"));
    const migrated = await rows("select s.member_id, s.team_id, s.role from team_memberships s join team_members m on m.id = s.member_id order by m.username");
    assert.deepEqual(migrated.map((row) => [row.member_id, row.team_id, row.role]), [
      [members.alice.id, teamA.id, "owner"],
      [members.bob.id, teamA.id, "member"],
      [members.carol.id, teamB.id, "owner"],
    ]);
    await db.exec(readSql("schema-team-memberships"));
    assert.equal((await one("select count(*)::int as n from team_memberships")).n, 3, "re-run keeps rows");

    // Re-running the single-team SQL afterwards would undo the multi-team rules: refuse.
    await assert.rejects(db.exec(readSql("schema-teams")), (error) => error.code === "P0001");
    await db.exec("rollback");

    // Active team must be one of my memberships, even for the service role.
    await rejects("update team_members set team_id = $2 where id = $1", [members.alice.id, teamB.id], "23503");
    assert.equal((await one("select team_id from team_members where id = $1", [members.alice.id])).team_id, teamA.id);

    // Clients never write memberships directly.
    await session(ids.alice);
    await rejects("insert into team_memberships(member_id,team_id) values ($1,$2)", [members.alice.id, teamB.id]);
    await rejects("delete from team_memberships where member_id = $1", [members.bob.id]);

    // Isolation unchanged after migration.
    assert.deepEqual((await rows("select name from projects")).map((r) => r.name), ["A 과업"]);
    assert.equal((await rows("select * from nodes")).length, 1);
    assert.deepEqual((await rows("select name from teams")).map((r) => r.name), ["A팀"]);
    assert.deepEqual((await rows("select username from team_members order by username")).map((r) => r.username), ["alice", "bob"]);
    assert.equal((await rows("select * from team_memberships")).length, 2);
    assert.deepEqual((await rows("select member_id from team_presence")).map((r) => r.member_id), [members.alice.id]);
    await session(ids.carol);
    assert.deepEqual((await rows("select name from projects")).map((r) => r.name), ["B 과업"]);
    assert.deepEqual((await rows("select username from team_members")).map((r) => r.username), ["carol"]);
    await rejects("insert into projects(name,owner_id,team_id) values ('침입',$1,$2)", [ids.carol, teamA.id]);
    await session(ids.dave);
    assert.equal((await rows("select * from projects")).length, 0);
    assert.equal((await rows("select * from teams")).length, 0);
    assert.equal((await rows("select * from team_memberships")).length, 0);

    // A second membership (as the RPCs will add): both teams listed, data stays with the active team.
    await admin();
    await db.query("insert into team_memberships(member_id,team_id) values ($1,$2)", [members.alice.id, teamB.id]);
    await session(ids.alice);
    assert.deepEqual((await rows("select name from teams order by name")).map((r) => r.name), ["A팀", "B팀"]);
    assert.equal((await one("select public.current_team_id() as id")).id, teamA.id);
    assert.deepEqual((await rows("select name from projects")).map((r) => r.name), ["A 과업"]);
    // carol (B) sees alice as a team mate although alice is looking at A, but not alice's position in A.
    await session(ids.carol);
    assert.deepEqual((await rows("select username from team_members order by username")).map((r) => r.username), ["alice", "carol"]);
    assert.deepEqual((await rows("select member_id from team_presence")).map((r) => r.member_id), [members.carol.id]);

    // Removing a membership clears only the active team, nothing else.
    await admin();
    const before = await one("select * from team_members where id = $1", [members.bob.id]);
    await db.query("delete from team_memberships where member_id = $1 and team_id = $2", [members.bob.id, teamA.id]);
    const after = await one("select * from team_members where id = $1", [members.bob.id]);
    assert.equal(after.team_id, null);
    assert.deepEqual({ ...after, team_id: before.team_id }, before);
    await session(ids.bob);
    assert.equal((await one("select public.current_team_id() as id")).id, null);
    assert.equal((await rows("select * from projects")).length, 0);
  } finally {
    await db.close();
  }
}

// M2: create/join add a membership, switch_team, leave_team, owner rules, limit.
async function rpcSuite() {
  const { db, one, rows, rejects, session, admin, members } = await openDb();
  const active = async () => (await one("select public.current_team_id() as id")).id;
  const myMemberships = async (memberId) => (await rows(
    "select team_id, role from team_memberships where member_id = $1 order by joined_at", [memberId],
  ));
  const seatOwner = async (layoutId, desk) => (await one("select items from office_layouts where id = $1", [layoutId]))
    .items.find((entry) => entry.id === desk).member_id;
  try {
    await db.exec(readSql("schema-team-memberships"));

    // Create = add a membership and move there.
    await session(ids.alice);
    const teamA = await one("select * from create_team('A팀')");
    const teamB = await one("select * from create_team('B팀')");
    assert.deepEqual(await myMemberships(members.alice.id), [
      { team_id: teamA.id, role: "owner" }, { team_id: teamB.id, role: "owner" },
    ]);
    assert.equal(await active(), teamB.id);
    assert.ok((await rows("select team_id from office_layouts")).every((room) => room.team_id === teamB.id));
    assert.equal((await rows("select * from office_layouts")).length, 6);

    // Join = add a membership and move there. Same team twice is refused.
    await session(ids.carol);
    await one("select * from join_team($1)", [teamA.invite_code]);
    await session(ids.bob);
    await one("select * from join_team($1)", [teamA.invite_code]);
    const joinedB = await one("select * from join_team($1)", [teamB.invite_code]);
    assert.equal(joinedB.id, teamB.id);
    assert.equal(await active(), teamB.id);
    assert.equal((await myMemberships(members.bob.id)).length, 2);
    await rejects("select * from join_team($1)", [teamA.invite_code], "23514");
    assert.equal((await myMemberships(members.bob.id)).length, 2);

    // Switching: only to my own teams. My position is dropped, desks stay.
    const officeB = await one("select * from office_layouts where room_key = 'office-1'");
    await one("select * from claim_office_seat($1,'desk-1')", [officeB.id]);
    await one("insert into team_presence(member_id,layout_id,x,y) values ($1,$2,10,10) returning member_id", [members.bob.id, officeB.id]);
    await rejects("select * from switch_team($1)", ["40000000-0000-0000-0000-000000000009"]);
    await session(ids.carol);
    await rejects("select * from switch_team($1)", [teamB.id]);
    await session(ids.bob);
    const switched = await one("select * from switch_team($1)", [teamA.id]);
    assert.equal(switched.id, teamA.id);
    assert.equal(await active(), teamA.id);
    assert.equal((await one("select count(*)::int as n from team_presence where member_id = $1", [members.bob.id])).n, 0);
    await admin();
    assert.equal(await seatOwner(officeB.id, "desk-1"), members.bob.id);
    // A direct UPDATE of the active team stays forbidden.
    await session(ids.bob);
    await rejects("update team_members set team_id = $2 where id = $1", [members.bob.id, teamB.id]);

    // Data follows the active team only; private schedules follow the person.
    await session(ids.alice); // active B
    await one("insert into projects(name,owner_id) values ('B 과업',$1) returning id", [ids.alice]);
    await one("insert into department_events(title,visibility,starts_on,ends_on,created_by) values ('B 회의','team','2026-11-11','2026-11-11',$1) returning id", [members.alice.id]);
    await one("insert into department_events(title,visibility,starts_on,ends_on,created_by) values ('alice 개인','private','2026-11-11','2026-11-11',$1) returning id", [members.alice.id]);
    await one("insert into team_attendance(member_id) values ($1) returning id", [members.alice.id]);
    const officeAliceB = await one("select * from office_layouts where room_key = 'office-2'");
    await one("insert into team_presence(member_id,layout_id,x,y) values ($1,$2,10,10) returning member_id", [members.alice.id, officeAliceB.id]);
    await session(ids.carol); // only in A
    await one("insert into projects(name,owner_id) values ('A 과업',$1) returning id", [ids.carol]);
    await one("insert into department_events(title,visibility,starts_on,ends_on,created_by) values ('A 회의','team','2026-11-11','2026-11-11',$1) returning id", [members.carol.id]);
    assert.deepEqual((await rows("select name from projects")).map((r) => r.name), ["A 과업"]);
    assert.deepEqual((await rows("select title from department_events")).map((r) => r.title), ["A 회의"]);
    assert.equal((await rows("select * from team_attendance")).length, 0);
    assert.ok((await rows("select team_id from office_layouts")).every((room) => room.team_id === teamA.id));
    // alice is looking at B, yet she is still carol's team mate in A; her position in B stays hidden.
    assert.deepEqual((await rows("select username from team_members order by username")).map((r) => r.username), ["alice", "bob", "carol"]);
    assert.equal((await rows("select * from team_presence where member_id = $1", [members.alice.id])).length, 0);
    assert.deepEqual((await rows("select name from teams")).map((r) => r.name), ["A팀"]);

    await session(ids.alice);
    assert.deepEqual((await rows("select name from projects")).map((r) => r.name), ["B 과업"]);
    assert.deepEqual((await rows("select title from department_events order by title")).map((r) => r.title), ["B 회의", "alice 개인"]);
    assert.equal((await rows("select * from team_attendance")).length, 1);
    await one("select * from switch_team($1)", [teamA.id]);
    assert.deepEqual((await rows("select name from projects")).map((r) => r.name), ["A 과업"]);
    assert.deepEqual((await rows("select title from department_events order by title")).map((r) => r.title), ["A 회의", "alice 개인"]);
    assert.equal((await rows("select * from team_attendance")).length, 0);
    assert.deepEqual((await rows("select name from teams order by name")).map((r) => r.name), ["A팀", "B팀"]);

    // Invite code rotation follows the role in the active team.
    await session(ids.bob); // active A, member
    await rejects("select * from regenerate_team_code()");
    await one("select * from switch_team($1)", [teamB.id]); // member in B as well
    await rejects("select * from regenerate_team_code()");
    await session(ids.alice); // active A, owner
    const rotatedA = await one("select * from regenerate_team_code()");
    assert.notEqual(rotatedA.invite_code, teamA.invite_code);

    // Leaving the active team: its desks are freed, other teams' desks stay, move to the latest remaining team.
    await session(ids.bob);
    await one("select * from switch_team($1)", [teamA.id]);
    const officeA = await one("select * from office_layouts where room_key = 'office-1'");
    await one("select * from claim_office_seat($1,'desk-2')", [officeA.id]);
    await one("insert into team_presence(member_id,layout_id,x,y) values ($1,$2,10,10) returning member_id", [members.bob.id, officeA.id]);
    await db.query("select public.leave_team()");
    assert.equal(await active(), teamB.id);
    assert.deepEqual((await myMemberships(members.bob.id)).map((row) => row.team_id), [teamB.id]);
    await admin();
    assert.equal(await seatOwner(officeA.id, "desk-2"), null);
    assert.equal(await seatOwner(officeB.id, "desk-1"), members.bob.id);
    assert.equal((await one("select count(*)::int as n from team_presence where member_id = $1", [members.bob.id])).n, 0);

    // Owner leaves: the longest-standing member becomes owner.
    await session(ids.bob);
    await one("select * from join_team($1)", [rotatedA.invite_code]); // bob rejoins A after carol
    await session(ids.alice);
    await one("select * from switch_team($1)", [teamA.id]);
    await db.query("select public.leave_team()");
    assert.equal(await active(), teamB.id);
    await admin();
    assert.deepEqual((await rows(
      "select m.username, s.role from team_memberships s join team_members m on m.id = s.member_id where s.team_id = $1 order by m.username", [teamA.id],
    )).map((r) => `${r.username}:${r.role}`), ["bob:member", "carol:owner"]);
    await session(ids.carol);
    const rotatedByCarol = await one("select * from regenerate_team_code()");
    assert.notEqual(rotatedByCarol.invite_code, rotatedA.invite_code);

    // Last person leaves: the team and its data stay; the next one to join becomes owner.
    await session(ids.dave);
    const teamD = await one("select * from create_team('D팀')");
    await one("insert into projects(name,owner_id) values ('D 과업',$1) returning id", [ids.dave]);
    await db.query("select public.leave_team()");
    assert.equal(await active(), null);
    await rejects("select public.leave_team()", [], "P0002");
    await session(ids.carol);
    await one("select * from join_team($1)", [teamD.invite_code]);
    assert.deepEqual((await rows("select name from projects")).map((r) => r.name), ["D 과업"]);
    assert.deepEqual(await myMemberships(members.carol.id), [
      { team_id: teamA.id, role: "owner" }, { team_id: teamD.id, role: "owner" },
    ]);

    // At most 20 memberships per person.
    await session(ids.dave);
    for (let index = 1; index <= 20; index += 1) await one("select id from create_team($1)", [`팀 ${index}`]);
    await rejects("select * from create_team('21번째')", [], "23514");
    await rejects("select * from join_team($1)", [rotatedByCarol.invite_code], "23514");
    assert.equal((await myMemberships(members.dave.id)).length, 20);
  } finally {
    await db.close();
  }
}

// M3: attendance is kept per team — one check-in per person, team and day.
async function attendanceSuite() {
  const { db, one, rows, rejects, session, admin, members } = await openDb();
  // Same statement the app sends (upsert with ignoreDuplicates); the team comes from the active team.
  const checkIn = (memberId) => rows(
    "insert into team_attendance(member_id) values ($1) on conflict (member_id, team_id, work_date) do nothing returning *", [memberId],
  );
  try {
    await db.exec(readSql("schema-team-memberships"));
    await session(ids.alice);
    const teamA = await one("select * from create_team('A팀')");
    const teamB = await one("select * from create_team('B팀')");
    await one("select * from switch_team($1)", [teamA.id]);
    const [inA] = await checkIn(members.alice.id);
    assert.equal(inA.team_id, teamA.id);
    assert.equal((await checkIn(members.alice.id)).length, 0, "same team twice is ignored");
    await one("select * from switch_team($1)", [teamB.id]);
    const [inB] = await checkIn(members.alice.id);
    assert.equal(inB.team_id, teamB.id);
    assert.deepEqual((await rows("select id from team_attendance")).map((r) => r.id), [inB.id]);
    await one("update team_attendance set checked_out_at = now() where id = $1 returning id", [inB.id]);
    assert.equal((await db.query("update team_attendance set checked_out_at = now() where id = $1", [inA.id])).affectedRows, 0);
    await rejects("update team_attendance set team_id = $2 where id = $1", [inB.id, teamA.id]);
    await one("select * from switch_team($1)", [teamA.id]);
    const visibleA = await rows("select id, checked_out_at from team_attendance");
    assert.deepEqual(visibleA.map((r) => [r.id, r.checked_out_at]), [[inA.id, null]]);
    await admin();
    assert.equal((await one("select count(*)::int as n from team_attendance where member_id = $1", [members.alice.id])).n, 2);
  } finally {
    await db.close();
  }
}

// M5: a screen still showing another team (x-teams-team header) cannot read or write the active team.
async function expectedTeamSuite() {
  const { db, one, rows, rejects, session, members } = await openDb();
  const headers = (value) => db.query("select set_config('request.headers', $1, false)", [value]);
  try {
    await db.exec(readSql("schema-team-memberships"));
    await session(ids.alice);
    const teamA = await one("select * from create_team('A팀')");
    const teamB = await one("select * from create_team('B팀')");
    await one("select * from switch_team($1)", [teamA.id]);
    await one("insert into projects(name,owner_id) values ('A 과업',$1) returning id", [ids.alice]);

    await headers(JSON.stringify({ "x-teams-team": teamB.id }));
    assert.equal((await one("select public.current_team_id() as id")).id, null);
    assert.equal((await rows("select * from projects")).length, 0);
    await rejects("insert into projects(name,owner_id) values ('엉뚱한 팀',$1)", [ids.alice]);
    await rejects("insert into department_events(title,visibility,starts_on,ends_on,created_by) values ('x','team','2026-11-11','2026-11-11',$1)", [members.alice.id]);
    // Private schedules do not depend on the team.
    await one("insert into department_events(title,visibility,starts_on,ends_on,created_by) values ('개인','private','2026-11-11','2026-11-11',$1) returning id", [members.alice.id]);

    await headers(JSON.stringify({ "x-teams-team": teamA.id }));
    assert.equal((await one("select public.current_team_id() as id")).id, teamA.id);
    assert.deepEqual((await rows("select name from projects")).map((r) => r.name), ["A 과업"]);
    // No header (desktop app, older app) or other headers: unchanged behaviour.
    await headers(JSON.stringify({ "user-agent": "desktop" }));
    assert.equal((await one("select public.current_team_id() as id")).id, teamA.id);
    await headers("");
    assert.equal((await one("select public.current_team_id() as id")).id, teamA.id);
    await one("insert into projects(name,owner_id) values ('A 둘째',$1) returning id", [ids.alice]);
  } finally {
    await db.close();
  }
}

(async () => {
  await migrationSuite();
  await expectedTeamSuite();
  await rpcSuite();
  await attendanceSuite();
  console.log("PASS: expected-team header (x-teams-team) mismatch hides the active team and blocks team writes; no header keeps old behaviour.");
  console.log("PASS: membership migration (owners from creators, repeatable), active-team foreign key, no direct membership writes, schema-teams re-run guard, isolation kept, cross-team mates without cross-team positions.");
  console.log("PASS: create/join add memberships, switch_team (members only, presence dropped, desks kept), per-team data, per-team owner role for code rotation, leave moves to latest remaining team, owner promotion, empty team kept, 20-team limit.");
  console.log("PASS: attendance per team (check in again after switching, each team sees its own row, no cross-team check-out).");
})().catch((error) => { console.error(error); process.exitCode = 1; });

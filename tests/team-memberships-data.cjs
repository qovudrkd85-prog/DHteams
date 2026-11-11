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

(async () => {
  await migrationSuite();
  console.log("PASS: membership migration (owners from creators, repeatable), active-team foreign key, no direct membership writes, schema-teams re-run guard, isolation kept, cross-team mates without cross-team positions.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

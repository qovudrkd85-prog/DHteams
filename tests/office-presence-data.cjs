/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL permissions and seat-race checks. */
// Local in-memory PostgreSQL only. No .env reads or Supabase connections.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const vm = require("node:vm");
const ts = require("typescript");
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");

const aliceId = "10000000-0000-0000-0000-000000000001";
const bobId = "10000000-0000-0000-0000-000000000002";
const newUserId = "10000000-0000-0000-0000-000000000003";
const outsiderId = "10000000-0000-0000-0000-000000000004";
const item = (id, member_id = null, extra = {}) => ({ id, kind: "desk", x: 200, y: 200, rotation: 0, label: id, member_id, ...extra });
const setupSql = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key, email text unique, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
`;
const baseSchemas = ["schema", "schema-open-mode", "schema-update-all", "schema-trash", "schema-department-events", "schema-team-workspace", "schema-accounts"];

(async () => {
  const db = new PGlite();
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const rejects = async (sql, params = [], code = "42501") => assert.rejects(db.query(sql, params), (error) => {
    assert.equal(error.code, code, `${sql}: ${error.message}`);
    return true;
  });
  const session = async (userId, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ""]);
    await db.exec(`set role ${role}`);
  };
  const readSql = (name) => fs.readFileSync(path.resolve(__dirname, `../supabase/${name}.sql`), "utf8");
  const claim = (layoutId, itemId) => one("select * from public.claim_office_seat($1, $2)", [layoutId, itemId]);
  const owner = (layout, seat) => layout.items.find((entry) => entry.id === seat)?.member_id;
  try {
    await db.exec(setupSql);
    for (const schema of baseSchemas) await db.exec(readSql(schema));
    for (const [id, username] of [[aliceId, "alice"], [bobId, "bob"], [newUserId, "new_user"]]) {
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)", [id, `${username}@members.dhteams.invalid`, JSON.stringify({ username })]);
    }
    await db.query("insert into auth.users(id,email) values ($1,'outsider@example.com')", [outsiderId]);
    const alice = await one("update team_members set profile_completed = true where user_id = $1 returning *", [aliceId]);
    const bob = await one("update team_members set profile_completed = true where user_id = $1 returning *", [bobId]);
    const newcomer = await one("select * from team_members where user_id = $1", [newUserId]);
    const legacy = await one("insert into team_members(name,role) values ('이전 팀원','팀장') returning *");
    const preservedItems = [item("legacy-desk", legacy.id), item("desk-a"), item("desk-b"), item("desk-c"), item("plant", null, { kind: "plant" })];
    const original = await one("insert into office_layouts(name,items) values ('꾸민 기존 사무실',$1) returning *", [JSON.stringify(preservedItems)]);
    execFileSync(process.execPath, [path.resolve(__dirname, "../scripts/prepare-account-upgrade.cjs")], { windowsHide: true, stdio: "pipe" });
    const migration = fs.readFileSync(path.resolve(__dirname, "../artifacts/setup/teams-office-world-upgrade.sql"), "utf8");
    const combined = fs.readFileSync(path.resolve(__dirname, "../artifacts/setup/teams-account-upgrade.sql"), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const preserved = await one("select * from office_layouts where id = $1", [original.id]);
    assert.equal(preserved.name, original.name);
    assert.deepEqual(preserved.items, preservedItems);
    assert.equal(preserved.room_key, "office-1");
    assert.equal(preserved.canvas_width, 1000);
    assert.equal((await one("select count(*)::int as n from office_layouts")).n, 6);
    assert.deepEqual((await db.query("select room_key from office_layouts order by room_key")).rows.map((row) => row.room_key), ["cafe", "office-1", "office-2", "office-3", "office-4", "outdoor"]);
    assert.equal((await one("select status_message from team_members where id = $1", [legacy.id])).status_message, "");

    await session(null, "anon");
    await rejects("select * from claim_office_seat($1,'desk-a')", [original.id]);
    await rejects("select * from team_presence");
    await rejects("update team_members set status_message = '변조' where id = $1", [alice.id]);
    await session(outsiderId);
    await rejects("select * from claim_office_seat($1,'desk-a')", [original.id]);
    assert.equal((await db.query("select * from team_presence")).rows.length, 0);
    await session(newUserId);
    await rejects("select * from claim_office_seat($1,'desk-a')", [original.id]);
    await rejects("insert into office_layouts(name,items) values ('프로필 미완료',$1)", [JSON.stringify([item("mine", newcomer.id)])]);

    await session(aliceId);
    const status = await one("update team_members set status_message = '집중 작업 중 ☕' where id = $1 returning status_message", [alice.id]);
    assert.equal(status.status_message, "집중 작업 중 ☕");
    assert.equal((await db.query("update team_members set status_message = '대리 수정' where id = $1 returning id", [bob.id])).rows.length, 0);
    await rejects("update team_members set status_message = repeat('가',61) where id = $1", [alice.id], "23514");
    await one("update team_members set status_message = '' where id = $1 returning id", [alice.id]);
    await rejects("select * from claim_office_seat($1,'legacy-desk')", [original.id], "23505");
    await rejects("select * from claim_office_seat($1,'plant')", [original.id], "P0002");
    await rejects("select * from claim_office_seat($1,'missing')", [original.id], "P0002");
    await rejects("select * from claim_office_seat($1,' ')", [original.id], "22023");

    const claimedA = await claim(original.id, "desk-a");
    assert.equal(owner(claimedA, "desk-a"), alice.id);
    assert.equal(owner(claimedA, "legacy-desk"), legacy.id);
    assert.notEqual(claimedA.updated_at, preserved.updated_at);
    assert.equal((await claim(original.id, "desk-a")).updated_at.getTime(), claimedA.updated_at.getTime());
    await session(bobId);
    // Simulate B submitting the same vacant seat from a stale view after A wins.
    await rejects("select * from claim_office_seat($1,'desk-a')", [original.id], "23505");
    assert.equal((await db.query("update office_layouts set items = $1 where id = $2 and updated_at = $3 returning id", [JSON.stringify(preserved.items), original.id, preserved.updated_at])).rows.length, 0);
    await rejects("update office_layouts set items = $1 where id = $2", [JSON.stringify(preserved.items), original.id]);
    const claimedB = await claim(original.id, "desk-b");
    assert.equal(owner(claimedB, "desk-a"), alice.id);
    assert.equal(owner(claimedB, "desk-b"), bob.id);
    await rejects("update office_layouts set items = $1 where id = $2", [JSON.stringify(claimedB.items.filter((entry) => entry.id !== "desk-a")), original.id]);
    await rejects("update office_layouts set items = $1 where id = $2", [JSON.stringify(claimedB.items.map((entry) => entry.id === "desk-a" ? { ...entry, member_id: bob.id } : entry.id === "desk-b" ? { ...entry, member_id: null } : entry)), original.id]);
    await rejects("insert into office_layouts(name,items) values ('다른 팀원 배정',$1)", [JSON.stringify([item("spoof", alice.id)])]);
    const movedFurniture = await one("update office_layouts set items = $1 where id = $2 returning *", [JSON.stringify(claimedB.items.map((entry) => ({ ...entry, x: entry.x + 20 }))), original.id]);
    assert.equal(owner(movedFurniture, "desk-a"), alice.id);
    await rejects("delete from office_layouts where id = $1", [original.id], "23514");

    await session(aliceId);
    const movedA = await claim(original.id, "desk-c");
    assert.equal(owner(movedA, "desk-a"), null);
    assert.equal(owner(movedA, "desk-c"), alice.id);
    assert.equal(owner(movedA, "desk-b"), bob.id);
    const presence = await one("insert into team_presence(member_id,layout_id,x,y,facing,motion,updated_at) values ($1,$2,220,200,'left','seated','2000-01-01') returning *", [alice.id, original.id]);
    assert.ok(presence.updated_at.getUTCFullYear() > 2000);
    assert.equal(presence.motion, "seated");
    await rejects("insert into team_presence(member_id,layout_id,x,y) values ($1,$2,200,200)", [bob.id, original.id]);
    await rejects("update team_presence set member_id = $1 where member_id = $2", [bob.id, alice.id]);
    await rejects("update team_presence set x = 1001 where member_id = $1", [alice.id], "23514");
    await rejects("update team_presence set facing = 'diagonal' where member_id = $1", [alice.id], "23514");
    await rejects("update team_presence set motion = 'flying' where member_id = $1", [alice.id], "23514");
    const released = await claim(original.id, null);
    assert.equal(owner(released, "desk-c"), null);
    assert.equal(owner(released, "desk-b"), bob.id);
    assert.equal((await one("select motion from team_presence where member_id = $1", [alice.id])).motion, "standing");
    await rejects("update team_presence set motion = 'seated' where member_id = $1", [alice.id], "23514");
    await session(bobId);
    assert.equal((await one("select x from team_presence where member_id = $1", [alice.id])).x, "220");
    assert.equal((await db.query("update team_presence set x = 100 where member_id = $1 returning member_id", [alice.id])).rows.length, 0);
    assert.equal((await db.query("delete from team_presence where member_id = $1 returning member_id", [alice.id])).rows.length, 0);

    await session(aliceId);
    const wide = await one("insert into office_layouts(name,items,canvas_width,canvas_height) values ('넓은 사무실',$1,2400,1200) returning *", [JSON.stringify([item("far", null, { x: 2300, y: 1100 })])]);
    await rejects("insert into office_layouts(name,canvas_width,canvas_height) values ('범위 오류',2401,1200)", [], "23514");
    await rejects("insert into office_layouts(name,canvas_width,canvas_height) values ('범위 오류',1000,559)", [], "23514");
    await rejects("update office_layouts set canvas_width = 1000 where id = $1", [wide.id], "23514");
    await rejects("insert into office_layouts(name,items,canvas_width,canvas_height) values ('좌표 오류',$1,2400,1200)", [JSON.stringify([item("outside", null, { x: 2401 })])], "23514");
    await one("update team_presence set layout_id=$1,x=2350,y=1150,motion='standing',facing='up' where member_id=$2 returning member_id", [wide.id, alice.id]);
    await rejects("update office_layouts set canvas_width = 2300 where id = $1", [wide.id], "23514");
    await claim(wide.id, "far");
    await one("update team_presence set motion='seated' where member_id=$1 returning member_id", [alice.id]);
    await one("update office_layouts set items=$1 where id=$2 returning id", [JSON.stringify([item("far", null, { x: 2300, y: 1100 })]), wide.id]);
    assert.equal((await one("select motion from team_presence where member_id=$1", [alice.id])).motion, "standing");
    await one("delete from office_layouts where id=$1 returning id", [wide.id]);
    const afterDelete = await one("select layout_id,x,y,motion from team_presence where member_id=$1", [alice.id]);
    assert.deepEqual(afterDelete, { layout_id: null, x: "0", y: "0", motion: "standing" });
    await one("delete from team_presence where member_id=$1 returning member_id", [alice.id]);

    await db.exec("reset role");
    const beforeRerun = await one("select items from office_layouts where id = $1", [original.id]);
    await db.exec(migration);
    assert.deepEqual(await one("select items from office_layouts where id = $1", [original.id]), beforeRerun);
    assert.equal((await one("select count(*)::int as n from office_layouts")).n, 6);
    await db.exec(combined);
    await db.exec(combined);
    assert.deepEqual(await one("select items from office_layouts where id = $1", [original.id]), beforeRerun);
    assert.equal((await one("select count(*)::int as n from office_layouts")).n, 6);
    await session(aliceId);
    await one("update team_members set status_message = '통합 업데이트 후 상태' where id=$1 returning id", [alice.id]);
    await one("update office_layouts set items = items where room_key='outdoor' returning id");
    await rejects("update office_layouts set items = $1 where id = $2", [JSON.stringify(preserved.items), original.id]);
    await session(null, "anon");
    await rejects("select * from office_layouts");
    await rejects("select * from team_presence");
    await db.exec("reset role");
    const rpc = await one("select prosecdef, proconfig from pg_proc where oid = 'public.claim_office_seat(uuid,text)'::regprocedure");
    assert.equal(rpc.prosecdef, true);
    assert.deepEqual(rpc.proconfig, ['search_path=""']);
    const emptyDb = new PGlite();
    try {
      await emptyDb.exec(setupSql);
      for (const schema of baseSchemas) await emptyDb.exec(readSql(schema));
      await emptyDb.exec(migration);
      await emptyDb.exec(migration);
      assert.equal((await emptyDb.query("select count(*)::int as n from office_layouts")).rows[0].n, 6);
      assert.deepEqual((await emptyDb.query("select canvas_width,canvas_height,jsonb_array_length(items) as furniture from office_layouts where room_key='office-1'")).rows[0], { canvas_width: 1600, canvas_height: 900, furniture: 4 });
    } finally { await emptyDb.close(); }
    // Exercise the real movement writer against transient transaction failures.
    // Only lock/deadlock/serialization conflicts are retried; ownership errors are not.
    const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/team/presence.ts"), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const presenceExports = {};
    const queued = [];
    const writes = [];
    vm.runInNewContext(compiled, {
      exports: presenceExports,
      require: () => ({ createClient: () => ({ from: (table) => {
        assert.equal(table, "team_presence");
        return { upsert: (payload) => {
          writes.push(payload);
          return { select: () => ({ single: async () => {
            assert.ok(queued.length, "Unexpected extra retry");
            return queued.shift();
          } }) };
        } };
      } }) }),
      setTimeout: (resolve) => { resolve(); return 0; },
    });
    const point = { member_id: alice.id, layout_id: original.id, x: 201.4, y: 200.6, facing: "down", motion: "standing" };
    queued.push({ error: { code: "55P03", message: "room busy" } }, { error: { code: "40P01", message: "retry transaction" } }, { data: point, error: null });
    assert.equal(await presenceExports.saveTeamPresence(point), point);
    assert.equal(writes.length, 3);
    for (const write of writes) {
      assert.equal(write.x, 201);
      assert.equal(write.y, 201);
      assert.equal(write.member_id, alice.id);
    }
    queued.push({ error: { code: "42501", message: "other member forbidden" } });
    await assert.rejects(presenceExports.saveTeamPresence(point), /other member forbidden/);
    assert.equal(writes.length, 4);
    queued.push(...Array.from({ length: 3 }, () => ({ error: { code: "55P03", message: "still busy" } })));
    await assert.rejects(presenceExports.saveTeamPresence(point), /still busy/);
    assert.equal(writes.length, 7);
    assert.equal(queued.length, 0);
    console.log("PASS: repeatable six-room seed, legacy layout preservation, exclusive self-seat claims, stale-save/owner guards, self status/presence, movement bounds, seat release and safe room deletion.");
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

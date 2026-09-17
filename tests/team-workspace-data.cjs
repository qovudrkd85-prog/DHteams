/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local PostgreSQL test harness. */
// Uses an isolated, in-memory PostgreSQL database. Never reads .env or contacts Supabase.
// npm install, then npm run test:data
// PGLITE_MODULE may point to an existing installation instead.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");

(async () => {
  const db = new PGlite();
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const rejects = async (sql, params = [], code = "23514") => {
    await assert.rejects(db.query(sql, params), (error) => error.code === code);
  };
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(fs.readFileSync(path.resolve(__dirname, "../supabase/schema-department-events.sql"), "utf8"));
    const legacy = await one("insert into department_events(title, category, starts_on, ends_on) values ('기존 회의', 'meeting', '2026-09-01', '2026-09-01') returning id, title");
    const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/schema-team-workspace.sql"), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const legacyAfter = await one("select id, title, created_by, creator_name, creator_color from department_events where id = $1", [legacy.id]);
    assert.deepEqual(legacyAfter, { ...legacy, created_by: null, creator_name: null, creator_color: null });

    // Exercise the same anonymous shared role as the app rather than a privileged connection.
    await db.exec("set role anon");
    const member = await one("insert into team_members(name, role, color) values ('민지', '디자인', '#547867') returning *");
    const second = await one("insert into team_members(name, color) values ('준호', '#5B7FA6') returning *");
    await rejects("insert into team_members(name) values ('   ')");
    await rejects("insert into team_members(name, color) values ('민지', 'red')");
    await rejects("insert into team_members(name) values (repeat('가', 41))");
    await rejects("update team_members set name = '변조' where id = $1", [member.id], "42501");

    const authored = await one("insert into department_events(title, category, starts_on, ends_on, created_by, creator_name, creator_color) values ('업무 보고서', 'work', '2026-09-01', '2026-09-02', $1, '임의 이름', '#000000') returning *", [member.id]);
    assert.equal(authored.creator_name, member.name);
    assert.equal(authored.creator_color, member.color);
    await rejects("update department_events set created_by = $1 where id = $2", [second.id, authored.id]);
    await rejects("update department_events set creator_name = '다른 이름' where id = $1", [authored.id]);
    await rejects("update department_events set creator_color = '#000000' where id = $1", [authored.id]);
    await rejects("update department_events set created_by = null, creator_name = null, creator_color = null where id = $1", [authored.id]);
    await rejects("update department_events set created_by = $1 where id = $2", [member.id, legacy.id]);
    await rejects("insert into department_events(title, category, starts_on, ends_on, creator_name) values ('작성자 오류', 'work', '2026-09-01', '2026-09-01', '임의 작성자')");
    await rejects("insert into department_events(title, category, starts_on, ends_on, created_by) values ('작성자 오류', 'work', '2026-09-01', '2026-09-01', '00000000-0000-0000-0000-000000000099')", [], "23503");
    const edited = await one("update department_events set title = '수정한 업무', deleted_at = now() where id = $1 returning creator_name, created_by", [authored.id]);
    assert.deepEqual(edited, { creator_name: member.name, created_by: member.id });
    const legacyEdited = await one("update department_events set title = '기존 일정 수정' where id = $1 returning created_by", [legacy.id]);
    assert.equal(legacyEdited.created_by, null);

    const checkin = await one("insert into team_attendance(member_id, work_date, checked_in_at) values ($1, '2000-01-01', '2000-01-01T00:00:00Z') returning id, work_date::text, checked_in_at::text, checked_out_at", [member.id]);
    const serverToday = await one("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as today, extract(epoch from (clock_timestamp() - $1::timestamptz)) as age", [checkin.checked_in_at]);
    assert.equal(checkin.work_date, serverToday.today);
    assert.ok(Number(serverToday.age) >= 0 && Number(serverToday.age) < 30);
    assert.equal(checkin.checked_out_at, null);
    await rejects("insert into team_attendance(member_id) values ($1)", [member.id], "23505");
    const overlap = await Promise.all(Array.from({ length: 3 }, () => db.query("insert into team_attendance(member_id) values ($1) on conflict (member_id, work_date) do nothing returning id", [second.id])));
    assert.equal(overlap.reduce((count, result) => count + result.rows.length, 0), 1);
    await rejects("update team_attendance set member_id = $1 where id = $2", [second.id, checkin.id]);
    await rejects("update team_attendance set work_date = work_date - 1 where id = $1", [checkin.id]);
    await rejects("update team_attendance set checked_in_at = checked_in_at - interval '1 hour' where id = $1", [checkin.id]);
    const checkout = await one("update team_attendance set checked_out_at = '1900-01-01T00:00:00Z' where id = $1 and checked_out_at is null returning checked_out_at::text, checked_out_at >= checked_in_at as ordered", [checkin.id]);
    assert.ok(checkout.ordered);
    assert.notEqual(checkout.checked_out_at.slice(0, 4), "1900");
    assert.equal((await db.query("update team_attendance set checked_out_at = now() where id = $1 and checked_out_at is null returning id", [checkin.id])).rows.length, 0);
    await rejects("update team_attendance set checked_out_at = null where id = $1", [checkin.id]);
    await rejects("update team_attendance set checked_out_at = checked_out_at + interval '1 hour' where id = $1", [checkin.id]);
    await rejects("delete from team_attendance where id = $1", [checkin.id], "42501");

    const item = { id: "starter-desk-1", kind: "desk", x: 200, y: 160, rotation: 0, label: "디자인팀", member_id: member.id };
    const layout = await one("insert into office_layouts(name, items) values ('우리 사무실', $1::jsonb) returning id, updated_at::text", [JSON.stringify([item])]);
    const invalidItems = [null, {}, [null], [{}], [{ ...item, x: -1 }], [{ ...item, y: 561 }], [{ ...item, x: "200" }], [{ ...item, rotation: 45 }], [{ ...item, kind: "unknown" }], [{ ...item, label: "가".repeat(41) }], [{ ...item, member_id: 42 }], [{ ...item, member_id: "invalid" }], [{ ...item, kind: "plant" }], [item, item], [item, { ...item, id: "second-desk" }], Array.from({ length: 101 }, (_, i) => ({ ...item, id: String(i), member_id: null }))];
    for (const invalid of invalidItems) {
      await rejects("insert into office_layouts(name, items) values ('검증', $1::jsonb)", [JSON.stringify(invalid)]);
    }
    await rejects("insert into office_layouts(name, items) values ('검증', $1::jsonb)", [JSON.stringify([{ ...item, member_id: "00000000-0000-0000-0000-000000000099" }])], "23503");
    const renamed = await one("update office_layouts set name = '새 배치도 이름' where id = $1 and updated_at = $2::timestamptz returning updated_at::text", [layout.id, layout.updated_at]);
    assert.ok(renamed);
    assert.notEqual(renamed.updated_at, layout.updated_at);
    assert.equal((await db.query("update office_layouts set name = '충돌' where id = $1 and updated_at = $2::timestamptz returning id", [layout.id, layout.updated_at])).rows.length, 0);
    assert.equal((await db.query("delete from office_layouts where id = $1 and updated_at = $2::timestamptz returning id", [layout.id, layout.updated_at])).rows.length, 0);
    assert.equal((await db.query("delete from office_layouts where id = $1 and updated_at = $2::timestamptz returning id", [layout.id, renamed.updated_at])).rows.length, 1);

    // Load only the TypeScript helper, with a client stub that forbids any real DB access.
    const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/team/workspace.ts"), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: () => ({ createClient() { throw new Error("Unexpected DB access"); } }), Intl, Date });
    assert.equal(exports.officeDateKey(new Date("2026-09-15T14:59:59.999Z")), "2026-09-15");
    assert.equal(exports.officeDateKey(new Date("2026-09-15T15:00:00.000Z")), "2026-09-16");
    assert.equal(exports.officeDateKey(new Date("2026-12-31T15:00:00.000Z")), "2027-01-01");
    await assert.rejects(exports.listAttendance("2026-02-30"), /날짜/);
    await assert.rejects(exports.listAttendance("invalid"), /날짜/);
    console.log("PASS: repeatable migration, shared-role permissions, creator integrity, work category, atomic attendance, server Korean dates, layout validation, stale-write guards, midnight helpers.");
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

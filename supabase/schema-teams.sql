-- 팀별 공간: 초대코드로 팀에 참가하고, 과업·사무실·팀 일정은 같은 팀만 봅니다.
-- 개인 일정(visibility = 'private')은 팀이 아니라 작성한 사람에게 붙습니다.
-- schema-office-presence.sql 다음, 맨 마지막에 Supabase SQL Editor에서 전체 실행하세요. 재실행 가능합니다.
-- 팀이 정해지지 않은 기존 행(과업·방·일정)은 보존되지만 어느 팀에도 보이지 않습니다.
begin;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  invite_code text not null,
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint teams_invite_code_key unique (invite_code),
  -- Unambiguous alphabet: no 0/O, 1/I/L.
  constraint teams_invite_code_check check (invite_code ~ '^[A-HJKMNP-Z2-9]{8}$')
);

alter table public.team_members add column if not exists team_id uuid;
-- Columns first: SQL helper functions below are validated at creation time.
alter table public.projects add column if not exists team_id uuid;
alter table public.office_layouts add column if not exists team_id uuid;
alter table public.team_attendance add column if not exists team_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_members_team_id_fkey') then
    alter table public.team_members add constraint team_members_team_id_fkey
      foreign key (team_id) references public.teams(id) on delete set null;
  end if;
end;
$$;
create index if not exists team_members_team_id_idx on public.team_members (team_id);

-- 팀 소속은 RPC로만 바꿉니다. team_id 는 프로필 컬럼 UPDATE 권한에 넣지 않습니다.
create or replace function public.current_team_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select member.team_id from public.team_members as member
  where member.user_id = (select auth.uid());
$$;
revoke all on function public.current_team_id() from public, anon, authenticated;
grant execute on function public.current_team_id() to authenticated, service_role;

-- 기존 정책 이름은 유지하되 의미를 "팀에 소속된 계정"으로 좁힙니다.
create or replace function public.has_team_account()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members as member
    where member.user_id = (select auth.uid()) and member.team_id is not null
  );
$$;
revoke all on function public.has_team_account() from public, anon, authenticated;
grant execute on function public.has_team_account() to authenticated, service_role;

create or replace function public.is_team_mate(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members as member
    where member.id = p_member and member.team_id is not null
      and member.team_id = public.current_team_id()
  );
$$;
revoke all on function public.is_team_mate(uuid) from public, anon, authenticated;
grant execute on function public.is_team_mate(uuid) to authenticated, service_role;

create or replace function public.can_access_project(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects as project
    where project.id = p_project and project.team_id is not null
      and project.team_id = public.current_team_id()
  );
$$;
revoke all on function public.can_access_project(uuid) from public, anon, authenticated;
grant execute on function public.can_access_project(uuid) to authenticated, service_role;

create or replace function public.can_access_node(p_node uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.nodes as node
    join public.projects as project on project.id = node.project_id
    where node.id = p_node and project.team_id is not null
      and project.team_id = public.current_team_id()
  );
$$;
revoke all on function public.can_access_node(uuid) from public, anon, authenticated;
grant execute on function public.can_access_node(uuid) to authenticated, service_role;

create or replace function public.layout_in_my_team(p_layout uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.office_layouts as layout
    where layout.id = p_layout and layout.team_id is not null
      and layout.team_id = public.current_team_id()
  );
$$;
revoke all on function public.layout_in_my_team(uuid) from public, anon, authenticated;
grant execute on function public.layout_in_my_team(uuid) to authenticated, service_role;

-- 팀 소유 테이블: 새 행은 작성자의 팀으로 자동 지정됩니다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_team_id_fkey') then
    alter table public.projects add constraint projects_team_id_fkey
      foreign key (team_id) references public.teams(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'office_layouts_team_id_fkey') then
    alter table public.office_layouts add constraint office_layouts_team_id_fkey
      foreign key (team_id) references public.teams(id) on delete cascade;
  end if;
end;
$$;
alter table public.projects alter column team_id set default public.current_team_id();
alter table public.office_layouts alter column team_id set default public.current_team_id();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_attendance_team_id_fkey') then
    alter table public.team_attendance add constraint team_attendance_team_id_fkey
      foreign key (team_id) references public.teams(id) on delete cascade;
  end if;
end;
$$;
create index if not exists team_attendance_team_id_idx on public.team_attendance (team_id, work_date);
-- Check-in records are stamped with the team at insert and never move with the person.
create or replace function public.stamp_attendance_team()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor_team uuid;
begin
  select team_id into actor_team from public.team_members where user_id = (select auth.uid()) for key share;
  if (select auth.uid()) is not null and actor_team is null then
    raise exception '팀에 참가한 뒤 출퇴근을 기록해 주세요.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.team_id := actor_team;
  else
    if (select auth.uid()) is not null and old.team_id is distinct from actor_team then
      raise exception '다른 팀의 출퇴근 기록은 바꿀 수 없습니다.' using errcode = '42501';
    end if;
    new.team_id := old.team_id;
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_attendance_team() from public, anon, authenticated;
drop trigger if exists team_attendance_stamp_team on public.team_attendance;
create trigger team_attendance_stamp_team before insert or update on public.team_attendance
  for each row execute function public.stamp_attendance_team();
create index if not exists projects_team_id_idx on public.projects (team_id);
create index if not exists office_layouts_team_id_idx on public.office_layouts (team_id);

-- 팀마다 같은 방 키(office-1, outdoor ...)를 씁니다. 키 없는 직접 만든 방은 개수 제한이 없습니다.
-- 팀 없는 기존 방의 키는 계속 하나씩만 허용해 office SQL 재실행 시 시드가 늘지 않습니다.
alter table public.office_layouts drop constraint if exists office_layouts_room_key_key;
create unique index if not exists office_layouts_team_room_key_idx
  on public.office_layouts (team_id, room_key) where team_id is not null and room_key is not null;
create unique index if not exists office_layouts_legacy_room_key_idx
  on public.office_layouts (room_key) where team_id is null and room_key is not null;

-- 팀 일정 / 개인 일정
alter table public.department_events add column if not exists visibility text not null default 'team';
alter table public.department_events add column if not exists team_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'department_events_visibility_check') then
    alter table public.department_events add constraint department_events_visibility_check
      check (visibility in ('team', 'private'));
  end if;
  -- 개인 일정은 절대 팀에 붙지 않습니다. 팀 없는 기존 팀 일정(NULL)은 아무에게도 보이지 않습니다.
  if not exists (select 1 from pg_constraint where conname = 'department_events_private_no_team_check') then
    alter table public.department_events add constraint department_events_private_no_team_check
      check (visibility = 'team' or team_id is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'department_events_team_id_fkey') then
    alter table public.department_events add constraint department_events_team_id_fkey
      foreign key (team_id) references public.teams(id) on delete cascade;
  end if;
end;
$$;
create index if not exists department_events_team_id_idx on public.department_events (team_id) where deleted_at is null;
create index if not exists department_events_private_owner_idx on public.department_events (created_by)
  where visibility = 'private' and deleted_at is null;

-- team_id 는 클라이언트가 정하지 못합니다. 공개 범위는 작성자만 바꿀 수 있습니다.
create or replace function public.scope_department_event()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor_team uuid := public.current_team_id();
begin
  if tg_op = 'UPDATE' then
    if new.visibility is not distinct from old.visibility then
      new.team_id := old.team_id;
      return new;
    end if;
    if old.created_by is distinct from public.current_team_member_id() then
      raise exception '공개 범위는 작성자만 바꿀 수 있습니다.' using errcode = '42501';
    end if;
  end if;
  if new.visibility = 'private' then
    new.team_id := null;
  else
    if actor_team is null then
      raise exception '팀에 참가한 뒤 팀 일정을 등록해 주세요.' using errcode = '42501';
    end if;
    new.team_id := actor_team;
  end if;
  return new;
end;
$$;
revoke all on function public.scope_department_event() from public, anon, authenticated;
drop trigger if exists department_events_team_scope on public.department_events;
create trigger department_events_team_scope before insert or update on public.department_events
  for each row execute function public.scope_department_event();

-- 정책 교체: 공유 범위를 "로그인 계정 전체"에서 "같은 팀"으로 좁힙니다.
do $$
declare target_table text;
begin
  foreach target_table in array array['projects', 'nodes', 'file_logs', 'schedules', 'project_memos', 'office_layouts'] loop
    execute format('drop policy if exists accounts_team_shared on public.%I', target_table);
    execute format('drop policy if exists teams_scoped on public.%I', target_table);
  end loop;
end;
$$;
create policy teams_scoped on public.projects for all to authenticated
  using (team_id is not null and team_id = (select public.current_team_id()))
  with check (team_id is not null and team_id = (select public.current_team_id()));
create policy teams_scoped on public.office_layouts for all to authenticated
  using (team_id is not null and team_id = (select public.current_team_id()))
  with check (team_id is not null and team_id = (select public.current_team_id()));
create policy teams_scoped on public.nodes for all to authenticated
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
create policy teams_scoped on public.schedules for all to authenticated
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
create policy teams_scoped on public.project_memos for all to authenticated
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
create policy teams_scoped on public.file_logs for all to authenticated
  using (public.can_access_node(node_id)) with check (public.can_access_node(node_id));

drop policy if exists accounts_members_read on public.team_members;
create policy accounts_members_read on public.team_members for select to authenticated
  using (user_id = (select auth.uid()) or (team_id is not null and team_id = (select public.current_team_id())));

drop policy if exists accounts_attendance_read on public.team_attendance;
create policy accounts_attendance_read on public.team_attendance for select to authenticated
  using (team_id is not null and team_id = (select public.current_team_id()));
drop policy if exists accounts_attendance_check_in on public.team_attendance;
create policy accounts_attendance_check_in on public.team_attendance for insert to authenticated
  with check (member_id = (select public.current_team_member_id())
    and team_id is not null and team_id = (select public.current_team_id()));
drop policy if exists accounts_attendance_check_out on public.team_attendance;
create policy accounts_attendance_check_out on public.team_attendance for update to authenticated
  using (member_id = (select public.current_team_member_id())
    and team_id is not null and team_id = (select public.current_team_id()))
  with check (member_id = (select public.current_team_member_id())
    and team_id is not null and team_id = (select public.current_team_id()));

drop policy if exists presence_members_read on public.team_presence;
create policy presence_members_read on public.team_presence for select to authenticated
  using (public.is_team_mate(member_id));
drop policy if exists presence_members_insert on public.team_presence;
create policy presence_members_insert on public.team_presence for insert to authenticated
  with check (member_id = (select public.current_team_member_id())
    and (layout_id is null or public.layout_in_my_team(layout_id)));
drop policy if exists presence_members_update on public.team_presence;
create policy presence_members_update on public.team_presence for update to authenticated
  using (member_id = (select public.current_team_member_id()))
  with check (member_id = (select public.current_team_member_id())
    and (layout_id is null or public.layout_in_my_team(layout_id)));

drop policy if exists accounts_events_read on public.department_events;
create policy accounts_events_read on public.department_events for select to authenticated using (
  (visibility = 'team' and team_id is not null and team_id = (select public.current_team_id()))
  or (visibility = 'private' and created_by = (select public.current_team_member_id()))
);
drop policy if exists accounts_events_create on public.department_events;
create policy accounts_events_create on public.department_events for insert to authenticated with check (
  created_by = (select public.current_team_member_id())
  and (visibility = 'private' or (team_id is not null and team_id = (select public.current_team_id())))
);
drop policy if exists accounts_events_edit on public.department_events;
create policy accounts_events_edit on public.department_events for update to authenticated
  using (
    (visibility = 'team' and team_id is not null and team_id = (select public.current_team_id()))
    or (visibility = 'private' and created_by = (select public.current_team_member_id()))
  )
  with check (
    (visibility = 'team' and team_id is not null and team_id = (select public.current_team_id()))
    or (visibility = 'private' and created_by = (select public.current_team_member_id()))
  );

alter table public.teams enable row level security;
revoke all on table public.teams from public, anon, authenticated;
grant select on table public.teams to authenticated;
grant all on table public.teams to service_role;
drop policy if exists teams_read_own on public.teams;
create policy teams_read_own on public.teams for select to authenticated
  using (id = (select public.current_team_id()));

-- 좌석 RPC: 다른 팀 배치도의 자리를 잡지 못합니다.
create or replace function public.claim_office_seat(p_layout_id uuid, p_item_id text default null)
returns public.office_layouts language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  actor_team uuid;
  chosen_layout public.office_layouts%rowtype;
  target_item jsonb;
  changed_items jsonb;
begin
  -- Same lock order as leave_team: member row first, then the layout row.
  select id, team_id into actor_id, actor_team from public.lock_team_actor();
  if actor_team is null then
    raise exception '팀에 참가한 뒤 자리를 선택해 주세요.' using errcode = '42501';
  end if;
  if p_item_id is not null and char_length(btrim(p_item_id)) not between 1 and 80 then
    raise exception '선택할 책상을 확인해 주세요.' using errcode = '22023';
  end if;
  select * into chosen_layout from public.office_layouts
    where id = p_layout_id and team_id = actor_team for update;
  if not found then
    raise exception '배치도를 찾을 수 없습니다. 새로고침해 주세요.' using errcode = 'P0002';
  end if;
  if p_item_id is not null then
    select value into target_item from jsonb_array_elements(chosen_layout.items) where value->>'id' = p_item_id;
    if not found or target_item->>'kind' <> 'desk' then
      raise exception '선택할 책상을 찾을 수 없습니다. 최신 배치도를 다시 불러와 주세요.' using errcode = 'P0002';
    end if;
    if target_item->>'member_id' is not null and (target_item->>'member_id')::uuid <> actor_id then
      raise exception '다른 팀원이 먼저 선택한 자리입니다. 다른 책상을 선택해 주세요.' using errcode = '23505';
    end if;
  end if;
  select coalesce(jsonb_agg(
    case
      when entry->>'id' = p_item_id then jsonb_set(entry, '{member_id}', to_jsonb(actor_id::text))
      when entry->>'member_id' is not null and (entry->>'member_id')::uuid = actor_id then jsonb_set(entry, '{member_id}', 'null'::jsonb)
      else entry
    end order by ordinal
  ), '[]'::jsonb) into changed_items
    from jsonb_array_elements(chosen_layout.items) with ordinality as items(entry, ordinal);
  if changed_items is distinct from chosen_layout.items then
    update public.office_layouts set items = changed_items where id = p_layout_id returning * into chosen_layout;
    update public.team_presence set motion = 'standing'
      where member_id = actor_id and layout_id = p_layout_id and motion = 'seated';
  end if;
  return chosen_layout;
end;
$$;
revoke all on function public.claim_office_seat(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_office_seat(uuid, text) to authenticated;

-- 직접 REST 쓰기도 팀원 행을 공유 잠금한 뒤 팀을 다시 확인합니다(팀 나가기와 경합 방지).
create or replace function public.verify_team_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor_team uuid;
  layout_team uuid;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  -- KEY SHARE only conflicts with lock_team_actor()'s FOR UPDATE; NOWAIT turns a would-be deadlock into retryable 55P03.
  select team_id into actor_team from public.team_members where user_id = (select auth.uid()) for key share nowait;
  if actor_team is null then
    raise exception '팀에 참가한 뒤 이용해 주세요.' using errcode = '42501';
  end if;
  if tg_table_name = 'office_layouts' then
    if new.team_id is null or new.team_id is distinct from actor_team then
      raise exception '우리 팀 공간이 아닙니다. 새로고침해 주세요.' using errcode = '42501';
    end if;
  elsif new.layout_id is not null then
    select team_id into layout_team from public.office_layouts where id = new.layout_id;
    if layout_team is null or layout_team is distinct from actor_team then
      raise exception '우리 팀 공간이 아닙니다. 새로고침해 주세요.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.verify_team_write() from public, anon, authenticated;
drop trigger if exists office_layouts_verify_team on public.office_layouts;
create trigger office_layouts_verify_team before insert or update on public.office_layouts
  for each row execute function public.verify_team_write();
drop trigger if exists team_presence_verify_team on public.team_presence;
create trigger team_presence_verify_team before insert or update on public.team_presence
  for each row execute function public.verify_team_write();

-- 초대코드: gen_random_uuid 의 무작위 바이트(버전·변형 비트 제외)에서 32글자 표로 뽑습니다.
create or replace function public.generate_team_invite_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  random_bytes bytea := uuid_send(gen_random_uuid());
  byte_positions constant int[] := array[0, 1, 2, 3, 4, 5, 10, 11];
  code text := '';
  position_index int;
begin
  foreach position_index in array byte_positions loop
    code := code || substr(alphabet, (get_byte(random_bytes, position_index) % 31) + 1, 1);
  end loop;
  return code;
end;
$$;
revoke all on function public.generate_team_invite_code() from public, anon, authenticated;

-- 새 팀의 기본 공간 6개(사무실 4·마당·카페). schema-office-presence.sql 의 시드와 같은 배치입니다.
create or replace function public.seed_team_rooms(p_team uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  room_number integer;
  room_items jsonb;
begin
  for room_number in 1..4 loop
    select jsonb_agg(jsonb_build_object(
      'id', 'desk-' || seat, 'kind', 'desk', 'x', 320 + ((seat - 1) % 2) * 530,
      'y', 260 + ((seat - 1) / 2) * 290, 'rotation', 0,
      'label', '책상 ' || seat, 'member_id', null
    ) order by seat) into room_items from generate_series(1, 4) as seats(seat);
    insert into public.office_layouts(name, theme, items, canvas_width, canvas_height, room_key, room_kind, team_id)
      values ('사무실 ' || room_number, 'sage', room_items, 1600, 900, 'office-' || room_number, 'office', p_team)
      on conflict do nothing;
  end loop;
  insert into public.office_layouts(name, theme, items, canvas_width, canvas_height, room_key, room_kind, team_id) values
    ('야외 마당', 'sage', '[{"id":"yard-tree-1","kind":"plant","x":250,"y":780,"rotation":0,"label":"쉼터 나무","member_id":null},{"id":"yard-tree-2","kind":"plant","x":1900,"y":780,"rotation":0,"label":"마당 나무","member_id":null},{"id":"yard-bench","kind":"sofa","x":1120,"y":820,"rotation":0,"label":"벤치","member_id":null}]', 2200, 1100, 'outdoor', 'outdoor', p_team),
    ('카페', 'sand', '[{"id":"cafe-table-1","kind":"table","x":420,"y":330,"rotation":0,"label":"커피 테이블","member_id":null},{"id":"cafe-table-2","kind":"table","x":1100,"y":330,"rotation":0,"label":"커피 테이블","member_id":null},{"id":"cafe-sofa","kind":"sofa","x":420,"y":650,"rotation":0,"label":"쉬어 가는 자리","member_id":null},{"id":"cafe-plant","kind":"plant","x":1370,"y":640,"rotation":0,"label":"카페 식물","member_id":null}]', 1600, 900, 'cafe', 'cafe', p_team)
    on conflict do nothing;
end;
$$;
revoke all on function public.seed_team_rooms(uuid) from public, anon, authenticated;

-- 이름·직책을 마친 계정의 member 행을 잠가 동시 요청을 막습니다.
create or replace function public.lock_team_actor()
returns public.team_members language plpgsql security definer set search_path = '' as $$
declare
  actor public.team_members%rowtype;
begin
  select * into actor from public.team_members where user_id = (select auth.uid()) for update;
  if not found or not actor.profile_completed then
    raise exception '로그인 후 이름과 직책을 설정해 주세요.' using errcode = '42501';
  end if;
  return actor;
end;
$$;
revoke all on function public.lock_team_actor() from public, anon, authenticated;

create or replace function public.create_team(p_name text)
returns public.teams language plpgsql security definer set search_path = '' as $$
declare
  actor public.team_members%rowtype := public.lock_team_actor();
  created public.teams%rowtype;
  attempt integer;
begin
  if actor.team_id is not null then
    raise exception '이미 팀에 소속되어 있습니다. 팀을 나간 뒤 새 팀을 만들어 주세요.' using errcode = '23514';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception '팀 이름은 1~40자로 입력해 주세요.' using errcode = '22023';
  end if;
  for attempt in 1..5 loop
    begin
      insert into public.teams(name, invite_code, created_by)
        values (btrim(p_name), public.generate_team_invite_code(), actor.id)
        returning * into created;
      exit;
    exception when unique_violation then
      if attempt = 5 then raise; end if;
    end;
  end loop;
  update public.team_members set team_id = created.id where id = actor.id;
  perform public.seed_team_rooms(created.id);
  return created;
end;
$$;
revoke all on function public.create_team(text) from public, anon, authenticated;
grant execute on function public.create_team(text) to authenticated;

create or replace function public.join_team(p_code text)
returns public.teams language plpgsql security definer set search_path = '' as $$
declare
  actor public.team_members%rowtype := public.lock_team_actor();
  target public.teams%rowtype;
  normalized text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
begin
  if actor.team_id is not null then
    raise exception '이미 팀에 소속되어 있습니다. 팀을 나간 뒤 참가해 주세요.' using errcode = '23514';
  end if;
  if normalized !~ '^[A-HJKMNP-Z2-9]{8}$' then
    raise exception '초대코드 8자리를 확인해 주세요.' using errcode = '22023';
  end if;
  select * into target from public.teams where invite_code = normalized;
  if not found then
    raise exception '초대코드에 맞는 팀이 없습니다.' using errcode = 'P0002';
  end if;
  update public.team_members set team_id = target.id where id = actor.id;
  return target;
end;
$$;
revoke all on function public.join_team(text) from public, anon, authenticated;
grant execute on function public.join_team(text) to authenticated;

-- 나가기 전에 내 자리와 현재 위치를 비웁니다. 개인 일정과 출퇴근 기록은 사람에게 남습니다.
create or replace function public.leave_team()
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor public.team_members%rowtype := public.lock_team_actor();
  layout record;
begin
  if actor.team_id is null then
    raise exception '소속된 팀이 없습니다.' using errcode = 'P0002';
  end if;
  for layout in
    select id, items from public.office_layouts
    where team_id = actor.team_id
      and exists (select 1 from jsonb_array_elements(items) as entry where entry->>'member_id' = actor.id::text)
    for update
  loop
    update public.office_layouts set items = (
      select coalesce(jsonb_agg(
        case when entry->>'member_id' = actor.id::text then jsonb_set(entry, '{member_id}', 'null'::jsonb) else entry end
        order by ordinal
      ), '[]'::jsonb)
      from jsonb_array_elements(layout.items) with ordinality as items(entry, ordinal)
    ) where id = layout.id;
  end loop;
  delete from public.team_presence where member_id = actor.id;
  update public.team_members set team_id = null where id = actor.id;
end;
$$;
revoke all on function public.leave_team() from public, anon, authenticated;
grant execute on function public.leave_team() to authenticated;

-- 만든 사람만 코드를 바꿉니다. 만든 사람이 팀을 떠났다면 남은 팀원 누구나 바꿀 수 있습니다.
create or replace function public.regenerate_team_code()
returns public.teams language plpgsql security definer set search_path = '' as $$
declare
  actor public.team_members%rowtype := public.lock_team_actor();
  target public.teams%rowtype;
  attempt integer;
begin
  if actor.team_id is null then
    raise exception '소속된 팀이 없습니다.' using errcode = 'P0002';
  end if;
  select * into target from public.teams where id = actor.team_id for update;
  if target.created_by is distinct from actor.id and exists (
    select 1 from public.team_members where id = target.created_by and team_id = target.id
  ) then
    raise exception '초대코드는 팀을 만든 사람만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  for attempt in 1..5 loop
    begin
      update public.teams set invite_code = public.generate_team_invite_code()
        where id = target.id returning * into target;
      exit;
    exception when unique_violation then
      if attempt = 5 then raise; end if;
    end;
  end loop;
  return target;
end;
$$;
revoke all on function public.regenerate_team_code() from public, anon, authenticated;
grant execute on function public.regenerate_team_code() to authenticated;

notify pgrst, 'reload schema';
commit;

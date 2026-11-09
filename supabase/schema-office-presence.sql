-- 내 자리 선택, 상태 메시지, 넓은 사무실.
-- schema-accounts.sql 다음에 실행하세요. 기존 자리 배정은 그대로 보존합니다.
-- 재실행할 수 있으며 다른 팀원의 자리 배정은 변경하거나 삭제할 수 없습니다.
begin;

-- Re-running this file after schema-teams.sql would reopen cross-team access. Stop instead.
do $$
begin
  if to_regclass('public.teams') is not null then
    raise exception '팀 공간(schema-teams.sql)이 설치된 DB입니다. 이 파일만 다시 실행하면 팀 격리가 풀립니다. 실행을 중단했습니다.' using errcode = 'P0001';
  end if;
end;
$$;

alter table public.team_members add column if not exists status_message text not null default '';
alter table public.office_layouts add column if not exists canvas_width integer not null default 1000;
alter table public.office_layouts add column if not exists canvas_height integer not null default 560;
alter table public.office_layouts add column if not exists room_key text;
alter table public.office_layouts add column if not exists room_kind text not null default 'office';
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.team_members'::regclass and conname = 'team_members_status_message_check') then
    alter table public.team_members add constraint team_members_status_message_check check (char_length(status_message) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.office_layouts'::regclass and conname = 'office_layouts_canvas_size_check') then
    alter table public.office_layouts add constraint office_layouts_canvas_size_check
      check (canvas_width between 1000 and 2400 and canvas_height between 560 and 1200);
  end if;
  -- After schema-teams.sql, room keys are unique per team instead of globally.
  if not exists (select 1 from pg_constraint where conrelid = 'public.office_layouts'::regclass and conname = 'office_layouts_room_key_key') and to_regclass('public.office_layouts_team_room_key_idx') is null then
    alter table public.office_layouts add constraint office_layouts_room_key_key unique (room_key);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.office_layouts'::regclass and conname = 'office_layouts_room_kind_check') then
    alter table public.office_layouts add constraint office_layouts_room_kind_check check (room_kind in ('office', 'outdoor', 'cafe'));
  end if;
end;
$$;
-- 본인 행만 변경할 수 있는 accounts_members_edit_own 정책을 그대로 사용합니다.
grant update (status_message) on public.team_members to authenticated;

create or replace function public.validate_office_layout()
returns trigger language plpgsql set search_path = '' as $$
declare
  item jsonb;
  item_ids text[] := array[]::text[];
  member_ids text[] := array[]::text[];
  member_uuid uuid;
begin
  if jsonb_typeof(new.items) is distinct from 'array' then
    raise exception '가구 배치 형식을 확인해 주세요.' using errcode = '23514';
  end if;
  if jsonb_array_length(new.items) > 100 then
    raise exception '배치도에는 가구를 최대 100개까지 추가할 수 있습니다.' using errcode = '23514';
  end if;
  for item in select value from jsonb_array_elements(new.items) loop
    if jsonb_typeof(item) is distinct from 'object'
      or not (item ?& array['id', 'kind', 'x', 'y', 'rotation', 'label', 'member_id']) then
      raise exception '가구 정보가 올바르지 않습니다.' using errcode = '23514';
    end if;
    if jsonb_typeof(item->'id') is distinct from 'string'
      or char_length(btrim(item->>'id')) not between 1 and 80
      or (item->>'id') = any(item_ids) then
      raise exception '가구 ID가 비어 있거나 중복되었습니다.' using errcode = '23514';
    end if;
    item_ids := array_append(item_ids, item->>'id');
    if jsonb_typeof(item->'kind') is distinct from 'string'
      or (item->>'kind') not in ('desk', 'table', 'plant', 'sofa', 'board')
      or jsonb_typeof(item->'label') is distinct from 'string'
      or char_length(item->>'label') > 40 then
      raise exception '가구 종류 또는 이름을 확인해 주세요.' using errcode = '23514';
    end if;
    if jsonb_typeof(item->'x') is distinct from 'number'
      or jsonb_typeof(item->'y') is distinct from 'number'
      or jsonb_typeof(item->'rotation') is distinct from 'number' then
      raise exception '가구 좌표와 회전 값은 숫자여야 합니다.' using errcode = '23514';
    end if;
    if (item->>'x')::numeric not between 0 and new.canvas_width
      or (item->>'y')::numeric not between 0 and new.canvas_height
      or (item->>'rotation')::numeric not in (0, 90, 180, 270) then
      raise exception '가구 위치 또는 회전 값을 확인해 주세요.' using errcode = '23514';
    end if;
    if item->'member_id' <> 'null'::jsonb then
      if jsonb_typeof(item->'member_id') is distinct from 'string'
        or (item->>'member_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or item->>'kind' <> 'desk' then
        raise exception '등록된 팀원은 책상에만 배정할 수 있습니다.' using errcode = '23514';
      end if;
      member_uuid := (item->>'member_id')::uuid;
      if member_uuid::text = any(member_ids) then
        raise exception '한 팀원은 한 배치도에서 하나의 책상에만 배정할 수 있습니다.' using errcode = '23514';
      end if;
      if not exists (select 1 from public.team_members where id = member_uuid) then
        raise exception '책상에 배정한 팀원을 찾을 수 없습니다.' using errcode = '23503';
      end if;
      member_ids := array_append(member_ids, member_uuid::text);
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function public.validate_office_layout() from public, anon, authenticated;

-- 가장 오래된 기존 사무실을 첫 방으로 사용합니다. 이름/가구/자리 배정은 유지합니다.
-- 고정 room_key 덕분에 재실행해도 방이 늘어나거나 꾸민 방이 덮어써지지 않습니다.
do $$
declare
  room_number integer;
  room_items jsonb;
begin
  if not exists (select 1 from public.office_layouts where room_key = 'office-1') then
    update public.office_layouts set room_key = 'office-1'
      where id = (select id from public.office_layouts where room_key is null and room_kind = 'office' order by created_at, id limit 1);
  end if;
  for room_number in 1..4 loop
    select jsonb_agg(jsonb_build_object(
      'id', 'desk-' || seat, 'kind', 'desk', 'x', 320 + ((seat - 1) % 2) * 530,
      'y', 260 + ((seat - 1) / 2) * 290, 'rotation', 0,
      'label', '책상 ' || seat, 'member_id', null
    ) order by seat) into room_items from generate_series(1, 4) as seats(seat);
    insert into public.office_layouts(name, theme, items, canvas_width, canvas_height, room_key, room_kind)
      values ('사무실 ' || room_number, 'sage', room_items, 1600, 900, 'office-' || room_number, 'office')
      on conflict do nothing;
  end loop;
  insert into public.office_layouts(name, theme, items, canvas_width, canvas_height, room_key, room_kind) values
    ('야외 마당', 'sage', '[{"id":"yard-tree-1","kind":"plant","x":250,"y":780,"rotation":0,"label":"쉼터 나무","member_id":null},{"id":"yard-tree-2","kind":"plant","x":1900,"y":780,"rotation":0,"label":"마당 나무","member_id":null},{"id":"yard-bench","kind":"sofa","x":1120,"y":820,"rotation":0,"label":"벤치","member_id":null}]', 2200, 1100, 'outdoor', 'outdoor'),
    ('카페', 'sand', '[{"id":"cafe-table-1","kind":"table","x":420,"y":330,"rotation":0,"label":"커피 테이블","member_id":null},{"id":"cafe-table-2","kind":"table","x":1100,"y":330,"rotation":0,"label":"커피 테이블","member_id":null},{"id":"cafe-sofa","kind":"sofa","x":420,"y":650,"rotation":0,"label":"쉬어 가는 자리","member_id":null},{"id":"cafe-plant","kind":"plant","x":1370,"y":640,"rotation":0,"label":"카페 식물","member_id":null}]', 1600, 900, 'cafe', 'cafe')
    on conflict do nothing;
end;
$$;

create table if not exists public.team_presence (
  member_id uuid primary key references public.team_members(id) on delete restrict,
  layout_id uuid references public.office_layouts(id) on delete set null,
  x numeric not null default 0,
  y numeric not null default 0,
  facing text not null default 'down' check (facing in ('up', 'down', 'left', 'right')),
  motion text not null default 'standing' check (motion in ('standing', 'seated')),
  updated_at timestamptz not null default clock_timestamp(),
  constraint team_presence_world_bounds check (x between 0 and 2400 and y between 0 and 1200)
);

create or replace function public.validate_team_presence()
returns trigger language plpgsql set search_path = '' as $$
declare
  room public.office_layouts%rowtype;
begin
  if tg_op = 'UPDATE' and new.member_id is distinct from old.member_id then
    raise exception '다른 팀원의 위치로 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if new.layout_id is null then
    new.x := 0;
    new.y := 0;
    new.motion := 'standing';
  else
    -- UPDATE 이미 위치 행을 잠갔을 수 있습니다. 방을 잠근 자리 선택 요청이
    -- 같은 위치 행을 기다릴 때 교착되지 않도록 즉시 충돌을 반환합니다.
    -- 성공한 검증은 SHARE 잠금을 유지하므로 좌석/경계가 동시에 바뀌지 않습니다.
    select * into room from public.office_layouts where id = new.layout_id for share nowait;
    if not found then
      raise exception '이동할 공간을 찾을 수 없습니다.' using errcode = '23503';
    end if;
    if new.x not between 0 and room.canvas_width or new.y not between 0 and room.canvas_height then
      raise exception '공간의 경계 안으로 이동해 주세요.' using errcode = '23514';
    end if;
    if new.motion = 'seated' and not exists (
      select 1 from jsonb_array_elements(room.items) as entry
      where entry->>'kind' = 'desk' and entry->>'member_id' is not null and (entry->>'member_id')::uuid = new.member_id
    ) then
      raise exception '본인이 선택한 책상에만 앉을 수 있습니다.' using errcode = '23514';
    end if;
  end if;
  new.updated_at := case when tg_op = 'UPDATE' then greatest(clock_timestamp(), old.updated_at + interval '1 microsecond') else clock_timestamp() end;
  return new;
end;
$$;
revoke all on function public.validate_team_presence() from public, anon, authenticated;
drop trigger if exists team_presence_validate on public.team_presence;
create trigger team_presence_validate before insert or update on public.team_presence
  for each row execute function public.validate_team_presence();

alter table public.team_presence enable row level security;
revoke all on public.team_presence from public, anon, authenticated;
grant select, insert, update, delete on public.team_presence to authenticated;
grant all on public.team_presence to service_role;
drop policy if exists presence_members_read on public.team_presence;
create policy presence_members_read on public.team_presence for select to authenticated
  using ((select public.has_team_account()));
drop policy if exists presence_members_insert on public.team_presence;
create policy presence_members_insert on public.team_presence for insert to authenticated
  with check (member_id = (select public.current_team_member_id()));
drop policy if exists presence_members_update on public.team_presence;
create policy presence_members_update on public.team_presence for update to authenticated
  using (member_id = (select public.current_team_member_id()))
  with check (member_id = (select public.current_team_member_id()));
drop policy if exists presence_members_delete on public.team_presence;
create policy presence_members_delete on public.team_presence for delete to authenticated
  using (member_id = (select public.current_team_member_id()));

-- 일반 JSON 저장에도 적용합니다. SECURITY DEFINER RPC를 우회하는 REST 요청도 보호합니다.
-- 먼저 기존 구조 검증이 실행되도록 트리거 이름을 office_layouts_validate 뒤로 둡니다.
create or replace function public.protect_office_seat_owners()
returns trigger language plpgsql set search_path = '' as $$
declare
  actor_id uuid := public.current_team_member_id();
  prior_item jsonb;
  next_item jsonb;
  old_items jsonb := '[]'::jsonb;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from jsonb_array_elements(old.items) as entry where entry->>'member_id' is not null) then
      raise exception '자리를 사용 중인 팀원이 있습니다. 모두 자리를 비운 뒤 배치도를 삭제해 주세요.' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception '배치도 ID는 변경할 수 없습니다.' using errcode = '23514';
    end if;
    if new.room_key is distinct from old.room_key and old.room_key is not null then
      raise exception '기본 공간의 연결 키는 변경할 수 없습니다.' using errcode = '23514';
    end if;
    if exists (select 1 from public.team_presence where layout_id = old.id and (x > new.canvas_width or y > new.canvas_height)) then
      raise exception '팀원이 있는 위치까지 공간을 줄일 수 없습니다. 팀원이 이동한 뒤 다시 시도해 주세요.' using errcode = '23514';
    end if;
    old_items := old.items;
    for prior_item in select value from jsonb_array_elements(old_items) loop
      if prior_item->>'member_id' is not null and (prior_item->>'member_id')::uuid is distinct from actor_id then
        select value into next_item from jsonb_array_elements(new.items) where value->>'id' = prior_item->>'id';
        if not found or next_item->>'member_id' is null
          or (next_item->>'member_id')::uuid is distinct from (prior_item->>'member_id')::uuid then
          raise exception '다른 팀원의 자리를 변경하거나 지울 수 없습니다. 최신 배치도를 다시 불러와 주세요.' using errcode = '42501';
        end if;
      end if;
    end loop;
  end if;
  for next_item in select value from jsonb_array_elements(new.items) loop
    if next_item->>'member_id' is not null then
      select value into prior_item from jsonb_array_elements(old_items) where value->>'id' = next_item->>'id';
      if prior_item is null or prior_item->>'member_id' is null
        or (prior_item->>'member_id')::uuid is distinct from (next_item->>'member_id')::uuid then
        if (next_item->>'member_id')::uuid is distinct from actor_id then
          raise exception '자리는 본인만 선택할 수 있습니다.' using errcode = '42501';
        end if;
        if not exists (select 1 from public.team_members where id = actor_id and profile_completed) then
          raise exception '이름과 직책을 설정한 뒤 자리를 선택해 주세요.' using errcode = '42501';
        end if;
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.protect_office_seat_owners() from public, anon, authenticated;
drop trigger if exists office_layouts_verify_seat_owners on public.office_layouts;
create trigger office_layouts_verify_seat_owners before insert or update or delete on public.office_layouts
  for each row execute function public.protect_office_seat_owners();

-- 일반 배치도 저장으로 본인 자리를 비운 경우에도 앉은 상태가 남지 않도록 합니다.
create or replace function public.sync_office_seated_presence()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.team_presence as presence set motion = 'standing'
    where presence.layout_id = new.id and presence.motion = 'seated' and not exists (
      select 1 from jsonb_array_elements(new.items) as entry
      where entry->>'member_id' is not null and (entry->>'member_id')::uuid = presence.member_id
    );
  return new;
end;
$$;
revoke all on function public.sync_office_seated_presence() from public, anon, authenticated;
drop trigger if exists office_layouts_sync_presence on public.office_layouts;
create trigger office_layouts_sync_presence after update of items on public.office_layouts
  for each row execute function public.sync_office_seated_presence();

-- 행 잠금 후 최신 JSON을 변경합니다. 동시에 같은 자리를 고르면 먼저 저장한 팀원만 성공합니다.
create or replace function public.claim_office_seat(p_layout_id uuid, p_item_id text default null)
returns public.office_layouts language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  chosen_layout public.office_layouts%rowtype;
  target_item jsonb;
  changed_items jsonb;
begin
  select id into actor_id from public.team_members
    where user_id = (select auth.uid()) and profile_completed;
  if actor_id is null then
    raise exception '로그인 후 이름과 직책을 설정해 주세요.' using errcode = '42501';
  end if;
  if p_item_id is not null and char_length(btrim(p_item_id)) not between 1 and 80 then
    raise exception '선택할 책상을 확인해 주세요.' using errcode = '22023';
  end if;
  select * into chosen_layout from public.office_layouts where id = p_layout_id for update;
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

notify pgrst, 'reload schema';
commit;

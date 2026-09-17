-- 팀원, 출퇴근, 꾸미는 사무실, 일정 작성자.
-- schema-department-events.sql 실행 후 Supabase SQL Editor에서 전체 실행합니다.
-- 기존 데이터는 유지되며 재실행할 수 있습니다. 앱과 동일한 공유 접근 모드입니다.
begin;

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  role text not null default '' check (char_length(role) <= 60),
  avatar text not null default '🧑‍💻' check (char_length(btrim(avatar)) between 1 and 16),
  color text not null default '#547867' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.team_attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members(id) on delete restrict,
  work_date date not null default (now() at time zone 'Asia/Seoul')::date,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  constraint team_attendance_member_date_key unique (member_id, work_date),
  constraint team_attendance_time_order check (checked_out_at is null or checked_out_at >= checked_in_at),
  constraint team_attendance_korean_date check (work_date = (checked_in_at at time zone 'Asia/Seoul')::date)
);
create index if not exists team_attendance_work_date_idx on public.team_attendance(work_date);

-- 출퇴근 시각과 한국 날짜는 DB에서 확정합니다. 한 번 퇴근한 시각은 덮어쓰지 않습니다.
create or replace function public.validate_team_attendance()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.checked_out_at is not null then
      raise exception '출근 등록과 퇴근 등록은 순서대로 해 주세요.' using errcode = '23514';
    end if;
    new.checked_in_at := clock_timestamp();
    new.work_date := (new.checked_in_at at time zone 'Asia/Seoul')::date;
  else
    if new.id is distinct from old.id or new.member_id is distinct from old.member_id
      or new.work_date is distinct from old.work_date
      or new.checked_in_at is distinct from old.checked_in_at then
      raise exception '이미 등록한 출근 기록은 변경할 수 없습니다.' using errcode = '23514';
    end if;
    if old.checked_out_at is not null and new.checked_out_at is distinct from old.checked_out_at then
      raise exception '이미 등록한 퇴근 기록은 변경할 수 없습니다.' using errcode = '23514';
    end if;
    if old.checked_out_at is null and new.checked_out_at is not null then
      new.checked_out_at := greatest(clock_timestamp(), old.checked_in_at);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists team_attendance_validate on public.team_attendance;
create trigger team_attendance_validate before insert or update on public.team_attendance
  for each row execute function public.validate_team_attendance();

create table if not exists public.office_layouts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  theme text not null default 'sage' check (theme in ('sage', 'sand', 'sky')),
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 가구는 1000×560 논리 좌표를 사용합니다. 같은 팀원을 한 배치도의 여러 책상에 앉힐 수 없습니다.
create or replace function public.validate_office_layout()
returns trigger language plpgsql set search_path = public as $$
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
    if (item->>'x')::numeric not between 0 and 1000
      or (item->>'y')::numeric not between 0 and 560
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
drop trigger if exists office_layouts_validate on public.office_layouts;
create trigger office_layouts_validate before insert or update on public.office_layouts
  for each row execute function public.validate_office_layout();

alter table public.team_members enable row level security;
alter table public.team_attendance enable row level security;
alter table public.office_layouts enable row level security;
grant select, insert on public.team_members to anon, authenticated;
grant select, insert, update on public.team_attendance to anon, authenticated;
grant select, insert, update, delete on public.office_layouts to anon, authenticated;
grant all on public.team_members, public.team_attendance, public.office_layouts to service_role;

drop policy if exists team_members_read on public.team_members;
create policy team_members_read on public.team_members
  for select to anon, authenticated using (true);
drop policy if exists team_members_create on public.team_members;
create policy team_members_create on public.team_members
  for insert to anon, authenticated with check (true);
drop policy if exists team_attendance_read on public.team_attendance;
create policy team_attendance_read on public.team_attendance
  for select to anon, authenticated using (true);
drop policy if exists team_attendance_create on public.team_attendance;
create policy team_attendance_create on public.team_attendance
  for insert to anon, authenticated with check (true);
drop policy if exists team_attendance_edit on public.team_attendance;
create policy team_attendance_edit on public.team_attendance
  for update to anon, authenticated using (true) with check (true);
drop policy if exists office_layouts_open on public.office_layouts;
create policy office_layouts_open on public.office_layouts
  for all to anon, authenticated using (true) with check (true);

alter table public.department_events drop constraint if exists department_events_category_check;
alter table public.department_events add constraint department_events_category_check
  check (category in ('work', 'meeting', 'dinner', 'leave', 'visit', 'other'));
alter table public.department_events add column if not exists created_by uuid;
alter table public.department_events add column if not exists creator_name text;
alter table public.department_events add column if not exists creator_color text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'department_events_created_by_fkey'
    and conrelid = 'public.department_events'::regclass) then
    alter table public.department_events add constraint department_events_created_by_fkey
      foreign key (created_by) references public.team_members(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'department_events_creator_snapshot_check'
    and conrelid = 'public.department_events'::regclass) then
    alter table public.department_events add constraint department_events_creator_snapshot_check check (
      (created_by is null and creator_name is null and creator_color is null)
      or (created_by is not null and creator_name is not null and creator_color is not null
        and char_length(btrim(creator_name)) between 1 and 40 and creator_color ~ '^#[0-9A-Fa-f]{6}$')
    );
  end if;
end;
$$;
create index if not exists department_events_created_by_idx
  on public.department_events(created_by) where deleted_at is null;

-- 최초 작성자를 보존합니다. 예전 일정의 빈 작성자도 편집한 사람으로 바뀌지 않습니다.
-- 공유 모드의 팀원 선택은 본인 식별을 위한 표시이며 인증 계정과 연동되지 않습니다.
create or replace function public.preserve_department_event_creator()
returns trigger language plpgsql set search_path = public as $$
declare
  member public.team_members%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by
      or new.creator_name is distinct from old.creator_name
      or new.creator_color is distinct from old.creator_color then
      raise exception '일정의 최초 작성자는 변경할 수 없습니다.' using errcode = '23514';
    end if;
  elsif new.created_by is not null then
    select * into member from public.team_members where id = new.created_by;
    if not found then
      raise exception '일정 작성 팀원을 찾을 수 없습니다.' using errcode = '23503';
    end if;
    new.creator_name := member.name;
    new.creator_color := member.color;
  elsif new.creator_name is not null or new.creator_color is not null then
    raise exception '일정 작성 팀원을 먼저 선택해 주세요.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists department_events_preserve_creator on public.department_events;
create trigger department_events_preserve_creator before insert or update on public.department_events
  for each row execute function public.preserve_department_event_creator();

notify pgrst, 'reload schema';
commit;

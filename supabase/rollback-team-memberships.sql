-- 되돌리기: 여러 팀 소속(schema-team-memberships.sql)을 "한 사람 한 팀" 규칙으로 되돌립니다.
-- 사장 승인 뒤 Supabase SQL Editor에서 전체 실행. 하나의 트랜잭션이며 오류가 나면 전부 취소됩니다.
-- 각자 지금 보던 팀(team_members.team_id)이 그대로 그 사람의 팀이 됩니다. 과업·일정 등 팀 자료는 지우지 않습니다.
-- 두 번째 이후 소속은 화면에서 사라집니다. 소속 표는 지우지 않고 team_memberships_rolled_back 으로 이름만 바꿔 보관합니다.
-- (다시 설치하면 team_members.team_id 에서 새로 만들어집니다. 되돌린 동안 나간 팀이 되살아나지 않게 하려는 것입니다.)
begin;

do $$
begin
  if to_regclass('public.team_memberships') is null then
    raise exception '여러 팀 소속이 설치되어 있지 않습니다. 되돌릴 것이 없습니다.' using errcode = 'P0001';
  end if;
  if to_regclass('public.team_memberships_rolled_back') is not null then
    raise exception '이전에 되돌린 보관 표(team_memberships_rolled_back)가 있습니다. 확인 후 이름을 바꾸고 다시 실행해 주세요.' using errcode = 'P0001';
  end if;
  -- 출퇴근 고유키(사람·날짜)를 되살리려면 같은 날 두 팀 기록이 없어야 합니다.
  if exists (select 1 from public.team_attendance group by member_id, work_date having count(*) > 1) then
    raise exception '같은 날 두 팀에 출근한 기록이 있어 출퇴근 규칙을 되돌릴 수 없습니다. 해당 기록을 먼저 확인해 주세요.' using errcode = 'P0001';
  end if;
end;
$$;

-- 1) 지금 보는 팀 제약 제거 (team_id 값은 그대로 = 각자의 팀)
alter table public.team_members drop constraint if exists team_members_active_team_fkey;

-- 2) 새 RPC·도우미 제거
drop function if exists public.switch_team(uuid);
drop function if exists public.move_to_team(uuid, uuid);
drop function if exists public.check_team_limit(uuid);

-- 3) 출퇴근: 사람·날짜당 1줄로 복원
alter table public.team_attendance drop constraint if exists team_attendance_member_team_date_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_attendance_member_date_key') then
    alter table public.team_attendance add constraint team_attendance_member_date_key unique (member_id, work_date);
  end if;
end;
$$;

-- 4) 옛 함수·정책·RPC 복원 (schema-teams.sql 본문 그대로 복사)
create or replace function public.current_team_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select member.team_id from public.team_members as member
  where member.user_id = (select auth.uid());
$$;
revoke all on function public.current_team_id() from public, anon, authenticated;
grant execute on function public.current_team_id() to authenticated, service_role;

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

drop policy if exists accounts_members_read on public.team_members;
create policy accounts_members_read on public.team_members for select to authenticated
  using (user_id = (select auth.uid()) or (team_id is not null and team_id = (select public.current_team_id())));

drop policy if exists presence_members_read on public.team_presence;
create policy presence_members_read on public.team_presence for select to authenticated
  using (public.is_team_mate(member_id));

drop policy if exists teams_read_own on public.teams;
create policy teams_read_own on public.teams for select to authenticated
  using (id = (select public.current_team_id()));

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

-- 5) 소속 표 보관: 정책·도우미 제거 후 이름 변경
drop policy if exists memberships_read on public.team_memberships;
drop function if exists public.my_team_ids();
alter table public.team_memberships rename to team_memberships_rolled_back;
alter index if exists public.team_memberships_pkey rename to team_memberships_rolled_back_pkey;
alter index if exists public.team_memberships_team_idx rename to team_memberships_rolled_back_team_idx;
revoke all on table public.team_memberships_rolled_back from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;

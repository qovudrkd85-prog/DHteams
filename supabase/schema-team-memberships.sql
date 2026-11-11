-- 한 사람이 여러 팀에 소속: 소속은 team_memberships(여러 줄), team_members.team_id 는 "지금 보는 팀".
-- schema-teams.sql 다음, 맨 마지막에 Supabase SQL Editor에서 전체 실행하세요. 재실행 가능합니다.
-- 옛 앱과 호환됩니다(RPC 이름·인자 유지, team_members.team_id 유지). 되돌리기: rollback-team-memberships.sql.
-- 필요: PostgreSQL 15 이상(외래키 ON DELETE SET NULL (칸) 문법).
begin;

do $$
begin
  if to_regclass('public.teams') is null then
    raise exception '팀 공간(schema-teams.sql)을 먼저 설치해 주세요.' using errcode = 'P0001';
  end if;
end;
$$;

-- 소속: 사람 × 팀. 역할은 팀마다 다릅니다(owner = 팀장).
create table if not exists public.team_memberships (
  member_id uuid not null references public.team_members(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default clock_timestamp(),
  primary key (member_id, team_id)
);
create index if not exists team_memberships_team_idx on public.team_memberships (team_id, joined_at);

-- 기존 소속 이전(재실행 안전). 팀을 만든 사람만 owner 입니다.
insert into public.team_memberships (member_id, team_id, role)
select member.id, member.team_id, case when team.created_by = member.id then 'owner' else 'member' end
from public.team_members as member
join public.teams as team on team.id = member.team_id
where member.team_id is not null
on conflict do nothing;

-- 핵심 불변식: 지금 보는 팀은 반드시 내 소속. 소속 줄이 지워지면 지금 보는 팀만 비웁니다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_members_active_team_fkey') then
    alter table public.team_members add constraint team_members_active_team_fkey
      foreign key (id, team_id) references public.team_memberships (member_id, team_id)
      on delete set null (team_id);
  end if;
end;
$$;

alter table public.team_memberships enable row level security;
revoke all on table public.team_memberships from public, anon, authenticated;
grant select on table public.team_memberships to authenticated;
grant all on table public.team_memberships to service_role;

-- 지금 보는 팀: 소속일 때만 값을 돌려줍니다.
create or replace function public.current_team_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select member.team_id from public.team_members as member
  where member.user_id = (select auth.uid())
    and exists (
      select 1 from public.team_memberships as membership
      where membership.member_id = member.id and membership.team_id = member.team_id
    );
$$;
revoke all on function public.current_team_id() from public, anon, authenticated;
grant execute on function public.current_team_id() to authenticated, service_role;

-- 내 소속 팀 전부(정책 안에서 재귀 없이 사용).
create or replace function public.my_team_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select membership.team_id from public.team_memberships as membership
  join public.team_members as member on member.id = membership.member_id
  where member.user_id = (select auth.uid());
$$;
revoke all on function public.my_team_ids() from public, anon, authenticated;
grant execute on function public.my_team_ids() to authenticated, service_role;

-- 상대가 내가 지금 보는 팀의 소속인가(상대가 지금 어느 팀을 보는지와 무관).
create or replace function public.is_team_mate(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_memberships as membership
    where membership.member_id = p_member and membership.team_id = public.current_team_id()
  );
$$;
revoke all on function public.is_team_mate(uuid) from public, anon, authenticated;
grant execute on function public.is_team_mate(uuid) to authenticated, service_role;

drop policy if exists accounts_members_read on public.team_members;
create policy accounts_members_read on public.team_members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_team_mate(id)));

drop policy if exists teams_read_own on public.teams;
create policy teams_read_own on public.teams for select to authenticated
  using (id in (select public.my_team_ids()));

drop policy if exists memberships_read on public.team_memberships;
create policy memberships_read on public.team_memberships for select to authenticated
  using (member_id = (select public.current_team_member_id())
    or team_id = (select public.current_team_id()));

-- 다른 팀 방에 있는 동료의 위치는 보이지 않습니다.
drop policy if exists presence_members_read on public.team_presence;
create policy presence_members_read on public.team_presence for select to authenticated
  using (public.is_team_mate(member_id)
    and (layout_id is null or public.layout_in_my_team(layout_id)));

-- RPC 공통: 소속 추가 후 그 팀으로 이동. 옮기기 전 내 위치(캐릭터)는 지웁니다. 책상은 팀마다 남습니다.
create or replace function public.move_to_team(p_member uuid, p_team uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.team_members where id = p_member and team_id is not distinct from p_team) then
    return;
  end if;
  delete from public.team_presence where member_id = p_member;
  update public.team_members set team_id = p_team where id = p_member;
end;
$$;
revoke all on function public.move_to_team(uuid, uuid) from public, anon, authenticated;

create or replace function public.check_team_limit(p_member uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select count(*) from public.team_memberships where member_id = p_member) >= 20 then
    raise exception '팀은 최대 20개까지 소속될 수 있습니다. 쓰지 않는 팀을 나간 뒤 다시 시도해 주세요.' using errcode = '23514';
  end if;
end;
$$;
revoke all on function public.check_team_limit(uuid) from public, anon, authenticated;

create or replace function public.create_team(p_name text)
returns public.teams language plpgsql security definer set search_path = '' as $$
declare
  actor public.team_members%rowtype := public.lock_team_actor();
  created public.teams%rowtype;
  attempt integer;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception '팀 이름은 1~40자로 입력해 주세요.' using errcode = '22023';
  end if;
  perform public.check_team_limit(actor.id);
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
  insert into public.team_memberships(member_id, team_id, role) values (actor.id, created.id, 'owner');
  perform public.move_to_team(actor.id, created.id);
  perform public.seed_team_rooms(created.id);
  return created;
end;
$$;
revoke all on function public.create_team(text) from public, anon, authenticated;
grant execute on function public.create_team(text) to authenticated;

-- 빈 팀(모두 나간 팀)에 처음 들어오는 사람이 팀장이 됩니다.
create or replace function public.join_team(p_code text)
returns public.teams language plpgsql security definer set search_path = '' as $$
declare
  actor public.team_members%rowtype := public.lock_team_actor();
  target public.teams%rowtype;
  normalized text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
begin
  if normalized !~ '^[A-HJKMNP-Z2-9]{8}$' then
    raise exception '초대코드 8자리를 확인해 주세요.' using errcode = '22023';
  end if;
  select * into target from public.teams where invite_code = normalized for update;
  if not found then
    raise exception '초대코드에 맞는 팀이 없습니다.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.team_memberships where member_id = actor.id and team_id = target.id) then
    raise exception '이미 이 팀 소속입니다.' using errcode = '23514';
  end if;
  perform public.check_team_limit(actor.id);
  insert into public.team_memberships(member_id, team_id, role)
    values (actor.id, target.id, case when exists (
      select 1 from public.team_memberships where team_id = target.id
    ) then 'member' else 'owner' end);
  perform public.move_to_team(actor.id, target.id);
  return target;
end;
$$;
revoke all on function public.join_team(text) from public, anon, authenticated;
grant execute on function public.join_team(text) to authenticated;

-- 지금 보는 팀 바꾸기: 내 소속 팀만 가능합니다.
create or replace function public.switch_team(p_team uuid)
returns public.teams language plpgsql security definer set search_path = '' as $$
declare
  actor public.team_members%rowtype := public.lock_team_actor();
  target public.teams%rowtype;
begin
  if p_team is null or not exists (
    select 1 from public.team_memberships where member_id = actor.id and team_id = p_team
  ) then
    raise exception '소속된 팀으로만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  select * into target from public.teams where id = p_team;
  perform public.move_to_team(actor.id, p_team);
  return target;
end;
$$;
revoke all on function public.switch_team(uuid) from public, anon, authenticated;
grant execute on function public.switch_team(uuid) to authenticated;

-- 지금 보는 팀에서 나갑니다. 그 팀 자리·내 위치를 비우고, 남은 소속 중 가장 최근에 들어간 팀으로 이동합니다.
-- 팀장이 나가면 가장 오래된 팀원이 팀장이 됩니다. 혼자였으면 팀과 자료는 남습니다.
create or replace function public.leave_team()
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor public.team_members%rowtype := public.lock_team_actor();
  leaving uuid := actor.team_id;
  layout record;
  successor uuid;
begin
  if leaving is null then
    raise exception '소속된 팀이 없습니다.' using errcode = 'P0002';
  end if;
  perform 1 from public.teams where id = leaving for update;
  for layout in
    select id, items from public.office_layouts
    where team_id = leaving
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
  if exists (select 1 from public.team_memberships where member_id = actor.id and team_id = leaving and role = 'owner')
    and not exists (select 1 from public.team_memberships where team_id = leaving and role = 'owner' and member_id <> actor.id) then
    select member_id into successor from public.team_memberships
      where team_id = leaving and member_id <> actor.id
      order by joined_at, member_id limit 1;
    if successor is not null then
      update public.team_memberships set role = 'owner' where member_id = successor and team_id = leaving;
    end if;
  end if;
  -- The active-team foreign key clears team_members.team_id when this row goes.
  delete from public.team_memberships where member_id = actor.id and team_id = leaving;
  update public.team_members set team_id = (
    select team_id from public.team_memberships where member_id = actor.id
    order by joined_at desc, team_id limit 1
  ) where id = actor.id;
end;
$$;
revoke all on function public.leave_team() from public, anon, authenticated;
grant execute on function public.leave_team() to authenticated;

-- 초대코드는 지금 보는 팀의 팀장만 바꿉니다. 팀장이 아무도 없으면 남은 팀원 누구나 바꿀 수 있습니다.
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
  if not exists (
    select 1 from public.team_memberships where member_id = actor.id and team_id = target.id and role = 'owner'
  ) and exists (
    select 1 from public.team_memberships where team_id = target.id and role = 'owner'
  ) then
    raise exception '초대코드는 팀장만 바꿀 수 있습니다.' using errcode = '42501';
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

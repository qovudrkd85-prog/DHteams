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

notify pgrst, 'reload schema';
commit;

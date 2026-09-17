-- 아이디/비밀번호 계정, 본인 프로필, 로그인한 팀원 전용 공유 공간.
-- 기존 설치 SQL과 schema-team-workspace.sql 다음에 실행하고, schema-office-presence.sql을 마지막으로 적용하세요.
-- 기존 이름만 있는 팀원/일정은 보존합니다. 이름이 같아도 새 계정에 자동 연결하지 않습니다.
-- 재실행 가능하며 비밀번호는 Supabase Auth에서만 관리합니다.
begin;

alter table public.team_members add column if not exists user_id uuid;
alter table public.team_members add column if not exists username text;
alter table public.team_members add column if not exists profile_completed boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.team_members'::regclass and conname = 'team_members_user_id_fkey') then
    alter table public.team_members add constraint team_members_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.team_members'::regclass and conname = 'team_members_user_id_key') then
    alter table public.team_members add constraint team_members_user_id_key unique (user_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.team_members'::regclass and conname = 'team_members_username_key') then
    alter table public.team_members add constraint team_members_username_key unique (username);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.team_members'::regclass and conname = 'team_members_account_identity_check') then
    alter table public.team_members add constraint team_members_account_identity_check check (
      (user_id is null and username is null)
      or (user_id is not null and username is not null and username ~ '^[a-z0-9][a-z0-9_]{2,23}$')
    );
  end if;
end;
$$;

-- auth.uid()만 사용합니다. 사용자 수정이 가능한 metadata로 소유권을 판단하지 않습니다.
-- SECURITY DEFINER로 team_members SELECT 정책이 자신을 반복 조회하는 문제를 막습니다.
create or replace function public.current_team_member_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select member.id from public.team_members as member
  where member.user_id = (select auth.uid());
$$;
revoke all on function public.current_team_member_id() from public, anon, authenticated;
grant execute on function public.current_team_member_id() to authenticated, service_role;

create or replace function public.has_team_account()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members as member
    where member.user_id = (select auth.uid())
  );
$$;
revoke all on function public.has_team_account() from public, anon, authenticated;
grant execute on function public.has_team_account() to authenticated, service_role;

-- 회원가입 트랜잭션 안에서 프로필을 만들기 때문에 계정만 생기는 중간 상태가 없습니다.
-- 이 앱의 내부 이메일 도메인이 아닌 기존/별도 Auth 계정은 그대로 둡니다.
create or replace function public.handle_team_account_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  account_username text;
begin
  if lower(coalesce(new.email, '')) not like '%@members.dhteams.invalid' then
    return new;
  end if;
  account_username := new.raw_user_meta_data ->> 'username';
  if account_username is null
    or jsonb_typeof(new.raw_user_meta_data -> 'username') is distinct from 'string'
    or account_username !~ '^[a-z0-9][a-z0-9_]{2,23}$'
    or new.email is distinct from account_username || '@members.dhteams.invalid' then
    raise exception '회원가입 아이디를 확인해 주세요.' using errcode = '23514';
  end if;
  insert into public.team_members (user_id, username, name, role, profile_completed)
  values (new.id, account_username, account_username, '', false);
  return new;
end;
$$;
revoke all on function public.handle_team_account_signup() from public, anon, authenticated;
drop trigger if exists on_team_account_created on auth.users;
create trigger on_team_account_created after insert on auth.users
  for each row execute function public.handle_team_account_signup();

create or replace function public.protect_team_account_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
    or new.username is distinct from old.username or new.created_at is distinct from old.created_at then
    raise exception '계정 연결과 아이디는 프로필 설정에서 변경할 수 없습니다.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_team_account_identity() from public, anon, authenticated;
drop trigger if exists team_members_protect_account on public.team_members;
create trigger team_members_protect_account before update on public.team_members
  for each row execute function public.protect_team_account_identity();

-- 공개 모드의 정책은 이름에 관계없이 이 앱 소유 테이블에서 모두 교체합니다.
-- 테이블 권한과 컬럼 권한은 별개이므로 기존 컬럼 권한도 정리합니다.
do $$
declare
  target_table text;
  old_policy record;
  target_column record;
begin
  foreach target_table in array array[
    'projects', 'nodes', 'file_logs', 'schedules', 'project_memos',
    'office_layouts', 'department_events', 'team_members', 'team_attendance', 'project_members'
  ] loop
    execute format('alter table public.%I enable row level security', target_table);
    for old_policy in select policyname from pg_policies where schemaname = 'public' and tablename = target_table loop
      execute format('drop policy %I on public.%I', old_policy.policyname, target_table);
    end loop;
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', target_table);
    for target_column in
      select attname from pg_attribute
      where attrelid = format('public.%I', target_table)::regclass and attnum > 0 and not attisdropped
    loop
      execute format('revoke all privileges (%I) on table public.%I from public, anon, authenticated', target_column.attname, target_table);
    end loop;
    execute format('grant all privileges on table public.%I to service_role', target_table);
  end loop;
end;
$$;

-- 기존 공유 과업은 owner_id가 비어 있어도 계속 함께 편집합니다.
do $$
declare target_table text;
begin
  foreach target_table in array array['projects', 'nodes', 'file_logs', 'schedules', 'project_memos', 'office_layouts'] loop
    execute format('grant select, insert, update, delete on table public.%I to authenticated', target_table);
    execute format(
      'create policy accounts_team_shared on public.%I for all to authenticated using ((select public.has_team_account())) with check ((select public.has_team_account()))',
      target_table
    );
  end loop;
end;
$$;

grant select on table public.team_members to authenticated;
grant update (name, role, avatar, color, profile_completed) on table public.team_members to authenticated;
create policy accounts_members_read on public.team_members
  for select to authenticated using ((select public.has_team_account()));
create policy accounts_members_edit_own on public.team_members
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- 직접 INSERT/DELETE 정책이 없습니다. 가입 트리거만 새 프로필을 만듭니다.

grant select on table public.team_attendance to authenticated;
grant insert (member_id) on table public.team_attendance to authenticated;
grant update (checked_out_at) on table public.team_attendance to authenticated;
create policy accounts_attendance_read on public.team_attendance
  for select to authenticated using ((select public.has_team_account()));
create policy accounts_attendance_check_in on public.team_attendance
  for insert to authenticated with check (member_id = (select public.current_team_member_id()));
create policy accounts_attendance_check_out on public.team_attendance
  for update to authenticated using (member_id = (select public.current_team_member_id()))
  with check (member_id = (select public.current_team_member_id()));

grant select, insert, update on table public.department_events to authenticated;
create policy accounts_events_read on public.department_events
  for select to authenticated using ((select public.has_team_account()));
create policy accounts_events_create on public.department_events
  for insert to authenticated with check (created_by = (select public.current_team_member_id()));
create policy accounts_events_edit on public.department_events
  for update to authenticated using ((select public.has_team_account()))
  with check ((select public.has_team_account()));
-- 공유 일정 수정/휴지통 복구는 유지하고 최초 작성자는 기존 보존 트리거로 고정합니다.

-- 예전 이메일 초대 모델은 현재 공유 공간에서 사용하지 않습니다.
-- 기존 내역 조회만 유지하고 사용하지 않는 SECURITY DEFINER RPC 접근을 닫습니다.
grant select on table public.project_members to authenticated;
create policy accounts_legacy_members_read on public.project_members
  for select to authenticated using (user_id = (select auth.uid()) and (select public.has_team_account()));
-- 설치 이력에 따라 예전 초대 함수가 없을 수 있으므로 존재하는 함수만 닫습니다.
do $$
declare function_signature text;
begin
  foreach function_signature in array array[
    'public.add_project_member(uuid, text, text)',
    'public.is_project_member(uuid)',
    'public.can_edit_project(uuid)',
    'public.handle_new_project()',
    'public.validate_team_attendance()',
    'public.validate_office_layout()',
    'public.preserve_department_event_creator()',
    'public.touch_department_event()'
  ] loop
    if to_regprocedure(function_signature) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', function_signature);
    end if;
  end loop;
end;
$$;

-- 회원가입 전에 서버가 준비 여부만 확인합니다. 팀/업무 데이터는 공개하지 않습니다.
create or replace function public.account_registration_ready()
returns boolean language sql stable security invoker set search_path = '' as $$ select true; $$;
revoke all on function public.account_registration_ready() from public, anon, authenticated;
grant execute on function public.account_registration_ready() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;

-- =====================================================================
-- 로그인 없이 사용하는 공개 모드로 전환
-- schema.sql 을 이미 Run 한 뒤에, 이 파일을 SQL Editor 에 붙여넣고 Run 하세요.
--
-- 주의: 이 설정은 URL 과 publishable key 를 아는 사람 누구나
--       모든 과업·폴더·파일·이력을 읽고 쓰고 지울 수 있게 만듭니다.
--       사내망 전용으로 쓰거나, 공개 배포 시에는 별도 보호 수단을 두세요.
-- =====================================================================

-- 1) 로그인 사용자를 전제로 하던 것 해제
drop trigger if exists on_project_created on public.projects;

alter table public.projects alter column owner_id drop not null;

-- 2) 기존 정책 제거
drop policy if exists projects_select   on public.projects;
drop policy if exists projects_insert   on public.projects;
drop policy if exists projects_update   on public.projects;
drop policy if exists projects_delete   on public.projects;
drop policy if exists projects_open     on public.projects;

drop policy if exists nodes_select      on public.nodes;
drop policy if exists nodes_write       on public.nodes;
drop policy if exists nodes_open        on public.nodes;

drop policy if exists logs_select       on public.file_logs;
drop policy if exists logs_write        on public.file_logs;
drop policy if exists logs_open         on public.file_logs;

-- 3) 공개 정책 (익명 접속 허용)
create policy projects_open on public.projects
  for all to anon, authenticated
  using (true) with check (true);

create policy nodes_open on public.nodes
  for all to anon, authenticated
  using (true) with check (true);

create policy file_logs_open on public.file_logs
  for all to anon, authenticated
  using (true) with check (true);

-- project_members 는 로그인 모드 전용이라 그대로 잠가 둡니다(정책 없음 = 접근 불가).

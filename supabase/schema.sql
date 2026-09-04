-- Teams: 과업 / 폴더 / 파일 / 이력 스키마
-- Supabase SQL Editor에 이 파일 전체를 붙여넣고 Run 하세요.

-- =====================================================================
-- 1. Tables
-- =====================================================================

-- 과업 (최상위 단위)
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  code        text check (code is null or char_length(code) <= 100),
  description text check (description is null or char_length(description) <= 2000),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- 과업 참여자
create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  email      text,
  role       text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- 폴더 / 파일 트리 (parent_id 자기참조)
create table if not exists public.nodes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_id  uuid references public.nodes (id) on delete cascade,
  kind       text not null check (kind in ('folder', 'file')),
  name       text not null check (char_length(name) between 1 and 200),
  note       text check (note is null or char_length(note) <= 2000),
  sort_order integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists nodes_project_idx on public.nodes (project_id);
create index if not exists nodes_parent_idx on public.nodes (parent_id);

-- 파일 이력: 누가 / 언제 / 무엇을 받았고 / 어떻게 수정했는지
create table if not exists public.file_logs (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references public.nodes (id) on delete cascade,
  action      text not null default '받음' check (action in ('받음', '수정', '보냄', '확인')),
  actor       text not null default '' check (char_length(actor) <= 100),   -- 누가
  counterpart text check (counterpart is null or char_length(counterpart) <= 100), -- 상대
  occurred_on date not null default current_date, -- 언제
  subject     text check (subject is null or char_length(subject) <= 300),  -- 무엇을
  detail      text check (detail is null or char_length(detail) <= 4000),   -- 어떻게 수정했는지
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists file_logs_node_idx on public.file_logs (node_id);

-- =====================================================================
-- 2. Helper (security definer로 RLS 재귀 방지)
-- =====================================================================

create or replace function public.is_project_member(p_project uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members m
    where m.project_id = p_project
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_project(p_project uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members m
    where m.project_id = p_project
      and m.user_id = auth.uid()
      and m.role in ('owner', 'editor')
  );
$$;

-- 과업 생성자를 자동으로 owner 멤버로 등록
create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, email, role)
  values (new.id, new.owner_id, (select email from auth.users where id = new.owner_id), 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

-- =====================================================================
-- 3. RLS
-- =====================================================================

alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.nodes           enable row level security;
alter table public.file_logs       enable row level security;

-- projects
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (owner_id = auth.uid() or public.is_project_member(id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert with check (owner_id = auth.uid());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (owner_id = auth.uid());

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete using (owner_id = auth.uid());

-- project_members
drop policy if exists members_select on public.project_members;
create policy members_select on public.project_members
  for select using (user_id = auth.uid() or public.is_project_member(project_id));

drop policy if exists members_write on public.project_members;
create policy members_write on public.project_members
  for all
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

-- nodes
drop policy if exists nodes_select on public.nodes;
create policy nodes_select on public.nodes
  for select using (public.is_project_member(project_id));

drop policy if exists nodes_write on public.nodes;
create policy nodes_write on public.nodes
  for all
  using (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

-- file_logs
drop policy if exists logs_select on public.file_logs;
create policy logs_select on public.file_logs
  for select using (
    exists (select 1 from public.nodes n where n.id = node_id and public.is_project_member(n.project_id))
  );

drop policy if exists logs_write on public.file_logs;
create policy logs_write on public.file_logs
  for all
  using (exists (select 1 from public.nodes n where n.id = node_id and public.can_edit_project(n.project_id)))
  with check (exists (select 1 from public.nodes n where n.id = node_id and public.can_edit_project(n.project_id)));

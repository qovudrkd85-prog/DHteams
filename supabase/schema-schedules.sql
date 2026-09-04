-- =====================================================================
-- 00_업무일정 (과업별 달력 + 포스트잇 일정)
-- Supabase SQL Editor 에 붙여넣고 Run 하세요. 여러 번 돌려도 안전합니다.
-- =====================================================================

create table if not exists public.schedules (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 200),
  due_date   date not null,
  assignee   text check (assignee is null or char_length(assignee) <= 100),
  note       text check (note is null or char_length(note) <= 1000),
  color      text not null default 'yellow' check (color in ('yellow', 'pink', 'blue', 'green')),
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists schedules_project_idx on public.schedules (project_id);
create index if not exists schedules_due_idx     on public.schedules (project_id, due_date);

alter table public.schedules enable row level security;

-- 로그인 없는 공개 모드 정책 (schema-open-mode.sql 과 동일 기조)
drop policy if exists schedules_open on public.schedules;
create policy schedules_open on public.schedules
  for all to anon, authenticated
  using (true) with check (true);

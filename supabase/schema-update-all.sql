-- =====================================================================
-- 한 번에 실행하는 최신 업데이트 (DIDAS 칸 + 업무일정 + 고정메모)
-- Supabase SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요.
-- 여러 번 돌려도 안전합니다.
-- =====================================================================

-- DIDAS 업로드 여부 체크 칸 추가
-- Supabase SQL Editor 에 붙여넣고 Run 하세요. (이미 있으면 아무 일도 안 함)

alter table public.file_logs
  add column if not exists didas_uploaded boolean not null default false;

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

-- =====================================================================
-- 00_업무일정 - 달력 아래 고정 메모 (과업 x 월 단위)
-- Supabase SQL Editor 에 붙여넣고 Run 하세요. 여러 번 돌려도 안전합니다.
-- =====================================================================

create table if not exists public.project_memos (
  project_id uuid not null references public.projects (id) on delete cascade,
  month      text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),  -- 'YYYY-MM'
  content    text not null default '' check (char_length(content) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (project_id, month)
);

alter table public.project_memos enable row level security;

drop policy if exists project_memos_open on public.project_memos;
create policy project_memos_open on public.project_memos
  for all to anon, authenticated
  using (true) with check (true);

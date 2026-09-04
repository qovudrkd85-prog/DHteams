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

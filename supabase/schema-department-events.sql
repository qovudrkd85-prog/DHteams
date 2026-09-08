-- 부서 공유 일정: 기존 과업/일정 데이터는 변경하지 않습니다.
-- Supabase SQL Editor에서 전체 실행하세요. 재실행 가능합니다.
-- 현재 앱의 공유 모드(schedules_open)와 동일한 접근 정책입니다.
begin;

create table if not exists public.department_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  category text not null default 'meeting'
    check (category in ('meeting', 'dinner', 'leave', 'visit', 'other')),
  starts_on date not null,
  ends_on date not null,
  starts_at time,
  location text check (char_length(location) <= 200),
  organizer text check (char_length(organizer) <= 100),
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_on >= starts_on)
);

create index if not exists department_events_dates_idx
  on public.department_events (starts_on, ends_on) where deleted_at is null;

create or replace function public.touch_department_event()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
drop trigger if exists department_events_updated on public.department_events;
create trigger department_events_updated before update on public.department_events
  for each row execute function public.touch_department_event();

alter table public.department_events enable row level security;
grant select, insert, update on public.department_events to anon, authenticated;
grant all on public.department_events to service_role;
drop policy if exists department_events_read on public.department_events;
create policy department_events_read on public.department_events
  for select to anon, authenticated using (true);
drop policy if exists department_events_create on public.department_events;
create policy department_events_create on public.department_events
  for insert to anon, authenticated with check (true);
drop policy if exists department_events_edit on public.department_events;
create policy department_events_edit on public.department_events
  for update to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
commit;

-- 주간 할 일의 줄 종류(할 일·텍스트·제목·글머리·번호)와 하루 안 순서. 기존 일정은 전부 '할 일'로 남습니다.
begin;
alter table public.schedules add column if not exists kind text not null default 'todo';
alter table public.schedules drop constraint if exists schedules_kind_check;
alter table public.schedules add constraint schedules_kind_check
  check (kind in ('todo', 'text', 'h1', 'h2', 'h3', 'bullet', 'number'));
alter table public.schedules add column if not exists sort_order double precision not null default 0;
create index if not exists schedules_day_order_idx
  on public.schedules (project_id, due_date, sort_order, created_at) where deleted_at is null;
commit;

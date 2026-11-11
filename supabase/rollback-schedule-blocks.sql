-- schema-schedule-blocks.sql 되돌리기: 블록 줄(할 일 아닌 줄)을 휴지통으로 보낸 뒤 kind·sort_order 칼럼을 지웁니다.
-- 사장 승인 뒤에만 실행하세요.
begin;
update public.schedules set deleted_at = now() where kind <> 'todo' and deleted_at is null;
drop index if exists public.schedules_day_order_idx;
alter table public.schedules drop constraint if exists schedules_kind_check;
alter table public.schedules drop column if exists kind, drop column if exists sort_order;
commit;

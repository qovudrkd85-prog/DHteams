-- 과업 일정 동시 수정 보호: updated_at 칼럼과 자동 갱신 트리거. 기존 자료는 바꾸지 않습니다.
begin;
alter table public.schedules add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_schedule()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
revoke all on function public.touch_schedule() from public, anon, authenticated;
drop trigger if exists schedules_touch on public.schedules;
create trigger schedules_touch before update on public.schedules
  for each row execute function public.touch_schedule();
commit;

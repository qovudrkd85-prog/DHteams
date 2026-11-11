-- 월 주요사항을 한 줄 = 한 항목으로 나눕니다. 기존 project_memos 는 그대로 둡니다(되돌리기용).
begin;
create table if not exists public.project_memo_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  month        text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  content      text not null check (char_length(btrim(content)) between 1 and 4000),
  created_by   uuid references public.team_members (id) on delete set null,
  creator_name text check (creator_name is null or char_length(creator_name) <= 100),
  created_at   timestamptz not null default clock_timestamp(),
  updated_at   timestamptz not null default clock_timestamp(),
  deleted_at   timestamptz
);
create index if not exists project_memo_items_list_idx
  on public.project_memo_items (project_id, month, created_at desc) where deleted_at is null;

-- 작성자는 서버가 찍습니다(위조 방지). 수정해도 최초 작성자는 유지됩니다.
create or replace function public.stamp_project_memo_item()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.created_by := public.current_team_member_id();
      new.creator_name := (select m.name from public.team_members as m where m.id = new.created_by);
    end if;
    new.updated_at := clock_timestamp();
  else
    new.created_by := old.created_by;
    new.creator_name := old.creator_name;
    new.project_id := old.project_id;
    new.month := old.month;
    new.created_at := old.created_at;
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_project_memo_item() from public, anon, authenticated;
drop trigger if exists project_memo_items_stamp on public.project_memo_items;
create trigger project_memo_items_stamp before insert or update on public.project_memo_items
  for each row execute function public.stamp_project_memo_item();

alter table public.project_memo_items enable row level security;
revoke all on table public.project_memo_items from public, anon, authenticated;
grant select, insert, update on table public.project_memo_items to authenticated;  -- delete 없음: 지우기는 deleted_at
grant all on table public.project_memo_items to service_role;
drop policy if exists teams_scoped on public.project_memo_items;
create policy teams_scoped on public.project_memo_items for all to authenticated
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));

-- 기존 글을 줄 단위로 옮깁니다. 이미 항목이 있는 (과업, 월)은 건너뜁니다.
-- 화면이 최신순이므로 원래 위쪽 줄이 위에 오도록 시각을 1ms 씩 거꾸로 줍니다.
insert into public.project_memo_items (project_id, month, content, creator_name, created_at, updated_at)
select m.project_id, m.month,
       btrim(regexp_replace(line.body, '^\s*[-•*·]\s*', '')),
       '이전 메모',
       m.updated_at - (line.ord * interval '1 millisecond'),
       m.updated_at - (line.ord * interval '1 millisecond')
from public.project_memos as m
cross join lateral regexp_split_to_table(m.content, E'\r?\n') with ordinality as line(body, ord)
where btrim(regexp_replace(line.body, '^\s*[-•*·]\s*', '')) <> ''
  and not exists (
    select 1 from public.project_memo_items as i
    where i.project_id = m.project_id and i.month = m.month
  );
commit;

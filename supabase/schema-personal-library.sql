-- 개인 메모·PC 폴더·파일 목록·파일 메모: 팀이 아니라 "사람" 소유입니다(팀을 바꾸거나 나가도 그대로).
-- schema-team-memberships.sql 다음에 Supabase SQL Editor에서 전체 실행하세요. 재실행 가능합니다.
-- 되돌리기: rollback-personal-library.sql (자료가 지워지므로 사장 승인 필요).
-- 필요: PostgreSQL 15 이상(외래키 ON DELETE SET NULL (칸) 문법).
begin;

do $$
begin
  if to_regclass('public.team_members') is null or to_regprocedure('public.current_team_member_id()') is null then
    raise exception '개인 계정(schema-accounts.sql)을 먼저 설치해 주세요.' using errcode = 'P0001';
  end if;
end;
$$;

-- 수정 시각: 같은 순간에 두 번 고쳐도 항상 앞으로 갑니다. 내용이 같은 upsert 는 시각을 그대로 둡니다(동기화 핑퐁 방지).
create or replace function public.touch_personal_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    new.updated_at := old.updated_at;
  elsif tg_op = 'UPDATE' then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

-- 소유자: 비워 두면 로그인한 본인으로 채웁니다. 소유자·client_id 는 나중에 바꿀 수 없습니다.
create or replace function public.stamp_personal_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, public.current_team_member_id());
  elsif new.owner_id is distinct from old.owner_id
     or (to_jsonb(new) ->> 'client_id') is distinct from (to_jsonb(old) ->> 'client_id') then
    raise exception '소유자와 client_id 는 바꿀 수 없습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.touch_personal_row() from public, anon, authenticated;
revoke all on function public.stamp_personal_owner() from public, anon, authenticated;

-- 메모 폴더
create table if not exists public.personal_note_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.team_members(id) on delete restrict,
  client_id text not null default gen_random_uuid()::text check (char_length(client_id) between 1 and 100),
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (owner_id, client_id),
  unique (id, owner_id)
);

-- 메모·할 일 (지우기는 deleted_at 으로만)
create table if not exists public.personal_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.team_members(id) on delete restrict,
  client_id text not null default gen_random_uuid()::text check (char_length(client_id) between 1 and 100),
  folder_id uuid,
  title text not null default '' check (char_length(title) <= 200),
  content text not null default '' check (char_length(content) <= 20000),
  is_task boolean not null default false,
  done boolean not null default false,
  pinned boolean not null default false,
  completed_at timestamptz,
  linked_path text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (owner_id, client_id),
  -- 남의 폴더에는 넣을 수 없습니다(폴더와 메모의 소유자가 같아야 함).
  foreign key (folder_id, owner_id) references public.personal_note_folders (id, owner_id) on delete set null (folder_id)
);
create index if not exists personal_notes_list_idx on public.personal_notes (owner_id, pinned desc, updated_at desc) where deleted_at is null;
-- 동기화(마지막 이후 바뀐 것, 지운 표시 포함)
create index if not exists personal_notes_sync_idx on public.personal_notes (owner_id, updated_at);
create index if not exists personal_notes_folder_idx on public.personal_notes (folder_id, owner_id) where folder_id is not null;

-- PC 폴더 (PC가 목록을 통째로 다시 올리므로 실제 삭제)
create table if not exists public.pc_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.team_members(id) on delete restrict,
  device_id text not null default '' check (char_length(device_id) <= 100),
  path text not null check (char_length(path) between 1 and 1000 and octet_length(path) <= 2000),
  name text not null default '',
  depth integer not null default 0 check (depth >= 0),
  file_count integer not null default 0 check (file_count >= 0),
  meta_size bigint not null default 0 check (meta_size >= 0),
  synced_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (owner_id, device_id, path),
  unique (id, owner_id)
);

-- PC 파일 목록 (폴더를 지우면 같이 지워짐)
create table if not exists public.pc_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.team_members(id) on delete restrict,
  device_id text not null default '' check (char_length(device_id) <= 100),
  folder_id uuid not null,
  file_name text not null,
  file_path text not null check (char_length(file_path) between 1 and 1000 and octet_length(file_path) <= 2000),
  file_size bigint not null default 0 check (file_size >= 0),
  is_directory boolean not null default false,
  modified_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (owner_id, device_id, file_path),
  foreign key (folder_id, owner_id) references public.pc_folders (id, owner_id) on delete cascade
);
create index if not exists pc_files_folder_idx on public.pc_files (folder_id, owner_id);

-- 파일 메모 (파일 목록과 따로, 경로로 이어짐 → 목록을 다시 올려도 메모는 남음)
create table if not exists public.pc_file_memos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.team_members(id) on delete restrict,
  device_id text not null default '' check (char_length(device_id) <= 100),
  file_path text not null check (char_length(file_path) between 1 and 1000 and octet_length(file_path) <= 2000),
  memo text not null default '' check (char_length(memo) <= 4000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (owner_id, device_id, file_path)
);
create index if not exists pc_file_memos_sync_idx on public.pc_file_memos (owner_id, updated_at);

-- 트리거·권한·정책 (다섯 표 공통)
do $$
declare
  t text;
begin
  foreach t in array array['personal_note_folders', 'personal_notes', 'pc_folders', 'pc_files', 'pc_file_memos'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_owner', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.stamp_personal_owner()', t || '_owner', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.touch_personal_row()', t || '_touch', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);

    execute format('drop policy if exists personal_owner on public.%I', t);
    execute format('create policy personal_owner on public.%I for all to authenticated using (owner_id = (select public.current_team_member_id())) with check (owner_id = (select public.current_team_member_id()))', t);
  end loop;
end;
$$;
-- PC 목록만 실제 삭제 허용 (메모는 deleted_at 으로)
grant delete on table public.pc_folders, public.pc_files to authenticated;

notify pgrst, 'reload schema';
commit;

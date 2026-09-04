-- DIDAS 업로드 여부 체크 칸 추가
-- Supabase SQL Editor 에 붙여넣고 Run 하세요. (이미 있으면 아무 일도 안 함)

alter table public.file_logs
  add column if not exists didas_uploaded boolean not null default false;

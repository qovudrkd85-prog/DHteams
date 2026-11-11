-- 되돌리기: 개인 메모·PC 폴더·파일 목록·파일 메모(schema-personal-library.sql)를 지웁니다.
-- 경고: 다섯 표의 자료(메모·할 일·파일 메모 포함)가 모두 사라집니다. 필요하면 먼저 내보내기 하세요.
-- 사장 승인 뒤 Supabase SQL Editor에서 전체 실행. 하나의 트랜잭션이며 오류가 나면 전부 취소됩니다.
-- 팀·일정·출퇴근 등 다른 표는 건드리지 않습니다.
begin;

-- 자식 표부터 지웁니다.
drop table if exists public.pc_file_memos;
drop table if exists public.pc_files;
drop table if exists public.pc_folders;
drop table if exists public.personal_notes;
drop table if exists public.personal_note_folders;

drop function if exists public.stamp_personal_owner();
drop function if exists public.touch_personal_row();

notify pgrst, 'reload schema';
commit;

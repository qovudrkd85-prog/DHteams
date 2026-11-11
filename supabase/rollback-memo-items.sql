-- schema-memo-items.sql 되돌리기: 항목 표와 작성자 트리거 함수를 지웁니다. project_memos 는 그대로 남습니다.
-- 항목으로 새로 쓴 내용은 사라집니다. 사장 승인 뒤에만 실행하세요.
drop table if exists public.project_memo_items;
drop function if exists public.stamp_project_memo_item();

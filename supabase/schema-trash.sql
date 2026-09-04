-- =====================================================================
-- 휴지통 (실수 삭제 복구) — 삭제해도 30일간 보관
-- Supabase SQL Editor 에 붙여넣고 Run 하세요. 여러 번 돌려도 안전합니다.
-- =====================================================================

alter table public.projects   add column if not exists deleted_at timestamptz;
alter table public.nodes      add column if not exists deleted_at timestamptz;
alter table public.file_logs  add column if not exists deleted_at timestamptz;
alter table public.schedules  add column if not exists deleted_at timestamptz;

create index if not exists projects_live_idx  on public.projects  (deleted_at);
create index if not exists nodes_live_idx     on public.nodes     (project_id, deleted_at);
create index if not exists file_logs_live_idx on public.file_logs (node_id, deleted_at);
create index if not exists schedules_live_idx on public.schedules (project_id, deleted_at);

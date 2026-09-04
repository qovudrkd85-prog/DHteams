import { createClient } from "@/lib/supabase/client";
import type {
  FileLog,
  MemberRole,
  NodeKind,
  Project,
  Schedule,
  ProjectMember,
  TreeNode,
} from "@/lib/types";

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// ---------------------------------------------------------------- projects

export async function listProjects(): Promise<Project[]> {
  const supabase = createClient();
  return unwrap(
    await supabase
      .from("projects")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  );
}

export async function getProject(id: string): Promise<Project> {
  const supabase = createClient();
  return unwrap(await supabase.from("projects").select("*").eq("id", id).single());
}

export async function createProject(input: {
  name: string;
  code?: string;
  description?: string;
}): Promise<Project> {
  const supabase = createClient();

  return unwrap(
    await supabase
      .from("projects")
      .insert({
        name: input.name.trim(),
        code: input.code?.trim() || null,
        description: input.description?.trim() || null,
        owner_id: null,
      })
      .select()
      .single(),
  );
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "code" | "description">>,
): Promise<Project> {
  const supabase = createClient();
  return unwrap(await supabase.from("projects").update(patch).eq("id", id).select().single());
}

export async function deleteProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------- nodes

export async function listNodes(projectId: string): Promise<TreeNode[]> {
  const supabase = createClient();
  return unwrap(
    await supabase
      .from("nodes")
      .select("*")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
  );
}

export async function createNode(input: {
  projectId: string;
  parentId: string | null;
  kind: NodeKind;
  name: string;
}): Promise<TreeNode> {
  const supabase = createClient();

  return unwrap(
    await supabase
      .from("nodes")
      .insert({
        project_id: input.projectId,
        parent_id: input.parentId,
        kind: input.kind,
        name: input.name.trim(),
        created_by: null,
      })
      .select()
      .single(),
  );
}

export async function renameNode(id: string, name: string): Promise<TreeNode> {
  const supabase = createClient();
  return unwrap(
    await supabase.from("nodes").update({ name: name.trim() }).eq("id", id).select().single(),
  );
}

export async function moveNode(id: string, parentId: string | null): Promise<TreeNode> {
  const supabase = createClient();
  return unwrap(
    await supabase.from("nodes").update({ parent_id: parentId }).eq("id", id).select().single(),
  );
}

/** 하위 항목까지 함께 휴지통으로 (ids 는 화면에서 계산해 넘긴다) */
export async function deleteNode(id: string, descendantIds: string[] = []): Promise<void> {
  const supabase = createClient();
  const targets = Array.from(new Set([id, ...descendantIds]));
  const { error } = await supabase
    .from("nodes")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", targets);
  if (error) throw new Error(error.message);
}

// --------------------------------------------------------------- file logs

export async function listLogs(nodeId: string): Promise<FileLog[]> {
  const supabase = createClient();
  return unwrap(
    await supabase
      .from("file_logs")
      .select("*")
      .eq("node_id", nodeId)
      .is("deleted_at", null)
      // 오래된 것부터 — 1, 2, 3 순번이 변경 이력 순서와 맞도록
      .order("occurred_on", { ascending: true })
      .order("created_at", { ascending: true }),
  );
}

export type LogInput = Pick<
  FileLog,
  "action" | "actor" | "counterpart" | "occurred_on" | "subject" | "detail"
> &
  Partial<Pick<FileLog, "didas_uploaded">>;

export async function createLog(nodeId: string, input: LogInput): Promise<FileLog> {
  const supabase = createClient();

  return unwrap(
    await supabase
      .from("file_logs")
      .insert({ ...input, node_id: nodeId, created_by: null })
      .select()
      .single(),
  );
}

export async function updateLog(id: string, patch: Partial<LogInput>): Promise<FileLog> {
  const supabase = createClient();
  return unwrap(await supabase.from("file_logs").update(patch).eq("id", id).select().single());
}

export async function deleteLog(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("file_logs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------------- members

export async function listMembers(projectId: string): Promise<ProjectMember[]> {
  const supabase = createClient();
  return unwrap(
    await supabase
      .from("project_members")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
  );
}

/** 이미 가입한 사람만 추가 가능 (auth.users 조회는 서버 함수에서) */
export async function addMemberByEmail(
  projectId: string,
  email: string,
  role: Exclude<MemberRole, "owner">,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("add_project_member", {
    p_project: projectId,
    p_email: email.trim(),
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// --------------------------------------------------------------- schedules

export async function listSchedules(projectId: string): Promise<Schedule[]> {
  const supabase = createClient();
  return unwrap(
    await supabase
      .from("schedules")
      .select("*")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: true }),
  );
}

export type ScheduleInput = Pick<
  Schedule,
  "title" | "due_date" | "assignee" | "note" | "color" | "done"
>;

export async function createSchedule(
  projectId: string,
  input: Omit<ScheduleInput, "done"> & { done?: boolean },
): Promise<Schedule> {
  const supabase = createClient();
  return unwrap(
    await supabase
      .from("schedules")
      .insert({ ...input, project_id: projectId })
      .select()
      .single(),
  );
}

export async function updateSchedule(
  id: string,
  patch: Partial<ScheduleInput>,
): Promise<Schedule> {
  const supabase = createClient();
  return unwrap(await supabase.from("schedules").update(patch).eq("id", id).select().single());
}

export async function deleteSchedule(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("schedules")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------- month memo

/** 과업 x 월 고정 메모. 없으면 빈 문자열 */
export async function getMemo(projectId: string, month: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("project_memos")
    .select("content")
    .eq("project_id", projectId)
    .eq("month", month)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.content ?? "";
}

export async function saveMemo(
  projectId: string,
  month: string,
  content: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("project_memos")
    .upsert(
      { project_id: projectId, month, content, updated_at: new Date().toISOString() },
      { onConflict: "project_id,month" },
    );
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------- trash

export const TRASH_KEEP_DAYS = 30;

export type TrashKind = "project" | "node" | "log" | "schedule";

export interface TrashItem {
  id: string;
  kind: TrashKind;
  label: string;
  detail: string;
  deleted_at: string;
}

const TABLE: Record<TrashKind, string> = {
  project: "projects",
  node: "nodes",
  log: "file_logs",
  schedule: "schedules",
};

const cutoffIso = () =>
  new Date(Date.now() - TRASH_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();

/** 삭제된 과업 목록 (홈 화면 휴지통) */
export async function listDeletedProjects(): Promise<TrashItem[]> {
  const supabase = createClient();
  const rows = unwrap<Project[]>(
    await supabase
      .from("projects")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }),
  );
  return rows.map((p) => ({
    id: p.id,
    kind: "project" as const,
    label: p.name,
    detail: p.code ?? "과업",
    deleted_at: p.deleted_at as string,
  }));
}

/** 과업 안에서 삭제된 폴더·파일·이력·일정 */
export async function listProjectTrash(projectId: string): Promise<TrashItem[]> {
  const supabase = createClient();

  const nodes = unwrap<TreeNode[]>(
    await supabase
      .from("nodes")
      .select("*")
      .eq("project_id", projectId)
      .not("deleted_at", "is", null),
  );
  const schedules = unwrap<Schedule[]>(
    await supabase
      .from("schedules")
      .select("*")
      .eq("project_id", projectId)
      .not("deleted_at", "is", null),
  );
  const nodeIds = unwrap<{ id: string }[]>(
    await supabase.from("nodes").select("id").eq("project_id", projectId),
  ).map((n) => n.id);

  const logs = nodeIds.length
    ? unwrap<FileLog[]>(
        await supabase
          .from("file_logs")
          .select("*")
          .in("node_id", nodeIds)
          .not("deleted_at", "is", null),
      )
    : [];

  const items: TrashItem[] = [
    ...nodes.map((n) => ({
      id: n.id,
      kind: "node" as const,
      label: n.name,
      detail: n.kind === "folder" ? "폴더" : "파일",
      deleted_at: n.deleted_at as string,
    })),
    ...logs.map((l) => ({
      id: l.id,
      kind: "log" as const,
      label: l.subject || l.detail || "(내용 없음)",
      detail: `이력 · ${l.occurred_on}`,
      deleted_at: l.deleted_at as string,
    })),
    ...schedules.map((s) => ({
      id: s.id,
      kind: "schedule" as const,
      label: s.title,
      detail: `일정 · ${s.due_date}`,
      deleted_at: s.deleted_at as string,
    })),
  ];

  return items.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

export async function restoreItem(kind: TrashKind, id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLE[kind]).update({ deleted_at: null }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** 되돌릴 수 없는 완전 삭제 */
export async function purgeItem(kind: TrashKind, id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLE[kind]).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** 30일 지난 휴지통 항목 자동 정리 (휴지통 열 때 호출) */
export async function purgeExpiredTrash(): Promise<void> {
  const supabase = createClient();
  const cutoff = cutoffIso();
  for (const table of Object.values(TABLE)) {
    await supabase.from(table).delete().lt("deleted_at", cutoff);
  }
}

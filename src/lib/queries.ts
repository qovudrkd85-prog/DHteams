import { createClient } from "@/lib/supabase/client";
import type {
  FileLog,
  MemberRole,
  NodeKind,
  Project,
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
    await supabase.from("projects").select("*").order("created_at", { ascending: false }),
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
  const { error } = await supabase.from("projects").delete().eq("id", id);
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

export async function deleteNode(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("nodes").delete().eq("id", id);
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
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false }),
  );
}

export type LogInput = Pick<
  FileLog,
  "action" | "actor" | "counterpart" | "occurred_on" | "subject" | "detail"
>;

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
  const { error } = await supabase.from("file_logs").delete().eq("id", id);
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

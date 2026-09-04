import { createClient } from "@/lib/supabase/client";
import type { FileLog, NodeKind, Project, TreeNode } from "@/lib/types";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다.");

  return unwrap(
    await supabase
      .from("projects")
      .insert({
        name: input.name.trim(),
        code: input.code?.trim() || null,
        description: input.description?.trim() || null,
        owner_id: user.id,
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return unwrap(
    await supabase
      .from("nodes")
      .insert({
        project_id: input.projectId,
        parent_id: input.parentId,
        kind: input.kind,
        name: input.name.trim(),
        created_by: user?.id ?? null,
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return unwrap(
    await supabase
      .from("file_logs")
      .insert({ ...input, node_id: nodeId, created_by: user?.id ?? null })
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

export type NodeKind = "folder" | "file";

export type LogAction = "받음" | "수정" | "보냄" | "확인";

export const LOG_ACTIONS: LogAction[] = ["받음", "수정", "보냄", "확인"];

export interface Project {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  owner_id: string;
  created_at: string;
}

export interface TreeNode {
  id: string;
  project_id: string;
  parent_id: string | null;
  kind: NodeKind;
  name: string;
  note: string | null;
  sort_order: number;
  created_at: string;
}

export interface FileLog {
  id: string;
  node_id: string;
  action: LogAction;
  actor: string;
  counterpart: string | null;
  occurred_on: string;
  subject: string | null;
  detail: string | null;
  created_at: string;
}

/** 트리 렌더링용 — nodes 배열을 부모/자식 구조로 묶은 형태 */
export interface TreeItem extends TreeNode {
  children: TreeItem[];
}

export function buildTree(nodes: TreeNode[]): TreeItem[] {
  const map = new Map<string, TreeItem>();
  nodes.forEach((n) => map.set(n.id, { ...n, children: [] }));

  const roots: TreeItem[] = [];
  map.forEach((item) => {
    const parent = item.parent_id ? map.get(item.parent_id) : undefined;
    if (parent) parent.children.push(item);
    else roots.push(item);
  });

  const sort = (items: TreeItem[]): TreeItem[] =>
    [...items]
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name, "ko");
      })
      .map((item) => ({ ...item, children: sort(item.children) }));

  return sort(roots);
}

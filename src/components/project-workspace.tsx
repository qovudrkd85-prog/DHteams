"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useRouter } from "next/navigation";

import { CalendarDays } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { LogTable } from "@/components/log-table";
import { NodeTree } from "@/components/node-tree";
import { ScheduleCalendar } from "@/components/schedule-calendar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import * as api from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { LogInput } from "@/lib/queries";
import { buildTree, type FileLog, type NodeKind, type Project, type TreeNode } from "@/lib/types";

type NameDialogState =
  | { mode: "add"; parentId: string | null; kind: NodeKind; value: string }
  | { mode: "rename"; target: TreeNode; value: string };

type DeleteTarget = { type: "node"; node: TreeNode } | { type: "log"; log: FileLog };

/** 모든 과업에 기본으로 들어가는 고정 항목 (DB 노드가 아니라 화면 고정) */
const SCHEDULE_ID = "__schedule__";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** 삭제 대상 노드와 그 하위 노드 id 전부 (DB는 cascade, 화면 상태도 맞춰준다) */
function collectDescendantIds(nodes: TreeNode[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((node) => {
      if (node.parent_id && ids.has(node.parent_id) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    });
  }
  return ids;
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<FileLog[]>([]);
  const [logsNodeId, setLogsNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; code: string; description: string } | null>(
    null,
  );
  const [projectDeleteOpen, setProjectDeleteOpen] = useState(false);
  const router = useRouter();

  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );
  const visibleLogs =
    selectedNode?.kind === "file" && logsNodeId === selectedNode.id ? logs : [];

  useEffect(() => {
    (async () => {
      try {
        const [loadedProject, loadedNodes] = await Promise.all([
          api.getProject(projectId),
          api.listNodes(projectId),
        ]);
        setProject(loadedProject);
        setNodes(loadedNodes);
      } catch (error) {
        toast.error(errorMessage(error, "과업을 불러오지 못했습니다."));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  // 파일을 고르면 그 파일의 이력을 불러온다
  useEffect(() => {
    if (!selectedNode || selectedNode.kind !== "file") {
      return;
    }
    const nodeId = selectedNode.id;
    let cancelled = false;
    api
      .listLogs(nodeId)
      .then((rows) => {
        if (!cancelled) {
          setLogs(rows);
          setLogsNodeId(nodeId);
        }
      })
      .catch((error) => toast.error(errorMessage(error, "이력을 불러오지 못했습니다.")));
    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

  const submitNameDialog = useCallback(async () => {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    if (!name) return;

    try {
      if (nameDialog.mode === "add") {
        const created = await api.createNode({
          projectId,
          parentId: nameDialog.parentId,
          kind: nameDialog.kind,
          name,
        });
        setNodes((prev) => [...prev, created]);
        if (created.kind === "file") setSelectedId(created.id);
      } else {
        const updated = await api.renameNode(nameDialog.target.id, name);
        setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      }
      setNameDialog(null);
    } catch (error) {
      toast.error(errorMessage(error, "저장하지 못했습니다."));
    }
  }, [nameDialog, projectId]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === "node") {
        const removedId = deleteTarget.node.id;
        await api.deleteNode(removedId);
        setNodes((prev) => {
          const removed = collectDescendantIds(prev, removedId);
          return prev.filter((n) => !removed.has(n.id));
        });
        if (selectedId && collectDescendantIds(nodes, removedId).has(selectedId)) {
          setSelectedId(null);
        }
      } else {
        await api.deleteLog(deleteTarget.log.id);
        setLogs((prev) => prev.filter((l) => l.id !== deleteTarget.log.id));
      }
      setDeleteTarget(null);
    } catch (error) {
      toast.error(errorMessage(error, "삭제하지 못했습니다."));
    }
  }, [deleteTarget, selectedId, nodes]);

  async function addLogRow() {
    if (!selectedNode || selectedNode.kind !== "file") return;
    try {
      const created = await api.createLog(selectedNode.id, {
        action: "받음",
        actor: "",
        counterpart: null,
        occurred_on: new Date().toISOString().slice(0, 10),
        subject: null,
        detail: null,
      });
      setLogs((prev) => [...prev, created]);
    } catch (error) {
      toast.error(errorMessage(error, "행을 추가하지 못했습니다."));
    }
  }

  async function patchLog(id: string, patch: Partial<LogInput>) {
    setLogs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    try {
      await api.updateLog(id, patch);
    } catch (error) {
      toast.error(errorMessage(error, "저장하지 못했습니다."));
    }
  }

  /** 드래그해서 다른 폴더로 옮기기 */
  async function moveNodeTo(nodeId: string, parentId: string | null) {
    const target = nodes.find((n) => n.id === nodeId);
    if (!target || target.parent_id === parentId) return;

    if (parentId && collectDescendantIds(nodes, nodeId).has(parentId)) {
      toast.error("폴더를 자기 하위 폴더로 옮길 수 없습니다.");
      return;
    }

    const previous = nodes;
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, parent_id: parentId } : n)));
    try {
      await api.moveNode(nodeId, parentId);
    } catch (error) {
      setNodes(previous);
      toast.error(errorMessage(error, "옮기지 못했습니다."));
    }
  }

  async function saveProjectEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editForm || !project) return;
    try {
      const updated = await api.updateProject(project.id, {
        name: editForm.name.trim(),
        code: editForm.code.trim() || null,
        description: editForm.description.trim() || null,
      });
      setProject(updated);
      setEditForm(null);
      toast.success("과업 정보를 수정했습니다.");
    } catch (error) {
      toast.error(errorMessage(error, "수정하지 못했습니다."));
    }
  }

  async function deleteWholeProject() {
    if (!project) return;
    try {
      await api.deleteProject(project.id);
      toast.success("과업을 삭제했습니다.");
      router.replace("/");
    } catch (error) {
      toast.error(errorMessage(error, "삭제하지 못했습니다."));
    }
  }

  return (
    <>
      <AppHeader>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm text-muted-foreground">
            {project ? `${project.name}${project.code ? ` · ${project.code}` : ""}` : ""}
          </span>
          {project ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setEditForm({
                    name: project.name,
                    code: project.code ?? "",
                    description: project.description ?? "",
                  })
                }
              >
                과업 수정
              </Button>
              <Button variant="outline" size="sm" onClick={() => setProjectDeleteOpen(true)}>
                과업 삭제
              </Button>
            </>
          ) : null}
        </div>
      </AppHeader>

      <main className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        {/* 좌: 폴더/파일 트리 */}
        <section className="flex w-full shrink-0 flex-col rounded-lg border bg-background lg:w-80">
          <div className="flex items-center gap-1 border-b p-2">
            <span className="flex-1 pl-1 text-sm font-medium">구성</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setNameDialog({ mode: "add", parentId: null, kind: "folder", value: "" })
              }
            >
              + 폴더
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setNameDialog({ mode: "add", parentId: null, kind: "file", value: "" })
              }
            >
              + 파일
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setSelectedId(SCHEDULE_ID)}
            className={cn(
              "mx-2 mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
              selectedId === SCHEDULE_ID && "bg-accent font-medium",
            )}
          >
            <CalendarDays className="size-4 shrink-0 text-rose-500" />
            00_업무일정
          </button>

          <ScrollArea className="max-h-[60vh] flex-1 p-2 lg:max-h-none">
            {loading ? (
              <p className="p-2 text-xs text-muted-foreground">불러오는 중...</p>
            ) : (
              <NodeTree
                items={tree}
                selectedId={selectedId}
                onSelect={(node) => setSelectedId(node.id)}
                onAddChild={(parent, kind) =>
                  setNameDialog({ mode: "add", parentId: parent?.id ?? null, kind, value: "" })
                }
                onRename={(node) => setNameDialog({ mode: "rename", target: node, value: node.name })}
                onDelete={(node) => setDeleteTarget({ type: "node", node })}
                onMove={moveNodeTo}
              />
            )}
          </ScrollArea>
        </section>

        {/* 우: 업무일정 달력 또는 선택한 파일의 이력 */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          {selectedId === SCHEDULE_ID ? (
            <ScheduleCalendar projectId={projectId} />
          ) : selectedNode && selectedNode.kind === "file" ? (
            <>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{selectedNode.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    누가 · 언제 · 무엇을 받았고 · 어떻게 수정했는지 기록
                  </p>
                </div>
                <Button size="sm" onClick={addLogRow}>
                  + 행 추가
                </Button>
              </div>
              <LogTable
                logs={visibleLogs}
                onPatch={patchLog}
                onDelete={(log) => setDeleteTarget({ type: "log", log })}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed bg-background p-10 text-sm text-muted-foreground">
              {selectedNode ? "폴더입니다. 왼쪽에서 파일을 선택하세요." : "왼쪽에서 파일을 선택하세요."}
            </div>
          )}
        </section>
      </main>

      {/* 이름 입력 다이얼로그 (추가 / 이름변경 공용) */}
      <Dialog open={nameDialog !== null} onOpenChange={(open) => !open && setNameDialog(null)}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitNameDialog();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {nameDialog?.mode === "rename"
                  ? "이름 변경"
                  : nameDialog?.kind === "folder"
                    ? "폴더 추가"
                    : "파일 추가"}
              </DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                autoFocus
                value={nameDialog?.value ?? ""}
                onChange={(e) =>
                  setNameDialog((prev) => (prev ? { ...prev, value: e.target.value } : prev))
                }
                placeholder={
                  nameDialog?.mode === "add" && nameDialog.kind === "folder"
                    ? "예) 03_설계도서"
                    : "예) 기본계획보고서.hwp"
                }
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!nameDialog?.value.trim()}>
                저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "node"
                ? `"${deleteTarget.node.name}" 및 하위 항목·이력이 모두 삭제됩니다.`
                : "이 이력 한 줄이 삭제됩니다."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 과업 정보 수정 */}
      <Dialog open={editForm !== null} onOpenChange={(open) => !open && setEditForm(null)}>
        <DialogContent>
          <form onSubmit={saveProjectEdit}>
            <DialogHeader>
              <DialogTitle>과업 수정</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="p-name">과업명</Label>
                <Input
                  id="p-name"
                  required
                  value={editForm?.name ?? ""}
                  onChange={(e) =>
                    setEditForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-code">과업번호</Label>
                <Input
                  id="p-code"
                  value={editForm?.code ?? ""}
                  onChange={(e) =>
                    setEditForm((prev) => (prev ? { ...prev, code: e.target.value } : prev))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-desc">설명</Label>
                <Textarea
                  id="p-desc"
                  value={editForm?.description ?? ""}
                  onChange={(e) =>
                    setEditForm((prev) => (prev ? { ...prev, description: e.target.value } : prev))
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!editForm?.name.trim()}>
                저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 과업 통째로 삭제 */}
      <AlertDialog open={projectDeleteOpen} onOpenChange={setProjectDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>과업을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${project?.name ?? ""}" 의 모든 폴더·파일·이력이 함께 삭제됩니다. 되돌릴 수 없습니다.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={deleteWholeProject}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

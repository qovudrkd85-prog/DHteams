"use client";

import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NodeKind, TreeItem, TreeNode } from "@/lib/types";

export interface NodeTreeActions {
  onSelect: (node: TreeNode) => void;
  onAddChild: (parent: TreeNode | null, kind: NodeKind) => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  /** 드래그해서 옮기기. parentId 가 null 이면 최상위로 뺀다 */
  onMove: (nodeId: string, parentId: string | null) => void;
}

interface NodeTreeProps extends NodeTreeActions {
  items: TreeItem[];
  selectedId: string | null;
}

const DRAG_TYPE = "application/x-teams-node";

export function NodeTree({ items, selectedId, ...actions }: NodeTreeProps) {
  const [rootOver, setRootOver] = useState(false);
  const [contextNode, setContextNode] = useState<TreeNode | null>(null);

  function handleRootDrop(event: React.DragEvent) {
    event.preventDefault();
    setRootOver(false);
    const id = event.dataTransfer.getData(DRAG_TYPE);
    if (id) actions.onMove(id, null);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          className={cn(
            "min-h-full rounded-md",
            rootOver && "bg-accent/40 ring-1 ring-primary",
          )}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(DRAG_TYPE)) {
              event.preventDefault();
              setRootOver(true);
            }
          }}
          onDragLeave={() => setRootOver(false)}
          onDrop={handleRootDrop}
          onContextMenu={(event) => {
            const target = event.target;
            if (
              !(target instanceof Element) ||
              !target.closest("[data-node-tree-row]")
            ) {
              setContextNode(null);
            }
          }}
        >
          {items.length > 0 ? (
            <ul className="space-y-0.5">
              {items.map((item) => (
                <NodeRow
                  key={item.id}
                  item={item}
                  depth={0}
                  selectedId={selectedId}
                  onContextNode={setContextNode}
                  {...actions}
                />
              ))}
            </ul>
          ) : (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              폴더나 파일을 추가하세요.
            </p>
          )}
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
            우클릭으로 추가 · 드래그해서 폴더 안으로 넣기 · 빈 곳에 놓으면
            최상위로
          </p>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {contextNode ? (
          <>
            <ContextMenuItem
              onClick={() =>
                actions.onAddChild(
                  contextNode.kind === "folder" ? contextNode : null,
                  "folder",
                )
              }
            >
              {contextNode.kind === "folder"
                ? "하위 폴더 추가"
                : "최상위 폴더 추가"}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                actions.onAddChild(
                  contextNode.kind === "folder" ? contextNode : null,
                  "file",
                )
              }
            >
              {contextNode.kind === "folder"
                ? "파일 추가"
                : "최상위 파일 추가"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => actions.onRename(contextNode)}>
              이름 변경
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              onClick={() => actions.onDelete(contextNode)}
            >
              삭제
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={() => actions.onAddChild(null, "folder")}>
              최상위 폴더 추가
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.onAddChild(null, "file")}>
              최상위 파일 추가
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface NodeRowProps extends NodeTreeActions {
  item: TreeItem;
  depth: number;
  selectedId: string | null;
  onContextNode: (node: TreeNode) => void;
}

function NodeRow({
  item,
  depth,
  selectedId,
  onContextNode,
  ...actions
}: NodeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const isFolder = item.kind === "folder";
  const isSelected = item.id === selectedId;
  const childCount = item.children.length;

  // 폴더에만 떨어뜨릴 수 있다. 파일 위에 놓으면 그 파일의 부모 폴더로 들어간다
  const dropParentId = isFolder ? item.id : item.parent_id;

  function handleDrop(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const id = event.dataTransfer.getData(DRAG_TYPE);
    if (id && id !== item.id) {
      actions.onMove(id, dropParentId);
      if (isFolder) setExpanded(true);
    }
  }

  return (
    <li>
      <div
        data-node-tree-row
        draggable
        onContextMenu={() => onContextNode(item)}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, item.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-accent",
          isSelected && "bg-accent font-medium",
          dragOver && "ring-1 ring-primary bg-accent",
        )}
        style={{ paddingLeft: depth * 14 }}
      >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
              onClick={() => {
                if (isFolder) setExpanded((prev) => !prev);
                actions.onSelect(item);
              }}
            >
              <span className="w-4 shrink-0 text-muted-foreground">
                {isFolder && childCount > 0 ? (
                  expanded ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )
                ) : null}
              </span>
              {isFolder ? (
                expanded ? (
                  <FolderOpen className="size-4 shrink-0 text-amber-500" />
                ) : (
                  <Folder className="size-4 shrink-0 text-amber-500" />
                )
              ) : (
                <FileText className="size-4 shrink-0 text-sky-500" />
              )}
              <span className="truncate">{item.name}</span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 opacity-0 group-hover:opacity-100 data-popup-open:opacity-100"
                  >
                    <MoreHorizontal className="size-4" />
                    <span className="sr-only">메뉴</span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {isFolder ? (
                  <>
                    <DropdownMenuItem
                      onClick={() => actions.onAddChild(item, "folder")}
                    >
                      하위 폴더 추가
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => actions.onAddChild(item, "file")}
                    >
                      파일 추가
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem onClick={() => actions.onRename(item)}>
                  이름 변경
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => actions.onDelete(item)}
                >
                  삭제
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
      </div>

      {isFolder && expanded && childCount > 0 ? (
        <ul className="space-y-0.5">
          {item.children.map((child) => (
            <NodeRow
              key={child.id}
              item={child}
              depth={depth + 1}
              selectedId={selectedId}
              onContextNode={onContextNode}
              {...actions}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

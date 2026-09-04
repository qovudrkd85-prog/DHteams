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
}

interface NodeTreeProps extends NodeTreeActions {
  items: TreeItem[];
  selectedId: string | null;
}

export function NodeTree({ items, selectedId, ...actions }: NodeTreeProps) {
  if (items.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-xs text-muted-foreground">
        폴더나 파일을 추가하세요.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <NodeRow key={item.id} item={item} depth={0} selectedId={selectedId} {...actions} />
      ))}
    </ul>
  );
}

interface NodeRowProps extends NodeTreeActions {
  item: TreeItem;
  depth: number;
  selectedId: string | null;
}

function NodeRow({ item, depth, selectedId, ...actions }: NodeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = item.kind === "folder";
  const isSelected = item.id === selectedId;
  const childCount = item.children.length;

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-accent",
          isSelected && "bg-accent font-medium",
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
                <DropdownMenuItem onClick={() => actions.onAddChild(item, "folder")}>
                  하위 폴더 추가
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onAddChild(item, "file")}>
                  파일 추가
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onClick={() => actions.onRename(item)}>이름 변경</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete(item)}>
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
              {...actions}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

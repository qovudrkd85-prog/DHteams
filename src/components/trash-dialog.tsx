"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listDeletedProjects,
  listProjectTrash,
  purgeExpiredTrash,
  purgeItem,
  restoreItem,
  TRASH_KEEP_DAYS,
  type TrashItem,
} from "@/lib/queries";

interface TrashDialogProps {
  /** 없으면 삭제된 과업 목록, 있으면 그 과업 안의 삭제 항목 */
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored?: () => void;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const daysLeft = (deletedAt: string) => {
  const passed = (Date.now() - new Date(deletedAt).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(TRASH_KEEP_DAYS - passed));
};

export function TrashDialog({
  projectId,
  open,
  onOpenChange,
  onRestored,
}: TrashDialogProps) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    () =>
      purgeExpiredTrash()
        .then(() =>
          projectId ? listProjectTrash(projectId) : listDeletedProjects(),
        )
        .then(setItems)
        .catch((error) => {
          toast.error(
            errorMessage(
              error,
              "휴지통을 불러오지 못했습니다. 휴지통 SQL을 실행했는지 확인하세요.",
            ),
          );
        })
        .finally(() => {
          setLoading(false);
        }),
    [projectId],
  );

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setLoading(true);
  }

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  async function handleRestore(item: TrashItem) {
    try {
      await restoreItem(item.kind, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast.success("복구했습니다.");
      onRestored?.();
    } catch (error) {
      toast.error(errorMessage(error, "복구하지 못했습니다."));
    }
  }

  async function handlePurge(item: TrashItem) {
    try {
      await purgeItem(item.kind, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (error) {
      toast.error(errorMessage(error, "삭제하지 못했습니다."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>휴지통</DialogTitle>
          <DialogDescription>
            삭제한 항목은 {TRASH_KEEP_DAYS}일간 보관되고, 그 뒤 자동으로 완전히
            사라집니다.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            불러오는 중...
          </p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            휴지통이 비어 있습니다.
          </p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {items.map((item) => (
              <li
                key={`${item.kind}-${item.id}`}
                className="flex items-center gap-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.detail} · {daysLeft(item.deleted_at)}일 남음
                  </p>
                </div>
                <Badge variant="secondary">{daysLeft(item.deleted_at)}일</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => handleRestore(item)}
                >
                  <RotateCcw className="size-4" />
                  <span className="sr-only">복구</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive"
                  onClick={() => handlePurge(item)}
                >
                  <Trash2 className="size-4" />
                  <span className="sr-only">완전 삭제</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

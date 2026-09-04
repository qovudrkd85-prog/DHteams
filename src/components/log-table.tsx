"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { LogInput } from "@/lib/queries";
import { LOG_ACTIONS, type FileLog, type LogAction } from "@/lib/types";

interface LogTableProps {
  logs: FileLog[];
  onPatch: (id: string, patch: Partial<LogInput>) => void;
  onDelete: (log: FileLog) => void;
}

export function LogTable({ logs, onPatch, onDelete }: LogTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[96px]">구분</TableHead>
            <TableHead className="w-[140px]">언제</TableHead>
            <TableHead className="w-[110px]">누가</TableHead>
            <TableHead className="w-[130px]">상대(발신/수신)</TableHead>
            <TableHead className="w-[200px]">무엇을</TableHead>
            <TableHead>어떻게 수정했는지</TableHead>
            <TableHead className="w-[44px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                기록이 없습니다. 아래 &ldquo;+ 행 추가&rdquo; 로 첫 이력을 남기세요.
              </TableCell>
            </TableRow>
          ) : (
            logs.map((log) => (
              <LogRow key={log.id} log={log} onPatch={onPatch} onDelete={onDelete} />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

interface LogRowProps {
  log: FileLog;
  onPatch: (id: string, patch: Partial<LogInput>) => void;
  onDelete: (log: FileLog) => void;
}

function LogRow({ log, onPatch, onDelete }: LogRowProps) {
  const [draft, setDraft] = useState({
    actor: log.actor ?? "",
    counterpart: log.counterpart ?? "",
    subject: log.subject ?? "",
    detail: log.detail ?? "",
  });

  function commit(field: keyof typeof draft, original: string | null) {
    const value = draft[field];
    if (value === (original ?? "")) return;
    onPatch(log.id, { [field]: value || null } as Partial<LogInput>);
  }

  return (
    <TableRow className="align-top">
      <TableCell>
        <Select
          value={log.action}
          onValueChange={(value) => onPatch(log.id, { action: value as LogAction })}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOG_ACTIONS.map((action) => (
              <SelectItem key={action} value={action}>
                {action}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      <TableCell>
        <Input
          type="date"
          className="h-8"
          value={log.occurred_on}
          onChange={(e) => onPatch(log.id, { occurred_on: e.target.value })}
        />
      </TableCell>

      <TableCell>
        <Input
          className="h-8"
          placeholder="담당자"
          value={draft.actor}
          onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
          onBlur={() => commit("actor", log.actor)}
        />
      </TableCell>

      <TableCell>
        <Input
          className="h-8"
          placeholder="○○과 / 발주처"
          value={draft.counterpart}
          onChange={(e) => setDraft({ ...draft, counterpart: e.target.value })}
          onBlur={() => commit("counterpart", log.counterpart)}
        />
      </TableCell>

      <TableCell>
        <Input
          className="h-8"
          placeholder="자료명 / 버전"
          value={draft.subject}
          onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
          onBlur={() => commit("subject", log.subject)}
        />
      </TableCell>

      <TableCell>
        <Textarea
          className="min-h-8 resize-y py-1.5"
          rows={1}
          placeholder="수정 내용"
          value={draft.detail}
          onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
          onBlur={() => commit("detail", log.detail)}
        />
      </TableCell>

      <TableCell>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => onDelete(log)}>
          <Trash2 className="size-4 text-muted-foreground" />
          <span className="sr-only">행 삭제</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}

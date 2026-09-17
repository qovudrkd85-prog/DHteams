"use client";

import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  onPatch: (id: string, patch: Partial<LogInput>) => Promise<boolean>;
  onDelete: (log: FileLog) => void;
}

export function LogTable({ logs, onPatch, onDelete }: LogTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <Table className="min-w-[1040px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[44px] text-center">순번</TableHead>
            <TableHead className="w-[96px]">구분</TableHead>
            <TableHead className="w-[140px]">언제</TableHead>
            <TableHead className="w-[110px]">누가</TableHead>
            <TableHead className="w-[130px]">상대(발신/수신)</TableHead>
            <TableHead className="w-[200px]">무엇을</TableHead>
            <TableHead>어떻게 수정했는지</TableHead>
            <TableHead className="w-[92px] text-center">DIDAS 업로드</TableHead>
            <TableHead className="w-[44px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                기록이 없습니다. 아래 &ldquo;+ 행 추가&rdquo; 로 첫 이력을 남기세요.
              </TableCell>
            </TableRow>
          ) : (
            logs.map((log, index) => (
              <LogRow key={log.id} seq={index + 1} log={log} onPatch={onPatch} onDelete={onDelete} />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

interface LogRowProps {
  seq: number;
  log: FileLog;
  onPatch: (id: string, patch: Partial<LogInput>) => Promise<boolean>;
  onDelete: (log: FileLog) => void;
}

function LogRow({ seq, log, onPatch, onDelete }: LogRowProps) {
  const [draft, setDraft] = useState({
    actor: log.actor ?? "",
    counterpart: log.counterpart ?? "",
    subject: log.subject ?? "",
    detail: log.detail ?? "",
  });
  type Field = keyof typeof draft;
  const [failedFields, setFailedFields] = useState<Field[]>([]);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  async function save(patch: Partial<LogInput>, fields: Field[] = []) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const saved = await onPatch(log.id, patch);
      setFailedFields((previous) => saved
        ? previous.filter((field) => !fields.includes(field))
        : [...new Set([...previous, ...fields])]);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function commit(field: Field, original: string | null) {
    const value = draft[field];
    if (value === (original ?? "")) {
      setFailedFields((previous) => previous.filter((entry) => entry !== field));
      return;
    }
    void save({ [field]: field === "actor" ? value : value || null }, [field]);
  }

  function retry() {
    const fields = (Object.keys(draft) as Field[]).filter((field) => draft[field] !== (log[field] ?? ""));
    if (!fields.length) { setFailedFields([]); return; }
    const patch = Object.fromEntries(fields.map((field) => [field, field === "actor" ? draft[field] : draft[field] || null]));
    void save(patch, fields);
  }

  return (
    <TableRow className="align-top">
      <TableCell className="pt-3 text-center text-sm font-medium text-muted-foreground tabular-nums">
        {seq}
      </TableCell>

      <TableCell>
        <Select
          value={log.action}
          disabled={busy}
          onValueChange={(value) => { if (value) void save({ action: value as LogAction }); }}
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
          disabled={busy}
          onChange={(e) => { if (e.target.value) void save({ occurred_on: e.target.value }); }}
        />
      </TableCell>

      <TableCell>
        <Input
          className="h-8"
          placeholder="담당자"
          value={draft.actor}
          maxLength={100}
          disabled={busy}
          aria-invalid={failedFields.includes("actor")}
          onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
          onBlur={() => commit("actor", log.actor)}
        />
      </TableCell>

      <TableCell>
        <Input
          className="h-8"
          placeholder="○○과 / 발주처"
          value={draft.counterpart}
          maxLength={100}
          disabled={busy}
          aria-invalid={failedFields.includes("counterpart")}
          onChange={(e) => setDraft({ ...draft, counterpart: e.target.value })}
          onBlur={() => commit("counterpart", log.counterpart)}
        />
      </TableCell>

      <TableCell>
        <Input
          className="h-8"
          placeholder="자료명 / 버전"
          value={draft.subject}
          maxLength={300}
          disabled={busy}
          aria-invalid={failedFields.includes("subject")}
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
          maxLength={4000}
          disabled={busy}
          aria-invalid={failedFields.includes("detail")}
          onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
          onBlur={() => commit("detail", log.detail)}
        />
        {failedFields.length > 0 && <div role="alert" className="mt-2 text-xs text-red-700">
          입력한 내용이 아직 저장되지 않았습니다.
          <Button type="button" size="sm" variant="outline" className="mt-1" disabled={busy} onClick={retry}>이력 다시 저장</Button>
        </div>}
      </TableCell>

      <TableCell className="pt-3 text-center">
        <Checkbox
          checked={log.didas_uploaded ?? false}
          disabled={busy}
          onCheckedChange={(checked) => { void save({ didas_uploaded: checked }); }}
          aria-label="DIDAS 업로드 완료"
        />
      </TableCell>

      <TableCell>
        <Button variant="ghost" size="icon" className="size-8" disabled={busy} onClick={() => onDelete(log)}>
          <Trash2 className="size-4 text-muted-foreground" />
          <span className="sr-only">행 삭제</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}

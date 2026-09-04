"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { TrashDialog } from "@/components/trash-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProject, listProjects } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import type { Project } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "과업을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      router.replace("/setup");
      return;
    }

    void reload();
  }, [router, reload]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await createProject(form);
      setProjects((prev) => [created, ...prev]);
      setForm({ name: "", code: "", description: "" });
      setOpen(false);
      toast.success("과업을 만들었습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "과업 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">과업 목록</h1>
            <p className="text-sm text-muted-foreground">
              과업 안에 폴더와 파일을 만들고, 파일마다 수령·수정 이력을 기록합니다.
            </p>
          </div>

          <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTrashOpen(true)}>휴지통</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button>+ 새 과업</Button>} />
            <DialogContent>
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>새 과업</DialogTitle>
                  <DialogDescription>과업명은 나중에 수정할 수 있습니다.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">과업명</Label>
                    <Input
                      id="name"
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="예) 00천 하천기본계획 수립용역"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="code">과업번호 (선택)</Label>
                    <Input
                      id="code"
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      placeholder="예) 2026-토목-01"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">설명 (선택)</Label>
                    <Textarea
                      id="description"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={busy || !form.name.trim()}>
                    {busy ? "만드는 중..." : "만들기"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : projects.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              아직 과업이 없습니다. 오른쪽 위 &ldquo;새 과업&rdquo; 으로 시작하세요.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full transition-colors hover:border-primary">
                  <CardHeader>
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    {project.code ? (
                      <p className="text-xs text-muted-foreground">{project.code}</p>
                    ) : null}
                  </CardHeader>
                  {project.description ? (
                    <CardContent className="text-sm text-muted-foreground line-clamp-2">
                      {project.description}
                    </CardContent>
                  ) : null}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
      <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} onRestored={reload} />
    </>
  );
}

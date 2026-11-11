"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, FolderOpen, Search, Sprout } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { DepartmentCalendar } from "@/components/department-calendar";
import { HubTabs, useHubView } from "@/components/team/hub-tabs";
import type { HubView } from "@/lib/team/rooms";
import { TeamPanel } from "@/components/team/panel";
import { Garage, HealingCard } from "@/components/team/garage";
import { TeamRoomMini } from "@/components/team/team-room";
import { ProjectFocusListener, UpcomingBadge, useFocusTarget, useUpcomingDeadlines } from "@/components/team/project-deadline-filter";
import { TrashDialog } from "@/components/trash-dialog";
import { Button } from "@/components/ui/button";
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
import { useTeamWorkspace } from "@/lib/team/use-team-workspace";
import { projectToneMap, toneFor } from "@/lib/project-deadlines";

export default function HomePage() {
  const router = useRouter();
  const workspace = useTeamWorkspace();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedView, saveView] = useHubView();
  // One-shot view from a focus link; shown without overwriting the remembered tab.
  const [focusView, setFocusView] = useState<HubView | null>(null);
  const view = focusView ?? savedView;
  const changeView = useCallback(
    (next: HubView) => {
      setFocusView(null);
      saveView(next);
    },
    [saveView],
  );
  // Project the team calendar was asked to open on (from a project's "팀 달력에서 보기").
  const [focusProject, setFocusProject] = useState<string | null>(null);
  const upcoming = useUpcomingDeadlines(loading ? null : projects);
  // Same colours as the team calendar (both built from this team's project list).
  const toneMap = useMemo(() => projectToneMap(projects.map((p) => p.id)), [projects]);
  const focus = useFocusTarget(focusProject, projects, loading);
  const [healing, setHealing] = useState(false);
  // Set when healing just ended, so the card takes focus back.
  const [healingEnded, setHealingEnded] = useState(false);
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) {
    // Any route out of the garage (tab click, storage sync) ends the healing scene.
    setSeenView(view);
    if (view !== "garage") { setHealing(false); setHealingEnded(false); }
  }
  const visibleProjects = projects.filter((project) =>
    `${project.name} ${project.code ?? ""}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );

  const reload = useCallback(
    () =>
      listProjects()
        .then((rows) => {
          setProjects(rows);
          setLoadError(null);
        })
        .catch((error) => {
          setLoadError(
            error instanceof Error
              ? error.message
              : "과업을 불러오지 못했습니다.",
          );
        })
        .finally(() => {
          setLoading(false);
        }),
    [],
  );

  useEffect(() => {
    if (!isSupabaseConfigured) {
      router.replace("/setup");
      return;
    }

    void reload();
  }, [router, reload]);

  const takeFocus = useCallback(
    (projectId: string) => {
      setFocusProject(projectId);
      setFocusView("team");
      // Drop the one-shot param so a reload does not pull the hub back to the team room.
      router.replace("/", { scroll: false });
    },
    [router],
  );

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
      toast.error(
        error instanceof Error ? error.message : "과업 생성에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader>
        <span className="text-xs text-slate-500">우리 부서의 업무 공간</span>
      </AppHeader>
      <main className="mx-auto w-full max-w-[1900px] flex-1 px-3 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-teal-700">
              <Sprout className="size-3.5" /> OUR LITTLE WORKSPACE
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              함께 계획하는 하루
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              내 자리에 앉아 하루를 시작하고, 우리 팀의 계획을 함께 채워요.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setTrashOpen(true)}>
              휴지통
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger
                render={
                  <Button className="bg-teal-700 text-white hover:bg-teal-800">
                    + 새 과업
                  </Button>
                }
              />
              <DialogContent>
                <form onSubmit={handleCreate}>
                  <DialogHeader>
                    <DialogTitle>새 과업</DialogTitle>
                    <DialogDescription>
                      과업명은 나중에 수정할 수 있습니다.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">과업명</Label>
                      <Input
                        id="name"
                        required
                        maxLength={200}
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                        placeholder="예) 00천 하천기본계획 수립용역"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="code">과업번호 (선택)</Label>
                      <Input
                        id="code"
                        maxLength={100}
                        value={form.code}
                        onChange={(e) =>
                          setForm({ ...form, code: e.target.value })
                        }
                        placeholder="예) 2026-토목-01"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">설명 (선택)</Label>
                      <Textarea
                        id="description"
                        maxLength={2000}
                        value={form.description}
                        onChange={(e) =>
                          setForm({ ...form, description: e.target.value })
                        }
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

        <Suspense fallback={null}><ProjectFocusListener onFocus={takeFocus} /></Suspense>
        <div className="mb-5"><HubTabs view={view} onChange={changeView} /></div>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-5">
            {/* Kept mounted while hidden so month and filters survive a trip to the garage. */}
            <section hidden={view !== "team"} className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:p-5" aria-label="우리 팀 달력" data-testid="team-calendar-inline">
              <DepartmentCalendar
                members={workspace.members}
                currentMember={workspace.error ? null : workspace.currentMember}
                onRegister={() => workspace.setProfileOpen(true)}
                active={view === "team"}
                projects={projects}
                focusProject={focus.project}
                focusDate={focus.date}
              />
            </section>
            {view === "garage" && (
              <Garage workspace={workspace} healing={healing} onHealingEnd={() => { setHealing(false); setHealingEnded(true); }} />
            )}
          </div>
          <aside
            className="min-w-0 space-y-4 lg:sticky lg:top-20"
            aria-label="과업 목록과 팀 방"
          >
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-testid="project-list">
              <div className="border-b border-slate-100 p-5">
                <div className="mb-1 flex items-center gap-2">
                  <FolderOpen className="size-4 text-teal-700" />
                  <h2 className="font-semibold text-slate-900">과업 목록</h2>
                  <span className="ml-auto rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                    {loading || loadError ? "—" : projects.length}
                  </span>
                </div>
                <p className="mb-4 text-xs text-slate-500">
                  과업을 선택해 과업 달력과 파일 이력을 확인하세요.
                </p>
                {upcoming.error && (
                  <p role="status" className="-mt-2 mb-3 text-xs text-amber-700">
                    다가오는 일정을 불러오지 못했습니다 ({upcoming.error}).
                  </p>
                )}
                <div className="relative">
                  <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
                  <Input
                    aria-label="과업 검색"
                    placeholder="과업명 또는 과업번호 검색"
                    className="bg-slate-50 pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="max-h-[280px] lg:max-h-[360px] overflow-y-auto p-2">
                {loading ? (
                  <p className="p-6 text-center text-sm text-slate-500">
                    과업을 불러오는 중…
                  </p>
                ) : loadError ? (
                  <div role="alert" className="p-4 text-sm text-red-700">
                    {loadError}
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => void reload()}
                    >
                      다시 시도
                    </Button>
                  </div>
                ) : visibleProjects.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">
                    {search
                      ? "검색 결과가 없습니다."
                      : "새 과업을 만들어 업무를 시작하세요."}
                  </p>
                ) : (
                  visibleProjects.map((project, i) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}?view=schedule`}
                      className="group flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-teal-600"
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold tabular-nums text-slate-500 group-hover:bg-teal-100 group-hover:text-teal-800">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="break-words text-sm leading-6 font-medium text-slate-800">
                          {project.name}
                        </h3>
                        {project.code && (
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            {project.code}
                          </p>
                        )}
                        <UpcomingBadge item={upcoming.next.get(project.id)} tone={toneFor(toneMap, project.id)} />
                        {project.description && (
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                            {project.description}
                          </p>
                        )}
                      </div>
                      <ArrowUpRight className="mt-1 size-4 shrink-0 text-slate-300 group-hover:text-teal-600" />
                    </Link>
                  ))
                )}
              </div>
              <div className="border-t border-slate-100 p-3">
                <Button
                  variant="ghost"
                  className="w-full text-teal-700"
                  onClick={() => setOpen(true)}
                >
                  + 새 과업 만들기
                </Button>
              </div>
            </section>
            {view === "team" && (
              <>
                <TeamRoomMini
                  members={workspace.members}
                  attendance={workspace.attendance}
                  currentMember={workspace.error ? null : workspace.currentMember}
                  onEnterGarage={() => changeView("garage")}
                />
                <TeamPanel workspace={workspace} />
              </>
            )}
            {view === "garage" && !healing && <HealingCard focusOnMount={healingEnded} onOpen={() => { setHealing(true); setHealingEnded(false); }} />}
            <div className="rounded-2xl bg-teal-800 p-5 text-white">
              <p className="text-sm font-semibold">
                일정은 함께, 기록은 차곡차곡.
              </p>
              <p className="mt-2 text-xs leading-6 text-teal-100">
                업무·회의·휴가는 등록자와 함께 부서 달력에,
                <br />
                과업별 일정과 파일 이력은 각 과업 안에 남겨 주세요.
              </p>
            </div>
          </aside>
        </div>
      </main>
      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        onRestored={reload}
      />
    </>
  );
}

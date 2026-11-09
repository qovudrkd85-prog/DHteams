"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Home, Wrench } from "lucide-react";

import { loadHubView, saveHubView, type HubView } from "@/lib/team/rooms";
import { cn } from "@/lib/utils";

const TABS: readonly { id: HubView; label: string; hint: string; icon: typeof Home }[] = [
  { id: "team", label: "우리 팀 방", hint: "팀 달력 · 지금 접속한 팀원", icon: Home },
  { id: "garage", label: "내 정비실", hint: "내 일정 · 상태 · 힐링 타임", icon: Wrench },
];

const HUB_EVENT = "teams:hub-view";
function subscribe(listener: () => void) {
  window.addEventListener(HUB_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(HUB_EVENT, listener); window.removeEventListener("storage", listener); };
}

/** Remembered hub view; the server render always starts at the team room. */
export function useHubView(): [HubView, (view: HubView) => void] {
  const view = useSyncExternalStore(subscribe, loadHubView, () => "team" as const);
  const change = useCallback((next: HubView) => { saveHubView(next); window.dispatchEvent(new Event(HUB_EVENT)); }, []);
  return [view, change];
}

interface HubTabsProps {
  view: HubView;
  onChange: (view: HubView) => void;
}

export function HubTabs({ view, onChange }: HubTabsProps) {
  return (
    <div role="tablist" aria-label="공간 선택" className="inline-flex gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={view === tab.id}
          data-testid={`hub-tab-${tab.id}`}
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-teal-600",
            view === tab.id ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-teal-50",
          )}
        >
          <tab.icon className="size-4" />
          <span><span className="block text-sm font-semibold">{tab.label}</span><span className={cn("block text-[10px]", view === tab.id ? "text-teal-100" : "text-slate-400")}>{tab.hint}</span></span>
        </button>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";
import { activitiesFor, type HealingActivityId, type HealingSceneId } from "@/lib/team/healing";
import type { TeamMember } from "@/lib/team/workspace";
import { cn } from "@/lib/utils";
import { HealingOverlay } from "./healing-overlay";
import styles from "./healing.module.css";

interface HealingPlaceProps {
  member: Pick<TeamMember, "avatar" | "color" | "name"> | null;
  onBack: () => void;
}

interface ActivityBarProps extends HealingPlaceProps {
  sceneId: HealingSceneId;
  activity: HealingActivityId;
  onPick: (id: HealingActivityId) => void;
}

function ActivityBar({ sceneId, activity, onPick, member }: ActivityBarProps) {
  const allowed = activitiesFor(sceneId);
  // A pick that the new scene does not allow falls back to resting.
  const current = allowed.some((a) => a.id === activity) ? activity : "rest";
  const label = allowed.find((a) => a.id === current)?.name ?? "쉬기";
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col items-center gap-1" data-testid="healing-avatar" data-activity={current}>
        <span
          className={cn("flex size-16 items-center justify-center rounded-full border-4 bg-white text-4xl shadow-lg", styles.avatar)}
          style={{ borderColor: member?.color ?? "#ffffff" }}
          aria-hidden
        >
          {member?.avatar ?? "🙂"}
        </span>
        <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs">{member?.name ?? "나"} · {label}</span>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="할 일 고르기">
        {allowed.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={current === item.id}
            data-testid={`healing-activity-${item.id}`}
            onClick={() => onPick(item.id)}
            className={cn("rounded-xl px-3 py-2 text-sm font-medium backdrop-blur", current === item.id ? "bg-teal-400 text-slate-900" : "bg-white/15 hover:bg-white/25")}
          >
            {item.emoji} {item.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Healing place that takes over the garage area (not a modal). */
export function HealingPlace({ member, onBack }: HealingPlaceProps) {
  const [activity, setActivity] = useState<HealingActivityId>("rest");
  return (
    <HealingOverlay inline onClose={onBack}>
      {(sceneId) => <ActivityBar sceneId={sceneId} activity={activity} onPick={setActivity} member={member} onBack={onBack} />}
    </HealingOverlay>
  );
}

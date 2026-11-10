"use client";

import { findActivity } from "@/lib/team/healing";
import { activitiesInScene } from "@/lib/team/healing-world";
import type { TeamMember } from "@/lib/team/workspace";
import { cn } from "@/lib/utils";
import { HealingOverlay, type HealingWorldContext } from "./healing-overlay";
import styles from "./healing.module.css";

interface HealingPlaceProps {
  member: Pick<TeamMember, "avatar" | "color" | "name"> | null;
  onBack: () => void;
}

interface ActivityBarProps extends Pick<HealingPlaceProps, "member"> {
  ctx: HealingWorldContext;
}

/** What this zone offers; a button walks the character to the matching prop. */
function ActivityBar({ ctx, member }: ActivityBarProps) {
  const allowed = activitiesInScene(ctx.sceneId).map(findActivity);
  const current = ctx.activity ?? "rest";
  const label = findActivity(current).name;
  return (
    <div className="flex w-fit max-w-full flex-wrap items-end gap-4 rounded-2xl bg-black/35 p-3 backdrop-blur-md">
      <div className="relative flex flex-col items-center gap-1" data-testid="healing-avatar" data-activity={current}>
        <span aria-hidden className={cn("absolute -right-2 top-0 z-10 text-2xl drop-shadow", styles.prop)}>{findActivity(current).emoji}</span>
        <span
          className={cn("flex size-16 items-center justify-center rounded-full border-4 bg-white text-4xl shadow-lg", styles.avatar)}
          style={{ borderColor: member?.color ?? "#ffffff" }}
          aria-hidden
        >
          {member?.avatar ?? "🙂"}
        </span>
        <span aria-hidden className="-mt-2 h-2 w-12 rounded-full bg-black/40 blur-[2px]" />
        <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs">{member?.name ?? "나"} · {label}</span>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="할 일 고르기">
        {allowed.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={current === item.id}
            data-testid={`healing-activity-${item.id}`}
            onClick={() => ctx.walkTo(item.id)}
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
  return (
    <HealingOverlay inline onClose={onBack}>
      {(ctx) => <ActivityBar ctx={ctx} member={member} />}
    </HealingOverlay>
  );
}

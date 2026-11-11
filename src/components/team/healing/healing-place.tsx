"use client";

import type { TeamMember } from "@/lib/team/workspace";
import { HealingOverlay } from "./healing-overlay";

interface HealingPlaceProps {
  member: Pick<TeamMember, "avatar" | "color" | "name"> | null;
  /** Close handler for the large inline view; the compact garage window is always open. */
  onBack?: () => void;
  /** Small always-open window in the garage side column. */
  compact?: boolean;
}

const stay = () => undefined;

/** Healing walk inside the page (not a modal); compact = always-open small window in the garage side column. */
export function HealingPlace({ member, onBack, compact = false }: HealingPlaceProps) {
  return (
    <HealingOverlay inline compact={compact} onClose={onBack ?? stay}>
      {(ctx) => (
        <span className="block truncate rounded-full bg-black/50 px-2 py-0.5 text-xs" data-testid="healing-avatar" data-activity={ctx.activity}>
          {ctx.caption} · {member?.name ?? "나"}
        </span>
      )}
    </HealingOverlay>
  );
}

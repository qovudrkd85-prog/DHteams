import { characterLook } from "@/lib/team/healing-view";
import styles from "./healing.module.css";

/** walk-front is used while walking back toward the camera (↓). */
export type HealingPose = "walk-back" | "stand-back" | "sit-back" | "walk-side" | "walk-front";
export type HealingHand = "none" | "rod" | "mug";

export interface HealingCharacterProps {
  member: { avatar: string; name: string; color: string };
  pose: HealingPose;
  /** walk-side: 1 = facing right, -1 = left. sit-back: which side the rod points to. */
  facing?: 1 | -1;
  /** What the hands hold while sitting. */
  hand?: HealingHand;
  className?: string;
}

const PANTS = "#526375";
const SHOES = "#354346";
const OUTLINE = "#23403530";

/** The trail walker: same person as the office character (characterLook), seen from behind. Feet at (0,0). */
export function HealingCharacter({ member, pose, facing = 1, hand = "none", className }: HealingCharacterProps) {
  const look = characterLook(member.avatar, member.name);
  const walking = pose === "walk-back" || pose === "walk-side" || pose === "walk-front";
  return <svg viewBox="-70 -150 140 160" className={className} aria-hidden="true" data-pose={pose} overflow="visible">
    <ellipse cy="2" rx={pose === "sit-back" ? 30 : 22} ry="7" fill="#1c413530" />
    <g className={walking ? styles.hcWalk : styles.hcBreath}>
      {pose === "sit-back" && <SitBack color={member.color} skin={look.skin} hair={look.hair} hand={hand} facing={facing} />}
      {pose === "walk-side" && <g transform={`scale(${facing} 1)`}><Side color={member.color} skin={look.skin} hair={look.hair} glasses={look.glasses} /></g>}
      {(pose === "walk-back" || pose === "stand-back" || pose === "walk-front") && <Upright pose={pose} color={member.color} look={look} />}
    </g>
  </svg>;
}

function Legs({ moving }: { moving: boolean }) {
  return <>
    <g className={moving ? styles.hcStepA : undefined}><path d="M-9-24v20" stroke={PANTS} strokeWidth="12" strokeLinecap="round" /><ellipse cx="-10" cy="-1" rx="8" ry="5" fill={SHOES} /></g>
    <g className={moving ? styles.hcStepB : undefined}><path d="M9-24v20" stroke={PANTS} strokeWidth="12" strokeLinecap="round" /><ellipse cx="10" cy="-1" rx="8" ry="5" fill={SHOES} /></g>
  </>;
}

function Upright({ pose, color, look }: { pose: HealingPose; color: string; look: ReturnType<typeof characterLook> }) {
  const moving = pose !== "stand-back";
  const front = pose === "walk-front";
  return <>
    <Legs moving={moving} />
    <g className={moving ? styles.hcArmA : undefined}><path d="M-18-52l-7 24" stroke={color} strokeWidth="10" strokeLinecap="round" /><circle cx="-25" cy="-26" r="5" fill={look.skin} /></g>
    <g className={moving ? styles.hcArmB : undefined}><path d="M18-52l7 24" stroke={color} strokeWidth="10" strokeLinecap="round" /><circle cx="25" cy="-26" r="5" fill={look.skin} /></g>
    <path d="M-18-54q18-12 36 0l3 30q-21 9-42 0z" fill={color} stroke={OUTLINE} strokeWidth="2" />
    {/* Back seam and collar shading so the back reads as a back. */}
    {!front && <path d="M0-60v32M-9-58q9 5 18 0" stroke="#00000018" strokeWidth="2" fill="none" />}
    <rect x="-6" y="-66" width="12" height="13" rx="5" fill={look.skin} />
    <ellipse cy="-80" rx="20" ry="22" fill={look.hair} />
    {front ? <g>
      <ellipse cy="-74" rx="17" ry="18" fill={look.skin} />
      <path d={look.hairStyle ? "M-19-76q-4-28 19-26 24 0 20 29L11-90Q0-80-13-88z" : "M-19-76q-3-30 22-26 21 3 16 28L10-90 3-83-6-91-13-86z"} fill={look.hair} />
      <ellipse cx="-6" cy="-74" rx="2" ry="3" fill="#433e36" /><ellipse cx="6" cy="-74" rx="2" ry="3" fill="#433e36" />
      <path d="M-4-65q4 4 8 0" fill="none" stroke="#a66d5a" strokeWidth="1.5" strokeLinecap="round" />
      {look.glasses && <g fill="none" stroke="#4d5350" strokeWidth="1.4"><rect x="-13" y="-79" width="10" height="8" rx="3" /><rect x="3" y="-79" width="10" height="8" rx="3" /><path d="M-3-75h6" /></g>}
    </g> : <g>
      {/* Ears peeking out and a crown highlight; no face from behind. */}
      <ellipse cx="-19" cy="-74" rx="3" ry="5" fill={look.skin} /><ellipse cx="19" cy="-74" rx="3" ry="5" fill={look.skin} />
      <path d="M-14-63q14 6 28 0" stroke="#00000020" strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>}
    <path d="M-10-94q8-7 18-4" fill="none" stroke="#ffffff30" strokeWidth="3" strokeLinecap="round" />
  </>;
}

function Side({ color, skin, hair, glasses }: { color: string; skin: string; hair: string; glasses: boolean }) {
  return <>
    <g className={styles.hcSwingA}><path d="M-2-24v20" stroke={PANTS} strokeWidth="12" strokeLinecap="round" /><ellipse cx="3" cy="-1" rx="9" ry="5" fill={SHOES} /></g>
    <g className={styles.hcSwingB}><path d="M2-24v20" stroke="#4a596a" strokeWidth="12" strokeLinecap="round" /><ellipse cx="7" cy="-1" rx="9" ry="5" fill="#2c383a" /></g>
    <path d="M-12-54q12-9 24 0l2 30q-14 7-28 0z" fill={color} stroke={OUTLINE} strokeWidth="2" />
    <g className={styles.hcArmA}><path d="M0-50l3 24" stroke={color} strokeWidth="10" strokeLinecap="round" /><circle cx="3" cy="-25" r="5" fill={skin} /></g>
    <rect x="-5" y="-66" width="11" height="13" rx="5" fill={skin} />
    <ellipse cx="2" cy="-78" rx="17" ry="19" fill={skin} />
    <path d="M-16-74q-3-28 18-26 18 1 17 14l-14 2-6 8z" fill={hair} />
    <ellipse cx="11" cy="-77" rx="2" ry="3" fill="#433e36" />
    <path d="M14-67q-3 2-6 1" fill="none" stroke="#a66d5a" strokeWidth="1.5" strokeLinecap="round" />
    {glasses && <rect x="6" y="-82" width="10" height="8" rx="3" fill="none" stroke="#4d5350" strokeWidth="1.4" />}
  </>;
}

function SitBack({ color, skin, hair, hand, facing }: { color: string; skin: string; hair: string; hand: HealingHand; facing: 1 | -1 }) {
  return <g transform="translate(0 4)">
    {/* Seat edge, knees tucked in front (hidden), arms reaching forward. */}
    <rect x="-24" y="-12" width="48" height="8" rx="3" fill={PANTS} />
    <ellipse cx="-14" cy="-6" rx="9" ry="6" fill={PANTS} /><ellipse cx="14" cy="-6" rx="9" ry="6" fill={PANTS} />
    <path d="M-18-40q18-12 36 0l3 30q-21 8-42 0z" fill={color} stroke={OUTLINE} strokeWidth="2" />
    <path d="M0-46v32" stroke="#00000018" strokeWidth="2" />
    <path d="M-18-38l-4 16M18-38l2 14" stroke={color} strokeWidth="10" strokeLinecap="round" />
    <rect x="-6" y="-52" width="12" height="13" rx="5" fill={skin} />
    <ellipse cy="-66" rx="20" ry="22" fill={hair} />
    <ellipse cx="-19" cy="-60" rx="3" ry="5" fill={skin} /><ellipse cx="19" cy="-60" rx="3" ry="5" fill={skin} />
    <path d="M-10-80q8-7 18-4" fill="none" stroke="#ffffff30" strokeWidth="3" strokeLinecap="round" />
    {hand === "rod" && <g transform={`scale(${facing} 1)`}><g className={styles.hcRod}>
      <path d="M14-26L66-118" stroke="#6e5340" strokeWidth="3" strokeLinecap="round" />
      <circle cx="18" cy="-31" r="4" fill="#3d3d3d" />
      <path d="M66-118Q74-80 78-40" stroke="#ffffffaa" strokeWidth="1" fill="none" />
      <g className={styles.hcBobber}><rect x="75" y="-42" width="6" height="8" rx="2" fill="#e05a4a" /><rect x="75" y="-38" width="6" height="4" fill="#fff8e8" /></g>
    </g></g>}
    {hand === "mug" && <g><rect x="12" y="-30" width="11" height="12" rx="2" fill="#fff8e8" /><path d="M23-27q5 3 0 6" stroke="#fff8e8" strokeWidth="2" fill="none" /></g>}
  </g>;
}

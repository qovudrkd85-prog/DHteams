import type { TeamMember, TeamPresence } from "@/lib/team/workspace";
import styles from "./office.module.css";

export function StatusBubble({ message, y = -90, x = 0 }: { message?: string; y?: number; x?: number }) {
  if (!message) return null;
  const chars = Array.from(message);
  const lines = Array.from({ length: Math.ceil(chars.length / 14) }, (_, i) => chars.slice(i * 14, i * 14 + 14).join(""));
  const width = Math.max(74, Math.min(210, chars.length * 13 + 24));
  const height = lines.length * 18 + 16;
  return <g transform={`translate(${x} ${y})`} pointerEvents="none" data-testid="office-status-bubble">
    <path d="M-6 0L0 8 6 0" fill="#fffdf5" stroke="#d8d7c2" />
    <rect x={-width / 2} y={-height} width={width} height={height} rx="12" fill="#fffdf5" stroke="#d8d7c2" />
    <text textAnchor="middle" fill="#354c42" fontSize="12" fontWeight="500">{lines.map((line, i) => <tspan x="0" y={-height + 20 + i * 18} key={i}>{line}</tspan>)}</text>
  </g>;
}

export function WalkingCharacter({ member, presence, roomWidth, own = false, moving = false, working = false }: {
  member: TeamMember; presence: TeamPresence; roomWidth: number; own?: boolean; moving?: boolean; working?: boolean;
}) {
  const seed = Array.from(member.avatar + member.name).reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0);
  const skin = ["#efc8a6", "#ddb18f", "#bc896b", "#f2d6bd"][seed % 4];
  const hair = ["#4f4038", "#76604b", "#353d3b", "#916647"][Math.floor(seed / 3) % 4];
  const back = presence.facing === "up";
  const side = presence.facing === "left" ? -4 : presence.facing === "right" ? 4 : 0;
  return <g transform={`translate(${presence.x} ${presence.y})`} pointerEvents="none"
    data-testid={own ? "office-player" : `office-walker-${member.id}`} data-x={presence.x} data-y={presence.y}
    data-room-id={presence.layout_id} data-motion={presence.motion} data-facing={presence.facing}>
    <ellipse cy="3" rx="23" ry="8" fill="#1c413528" />
    {own && <ellipse cy="3" rx="28" ry="12" fill="none" stroke="#397f68" strokeWidth="2" strokeDasharray="4 4" />}
    <g className={moving ? styles.walking : undefined}>
      <g className={styles.leftLeg}><path d="M-9-20v18" stroke="#526375" strokeWidth="12" strokeLinecap="round" /><ellipse cx="-10" cy="0" rx="9" ry="5" fill="#354346" /></g>
      <g className={styles.rightLeg}><path d="M9-20v18" stroke="#526375" strokeWidth="12" strokeLinecap="round" /><ellipse cx="10" cy="0" rx="9" ry="5" fill="#354346" /></g>
      <path d="M-18-47l-8 22M18-47l8 22" stroke={member.color} strokeWidth="10" strokeLinecap="round" />
      <circle cx="-26" cy="-23" r="5" fill={skin} /><circle cx="26" cy="-23" r="5" fill={skin} />
      <path d="M-18-49q18-12 36 0l3 28q-21 9-42 0z" fill={member.color} stroke="#23403530" strokeWidth="2" />
      <path d="M-10-46q10 7 20 0" stroke="#ffffff75" strokeWidth="2" fill="none" />
      <rect x="-6" y="-61" width="12" height="14" rx="5" fill={skin} />
      <ellipse cx={side} cy="-74" rx="21" ry="23" fill={hair} />
      {!back && <g transform={`translate(${side} 0)`}>
        <ellipse cy="-68" rx="18" ry="19" fill={skin} />
        <path d={seed % 2 ? "M-20-70q-4-29 20-27 25 0 21 30L12-85Q0-74-14-83z" : "M-20-70q-3-31 23-27 22 3 17 29L11-85 3-78-6-86-14-81z"} fill={hair} />
        <ellipse cx="-7" cy="-68" rx="2" ry="3" fill="#433e36" /><ellipse cx="7" cy="-68" rx="2" ry="3" fill="#433e36" />
        <path d="M-4-59q4 4 8 0" fill="none" stroke="#a66d5a" strokeWidth="1.5" strokeLinecap="round" />
        <ellipse cx="-12" cy="-62" rx="3" ry="2" fill="#d3867860" /><ellipse cx="12" cy="-62" rx="3" ry="2" fill="#d3867860" />
        {seed % 4 === 1 && <g fill="none" stroke="#4d5350" strokeWidth="1.4"><rect x="-14" y="-73" width="11" height="9" rx="3" /><rect x="3" y="-73" width="11" height="9" rx="3" /><path d="M-3-69h6" /></g>}
      </g>}
      <path d="M-10-88q8-7 18-4" fill="none" stroke="#ffffff25" strokeWidth="3" strokeLinecap="round" />
    </g>
    <rect x="-52" y="16" width="104" height="24" rx="12" fill={own ? "#365f50" : "#fffdf4"} stroke="#d4ddce" />
    <text x="0" y="32" textAnchor="middle" fontSize="11" fontWeight="600" fill={own ? "#fff" : "#405a4c"}>{member.name.length > 7 ? `${member.name.slice(0, 7)}…` : member.name}{own ? " · 나" : ""}</text>
    <circle cx="25" cy="-85" r="6" fill={working ? "#55a780" : "#acafa3"} stroke="#fffdf4" strokeWidth="2" />
    <StatusBubble message={member.status_message} y={presence.y < 215 ? 175 : -108} x={Math.max(110 - presence.x, Math.min(roomWidth - 110 - presence.x, 0))} />
  </g>;
}

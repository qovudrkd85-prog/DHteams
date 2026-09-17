import type { OfficeLayout } from "@/lib/team/workspace";
import { roomPortals } from "@/lib/team/world";
import styles from "./office.module.css";

export function WorldArt({ width, height, kind, patternId, editing }: { width: number; height: number; kind?: OfficeLayout["room_kind"]; patternId: string; editing: boolean }) {
  const outdoor = kind === "outdoor";
  return <g pointerEvents="none">
    <defs>
      <pattern id={`${patternId}floor`} width="100" height="40" patternUnits="userSpaceOnUse"><path d="M0 40H100M50 0V40" fill="none" stroke="var(--floor-line)" strokeWidth="1" /></pattern>
      <pattern id={`${patternId}grid`} width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="1" fill="#59796735" /></pattern>
      <pattern id={`${patternId}grass`} width="48" height="48" patternUnits="userSpaceOnUse"><path d="M8 18l2-4 2 4M32 38l2-4 2 4" stroke="#8db080" fill="none" /></pattern>
    </defs>
    <rect x="8" y="8" width={width - 16} height={height - 16} rx="26" fill={outdoor ? "#adc99c" : "var(--wall)"} />
    <rect x="24" y="46" width={width - 48} height={height - 70} rx="12" fill={outdoor ? `url(#${patternId}grass)` : "var(--floor)"} stroke={outdoor ? "#91af82" : "var(--floor-edge)"} strokeWidth="2" />
    {outdoor ? <>
      <path d={`M${width / 2} ${height}V500M110 500H${width - 110}`} stroke="#e4dcc1" strokeWidth="110" fill="none" strokeLinejoin="round" />
      <path d={`M${width / 2} ${height}V500M110 500H${width - 110}`} stroke="#cdbf9c" strokeWidth="2" strokeDasharray="6 12" fill="none" />
      {[120, width - 120].flatMap((x) => [680, height - 130].map((y) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}><ellipse cy="18" rx="60" ry="20" fill="#55754725" /><rect x="-9" y="-45" width="18" height="68" rx="5" fill="#9e7958" /><circle cy="-66" r="47" fill="#709465" /><circle cx="-23" cy="-72" r="28" fill="#86a977" /><circle cx="18" cy="-85" r="32" fill="#96b982" /></g>))}
      <g transform={`translate(${width / 2 + 230} 770)`}><ellipse rx="96" ry="62" fill="#c6c9b0" /><ellipse cy="-8" rx="83" ry="51" fill="#97c8c5" /><ellipse cy="-10" rx="53" ry="29" fill="none" stroke="#d9eeeb" strokeWidth="4" /><path d="M0-65v50" stroke="#e4f2e9" strokeWidth="7" /><ellipse cy="-67" rx="26" ry="9" fill="#b9d5ca" /></g>
      <text x={width / 2} y="650" textAnchor="middle" fontSize="19" letterSpacing="5" fill="#728b67">TAKE A LITTLE WALK</text>
    </> : <>
      <rect x="24" y="46" width={width - 48} height={height - 70} fill={`url(#${patternId}floor)`} />
      {Array.from({ length: Math.floor(width / 280) }, (_, i) => <g key={i} transform={`translate(${90 + i * 280} 18)`}><rect width="164" height="28" rx="5" fill="#fafcf0" stroke="#a9bdb0" strokeWidth="2" /><rect x="5" y="5" width="154" height="17" rx="2" fill="#bbdad7" /><path d="M55 3v22M110 3v22" stroke="#fafcf0" strokeWidth="4" /><path d="M5 28h154l115 200H120z" fill="#fffdf022" /></g>)}
      <rect x="125" y="110" width={Math.min(560, width * .45)} height={Math.min(460, height * .6)} rx="35" fill="var(--rug)" opacity=".65" />
      <rect x={width - 390} y={height - 250} width="280" height="130" rx="45" fill="var(--lounge-rug)" opacity=".6" />
      <text x={width - 250} y={height - 275} textAnchor="middle" fontSize="13" letterSpacing="4" fill="var(--room-text)">{kind === "cafe" ? "COFFEE & CONVERSATION" : "MAKE GOOD THINGS"}</text>
      {kind === "cafe" && <g transform={`translate(${width - 270} 175)`}><rect x="-160" y="-65" width="320" height="145" rx="15" fill="#a97d58" /><rect x="-160" y="-75" width="320" height="120" rx="15" fill="#d0ae80" stroke="#b68a60" strokeWidth="3" /><rect x="-110" y="-57" width="75" height="60" rx="7" fill="#61766c" /><rect x="-98" y="-48" width="51" height="25" rx="3" fill="#b8d1c2" />{[15, 65, 115].map((x) => <g key={x}><circle cx={x} cy="-20" r="16" fill="#fff9e8" /><circle cx={x} cy="-20" r="10" fill="#8e6345" /></g>)}<text y="115" textAnchor="middle" fill="#7d644b" fontSize="17" letterSpacing="4">OUR LITTLE CAFÉ</text></g>}
    </>}
    {editing && <rect x="24" y="46" width={width - 48} height={height - 70} fill={`url(#${patternId}grid)`} />}
  </g>;
}

export function WorldPortals({ room, rooms, onTravel, disabled }: { room: OfficeLayout | null; rooms: OfficeLayout[]; onTravel: (id: string) => void; disabled: boolean }) {
  return <>{roomPortals(room, rooms).map(({ destination, x, y }) => <g key={destination.id} transform={`translate(${x} ${y})`} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={`${destination.name}(으)로 이동`} data-testid={`portal-${destination.room_key}`} className={styles.portal} onClick={() => { if (!disabled) onTravel(destination.id); }} onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); onTravel(destination.id); } }}>
    <rect x={room?.room_kind === "outdoor" ? -145 : -90} y={room?.room_kind === "outdoor" ? -292 : -20} width={room?.room_kind === "outdoor" ? 290 : 180} height={room?.room_kind === "outdoor" ? 350 : 80} fill="transparent" pointerEvents="all" />
    {room?.room_kind === "outdoor" && <g pointerEvents="none"><rect x="-132" y="-220" width="264" height="235" rx="13" fill="#64765820" /><rect x="-130" y="-235" width="260" height="228" rx="10" fill={destination.room_kind === "cafe" ? "#e8cfaa" : "#ecead9"} stroke="#b8bd9f" strokeWidth="3" /><path d="M-145-225L0-292l145 67z" fill={destination.room_kind === "cafe" ? "#b98262" : "#698c7a"} stroke="#567662" strokeWidth="3" />{[-80, 80].map((cx) => <g key={cx}><rect x={cx - 25} y="-172" width="50" height="65" rx="4" fill="#a7d0cf" stroke="#fff8e8" strokeWidth="5" /><path d={`M${cx} -170v60`} stroke="#fff8e8" strokeWidth="3" /></g>)}<rect x="-29" y="-88" width="58" height="80" rx="5" fill="#7c9888" /><rect x="-23" y="-82" width="46" height="40" rx="2" fill="#b5d5cd" /><circle cx="17" cy="-28" r="3" fill="#f7e4ae" /><rect x="-111" y="-210" width="222" height="29" rx="5" fill="#fffaf0" /><text y="-190" textAnchor="middle" fontSize="14" fontWeight="600" fill="#4e6657">{destination.name}</text><path d="M0 18v82" stroke="#e4dcc1" strokeWidth="55" /></g>}
    <ellipse cy="3" rx="55" ry="22" fill="#70998730" stroke="#5d927b" strokeWidth="2" strokeDasharray="5 5" />
    <rect x="-90" y="26" width="180" height="32" rx="16" fill="#fffdf1" stroke="#c2cfb9" />
    <text y="47" textAnchor="middle" fontSize="12" fontWeight="600" fill="#466450">{destination.name} ↗</text>
  </g>)}</>;
}

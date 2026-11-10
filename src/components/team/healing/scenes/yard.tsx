import type { SceneArtProps } from "./index";

// Hub yard: a grassy rest garden with six gates along the back fence.
// Walkable: 80,560,1440,300. Gates sit around the portal rects (x, 560, 140, 90); bench rect 720,760,160,80 stays empty.

type Tone = { sky: string; band: string; hillFar: string; hillNear: string; grass: string; grassAlt: string; shade: string; shadeOpacity: number };

function tone(isDay: boolean, effect: SceneArtProps["effect"]): Tone {
  const dull = effect !== "clear";
  if (!isDay) return { sky: dull ? "#1a2233" : "#1d2946", band: dull ? "#273142" : "#2c3d63", hillFar: "#3f5466", hillNear: "#4b6650", grass: "#7f9a74", grassAlt: "#75906b", shade: "#0f1a33", shadeOpacity: dull ? 0.5 : 0.38 };
  return { sky: dull ? "#aebfc7" : "#bfe3ef", band: dull ? "#c6d2d7" : "#dff1f6", hillFar: dull ? "#93a9a3" : "#9dc0b4", hillNear: dull ? "#829c7c" : "#8db080", grass: "#adc99c", grassAlt: "#a3c192", shade: "#5a6a78", shadeOpacity: dull ? 0.16 : 0 };
}

const GATES = [
  { x: 130, roof: "#7fb3c4", post: "#b48a62" },
  { x: 370, roof: "#6f9f8e", post: "#b48a62" },
  { x: 610, roof: "#7f9f6a", post: "#8a6647" },
  { x: 850, roof: "#a8a395", post: "#8e8a7f" },
  { x: 1090, roof: "#d9823b", post: "#7a5a3c" },
  { x: 1330, roof: "#dbe7ee", post: "#6e5340" },
];

const STARS = [120, 310, 520, 760, 940, 1180, 1420, 1540, 260, 680, 1300];

function Cloud({ x, y, c }: { x: number; y: number; c: string }) {
  return <g fill={c}><rect x={x} y={y + 32} width={192} height={32} /><rect x={x + 32} y={y} width={96} height={32} /><rect x={x + 96} y={y - 24} width={64} height={24} /></g>;
}

function Tree({ x, y }: { x: number; y: number }) {
  return <g><rect x={x - 12} y={y - 96} width={24} height={96} fill="#9e7958" /><rect x={x - 64} y={y - 160} width={128} height={64} fill="#709465" /><rect x={x - 48} y={y - 224} width={96} height={64} fill="#86a977" /><rect x={x - 24} y={y - 272} width={48} height={48} fill="#96b982" /></g>;
}

function Gate({ x, roof, post }: { x: number; roof: string; post: string }) {
  return <g>
    <rect x={x - 24} y={472} width={24} height={178} fill={post} />
    <rect x={x + 140} y={472} width={24} height={178} fill={post} />
    <rect x={x - 32} y={440} width={204} height={32} fill={post} />
    <rect x={x - 40} y={408} width={220} height={32} fill={roof} />
    <rect x={x + 20} y={376} width={100} height={32} fill={roof} />
    <rect x={x + 32} y={452} width={76} height={14} fill="#fff8e8" />
    <rect x={x} y={560} width={140} height={90} fill="#e4dcc1" />
    <rect x={x} y={646} width={140} height={4} fill="#cdbf9c" />
  </g>;
}

export function YardArt({ isDay, effect }: SceneArtProps) {
  const t = tone(isDay, effect);
  const cloud = isDay ? (effect === "clear" ? "#ffffff" : "#d8e0e3") : "#2f3d5a";
  return <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <rect width="1600" height="900" fill={t.sky} />
    <rect y="320" width="1600" height="160" fill={t.band} />
    {isDay
      ? <rect x="1320" y="96" width="80" height="80" fill={effect === "clear" ? "#f7e4ae" : "#e9e3cf"} />
      : <g><rect x="1320" y="96" width="72" height="72" fill="#f3f0dc" /><rect x="1352" y="96" width="40" height="40" fill={t.sky} /></g>}
    {!isDay && <g fill="#fff8e8">
      {STARS.map((x, i) => <rect key={x} x={x} y={40 + ((i * 53) % 220)} width="6" height="6" />)}
      <animate attributeName="opacity" values="1;0.45;1" dur="3.2s" repeatCount="indefinite" />
    </g>}
    <Cloud x={160} y={120} c={cloud} />
    <Cloud x={700} y={180} c={cloud} />
    <Cloud x={1050} y={90} c={cloud} />
    {/* Far and near hills as stepped blocks */}
    <g fill={t.hillFar}>
      <rect y="400" width="1600" height="100" /><rect x="40" y="368" width="320" height="32" /><rect x="120" y="336" width="160" height="32" />
      <rect x="560" y="352" width="420" height="48" /><rect x="680" y="320" width="200" height="32" /><rect x="1180" y="360" width="360" height="40" /><rect x="1280" y="328" width="160" height="32" />
    </g>
    <g fill={t.hillNear}>
      <rect y="456" width="1600" height="104" /><rect x="300" y="424" width="400" height="32" /><rect x="400" y="400" width="200" height="24" />
      <rect x="900" y="432" width="500" height="24" /><rect x="1000" y="408" width="300" height="24" />
    </g>
    {/* Back fence */}
    <rect x="48" y="520" width="1504" height="12" fill="#e4dcc1" />
    <rect x="48" y="544" width="1504" height="10" fill="#e4dcc1" />
    {Array.from({ length: 24 }, (_, i) => <rect key={i} x={48 + i * 64} y="504" width="14" height="56" fill="#d6ccad" />)}
    {/* Ground */}
    <rect y="560" width="1600" height="300" fill={t.grass} />
    {Array.from({ length: 25 }, (_, i) => <rect key={i} x={i * 64} y={560 + (i % 2) * 64} width="64" height="64" fill={t.grassAlt} />)}
    {Array.from({ length: 25 }, (_, i) => <rect key={i} x={i * 64} y={752 - (i % 2) * 64} width="64" height="64" fill={t.grassAlt} />)}
    <rect y="860" width="1600" height="40" fill="#8da57a" />
    {/* Sand path linking the gates and the bench */}
    <rect x="80" y="680" width="1440" height="56" fill="#e4dcc1" />
    <rect x="80" y="732" width="1440" height="4" fill="#cdbf9c" />
    {GATES.map((g) => <rect key={g.x} x={g.x + 38} y="650" width="64" height="30" fill="#e4dcc1" />)}
    <rect x="768" y="736" width="64" height="24" fill="#e4dcc1" />
    {GATES.map((g) => <Gate key={g.x} {...g} />)}
    <Tree x={40} y={560} />
    <Tree x={1560} y={560} />
    <g fill="#f3c6c1"><rect x="96" y="840" width="12" height="12" /><rect x="1480" y="848" width="12" height="12" /><rect x="300" y="856" width="12" height="12" /></g>
    {t.shadeOpacity > 0 && <rect width="1600" height="900" fill={t.shade} opacity={t.shadeOpacity} />}
  </svg>;
}

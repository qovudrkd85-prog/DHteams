import type { SceneArtProps } from "./index";

// Daytime rooftop: concrete slab (walkable 80,520,1440,340) ringed by a parapet, city blocks behind.
// Empty prop rects: smoke 1320,550,120,100 · laptop 420,570,160,100 · bench 820,760,160,80. Portal to-yard 90,775,140,90 sits below the stair hut door.

type Tone = { sky: string; band: string; far: string; near: string; window: string; slab: string; line: string; wall: string; cap: string; shade: string; shadeOpacity: number };

function tone(isDay: boolean, effect: SceneArtProps["effect"]): Tone {
  const dull = effect !== "clear";
  if (!isDay) return { sky: dull ? "#161c2b" : "#1a2340", band: dull ? "#202839" : "#233052", far: "#2a3042", near: "#333a50", window: "#f7e4ae", slab: "#5b5e6e", line: "#4e5160", wall: "#6e717f", cap: "#7c7f8d", shade: "#0f1a33", shadeOpacity: dull ? 0.4 : 0.2 };
  return { sky: dull ? "#aebfc7" : "#bfe3ef", band: dull ? "#c6d2d7" : "#dff1f6", far: dull ? "#9aa6ad" : "#a9bcc6", near: dull ? "#7f8a94" : "#8b9aa6", window: dull ? "#c7d2d6" : "#d8e8ec", slab: "#b9b4a6", line: "#aaa597", wall: "#d6d0c0", cap: "#e4dcc1", shade: "#5a6a78", shadeOpacity: dull ? 0.16 : 0 };
}

const FAR = [[0, 200, 300], [220, 120, 220], [380, 260, 340], [700, 180, 260], [920, 300, 380], [1260, 140, 240], [1440, 200, 320]];
const NEAR = [[60, 160, 170], [330, 220, 210], [640, 150, 150], [860, 260, 230], [1200, 180, 190], [1480, 140, 130]];
const STARS = [110, 300, 540, 760, 980, 1150, 1380, 1520, 420, 1290];

function Cloud({ x, y, c }: { x: number; y: number; c: string }) {
  return <g fill={c}><rect x={x} y={y + 32} width={192} height={32} /><rect x={x + 32} y={y} width={96} height={32} /><rect x={x + 96} y={y - 24} width={64} height={24} /></g>;
}

function Building({ x, w, h, c, win }: { x: number; w: number; h: number; c: string; win: string }) {
  const cols = Math.floor((w - 16) / 40);
  const rows = Math.floor((h - 24) / 48);
  return <g>
    <rect x={x} y={470 - h} width={w} height={h} fill={c} />
    {Array.from({ length: cols * rows }, (_, i) => <rect key={i} x={x + 16 + (i % cols) * 40} y={470 - h + 20 + Math.floor(i / cols) * 48} width="20" height="24" fill={win} />)}
  </g>;
}

export function RooftopArt({ isDay, effect }: SceneArtProps) {
  const t = tone(isDay, effect);
  const cloud = isDay ? (effect === "clear" ? "#ffffff" : "#d8e0e3") : "#2f3d5a";
  return <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <rect width="1600" height="900" fill={t.sky} />
    <rect y="260" width="1600" height="210" fill={t.band} />
    {isDay
      ? <rect x="200" y="70" width="84" height="84" fill={effect === "clear" ? "#f7e4ae" : "#e9e3cf"} />
      : <g><rect x="200" y="70" width="72" height="72" fill="#f3f0dc" /><rect x="232" y="70" width="40" height="40" fill={t.sky} /></g>}
    {!isDay && <g fill="#fff8e8">
      {STARS.map((x, i) => <rect key={x} x={x} y={24 + ((i * 43) % 130)} width="6" height="6" />)}
      <animate attributeName="opacity" values="1;0.4;1" dur="3.5s" repeatCount="indefinite" />
    </g>}
    <Cloud x={520} y={90} c={cloud} />
    <Cloud x={1140} y={40} c={cloud} />
    {FAR.map(([x, w, h]) => <Building key={x} x={x} w={w} h={h} c={t.far} win={isDay ? t.window : "#3b4460"} />)}
    {NEAR.map(([x, w, h]) => <Building key={x} x={x} w={w} h={h} c={t.near} win={t.window} />)}
    {/* Outer building faces beyond the parapet */}
    <rect y="520" width="40" height="380" fill={t.near} />
    <rect x="1560" y="520" width="40" height="380" fill={t.near} />
    {/* Slab with tile lines */}
    <rect x="80" y="520" width="1440" height="340" fill={t.slab} />
    {Array.from({ length: 22 }, (_, i) => <rect key={i} x={144 + i * 64} y="520" width="2" height="340" fill={t.line} />)}
    {Array.from({ length: 5 }, (_, i) => <rect key={i} x="80" y={584 + i * 64} width="1440" height="2" fill={t.line} />)}
    <rect x="1440" y="800" width="40" height="40" fill={t.line} />
    {/* Parapet: back, sides, front */}
    <rect x="40" y="472" width="1520" height="48" fill={t.wall} />
    <rect x="40" y="456" width="1520" height="16" fill={t.cap} />
    <rect x="40" y="456" width="40" height="444" fill={t.wall} />
    <rect x="1520" y="456" width="40" height="444" fill={t.wall} />
    <rect x="40" y="860" width="1520" height="40" fill={t.wall} />
    <rect x="40" y="860" width="1520" height="12" fill={t.cap} />
    {/* Planters on the back parapet */}
    {[520, 600, 1000].map((x) => <g key={x}><rect x={x} y="424" width="56" height="32" fill="#c96a5a" /><rect x={x + 8} y="396" width="40" height="28" fill="#709465" /><rect x={x + 20} y="376" width="16" height="20" fill="#86a977" /></g>)}
    {/* Water tank on legs at the back right */}
    <g><rect x="1408" y="470" width="12" height="70" fill="#767670" /><rect x="1484" y="470" width="12" height="70" fill="#767670" /><rect x="1400" y="380" width="104" height="90" fill="#c9c4b4" /><rect x="1400" y="420" width="104" height="8" fill="#a8a395" /><rect x="1416" y="356" width="72" height="24" fill="#a8a395" /><rect x="1440" y="340" width="24" height="16" fill="#8e8a7f" /></g>
    {/* Vent pipe with drifting smoke blocks */}
    <rect x="1180" y="400" width="24" height="56" fill="#767670" />
    <rect x="1172" y="392" width="40" height="12" fill="#8e8a7f" />
    <g fill="#e4dcc1">
      <rect x="1184" y="364" width="16" height="16" /><rect x="1196" y="336" width="20" height="20" /><rect x="1180" y="304" width="24" height="24" />
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -70" dur="3s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.9;0" dur="3s" repeatCount="indefinite" />
    </g>
    {/* Stair hut: the yard portal rect 90,775,140,90 is the slab in front of its door */}
    <rect x="70" y="660" width="180" height="115" fill={t.wall} />
    <rect x="62" y="644" width="196" height="16" fill="#8e8a7f" />
    <rect x="120" y="690" width="80" height="85" fill="#4e5160" />
    <rect x="128" y="698" width="64" height="30" fill="#b5d5cd" />
    <rect x="176" y="600" width="64" height="44" fill="#a8a395" />
    <rect x="192" y="608" width="32" height="28" fill="#767670" />
    <rect x="90" y="775" width="140" height="6" fill={t.line} />
    {t.shadeOpacity > 0 && <rect width="1600" height="900" fill={t.shade} opacity={t.shadeOpacity} />}
  </svg>;
}

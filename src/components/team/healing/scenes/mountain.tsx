import type { SceneArtProps } from "./index";

// Mountain trail: four terraces climbing to the summit, joined by stairs in the overlap bands.
// Terraces (walkable): T1 100,740,1400,140 · T2 700,560,800,200 · T3 300,380,800,200 · T4 500,220,500,180.
// Empty prop rects: hike-1 1140,605,120,90 · hike-2 540,425,120,90 · hike-3 690,250,140,100. Portal to-yard 90,795,140,90 is the trailhead gate.

type Tone = { sky: string; band: string; peak: string; slope: string; slopeAlt: string; rock: string; shade: string; shadeOpacity: number };

function tone(isDay: boolean, effect: SceneArtProps["effect"]): Tone {
  const dull = effect !== "clear";
  if (!isDay) return { sky: dull ? "#1a2233" : "#1d2946", band: dull ? "#263040" : "#2c3d63", peak: "#2a3a52", slope: "#4b6650", slopeAlt: "#43604a", rock: "#4e5355", shade: "#0f1a33", shadeOpacity: dull ? 0.5 : 0.36 };
  return { sky: dull ? "#aebfc7" : "#bfe3ef", band: dull ? "#c6d2d7" : "#dff1f6", peak: dull ? "#8a9aa3" : "#8ea3b0", slope: "#9bbd8a", slopeAlt: "#8fb37f", rock: "#8f8f86", shade: "#5a6a78", shadeOpacity: dull ? 0.16 : 0 };
}

const TRAIL = "#c9b48c";
const TRAIL_ALT = "#bea679";
const RISER = "#a8916a";
const STARS = [60, 220, 1180, 1340, 1500, 140, 1420, 1560, 300, 1260];

function Cloud({ x, y, c }: { x: number; y: number; c: string }) {
  return <g fill={c}><rect x={x} y={y + 32} width={192} height={32} /><rect x={x + 32} y={y} width={96} height={32} /><rect x={x + 96} y={y - 24} width={64} height={24} /></g>;
}

function Pine({ x, y, s }: { x: number; y: number; s: number }) {
  // y = base of trunk, s = block size.
  return <g>
    <rect x={x - s / 4} y={y - s} width={s / 2} height={s} fill="#6e5340" />
    <rect x={x - s * 1.5} y={y - s * 2} width={s * 3} height={s} fill="#4f7f66" />
    <rect x={x - s} y={y - s * 3} width={s * 2} height={s} fill="#5f8f68" />
    <rect x={x - s / 2} y={y - s * 4} width={s} height={s} fill="#6a9a7c" />
  </g>;
}

function Stairs({ x, y }: { x: number; y: number }) {
  // Five treads over the riser band plus two hand-rail posts; x = left edge, y = top of the band.
  return <g>
    {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={x} y={y - 8 + i * 9} width="120" height="9" fill={i % 2 ? "#8c7757" : "#e8d8b0"} />)}
    <rect x={x - 10} y={y - 36} width="10" height="72" fill="#6e5340" />
    <rect x={x + 120} y={y - 36} width="10" height="72" fill="#6e5340" />
  </g>;
}

export function MountainArt({ isDay, effect }: SceneArtProps) {
  const t = tone(isDay, effect);
  const cloud = isDay ? (effect === "clear" ? "#ffffff" : "#d8e0e3") : "#2f3d5a";
  return <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <rect width="1600" height="900" fill={t.sky} />
    <rect y="300" width="1600" height="120" fill={t.band} />
    {isDay
      ? <rect x="1300" y="90" width="84" height="84" fill={effect === "clear" ? "#f7e4ae" : "#e9e3cf"} />
      : <g><rect x="1300" y="90" width="72" height="72" fill="#f3f0dc" /><rect x="1332" y="90" width="40" height="40" fill={t.sky} /></g>}
    {!isDay && <g fill="#fff8e8">
      {STARS.map((x, i) => <rect key={x} x={x} y={30 + ((i * 59) % 200)} width="6" height="6" />)}
      <animate attributeName="opacity" values="1;0.4;1" dur="3.3s" repeatCount="indefinite" />
    </g>}
    <Cloud x={80} y={160} c={cloud} />
    <Cloud x={1180} y={230} c={cloud} />
    {/* Far ridges */}
    <g fill={t.peak}>
      <rect y="440" width="1600" height="300" /><rect x="0" y="360" width="300" height="80" /><rect x="60" y="300" width="140" height="60" />
      <rect x="1100" y="380" width="500" height="60" /><rect x="1200" y="320" width="300" height="60" /><rect x="1280" y="270" width="140" height="50" />
      <rect x="1310" y="236" width="80" height="34" fill="#f4f6f8" />
    </g>
    {/* Mountain body: each block is 40 units wider than the terrace it carries, rock margins become cliffs */}
    <rect y="700" width="1600" height="200" fill={t.slope} />
    <rect x="660" y="520" width="880" height="220" fill={t.rock} />
    <rect x="260" y="340" width="880" height="240" fill={t.rock} />
    <rect x="460" y="180" width="580" height="220" fill={t.rock} />
    <rect x="400" y="580" width="260" height="160" fill={t.slopeAlt} />
    <rect x="1140" y="400" width="400" height="160" fill={t.slopeAlt} />
    <rect x="1040" y="200" width="100" height="180" fill={t.slopeAlt} />
    {/* Summit rock and snow cap */}
    <g fill={t.rock}><rect x="560" y="100" width="380" height="120" /><rect x="640" y="60" width="220" height="40" /><rect x="700" y="28" width="100" height="32" /></g>
    <g fill="#f4f6f8"><rect x="700" y="28" width="100" height="32" /><rect x="640" y="60" width="220" height="24" /><rect x="600" y="84" width="60" height="16" /><rect x="840" y="84" width="60" height="16" /></g>
    {/* Terrace floors, lowest first */}
    <rect x="100" y="740" width="1400" height="140" fill={TRAIL} />
    {Array.from({ length: 22 }, (_, i) => <rect key={i} x={100 + i * 64} y={740 + (i % 2) * 64} width="64" height="64" fill={TRAIL_ALT} />)}
    <rect x="700" y="560" width="800" height="200" fill={TRAIL} />
    {Array.from({ length: 13 }, (_, i) => <rect key={i} x={700 + i * 64} y={560 + (i % 2) * 64} width="64" height="64" fill={TRAIL_ALT} />)}
    <rect x="300" y="380" width="800" height="200" fill={TRAIL} />
    {Array.from({ length: 13 }, (_, i) => <rect key={i} x={300 + i * 64} y={380 + (i % 2) * 64} width="64" height="64" fill={TRAIL_ALT} />)}
    <rect x="500" y="220" width="500" height="180" fill={TRAIL} />
    {Array.from({ length: 8 }, (_, i) => <rect key={i} x={500 + i * 64} y={220 + (i % 2) * 64} width="64" height="64" fill={TRAIL_ALT} />)}
    {/* Risers along each upper terrace's front edge, with stairs */}
    <rect x="700" y="740" width="800" height="20" fill={RISER} />
    <rect x="300" y="560" width="800" height="20" fill={RISER} />
    <rect x="500" y="380" width="500" height="20" fill={RISER} />
    <Stairs x={1080} y={736} />
    <Stairs x={860} y={556} />
    <Stairs x={720} y={376} />
    {/* Trodden path hinting the way up (floor-coloured, still walkable) */}
    <rect x="230" y="800" width="900" height="28" fill="#d8c6a0" />
    <rect x="1130" y="772" width="40" height="56" fill="#d8c6a0" />
    <rect x="900" y="700" width="300" height="28" fill="#d8c6a0" />
    <rect x="900" y="592" width="28" height="120" fill="#d8c6a0" />
    <rect x="680" y="520" width="300" height="28" fill="#d8c6a0" />
    <rect x="760" y="412" width="28" height="120" fill="#d8c6a0" />
    <rect x="760" y="352" width="100" height="24" fill="#d8c6a0" />
    {/* Pines and boulders on the slopes (outside terraces) */}
    <Pine x={470} y={720} s={28} />
    <Pine x={560} y={740} s={32} />
    <Pine x={620} y={700} s={24} />
    <Pine x={1240} y={540} s={28} />
    <Pine x={1360} y={556} s={32} />
    <Pine x={1460} y={520} s={24} />
    <Pine x={40} y={700} s={32} />
    <Pine x={1560} y={720} s={28} />
    <g fill="#767670"><rect x="320" y="620" width="48" height="32" /><rect x="1180" y="440" width="40" height="28" /><rect x="380" y="300" width="56" height="36" /><rect x="1050" y="300" width="40" height="28" /></g>
    {/* Trailhead gate around the yard portal (rect 90,795,140,90 stays plain trail) */}
    <rect x="90" y="795" width="140" height="90" fill={TRAIL} />
    <rect x="70" y="720" width="20" height="165" fill="#8a6647" />
    <rect x="230" y="720" width="20" height="165" fill="#8a6647" />
    <rect x="62" y="692" width="196" height="28" fill="#6e5340" />
    <rect x="54" y="668" width="212" height="24" fill="#8a6647" />
    <rect x="110" y="730" width="100" height="40" fill="#fff8e8" />
    {t.shadeOpacity > 0 && <rect width="1600" height="900" fill={t.shade} opacity={t.shadeOpacity} />}
  </svg>;
}

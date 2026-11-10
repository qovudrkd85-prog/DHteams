import type { SceneArtProps } from "./index";

// Beach: sea on the upper half, flat sand below (walkable 0,520,1600,360).
// Empty prop rects: bench 1020,720,160,80 (parasol chair). Portal to-yard 50,780,140,90 gets a boardwalk gate around it.

type Tone = { sky: string; band: string; deep: string; mid: string; shallow: string; sand: string; sandAlt: string; shade: string; shadeOpacity: number };

function tone(isDay: boolean, effect: SceneArtProps["effect"]): Tone {
  const dull = effect !== "clear";
  if (!isDay) return { sky: dull ? "#1a2233" : "#1d2946", band: dull ? "#263040" : "#2c3d63", deep: "#2f5466", mid: "#3c6678", shallow: "#4d7a8a", sand: "#b8ab8a", sandAlt: "#ad9f7e", shade: "#0f1a33", shadeOpacity: dull ? 0.5 : 0.34 };
  return { sky: dull ? "#aebfc7" : "#bfe3ef", band: dull ? "#c6d2d7" : "#dff1f6", deep: dull ? "#5f8d9b" : "#6faebd", mid: dull ? "#7ea6b1" : "#8fc6d2", shallow: dull ? "#a2c3ca" : "#b6dde3", sand: "#efe0b8", sandAlt: "#e8d6aa", shade: "#5a6a78", shadeOpacity: dull ? 0.16 : 0 };
}

const STARS = [90, 260, 430, 640, 820, 1010, 1240, 1400, 1530, 360, 1130];

function Cloud({ x, y, c }: { x: number; y: number; c: string }) {
  return <g fill={c}><rect x={x} y={y + 32} width={192} height={32} /><rect x={x + 32} y={y} width={96} height={32} /><rect x={x + 96} y={y - 24} width={64} height={24} /></g>;
}

function Palm({ x, y, lean }: { x: number; y: number; lean: number }) {
  // Trunk climbs in 32-unit blocks, each one shifted by `lean` to read as a curve.
  return <g>
    {Array.from({ length: 7 }, (_, i) => <rect key={i} x={x + i * lean} y={y - 32 * (i + 1)} width="28" height="32" fill={i % 2 ? "#9e7958" : "#8a6647"} />)}
    <g transform={`translate(${x + 7 * lean + 14} ${y - 232})`} fill="#5f8f68">
      <rect x="-120" y="-16" width="240" height="32" /><rect x="-96" y="-48" width="192" height="32" fill="#709465" /><rect x="-40" y="-80" width="80" height="32" fill="#86a977" />
      <rect x="-128" y="16" width="64" height="32" /><rect x="64" y="16" width="64" height="32" />
    </g>
    <g fill="#8a6647"><rect x={x + 7 * lean - 10} y={y - 236} width="16" height="16" /><rect x={x + 7 * lean + 22} y={y - 236} width="16" height="16" /></g>
  </g>;
}

export function BeachArt({ isDay, effect }: SceneArtProps) {
  const t = tone(isDay, effect);
  const cloud = isDay ? (effect === "clear" ? "#ffffff" : "#d8e0e3") : "#2f3d5a";
  return <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <rect width="1600" height="900" fill={t.sky} />
    <rect y="200" width="1600" height="100" fill={t.band} />
    {isDay
      ? <rect x="1180" y="80" width="88" height="88" fill={effect === "clear" ? "#f7e4ae" : "#e9e3cf"} />
      : <g><rect x="1180" y="80" width="72" height="72" fill="#f3f0dc" /><rect x="1212" y="80" width="40" height="40" fill={t.sky} /></g>}
    {!isDay && <g fill="#fff8e8">
      {STARS.map((x, i) => <rect key={x} x={x} y={30 + ((i * 47) % 150)} width="6" height="6" />)}
      <animate attributeName="opacity" values="1;0.4;1" dur="3.4s" repeatCount="indefinite" />
    </g>}
    <Cloud x={120} y={110} c={cloud} />
    <Cloud x={620} y={60} c={cloud} />
    <Cloud x={1360} y={150} c={cloud} />
    {/* Sea in three flat bands, an island on the horizon, a bobbing boat */}
    <rect y="300" width="1600" height="100" fill={t.deep} />
    <rect y="400" width="1600" height="80" fill={t.mid} />
    <rect y="480" width="1600" height="40" fill={t.shallow} />
    <g fill="#7f9a7a"><rect x="1240" y="284" width="160" height="16" /><rect x="1288" y="268" width="64" height="16" /><rect x="1304" y="236" width="12" height="32" /><rect x="1292" y="228" width="40" height="12" fill="#86a977" /></g>
    <g>
      <rect x="880" y="372" width="112" height="28" fill="#b48a62" /><rect x="896" y="360" width="80" height="12" fill="#8a6647" />
      <rect x="930" y="300" width="8" height="60" fill="#6e5340" /><rect x="938" y="304" width="40" height="48" fill="#fff8e8" />
      <animateTransform attributeName="transform" type="translate" values="0 0;0 6;0 0" dur="2.6s" repeatCount="indefinite" />
    </g>
    {isDay && effect === "clear" && <g fill="#e8f4f2" opacity="0.7">{[0, 1, 2, 3, 4].map((i) => <rect key={i} x={1180 + (i % 2) * 24} y={316 + i * 24} width={64 - i * 8} height="6" />)}</g>}
    {/* Foam line slides sideways */}
    <g fill="#e8f4f2">
      {Array.from({ length: 14 }, (_, i) => <rect key={i} x={-64 + i * 128} y="508" width="72" height="12" />)}
      <animateTransform attributeName="transform" type="translate" values="0 0;56 0;0 0" dur="5s" repeatCount="indefinite" />
    </g>
    {/* Sand: flat blocks with a quiet checker, wet strip at the bottom */}
    <rect y="520" width="1600" height="360" fill={t.sand} />
    {Array.from({ length: 25 }, (_, i) => <rect key={i} x={i * 64} y={584 + (i % 2) * 64} width="64" height="64" fill={t.sandAlt} />)}
    {Array.from({ length: 25 }, (_, i) => <rect key={i} x={i * 64} y={776 - (i % 2) * 64} width="64" height="64" fill={t.sandAlt} />)}
    <rect y="880" width="1600" height="20" fill="#d9c28f" />
    <g fill="#fff8e8"><rect x="420" y="640" width="10" height="10" /><rect x="1380" y="690" width="10" height="10" /><rect x="700" y="840" width="10" height="10" /><rect x="260" y="600" width="10" height="10" fill="#f3c6c1" /></g>
    {/* Boardwalk gate around the yard portal (rect 50,780,140,90 stays plain planks) */}
    <rect x="50" y="780" width="140" height="90" fill="#d6b58a" />
    {[796, 828, 860].map((y) => <rect key={y} x="50" y={y} width="140" height="4" fill="#c4a376" />)}
    <rect x="26" y="690" width="24" height="190" fill="#b48a62" />
    <rect x="190" y="690" width="24" height="190" fill="#b48a62" />
    <rect x="18" y="660" width="204" height="30" fill="#9e7958" />
    <rect x="60" y="700" width="120" height="44" fill="#fff8e8" />
    <rect x="60" y="738" width="120" height="6" fill="#cdbf9c" />
    <Palm x={1470} y={560} lean={6} />
    <Palm x={1545} y={600} lean={-5} />
    {t.shadeOpacity > 0 && <rect width="1600" height="900" fill={t.shade} opacity={t.shadeOpacity} />}
  </svg>;
}

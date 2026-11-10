import type { SceneArtProps } from "./index";

// Fishing pier: plank deck x200..1400, y600..800 (walkable 200,600,1200,200) over calm water.
// Empty prop rects: fishing 1190,650,120,100 · bench 620,700,160,80. Portal to-yard 170,735,140,90 is the gangway to shore.

type Tone = { sky: string; band: string; hill: string; water: string; waterFar: string; ripple: string; shade: string; shadeOpacity: number };

function tone(isDay: boolean, effect: SceneArtProps["effect"]): Tone {
  const dull = effect !== "clear";
  if (!isDay) return { sky: dull ? "#1a2233" : "#1d2946", band: dull ? "#263040" : "#2c3d63", hill: "#3f5466", water: "#2f4f60", waterFar: "#3b5f72", ripple: "#4d7388", shade: "#0f1a33", shadeOpacity: dull ? 0.5 : 0.34 };
  return { sky: dull ? "#aebfc7" : "#bfe3ef", band: dull ? "#c6d2d7" : "#dff1f6", hill: dull ? "#93a9a3" : "#9dc0b4", water: dull ? "#6f9faf" : "#7fb3c4", waterFar: dull ? "#8fb6c1" : "#9fcbd6", ripple: dull ? "#9cc0c9" : "#a9d3dc", shade: "#5a6a78", shadeOpacity: dull ? 0.16 : 0 };
}

const STARS = [70, 240, 410, 600, 790, 980, 1150, 1330, 1500, 330, 1060];
const RIPPLES = [[80, 360], [420, 330], [760, 380], [1100, 340], [1460, 370], [300, 450], [900, 470], [1300, 500], [600, 860], [1200, 850], [1500, 820]];
const POSTS = [232, 520, 808, 1096, 1352];

function Cloud({ x, y, c }: { x: number; y: number; c: string }) {
  return <g fill={c}><rect x={x} y={y + 32} width={192} height={32} /><rect x={x + 32} y={y} width={96} height={32} /><rect x={x + 96} y={y - 24} width={64} height={24} /></g>;
}

export function FishingArt({ isDay, effect }: SceneArtProps) {
  const t = tone(isDay, effect);
  const cloud = isDay ? (effect === "clear" ? "#ffffff" : "#d8e0e3") : "#2f3d5a";
  return <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <rect width="1600" height="900" fill={t.sky} />
    <rect y="150" width="1600" height="90" fill={t.band} />
    {isDay
      ? <rect x="240" y="60" width="80" height="80" fill={effect === "clear" ? "#f7e4ae" : "#e9e3cf"} />
      : <g><rect x="240" y="60" width="72" height="72" fill="#f3f0dc" /><rect x="272" y="60" width="40" height="40" fill={t.sky} /></g>}
    {!isDay && <g fill="#fff8e8">
      {STARS.map((x, i) => <rect key={x} x={x} y={24 + ((i * 41) % 120)} width="6" height="6" />)}
      <animate attributeName="opacity" values="1;0.4;1" dur="3.6s" repeatCount="indefinite" />
    </g>}
    <Cloud x={520} y={70} c={cloud} />
    <Cloud x={1120} y={110} c={cloud} />
    {/* Far shore: stepped hills, a lighthouse on the right point */}
    <g fill={t.hill}>
      <rect y="232" width="1600" height="68" /><rect x="80" y="200" width="360" height="32" /><rect x="180" y="176" width="140" height="24" />
      <rect x="640" y="208" width="300" height="24" /><rect x="1300" y="204" width="300" height="28" />
    </g>
    <g><rect x="1440" y="128" width="40" height="80" fill="#fff8e8" /><rect x="1440" y="156" width="40" height="16" fill="#c96a5a" /><rect x="1436" y="112" width="48" height="16" fill="#c96a5a" /><rect x="1448" y="96" width="24" height="16" fill={isDay ? "#5b6b78" : "#f7e4ae"} /></g>
    {/* Water */}
    <rect y="300" width="1600" height="600" fill={t.water} />
    <rect y="300" width="1600" height="40" fill={t.waterFar} />
    <g fill={t.ripple}>
      {RIPPLES.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="56" height="8" />)}
      <animate attributeName="opacity" values="1;0.35;1" dur="2.8s" repeatCount="indefinite" />
    </g>
    <g><rect x="1140" y="404" width="96" height="24" fill="#b48a62" /><rect x="1152" y="394" width="72" height="10" fill="#8a6647" /><rect x="1182" y="340" width="6" height="54" fill="#6e5340" /><rect x="1188" y="344" width="32" height="40" fill="#fff8e8" /></g>
    {/* Shore on the left where the gangway lands */}
    <rect y="620" width="200" height="280" fill="#adc99c" />
    <rect y="660" width="200" height="240" fill="#e4dcc1" />
    <rect x="128" y="660" width="72" height="240" fill="#d6ccad" />
    {/* Pier posts and front beam under the deck */}
    {POSTS.map((x) => <g key={x}><rect x={x} y="800" width="32" height="100" fill="#6e5340" /><rect x={x - 8} y="884" width="48" height="16" fill={t.ripple} /></g>)}
    <rect x="200" y="800" width="1200" height="18" fill="#8a6647" />
    {/* Deck planks (walkable floor) */}
    <rect x="200" y="600" width="1200" height="200" fill="#b48a62" />
    {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x="200" y={628 + i * 32} width="1200" height="4" fill="#9e7958" />)}
    {[360, 680, 1000, 1260].map((x, i) => <rect key={x} x={x} y={600 + (i % 2) * 96} width="4" height="96" fill="#9e7958" />)}
    {/* Gangway to shore (portal rect 170,735,140,90 stays plain planks) */}
    <rect x="112" y="735" width="198" height="90" fill="#c29a70" />
    {[756, 788, 820].map((y) => <rect key={y} x="112" y={y} width="198" height="4" fill="#9e7958" />)}
    <rect x="150" y="680" width="20" height="150" fill="#8a6647" />
    <rect x="310" y="680" width="20" height="150" fill="#8a6647" />
    <rect x="142" y="652" width="196" height="28" fill="#6e5340" />
    <rect x="300" y="680" width="40" height="36" fill="#f7e4ae" />
    {/* Back railing along the deck edge and the far end */}
    <rect x="200" y="548" width="1216" height="12" fill="#8a6647" />
    <rect x="200" y="576" width="1216" height="8" fill="#8a6647" />
    {[200, 360, 520, 680, 840, 1000, 1160, 1320, 1400].map((x) => <rect key={x} x={x} y="536" width="16" height="64" fill="#6e5340" />)}
    <rect x="1400" y="548" width="16" height="252" fill="#6e5340" />
    <rect x="1408" y="700" width="8" height="100" fill="#8a6647" />
    <g><rect x="1340" y="500" width="48" height="36" fill="#c96a5a" /><rect x="1352" y="486" width="24" height="14" fill="#8a6647" /></g>
    {t.shadeOpacity > 0 && <rect width="1600" height="900" fill={t.shade} opacity={t.shadeOpacity} />}
  </svg>;
}

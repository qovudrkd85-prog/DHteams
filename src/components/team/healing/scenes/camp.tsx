import type { SceneArtProps } from "./index";

// Campground: a clearing by a dark pine line with two tents and a fire ring (walkable 100,540,1400,340).
// Empty prop rects: campfire 720,640,160,120 (fire ring drawn inside) · bench 1100,740,160,80 (log seat).
// Portal to-yard 90,795,140,90 gets a wooden signpost. The fire glows at night.

type Tone = { sky: string; band: string; far: string; near: string; grass: string; grassAlt: string; dirt: string; shade: string; shadeOpacity: number };

function tone(isDay: boolean, effect: SceneArtProps["effect"]): Tone {
  const dull = effect !== "clear";
  if (!isDay) return { sky: dull ? "#151b2a" : "#182038", band: dull ? "#1f2737" : "#232d4a", far: "#22352f", near: "#2c4337", grass: "#55714f", grassAlt: "#4c6747", dirt: "#6d5a44", shade: "#0f1a33", shadeOpacity: dull ? 0.42 : 0.2 };
  return { sky: dull ? "#aebcc6" : "#bfe0ef", band: dull ? "#c3ced4" : "#def0f6", far: dull ? "#5f7f69" : "#5a8a6b", near: dull ? "#4f7257" : "#4e7f5a", grass: "#9cbf7f", grassAlt: "#92b676", dirt: "#c9a97c", shade: "#5a6a78", shadeOpacity: dull ? 0.16 : 0 };
}

const STARS = [90, 260, 450, 640, 820, 1000, 1190, 1380, 1530, 360, 1100];
const PINES = [140, 300, 460, 620, 780, 940, 1100, 1260, 1420, 1560];

function Pine({ x, y, s, c }: { x: number; y: number; s: number; c: string }) {
  // y = base of trunk, s = block size.
  return <g>
    <rect x={x - s / 4} y={y - s} width={s / 2} height={s} fill="#5c4634" />
    <rect x={x - s * 1.5} y={y - s * 2} width={s * 3} height={s} fill={c} />
    <rect x={x - s * 1.1} y={y - s * 3} width={s * 2.2} height={s} fill={c} />
    <rect x={x - s * 0.7} y={y - s * 4} width={s * 1.4} height={s} fill={c} />
    <rect x={x - s * 0.3} y={y - s * 4.7} width={s * 0.6} height={s * 0.7} fill={c} />
  </g>;
}

function Tent({ x, y, c, dark }: { x: number; y: number; c: string; dark: string }) {
  // x = centre, y = ground line; a 240 wide stepped tent with a dark door.
  return <g>
    <rect x={x - 120} y={y - 48} width={240} height={48} fill={c} />
    <rect x={x - 88} y={y - 96} width={176} height={48} fill={c} />
    <rect x={x - 56} y={y - 144} width={112} height={48} fill={c} />
    <rect x={x - 24} y={y - 176} width={48} height={32} fill={c} />
    <rect x={x - 28} y={y - 96} width={56} height={96} fill={dark} />
    <rect x={x - 140} y={y - 6} width={280} height={6} fill={dark} />
  </g>;
}

function Log({ x, y }: { x: number; y: number }) {
  return <g><rect x={x} y={y} width={160} height={40} fill="#8c6a4b" /><rect x={x} y={y} width={160} height={10} fill="#a98562" /><rect x={x + 8} y={y + 40} width={24} height={14} fill="#5c4634" /><rect x={x + 128} y={y + 40} width={24} height={14} fill="#5c4634" /></g>;
}

export function CampArt({ isDay, effect }: SceneArtProps) {
  const t = tone(isDay, effect);
  const cloud = isDay ? (effect === "clear" ? "#ffffff" : "#d8e0e3") : "#2f3d5a";
  return <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <rect width="1600" height="900" fill={t.sky} />
    <rect y="300" width="1600" height="160" fill={t.band} />
    {isDay
      ? <rect x="220" y="90" width="80" height="80" fill={effect === "clear" ? "#f7e4ae" : "#e9e3cf"} />
      : <g><rect x="220" y="90" width="72" height="72" fill="#f3f0dc" /><rect x="252" y="90" width="40" height="40" fill={t.sky} /></g>}
    {!isDay && <g fill="#fff8e8">
      {STARS.map((x, i) => <rect key={x} x={x} y={36 + ((i * 47) % 210)} width="6" height="6" />)}
      <animate attributeName="opacity" values="1;0.45;1" dur="3.6s" repeatCount="indefinite" />
    </g>}
    <g fill={cloud}><rect x="520" y="150" width="192" height="32" /><rect x="552" y="118" width="96" height="32" /><rect x="1140" y="110" width="160" height="32" /><rect x="1172" y="78" width="80" height="32" /></g>
    {/* Far ridge and the pine line */}
    <g fill={t.far}>
      <rect y="380" width="1600" height="120" /><rect x="60" y="340" width="360" height="40" /><rect x="160" y="308" width="160" height="32" />
      <rect x="700" y="332" width="420" height="48" /><rect x="820" y="300" width="180" height="32" /><rect x="1240" y="348" width="320" height="32" />
    </g>
    <rect y="470" width="1600" height="90" fill={t.near} />
    {PINES.map((x, i) => <Pine key={x} x={x} y={560} s={i % 2 ? 36 : 44} c={t.near} />)}
    {/* Clearing */}
    <rect y="540" width="1600" height="340" fill={t.grass} />
    {Array.from({ length: 25 }, (_, i) => <rect key={i} x={i * 64} y={540 + (i % 2) * 64} width="64" height="64" fill={t.grassAlt} />)}
    {Array.from({ length: 25 }, (_, i) => <rect key={i} x={i * 64} y={796 - (i % 2) * 64} width="64" height="64" fill={t.grassAlt} />)}
    <rect y="860" width="1600" height="40" fill={t.grassAlt} />
    {/* Trodden dirt around the fire */}
    <rect x="640" y="600" width="320" height="200" fill={t.dirt} />
    <rect x="608" y="632" width="384" height="136" fill={t.dirt} />
    {/* Tents behind the fire, one each side */}
    <Tent x={330} y={600} c="#d9823b" dark="#5a3a22" />
    <Tent x={1280} y={590} c="#4f8a9b" dark="#223f4a" />
    {/* Fire ring inside the campfire prop rect 720,640,160,120 */}
    <g fill="#6f6a64">
      {[720, 760, 800, 840].map((x) => <rect key={x} x={x} y="736" width="40" height="24" />)}
      <rect x="712" y="700" width="24" height="40" /><rect x="864" y="700" width="24" height="40" />
    </g>
    <rect x="744" y="716" width="112" height="24" fill="#4a3a2c" />
    <rect x="760" y="700" width="80" height="20" fill="#5c4634" />
    <g>
      <rect x="776" y="664" width="48" height="40" fill="#f08c2e" /><rect x="788" y="640" width="24" height="28" fill="#f7c948" /><rect x="764" y="684" width="72" height="20" fill="#e1542b" />
      <animate attributeName="opacity" values="1;0.8;1" dur="0.9s" repeatCount="indefinite" />
    </g>
    {!isDay && <rect x="560" y="560" width="480" height="260" fill="#f7a34a" opacity="0.18" />}
    {/* Log seat on the bench prop rect 1100,740,160,80 and a spare log by the fire */}
    <Log x={1100} y={756} />
    <Log x={520} y={700} />
    {/* Signpost on the way back to the yard (portal 90,795,140,90) */}
    <rect x="150" y="700" width="16" height="100" fill="#8c6a4b" />
    <rect x="116" y="696" width="84" height="28" fill="#b48a62" />
    <rect x="128" y="706" width="60" height="8" fill="#fff8e8" />
    {/* Lanterns and a cooler for warmth */}
    <g fill="#f7e4ae"><rect x="1030" y="640" width="14" height="18" /><rect x="236" y="560" width="14" height="18" /></g>
    <rect x="1340" y="770" width="60" height="44" fill="#3d7fb2" /><rect x="1340" y="770" width="60" height="10" fill="#ffffff" />
    {t.shadeOpacity > 0 && <rect width="1600" height="900" fill={t.shade} opacity={t.shadeOpacity} />}
  </svg>;
}

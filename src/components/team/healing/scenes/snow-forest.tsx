import type { SceneArtProps } from "./index";

// Snow forest: pine rows and a log cabin behind a flat snowfield (walkable 100,540,1400,340).
// Empty prop rects: snowman 1130,620,140,120 · bench 620,760,160,80 (log seat). Portal to-yard 90,795,140,90 gets a wooden gate with lanterns.

type Tone = { sky: string; band: string; far: string; snow: string; snowAlt: string; trodden: string; window: string; shade: string; shadeOpacity: number };

function tone(isDay: boolean, effect: SceneArtProps["effect"]): Tone {
  const dull = effect !== "clear";
  if (!isDay) return { sky: dull ? "#161c2b" : "#1a2340", band: dull ? "#202839" : "#233052", far: "#263d33", snow: "#c7d0d8", snowAlt: "#bcc6cf", trodden: "#b3bec8", window: "#f7e4ae", shade: "#0f1a33", shadeOpacity: dull ? 0.42 : 0.22 };
  return { sky: dull ? "#b9c4cb" : "#d7e6ee", band: dull ? "#c9d2d7" : "#e6eff4", far: dull ? "#4a6a58" : "#3f6652", snow: "#f4f6f8", snowAlt: "#eaf0f4", trodden: "#e2e9ee", window: "#b5d5cd", shade: "#5a6a78", shadeOpacity: dull ? 0.14 : 0 };
}

const STARS = [80, 230, 410, 590, 760, 940, 1120, 1300, 1470, 330, 1030];
const BACK_PINES = [160, 330, 520, 700, 880, 1040, 1500];

function Pine({ x, y, s }: { x: number; y: number; s: number }) {
  // y = base of trunk, s = block size; snow sits on each tier.
  return <g>
    <rect x={x - s / 4} y={y - s} width={s / 2} height={s} fill="#6e5340" />
    <rect x={x - s * 1.5} y={y - s * 2} width={s * 3} height={s} fill="#4f7f66" />
    <rect x={x - s * 1.5} y={y - s * 2} width={s * 3} height={s / 4} fill="#eaf0f4" />
    <rect x={x - s} y={y - s * 3} width={s * 2} height={s} fill="#5f8f68" />
    <rect x={x - s} y={y - s * 3} width={s * 2} height={s / 4} fill="#eaf0f4" />
    <rect x={x - s / 2} y={y - s * 4} width={s} height={s} fill="#6a9a7c" />
    <rect x={x - s / 2} y={y - s * 4} width={s} height={s / 4} fill="#f4f6f8" />
  </g>;
}

export function SnowForestArt({ isDay, effect }: SceneArtProps) {
  const t = tone(isDay, effect);
  return <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <rect width="1600" height="900" fill={t.sky} />
    <rect y="200" width="1600" height="140" fill={t.band} />
    {isDay
      ? <rect x="1180" y="70" width="80" height="80" fill={effect === "clear" ? "#f7e4ae" : "#e9e3cf"} />
      : <g><rect x="1180" y="70" width="72" height="72" fill="#f3f0dc" /><rect x="1212" y="70" width="40" height="40" fill={t.sky} /></g>}
    {!isDay && <g fill="#fff8e8">
      {STARS.map((x, i) => <rect key={x} x={x} y={28 + ((i * 51) % 160)} width="6" height="6" />)}
      <animate attributeName="opacity" values="1;0.4;1" dur="3.4s" repeatCount="indefinite" />
    </g>}
    {/* Far treeline as a stepped dark band */}
    <g fill={t.far}>
      <rect y="330" width="1600" height="210" /><rect x="0" y="290" width="240" height="40" /><rect x="320" y="300" width="200" height="30" />
      <rect x="640" y="280" width="260" height="50" /><rect x="1000" y="306" width="160" height="24" /><rect x="1380" y="286" width="220" height="44" />
    </g>
    <rect y="470" width="1600" height="70" fill={t.snowAlt} />
    {BACK_PINES.map((x) => <Pine key={x} x={x} y={540} s={40} />)}
    {/* Log cabin with a smoking chimney */}
    <g>
      <rect x="1180" y="420" width="220" height="120" fill="#9e7958" />
      {[444, 476, 508].map((y) => <rect key={y} x="1180" y={y} width="220" height="4" fill="#8a6647" />)}
      <rect x="1164" y="372" width="252" height="48" fill="#6e5340" />
      <rect x="1196" y="340" width="188" height="32" fill="#6e5340" />
      <rect x="1164" y="364" width="252" height="16" fill="#f4f6f8" />
      <rect x="1196" y="332" width="188" height="16" fill="#f4f6f8" />
      <rect x="1340" y="300" width="28" height="60" fill="#767670" />
      <rect x="1264" y="460" width="52" height="80" fill="#4e3a2c" />
      <rect x="1200" y="452" width="44" height="40" fill={t.window} />
      <rect x="1336" y="452" width="44" height="40" fill={t.window} />
      <g fill="#e4dcc1">
        <rect x="1344" y="272" width="16" height="16" /><rect x="1356" y="244" width="20" height="20" /><rect x="1340" y="212" width="24" height="24" />
        <animateTransform attributeName="transform" type="translate" values="0 0;0 -60" dur="3.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.9;0" dur="3.2s" repeatCount="indefinite" />
      </g>
    </g>
    {/* Fence posts with snow caps along the back edge */}
    {[300, 428, 556, 684, 812, 940, 1068].map((x) => <g key={x}><rect x={x} y="500" width="14" height="40" fill="#8a6647" /><rect x={x - 2} y="494" width="18" height="8" fill="#f4f6f8" /></g>)}
    <rect x="300" y="516" width="782" height="6" fill="#8a6647" />
    {/* Snowfield (walkable floor) */}
    <rect y="540" width="1600" height="340" fill={t.snow} />
    {Array.from({ length: 25 }, (_, i) => <rect key={i} x={i * 64} y={540 + (i % 2) * 64} width="64" height="64" fill={t.snowAlt} />)}
    {Array.from({ length: 25 }, (_, i) => <rect key={i} x={i * 64} y={796 - (i % 2) * 64} width="64" height="64" fill={t.snowAlt} />)}
    <rect y="880" width="1600" height="20" fill="#dfe6ec" />
    <rect x="230" y="820" width="1180" height="32" fill={t.trodden} />
    <rect x="1120" y="740" width="60" height="80" fill={t.trodden} />
    {/* Front pines outside the walkable strip */}
    <Pine x={40} y={760} s={36} />
    <Pine x={60} y={620} s={24} />
    <Pine x={1560} y={700} s={32} />
    <Pine x={1550} y={860} s={28} />
    {/* Wooden gate around the yard portal (rect 90,795,140,90 stays trodden snow) */}
    <rect x="90" y="795" width="140" height="90" fill={t.trodden} />
    <rect x="70" y="700" width="20" height="185" fill="#6e5340" />
    <rect x="230" y="700" width="20" height="185" fill="#6e5340" />
    <rect x="54" y="672" width="212" height="28" fill="#8a6647" />
    <rect x="54" y="660" width="212" height="12" fill="#f4f6f8" />
    <rect x="94" y="710" width="24" height="36" fill={isDay ? "#e9e3cf" : "#f7e4ae"} />
    <rect x="202" y="710" width="24" height="36" fill={isDay ? "#e9e3cf" : "#f7e4ae"} />
    <rect x="90" y="704" width="32" height="6" fill="#4e3a2c" />
    <rect x="198" y="704" width="32" height="6" fill="#4e3a2c" />
    {t.shadeOpacity > 0 && <rect width="1600" height="900" fill={t.shade} opacity={t.shadeOpacity} />}
  </svg>;
}

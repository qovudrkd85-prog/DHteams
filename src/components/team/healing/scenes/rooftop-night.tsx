import type { SceneArtProps } from "./index";

// Night rooftop: always night. Same slab as the day rooftop (walkable 80,520,1440,340), lit windows, string lights.
// Empty prop rects: stargaze 1230,545,140,110 · smoke 240,550,120,100 · bench 720,760,160,80. Portal to-yard 90,775,140,90 sits below the stair hut door.

type Tone = { sky: string; band: string; shadeOpacity: number };

function tone(effect: SceneArtProps["effect"]): Tone {
  const dull = effect !== "clear";
  return { sky: dull ? "#161c2b" : "#141b2e", band: dull ? "#202839" : "#1c2740", shadeOpacity: dull ? 0.25 : 0 };
}

const FAR = "#2a3042";
const NEAR = "#333a50";
const SLAB = "#5b5e6e";
const LINE = "#4e5160";
const WALL = "#6e717f";
const CAP = "#7c7f8d";
const LIT = "#f7e4ae";
const DARK_WIN = "#3b4460";
const FAR_BLOCKS = [[0, 200, 300], [220, 120, 220], [380, 260, 340], [700, 180, 260], [920, 300, 380], [1260, 140, 240], [1440, 200, 320]];
const NEAR_BLOCKS = [[60, 160, 170], [330, 220, 210], [640, 150, 150], [860, 260, 230], [1200, 180, 190], [1480, 140, 130]];
const STARS = [60, 150, 290, 420, 560, 700, 830, 960, 1090, 1230, 1370, 1500, 1570, 240, 640, 1010, 1300];
const BULBS = ["#f7e4ae", "#c96a5a", "#97c8c5", "#f3c6c1"];

function Building({ x, w, h, c }: { x: number; w: number; h: number; c: string }) {
  const cols = Math.floor((w - 16) / 40);
  const rows = Math.floor((h - 24) / 48);
  return <g>
    <rect x={x} y={470 - h} width={w} height={h} fill={c} />
    {Array.from({ length: cols * rows }, (_, i) => <rect key={i} x={x + 16 + (i % cols) * 40} y={470 - h + 20 + Math.floor(i / cols) * 48} width="20" height="24" fill={(i * 7 + x) % 3 === 0 ? LIT : DARK_WIN} />)}
  </g>;
}

export function RooftopNightArt({ effect }: SceneArtProps) {
  const t = tone(effect);
  return <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
    <rect width="1600" height="900" fill={t.sky} />
    <rect y="260" width="1600" height="210" fill={t.band} />
    <g><rect x="1240" y="60" width="88" height="88" fill="#f3f0dc" /><rect x="1280" y="60" width="48" height="48" fill={t.sky} /><rect x="1256" y="108" width="16" height="16" fill="#e4dcc1" /></g>
    <g fill="#fff8e8">
      {STARS.map((x, i) => <rect key={x} x={x} y={20 + ((i * 37) % 180)} width={i % 4 === 0 ? 8 : 6} height={i % 4 === 0 ? 8 : 6} />)}
      <animate attributeName="opacity" values="1;0.35;1" dur="3.1s" repeatCount="indefinite" />
    </g>
    <g fill="#2f3d5a"><rect x="420" y="150" width="192" height="32" /><rect x="452" y="118" width="96" height="32" /></g>
    {FAR_BLOCKS.map(([x, w, h]) => <Building key={x} x={x} w={w} h={h} c={FAR} />)}
    {NEAR_BLOCKS.map(([x, w, h]) => <Building key={x} x={x} w={w} h={h} c={NEAR} />)}
    <g fill="#c96a5a"><rect x="1070" y="86" width="12" height="12" /><rect x="640" y="150" width="10" height="10" /></g>
    {/* Outer building faces beyond the parapet */}
    <rect y="520" width="40" height="380" fill={NEAR} />
    <rect x="1560" y="520" width="40" height="380" fill={NEAR} />
    {/* Slab with tile lines */}
    <rect x="80" y="520" width="1440" height="340" fill={SLAB} />
    {Array.from({ length: 22 }, (_, i) => <rect key={i} x={144 + i * 64} y="520" width="2" height="340" fill={LINE} />)}
    {Array.from({ length: 5 }, (_, i) => <rect key={i} x="80" y={584 + i * 64} width="1440" height="2" fill={LINE} />)}
    <rect x="1440" y="800" width="40" height="40" fill={LINE} />
    {/* Parapet: back, sides, front */}
    <rect x="40" y="472" width="1520" height="48" fill={WALL} />
    <rect x="40" y="456" width="1520" height="16" fill={CAP} />
    <rect x="40" y="456" width="40" height="444" fill={WALL} />
    <rect x="1520" y="456" width="40" height="444" fill={WALL} />
    <rect x="40" y="860" width="1520" height="40" fill={WALL} />
    <rect x="40" y="860" width="1520" height="12" fill={CAP} />
    {/* String lights hung along the back parapet */}
    <rect x="400" y="436" width="900" height="3" fill="#8e8a7f" />
    <g>
      {Array.from({ length: 15 }, (_, i) => <rect key={i} x={420 + i * 60} y={438 + (i % 2) * 6} width="12" height="14" fill={BULBS[i % 4]} />)}
      <animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite" />
    </g>
    {[400, 1300].map((x) => <rect key={x} x={x - 6} y="400" width="12" height="56" fill="#8e8a7f" />)}
    {/* Planters on the back parapet */}
    {[560, 1000].map((x) => <g key={x}><rect x={x} y="424" width="56" height="32" fill="#8c4c42" /><rect x={x + 8} y="396" width="40" height="28" fill="#4f7f66" /><rect x={x + 20} y="376" width="16" height="20" fill="#5f8f68" /></g>)}
    {/* Water tank on legs at the back right */}
    <g><rect x="1408" y="470" width="12" height="70" fill="#4e5160" /><rect x="1484" y="470" width="12" height="70" fill="#4e5160" /><rect x="1400" y="380" width="104" height="90" fill="#8b8e9c" /><rect x="1400" y="420" width="104" height="8" fill="#6e717f" /><rect x="1416" y="356" width="72" height="24" fill="#6e717f" /><rect x="1440" y="340" width="24" height="16" fill="#4e5160" /></g>
    {/* Vent pipe with drifting smoke blocks */}
    <rect x="1180" y="400" width="24" height="56" fill="#4e5160" />
    <rect x="1172" y="392" width="40" height="12" fill="#6e717f" />
    <g fill="#8b8e9c">
      <rect x="1184" y="364" width="16" height="16" /><rect x="1196" y="336" width="20" height="20" /><rect x="1180" y="304" width="24" height="24" />
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -70" dur="3s" repeatCount="indefinite" />
    </g>
    {/* Stair hut: the yard portal rect 90,775,140,90 is the slab in front of its door */}
    <rect x="70" y="660" width="180" height="115" fill={WALL} />
    <rect x="62" y="644" width="196" height="16" fill="#4e5160" />
    <rect x="120" y="690" width="80" height="85" fill="#3b4460" />
    <rect x="128" y="698" width="64" height="30" fill={LIT} />
    <rect x="176" y="600" width="64" height="44" fill="#7c7f8d" />
    <rect x="192" y="608" width="32" height="28" fill="#4e5160" />
    <rect x="90" y="775" width="140" height="6" fill={LINE} />
    <rect x="96" y="640" width="12" height="12" fill={LIT} />
    {t.shadeOpacity > 0 && <rect width="1600" height="900" fill="#0f1a33" opacity={t.shadeOpacity} />}
  </svg>;
}

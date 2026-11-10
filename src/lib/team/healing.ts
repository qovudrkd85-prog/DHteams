// Healing time: a small pixel world to walk around in and rest. Client-only, no database writes.
// Scene geometry and which prop starts which activity live in healing-world.ts (this file must
// stay free of runtime imports: tests load it in a bare vm sandbox).

export type HealingSceneId = "beach" | "fishing" | "mountain" | "rooftop" | "snow-forest" | "camp";
export type WeatherEffect = "clear" | "cloudy" | "rain" | "snow" | "fog";

export interface HealingScene {
  id: HealingSceneId;
  name: string;
  caption: string;
  emoji: string;
}

/** The places you can fast-travel to; the yard in the middle is where you start. */
export const HEALING_SCENES: readonly HealingScene[] = [
  { id: "beach", name: "바닷가", caption: "파도 소리 들리는 해변", emoji: "🌊" },
  { id: "fishing", name: "낚시터", caption: "호숫가 잔교에서 낚싯대 드리우기", emoji: "🎣" },
  { id: "camp", name: "캠핑장", caption: "모닥불 앞에서 멍하니 불멍", emoji: "🔥" },
  { id: "mountain", name: "산 정상", caption: "등산 끝에 만난 전망대", emoji: "⛰️" },
  { id: "rooftop", name: "옥상 쉼터", caption: "바람 쐬러 올라온 옥상", emoji: "🌤️" },
  { id: "snow-forest", name: "눈 내린 숲", caption: "고요한 겨울 숲길", emoji: "❄️" },
];

export const YARD_NAME = "쉼터 마당";

export type HealingActivityId = "laptop" | "fishing" | "walk" | "rest" | "smoke" | "hike" | "stargaze" | "snowman" | "campfire";

export interface HealingActivity {
  id: HealingActivityId;
  name: string;
  emoji: string;
}

/** Display names; which zone offers which activity comes from healing-world.activitiesInScene. */
export const HEALING_ACTIVITIES: readonly HealingActivity[] = [
  { id: "laptop", name: "노트북 하기", emoji: "💻" },
  { id: "fishing", name: "낚시하기", emoji: "🎣" },
  { id: "walk", name: "산책하기", emoji: "🚶" },
  { id: "rest", name: "쉬기", emoji: "☕" },
  { id: "smoke", name: "담배 한 대", emoji: "🚬" },
  { id: "hike", name: "등산하기", emoji: "🥾" },
  { id: "stargaze", name: "별 보기", emoji: "🔭" },
  { id: "snowman", name: "눈사람 만들기", emoji: "⛄" },
  { id: "campfire", name: "불멍", emoji: "🔥" },
];

export function findActivity(id: unknown): HealingActivity {
  return HEALING_ACTIVITIES.find((a) => a.id === id) ?? HEALING_ACTIVITIES[3];
}

export const HEALING_STATUS = "힐링 타임 중 · 잠시 쉬어요";

type StatusWriter = (message: string) => Promise<{ status_message?: string | null }>;

export interface HealingStatusSession {
  /** Resolves true once our HEALING_STATUS write landed. */
  applied: Promise<boolean>;
  /** Message to restore on leave. */
  original: string;
  isApplied: () => boolean;
  /** Restores the original; resolves false when nothing was ours to undo. Rejects if the restore write fails. */
  end: () => Promise<boolean>;
  /** Page is going away: cancels an apply not yet sent; returns the message to send with keepalive, or null. */
  unload: () => string | null;
}

// Last restore that has not succeeded yet. A quick reopen waits for it and inherits its target;
// a failed restore stays here so the next session still knows the real original.
let pendingRestore: { done: Promise<boolean>; original: string } | null = null;

/** Shows teammates I am resting, ordered after any unfinished restore from the last session. */
export function startHealingStatus(current: string, write: StatusWriter): HealingStatusSession {
  const prior = pendingRestore;
  // Inherit only while the server still shows our healing message; a newer user status wins.
  const inherit = prior !== null && current === HEALING_STATUS;
  // Leftover HEALING_STATUS with no restore record = interrupted session: clear it on leave.
  const original = inherit ? prior.original : current === HEALING_STATUS ? "" : current;
  const alreadyHealing = prior === null && current === HEALING_STATUS;
  let state: "pending" | "landed" | "failed" = "pending";
  let unloading = false;
  const applied = (prior?.done ?? Promise.resolve(true))
    .then(() => {
      // Never start a write the unloading page could not undo.
      if (unloading) return false;
      if (alreadyHealing) return true;
      return write(HEALING_STATUS).then((member) => member.status_message === HEALING_STATUS, () => false);
    })
    .then((ok) => { state = ok ? "landed" : "failed"; return ok; });
  return {
    applied,
    original,
    isApplied: () => state === "landed",
    end() {
      // Never undo a write that did not land.
      const done = applied.then((ok) => (ok ? write(original).then(() => true) : false));
      const entry = { done: done.then(() => true, () => false), original };
      pendingRestore = entry;
      void entry.done.then((restored) => { if (restored && pendingRestore === entry) pendingRestore = null; });
      return done;
    },
    unload() {
      unloading = true;
      // Pending = our apply or the prior restore may still land; restoring the same target is safe.
      return state === "failed" ? null : original;
    },
  };
}

export const HEALING_MINUTES = [5, 10, 15] as const;
export type HealingMinutes = (typeof HEALING_MINUTES)[number];

export interface HealingCity {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export const HEALING_CITIES: readonly HealingCity[] = [
  { id: "seoul", name: "서울", latitude: 37.5665, longitude: 126.978 },
  { id: "busan", name: "부산", latitude: 35.1796, longitude: 129.0756 },
  { id: "daejeon", name: "대전", latitude: 36.3504, longitude: 127.3845 },
  { id: "daegu", name: "대구", latitude: 35.8714, longitude: 128.6014 },
  { id: "gwangju", name: "광주", latitude: 35.1595, longitude: 126.8526 },
  { id: "gangneung", name: "강릉", latitude: 37.7519, longitude: 128.8761 },
  { id: "jeju", name: "제주", latitude: 33.4996, longitude: 126.5312 },
];

export interface CurrentWeather {
  effect: WeatherEffect;
  isDay: boolean;
  temperature: number | null;
  label: string;
}

// WMO weather interpretation codes used by Open-Meteo.
export function weatherEffect(code: number): WeatherEffect {
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return "rain";
  return "cloudy";
}

const EFFECT_LABEL: Record<WeatherEffect, string> = { clear: "맑음", cloudy: "흐림", rain: "비", snow: "눈", fog: "안개" };

// Suggested spot for the current weather; the person can still walk anywhere.
export function sceneForWeather(weather: Pick<CurrentWeather, "effect" | "isDay">): HealingSceneId {
  if (!weather.isDay) return "camp";
  if (weather.effect === "snow") return "snow-forest";
  if (weather.effect === "rain") return "rooftop";
  if (weather.effect === "fog") return "fishing";
  if (weather.effect === "cloudy") return "mountain";
  return "beach";
}

export function findScene(id: unknown): HealingScene {
  return HEALING_SCENES.find((scene) => scene.id === id) ?? HEALING_SCENES[0];
}

export function findCity(id: unknown): HealingCity {
  return HEALING_CITIES.find((city) => city.id === id) ?? HEALING_CITIES[0];
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function parseWeather(payload: unknown): CurrentWeather {
  const current = (payload as { current?: Record<string, unknown> } | null)?.current;
  const code = Number(current?.weather_code);
  if (!current || !Number.isFinite(code)) throw new Error("날씨 응답을 확인하지 못했습니다.");
  const effect = weatherEffect(code);
  const temperature = Number.isFinite(Number(current.temperature_2m)) ? Number(current.temperature_2m) : null;
  return { effect, isDay: Number(current.is_day) !== 0, temperature, label: EFFECT_LABEL[effect] };
}

export async function fetchCurrentWeather(city: HealingCity, signal?: AbortSignal): Promise<CurrentWeather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=weather_code,is_day,temperature_2m&timezone=Asia%2FSeoul`;
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("날씨를 불러오지 못했습니다.");
  return parseWeather(await response.json());
}

const STORAGE_KEY = "teams:healing";
export interface HealingPrefs { sceneId: HealingSceneId | "auto"; cityId: string; minutes: HealingMinutes }

export function loadHealingPrefs(): HealingPrefs {
  const fallback: HealingPrefs = { sceneId: "auto", cityId: "seoul", minutes: 10 };
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<HealingPrefs> | null;
    if (!raw) return fallback;
    return {
      sceneId: raw.sceneId === "auto" ? "auto" : findScene(raw.sceneId).id,
      cityId: findCity(raw.cityId).id,
      minutes: (HEALING_MINUTES as readonly number[]).includes(Number(raw.minutes)) ? (Number(raw.minutes) as HealingMinutes) : 10,
    };
  } catch {
    return fallback;
  }
}

export function saveHealingPrefs(prefs: HealingPrefs): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* Preferences are a convenience only. */ }
}

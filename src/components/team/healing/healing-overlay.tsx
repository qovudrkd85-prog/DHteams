"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CloudSun, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/components/account/provider";
import {
  fetchCurrentWeather, findCity, findScene, formatRemaining, HEALING_CITIES, HEALING_MINUTES, HEALING_SCENES,
  loadHealingPrefs, saveHealingPrefs, sceneForWeather,
  type CurrentWeather, type HealingMinutes, type HealingSceneId, type HealingPrefs, type WeatherEffect,
} from "@/lib/team/healing";
import { cn } from "@/lib/utils";
import { PanoramaViewer } from "./panorama-viewer";
import styles from "./healing.module.css";

interface HealingOverlayProps {
  onClose: () => void;
  /** Render inside the page area instead of a full-screen modal. */
  inline?: boolean;
  /** Extra controls shown above the scene chips, given the current scene. */
  children?: (sceneId: HealingSceneId) => ReactNode;
}

const HEALING_STATUS = "힐링 타임 중 · 잠시 쉬어요";

// Fire-and-forget restore that survives tab close/refresh.
function restoreOnUnload(statusMessage: string): void {
  try {
    void fetch("/api/account/status", { method: "PATCH", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statusMessage }) });
  } catch { /* Best effort only. */ }
}

function WeatherEffects({ effect }: { effect: WeatherEffect }) {
  // Fixed pseudo-random layout so renders stay stable.
  const particles = useMemo(() => Array.from({ length: effect === "rain" ? 70 : 45 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: ((i * 53) % 100) / 25,
    duration: effect === "rain" ? 0.7 + ((i * 17) % 10) / 20 : 6 + ((i * 29) % 10) / 2,
    scale: 0.6 + ((i * 13) % 10) / 15,
  })), [effect]);
  if (effect === "fog") return <div className={styles.effects}><div className={styles.fog} /></div>;
  if (effect !== "rain" && effect !== "snow") return null;
  const className = effect === "rain" ? styles.drop : styles.flake;
  return (
    <div className={styles.effects} aria-hidden data-testid={`healing-effect-${effect}`}>
      {particles.map((p, i) => (
        <span key={i} className={className} style={{ left: `${p.left}%`, animationDelay: `-${p.delay}s`, animationDuration: `${p.duration}s`, transform: `scale(${p.scale})` }} />
      ))}
    </div>
  );
}

// Full-screen personal rest view opened from my own desk.
export function HealingOverlay({ onClose, inline = false, children }: HealingOverlayProps) {
  const { account, updateStatus } = useAccount();
  const [prefs, setPrefs] = useState<HealingPrefs>(() => loadHealingPrefs());
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [imageResult, setImageResult] = useState<{ image: string; ok: boolean } | null>(null);
  const [endsAt, setEndsAt] = useState(() => Date.now() + prefs.minutes * 60_000);
  const [now, setNow] = useState(() => Date.now());
  const [reducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const statusAtOpen = useRef(account?.member.status_message ?? "");
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const sceneId = prefs.sceneId === "auto" ? (weather ? sceneForWeather(weather) : "beach") : prefs.sceneId;
  const scene = findScene(sceneId);
  const city = findCity(prefs.cityId);
  const remaining = endsAt - now;
  const imageState = imageResult?.image !== scene.image ? "loading" : imageResult.ok ? "ready" : "error";

  const update = useCallback((patch: Partial<HealingPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveHealingPrefs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (inline || event.key !== "Tab") return;
      // Keep focus inside the modal.
      const root = dialogRef.current;
      const focusable = root ? Array.from(root.querySelectorAll<HTMLElement>("button, select, canvas[tabindex], [tabindex='0']")).filter((el) => !el.hasAttribute("disabled")) : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!root?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, inline]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentWeather(city, controller.signal)
      .then((next) => { setWeather(next); setWeatherError(null); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setWeather(null);
        setWeatherError(error instanceof Error ? error.message : "날씨를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [city]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remaining > 0) return;
    toast.success("힐링 타임이 끝났어요. 다시 힘내 볼까요?");
    onClose();
  }, [remaining, onClose]);

  // Show teammates I am resting; restore the previous message when I leave. Failures never block the view.
  useEffect(() => {
    // A leftover message from an interrupted session is cleared instead of restored.
    const original = statusAtOpen.current === HEALING_STATUS ? "" : statusAtOpen.current;
    const applied = statusAtOpen.current === HEALING_STATUS
      ? Promise.resolve(true)
      : updateStatus(HEALING_STATUS).then((member) => member.status_message === HEALING_STATUS, () => false);
    let landed = false;
    void applied.then((ok) => { landed = ok; });
    const onPageHide = () => { if (landed) restoreOnUnload(original); };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void applied.then((ok) => {
        // Restore only after our own write landed; never undo a failed write.
        if (!ok) return;
        return updateStatus(original).then(() => undefined, () => { toast.error("상태 메시지를 되돌리지 못했어요. 내 설정에서 바꿔 주세요."); });
      });
    };
    // Run once per open; account changes during the session must not re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={dialogRef}
      role={inline ? "region" : "dialog"}
      aria-modal={inline ? undefined : true}
      aria-label={`힐링 타임 · ${scene.name}`}
      className={inline ? "relative h-[72vh] min-h-[440px] overflow-hidden rounded-2xl bg-black text-white shadow-sm" : "fixed inset-0 z-[80] bg-black text-white"}
      data-testid={inline ? "healing-place" : "healing-overlay"}
    >
      <PanoramaViewer
        key={scene.image}
        image={scene.image}
        label={`${scene.name} 360도 풍경`}
        autoRotate={!reducedMotion}
        onReady={() => setImageResult({ image: scene.image, ok: true })}
        onError={() => setImageResult({ image: scene.image, ok: false })}
      />
      <WeatherEffects effect={weather?.effect ?? "clear"} />
      <div className={styles.vignette} />
      {imageState === "loading" && <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80"><LoaderCircle className="size-4 animate-spin" />풍경을 불러오는 중…</div>}
      {imageState === "error" && <div role="alert" className="absolute inset-x-0 top-1/2 mx-auto w-fit rounded-lg bg-black/60 px-4 py-2 text-sm">풍경 사진을 불러오지 못했어요. 다른 장소를 골라 주세요.</div>}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/60 to-transparent p-4 sm:p-6">
        <div className="pointer-events-auto">
          <p className="text-xs text-white/70">힐링 타임</p>
          <h2 className="text-xl font-semibold">{scene.emoji} {scene.name}</h2>
          <p className="text-xs text-white/70">{scene.caption}</p>
          <p className="mt-2 flex items-center gap-1 text-xs text-white/80" data-testid="healing-weather">
            <CloudSun className="size-3.5" />
            {weather ? `${city.name} 지금 ${weather.label}${weather.temperature !== null ? ` · ${Math.round(weather.temperature)}°` : ""}` : weatherError ? `${weatherError} 기본 풍경을 보여 드려요.` : `${city.name} 날씨 확인 중…`}
          </p>
        </div>
        <div className="pointer-events-auto flex items-center gap-3">
          <span className="rounded-full bg-black/40 px-3 py-1 font-mono text-lg tabular-nums" aria-live="off" data-testid="healing-timer">{formatRemaining(remaining)}</span>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-full bg-white/15 p-2 hover:bg-white/25" aria-label={inline ? "정비실로 돌아오기 (Esc)" : "힐링 타임 끝내기 (Esc)"} data-testid="healing-close"><X className="size-5" /></button>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/70 to-transparent p-4 sm:p-6">
        {children?.(scene.id)}
        <div className="flex flex-wrap gap-2" role="group" aria-label="장소 고르기">
          <button type="button" aria-pressed={prefs.sceneId === "auto"} onClick={() => update({ sceneId: "auto" })} className={cn("rounded-full px-3 py-1.5 text-sm backdrop-blur", prefs.sceneId === "auto" ? "bg-white text-slate-900" : "bg-white/15 hover:bg-white/25")}>☁️ 지금 날씨대로</button>
          {HEALING_SCENES.map((item) => (
            <button key={item.id} type="button" aria-pressed={prefs.sceneId === item.id} onClick={() => update({ sceneId: item.id })} className={cn("rounded-full px-3 py-1.5 text-sm backdrop-blur", prefs.sceneId === item.id ? "bg-white text-slate-900" : "bg-white/15 hover:bg-white/25")}>{item.emoji} {item.name}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-white/80">
          <label className="flex items-center gap-1.5">도시
            <select value={city.id} onChange={(event) => update({ cityId: event.target.value })} className="rounded bg-black/40 px-2 py-1 text-white">
              {HEALING_CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <span className="flex items-center gap-1" role="group" aria-label="쉬는 시간">
            {HEALING_MINUTES.map((minutes) => (
              <button key={minutes} type="button" aria-pressed={prefs.minutes === minutes} onClick={() => { update({ minutes: minutes as HealingMinutes }); setEndsAt(Date.now() + minutes * 60_000); }} className={cn("rounded px-2 py-1", prefs.minutes === minutes ? "bg-white text-slate-900" : "bg-white/15 hover:bg-white/25")}>{minutes}분</button>
            ))}
          </span>
          <span className="hidden sm:inline">끌어서 둘러보기 · 휠로 확대 · 방향키 이동 · Esc 닫기</span>
        </div>
        <p className="text-[10px] text-white/50">풍경 사진: Poly Haven (CC0)</p>
      </div>
    </div>
  );
}

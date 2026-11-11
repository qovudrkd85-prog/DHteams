"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CloudSun, Maximize2, Minimize2, X } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/components/account/provider";
import {
  fetchCurrentWeather, findCity, findScene, formatRemaining, HEALING_CITIES, HEALING_MINUTES, HEALING_SCENES, YARD_NAME,
  loadHealingPrefs, saveHealingPrefs, sceneForWeather, startHealingStatus,
  type CurrentWeather, type HealingActivityId, type HealingMinutes, type HealingPrefs, type WeatherEffect,
} from "@/lib/team/healing";
import { showsHealingStatus, type BiomeId } from "@/lib/team/healing-trail";
import { cn } from "@/lib/utils";
import { HealingTrail, type TrailJump, type TrailReport } from "./healing-trail";
import styles from "./healing.module.css";

/** What the caption gets: where I am, what I am doing, and the one-line caption text. */
export interface HealingWorldContext {
  sceneId: BiomeId;
  activity: HealingActivityId;
  caption: string;
}

interface HealingOverlayProps {
  onClose: () => void;
  /** Render inside the page area instead of a full-screen modal. */
  inline?: boolean;
  /**
   * Small always-open window in the garage side column (implies inline): no close button or timer,
   * a "넓게 보기" toggle, and the status message only while I sit at an activity.
   */
  compact?: boolean;
  /** Caption drawn over the bottom-left of the picture. */
  children?: (ctx: HealingWorldContext) => ReactNode;
}

const ZONE_HEADER: Record<"yard", { emoji: string; name: string; caption: string }> = { yard: { emoji: "🌿", name: YARD_NAME, caption: "길을 따라 걸어 보세요." } };

function zoneHeader(zone: BiomeId): { emoji: string; name: string; caption: string } {
  return zone === "yard" ? ZONE_HEADER.yard : findScene(zone);
}

// Fire-and-forget restore that survives tab close/refresh.
function restoreOnUnload(statusMessage: string): void {
  try {
    void fetch("/api/account/status", { method: "PATCH", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statusMessage }) }).catch(() => undefined);
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

// Personal rest view: a full-screen modal (office desk) or the always-open small window in the garage.
export function HealingOverlay({ onClose, inline: inlineProp = false, compact = false, children }: HealingOverlayProps) {
  const inline = inlineProp || compact;
  // Garage window: always open, so being open is not "healing"; sitting at an activity is.
  const alwaysOpen = compact;
  const { account, updateStatus } = useAccount();
  const [prefs, setPrefs] = useState<HealingPrefs>(() => loadHealingPrefs());
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [startScene] = useState<BiomeId>(() => (prefs.sceneId === "auto" ? "yard" : prefs.sceneId));
  const [report, setReport] = useState<TrailReport>(() => ({ scene: startScene, activity: "walk", caption: "🚶 산책" }));
  const [jump, setJump] = useState<TrailJump | null>(null);
  const [wide, setWide] = useState(false);
  const [endsAt, setEndsAt] = useState(() => Date.now() + prefs.minutes * 60_000);
  const [now, setNow] = useState(() => Date.now());
  const statusAtOpen = useRef(account?.member.status_message ?? "");
  // Latest status, read when I sit down (the garage window stays open across status edits).
  const statusNow = useRef(account?.member.status_message ?? "");
  useEffect(() => { statusNow.current = account?.member.status_message ?? ""; }, [account]);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const wideRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Latest onClose for window listeners registered once per open.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Latest scene preference for the weather answer, which may arrive after the person changed it.
  const sceneIdRef = useRef(prefs.sceneId);
  useEffect(() => { sceneIdRef.current = prefs.sceneId; }, [prefs.sceneId]);
  const header = zoneHeader(report.scene);
  const city = findCity(prefs.cityId);
  const remaining = endsAt - now;
  const full = !inline || wide;
  const showTimer = !alwaysOpen;

  const update = useCallback((patch: Partial<HealingPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveHealingPrefs(next);
      return next;
    });
  }, []);

  const jumpTo = useCallback((sceneId: BiomeId, soft = false) => {
    setJump((prev) => ({ sceneId, nonce: (prev?.nonce ?? 0) + 1, soft }));
  }, []);
  const pickScene = (sceneId: HealingPrefs["sceneId"]) => {
    update({ sceneId });
    if (sceneId !== "auto") jumpTo(sceneId);
    else if (weather) jumpTo(sceneForWeather(weather));
  };

  // The modal takes focus when it opens; the always-open garage window never steals it.
  useEffect(() => {
    if (!alwaysOpen) closeRef.current?.focus();
  }, [alwaysOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const inside = event.target instanceof Node && Boolean(dialogRef.current?.contains(event.target));
      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        // Wide view: Esc goes back to the small window (same instance, nothing restarts).
        if (wide) { event.preventDefault(); setWide(false); return; }
        if (alwaysOpen) return;
        // Inline: only Esc from inside the place.
        if (!inline || inside) onClose();
        return;
      }
      if (!full || event.key !== "Tab") return;
      // Keep focus inside the modal / wide view.
      const root = dialogRef.current;
      const focusable = root ? Array.from(root.querySelectorAll<HTMLElement>("button, select, summary, [tabindex='0']")).filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0) : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!root?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, inline, alwaysOpen, wide, full]);

  // Leaving the wide view hands focus back to its toggle.
  const wasWide = useRef(false);
  useEffect(() => {
    if (wasWide.current && !wide) wideRef.current?.focus({ preventScroll: true });
    wasWide.current = wide;
  }, [wide]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentWeather(city, controller.signal)
      .then((next) => {
        setWeather(next);
        setWeatherError(null);
        // "지금 날씨대로": start where the weather suggests, unless the player already walked off.
        if (sceneIdRef.current === "auto") jumpTo(sceneForWeather(next), true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setWeather(null);
        setWeatherError(error instanceof Error ? error.message : "날씨를 불러오지 못했습니다.");
      });
    return () => controller.abort();
    // Refetch on city change only; the scene preference is read (via ref) when the answer arrives.
  }, [city, jumpTo]);

  useEffect(() => {
    if (!showTimer) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [showTimer]);

  useEffect(() => {
    if (!showTimer || remaining > 0) return;
    toast.success("힐링 타임이 끝났어요. 다시 힘내 볼까요?");
    onClose();
  }, [showTimer, remaining, onClose]);

  // Show teammates I am resting; restore the previous message when I stop. Failures never block the view.
  // Modal: for the whole open. Garage window: only while I sit at an activity.
  const statusActive = alwaysOpen ? showsHealingStatus(report.activity) : true;
  useEffect(() => {
    if (!statusActive) return;
    const session = startHealingStatus(alwaysOpen ? statusNow.current : statusAtOpen.current, updateStatus);
    const onPageHide = () => {
      const message = session.unload();
      if (message !== null) restoreOnUnload(message);
    };
    // Back from bfcache: the status was already restored, so end the modal too (reopen starts a fresh session).
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted && !alwaysOpen) onCloseRef.current(); };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      session.end().catch(() => { toast.error("상태 메시지를 되돌리지 못했어요. 내 설정에서 바꿔 주세요."); });
    };
    // One session per sitting (garage) or per open (modal); account changes must not re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusActive]);

  const ctx: HealingWorldContext = { sceneId: report.scene, activity: report.activity, caption: report.caption };
  const weatherText = weather ? `${city.name} 지금 ${weather.label}${weather.temperature !== null ? ` · ${Math.round(weather.temperature)}°` : ""}` : weatherError ? `${weatherError} 기본 풍경을 보여 드려요.` : `${city.name} 날씨 확인 중…`;
  const closeLabel = inline ? "정비실로 돌아오기 (Esc)" : "힐링 타임 끝내기 (Esc)";
  const iconButton = "flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 hover:bg-white/25 sm:size-8";

  // One tree for every mode; only classes change, so the wide toggle never remounts the walk.
  return (
    <div
      ref={dialogRef}
      role={inline ? "region" : "dialog"}
      aria-modal={inline ? undefined : true}
      aria-label={`힐링 타임 · ${header.name}`}
      className={cn(
        "flex flex-col overflow-hidden bg-slate-900 text-white",
        // m-0: the side column's space-y margin must not shrink the full-screen view.
        full ? "fixed inset-0 z-[80] m-0" : compact ? "rounded-2xl shadow-sm" : "relative h-[72vh] min-h-[440px] rounded-2xl shadow-sm",
      )}
      data-testid={inline ? "healing-place" : "healing-overlay"}
      data-compact={compact ? "true" : undefined}
      data-wide={wide ? "true" : undefined}
      data-healing-wide={wide ? "" : undefined}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className={cn("truncate font-semibold", full ? "text-base" : "text-sm")} data-testid="healing-zone">{header.emoji} {header.name}</h2>
          <p className="flex items-center gap-1 truncate text-[11px] text-white/70" data-testid="healing-weather"><CloudSun className="size-3 shrink-0" /><span className="truncate">{weatherText}</span></p>
        </div>
        {showTimer && <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 font-mono text-sm tabular-nums" aria-live="off" data-testid="healing-timer">{formatRemaining(remaining)}</span>}
        {!alwaysOpen && <button ref={closeRef} type="button" onClick={onClose} className={iconButton} aria-label={closeLabel} data-testid="healing-close"><X className="size-4" /></button>}
      </div>
      <div className={cn("relative w-full overflow-hidden bg-black", full || !compact ? "min-h-0 flex-1" : "aspect-video")}>
        <HealingTrail
          startScene={startScene}
          jump={jump}
          member={account?.member ?? null}
          isDay={weather?.isDay ?? true}
          effect={weather?.effect ?? "clear"}
          wide={full}
          focusRoot={dialogRef}
          onReport={setReport}
        />
        <WeatherEffects effect={weather?.effect ?? "clear"} />
        <div className={styles.vignette} />
        <div className="pointer-events-none absolute bottom-2 left-2 max-w-[70%]" aria-live="off">
          {children ? children(ctx) : <span className="truncate rounded-full bg-black/50 px-2 py-0.5 text-xs">{ctx.caption}</span>}
        </div>
        {alwaysOpen && (
          <button
            ref={wideRef}
            type="button"
            onClick={() => setWide((value) => !value)}
            className={cn(iconButton, "absolute bottom-1.5 right-1.5 bg-black/40")}
            aria-label={wide ? "작은 창으로 (Esc)" : "넓게 보기"}
            aria-pressed={wide}
            data-testid="healing-wide"
          >
            {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        )}
      </div>
      <details className="px-3 py-1 text-xs text-white/80">
        <summary className="cursor-pointer select-none py-1">설정</summary>
        <div className="flex flex-wrap items-center gap-3 pb-2 pt-1">
          <label className="flex items-center gap-1.5">시작 장소
            <select aria-label="시작 장소" value={prefs.sceneId} onChange={(event) => pickScene(event.target.value as HealingPrefs["sceneId"])} className="rounded bg-black/40 px-2 py-1 text-white">
              <option value="auto">☁️ 지금 날씨대로</option>
              {HEALING_SCENES.map((item) => <option key={item.id} value={item.id}>{item.emoji} {item.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">도시
            <select value={city.id} onChange={(event) => update({ cityId: event.target.value })} className="rounded bg-black/40 px-2 py-1 text-white">
              {HEALING_CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {showTimer && (
            <span className="flex items-center gap-1" role="group" aria-label="쉬는 시간">
              {HEALING_MINUTES.map((minutes) => (
                <button key={minutes} type="button" aria-pressed={prefs.minutes === minutes} onClick={() => { update({ minutes: minutes as HealingMinutes }); setEndsAt(Date.now() + minutes * 60_000); }} className={cn("rounded px-2 py-1", prefs.minutes === minutes ? "bg-white text-slate-900" : "bg-white/15 hover:bg-white/25")}>{minutes}분</button>
              ))}
            </span>
          )}
          <span className="hidden sm:inline">↑↓ 걷기 · 표지판 앞에서 ←/→ 로 들어가기 · 탭하면 걷기/멈춤</span>
        </div>
      </details>
    </div>
  );
}

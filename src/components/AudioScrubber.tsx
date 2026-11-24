import { useEffect, useMemo, useRef, useState } from "react";
import Pause from "lucide-react/icons/pause";
import Play from "lucide-react/icons/play";
import Volume2 from "lucide-react/icons/volume-2";
import VolumeX from "lucide-react/icons/volume-x";
import ZoomIn from "lucide-react/icons/zoom-in";

interface AudioScrubberProps {
  src: string;
  durationHintSec: number;
  seekRequest: { sec: number; nonce: number } | null;
  onTimeUpdate: (sec: number, playing: boolean) => void;
  onPlayheadChange: (sec: number) => void;
}

type ZoomWindow = "full" | 240 | 60; // full, 4-min window (±2m), 1-min window (±30s)

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }
  return `${m}:${String(rem).padStart(2, "0")}`;
}

function parseClock(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

const SPEEDS = [1, 1.25, 1.5, 2] as const;

export function AudioScrubber({
  src,
  durationHintSec,
  seekRequest,
  onTimeUpdate,
  onPlayheadChange,
}: AudioScrubberProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(Math.max(0, durationHintSec));
  const [muted, setMuted] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [zoom, setZoom] = useState<ZoomWindow>(
    durationHintSec > 600 ? 240 : "full"
  );
  const [editingTime, setEditingTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState("");
  const [windowAnchor, setWindowAnchor] = useState(0);

  // Sync duration hint when audio is trimmed or reloaded
  useEffect(() => {
    setDuration(Math.max(0, durationHintSec));
    setCurrentTime(0);
    setWindowAnchor(0);
    setPlaying(false);
    setZoom(durationHintSec > 600 ? 240 : "full");
  }, [src, durationHintSec]);

  // Honor external seek requests (e.g. clicking a transcript turn)
  useEffect(() => {
    if (!seekRequest || !audioRef.current) return;
    const target = Math.max(0, Math.min(duration || Infinity, seekRequest.sec));
    audioRef.current.currentTime = target;
    setCurrentTime(target);
    setWindowAnchor(target);
    onPlayheadChange(target);
    void audioRef.current.play().catch(() => {});
  }, [seekRequest, duration, onPlayheadChange]);

  const effectiveDuration = Math.max(duration, durationHintSec, 1);

  const seekTo = (nextSec: number, recenterFine = true) => {
    const clamped = Math.max(0, Math.min(effectiveDuration, nextSec));
    if (audioRef.current) {
      audioRef.current.currentTime = clamped;
    }
    setCurrentTime(clamped);
    if (recenterFine) {
      setWindowAnchor(clamped);
    }
    onPlayheadChange(clamped);
    onTimeUpdate(clamped, playing);
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = SPEEDS[next];
    }
  };

  // Compute the fine zoomed window bounds around `windowAnchor`
  const fineBounds = useMemo(() => {
    if (zoom === "full" || effectiveDuration <= zoom) {
      return { start: 0, end: effectiveDuration };
    }
    const half = zoom / 2;
    let start = windowAnchor - half;
    let end = windowAnchor + half;
    if (start < 0) {
      end = Math.min(effectiveDuration, zoom);
      start = 0;
    } else if (end > effectiveDuration) {
      start = Math.max(0, effectiveDuration - zoom);
      end = effectiveDuration;
    }
    return { start, end };
  }, [zoom, windowAnchor, effectiveDuration]);

  // Keep the zoomed window gently centered if playback moves outside it
  useEffect(() => {
    if (zoom === "full") return;
    if (currentTime < fineBounds.start || currentTime > fineBounds.end) {
      setWindowAnchor(currentTime);
    }
  }, [currentTime, fineBounds.start, fineBounds.end, zoom]);

  const fineSpan = Math.max(1, fineBounds.end - fineBounds.start);
  const finePct = Math.max(
    0,
    Math.min(100, ((currentTime - fineBounds.start) / fineSpan) * 100)
  );
  const overviewPct = Math.max(
    0,
    Math.min(100, (currentTime / effectiveDuration) * 100)
  );

  return (
    <div className="space-y-2 select-none">
      {/* Hidden native audio element driving actual playback */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        muted={muted}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          const isPlaying = !e.currentTarget.paused;
          setCurrentTime(t);
          onPlayheadChange(t);
          onTimeUpdate(t, isPlaying);
        }}
        onPlay={() => {
          setPlaying(true);
          onTimeUpdate(audioRef.current?.currentTime || 0, true);
        }}
        onPause={() => {
          setPlaying(false);
          onTimeUpdate(audioRef.current?.currentTime || 0, false);
        }}
        onEnded={() => {
          setPlaying(false);
          onTimeUpdate(0, false);
        }}
      />

      {/* Row 1: Play/Pause + Editable Jump-to-Timecode + Speed + Mute */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={togglePlay}
            className="w-7 h-7 rounded-full bg-stone-900 text-white hover:bg-stone-800 flex items-center justify-center shrink-0 transition"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            )}
          </button>

          {editingTime ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = parseClock(timeDraft);
                if (parsed !== null) seekTo(parsed, true);
                setEditingTime(false);
              }}
              className="flex items-center gap-1"
            >
              <input
                autoFocus
                value={timeDraft}
                onChange={(e) => setTimeDraft(e.target.value)}
                onBlur={() => setEditingTime(false)}
                placeholder="m:ss"
                className="w-16 font-mono-code text-xs bg-white border border-blue-400 rounded px-1.5 py-0.5 outline-none"
              />
              <span className="font-mono-code text-[11px] text-stone-400">
                / {formatClock(effectiveDuration)}
              </span>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setTimeDraft(formatClock(currentTime));
                setEditingTime(true);
              }}
              title="Click to jump to an exact timestamp (e.g. 2:15 or 1:05:30)"
              className="font-mono-code text-xs font-medium text-stone-800 hover:bg-stone-200/70 px-1.5 py-0.5 rounded transition"
            >
              {formatClock(currentTime)}{" "}
              <span className="text-stone-400">
                / {formatClock(effectiveDuration)}
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={cycleSpeed}
            className="px-1.5 py-0.5 rounded-md bg-white border border-stone-200 text-[10px] font-mono-code font-semibold text-stone-600 hover:bg-stone-100"
            title="Playback speed"
          >
            {SPEEDS[speedIdx]}×
          </button>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="p-1 rounded-md text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Row 2: Full-Clip Overview Bar (when zoomed, shows highlighted window!) */}
      <div className="space-y-1">
        <div className="relative h-2.5 flex items-center">
          <div className="w-full h-1.5 rounded-full bg-stone-200 relative overflow-hidden">
            {zoom !== "full" && effectiveDuration > zoom && (
              <div
                style={{
                  left: `${(fineBounds.start / effectiveDuration) * 100}%`,
                  width: `${(fineSpan / effectiveDuration) * 100}%`,
                }}
                className="absolute inset-y-0 bg-blue-200/90"
              />
            )}
            <div
              style={{ width: `${overviewPct}%` }}
              className="absolute inset-y-0 left-0 bg-stone-700/70 rounded-full"
            />
          </div>
          <input
            type="range"
            min={0}
            max={effectiveDuration}
            step={1}
            value={currentTime}
            onChange={(e) => seekTo(Number(e.target.value), true)}
            aria-label="Full audio timeline"
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
        </div>

        {/* Row 3: Zoomed Fine Scrubber (sub-second precision even on 3-hour files!) */}
        {effectiveDuration > 90 && (
          <div className="pt-0.5 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-stone-500">
              <span className="inline-flex items-center gap-1 font-medium">
                <ZoomIn className="w-3 h-3 text-blue-600" />
                Fine scrub
              </span>
              <div className="inline-flex items-center gap-0.5 bg-stone-200/70 p-0.5 rounded-md">
                {(
                  [
                    [60, "1m"],
                    [240, "4m"],
                    ["full", "Full"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => {
                      setZoom(val);
                      setWindowAnchor(currentTime);
                    }}
                    className={`px-1.5 py-0.2 rounded text-[10px] font-semibold transition ${
                      zoom === val
                        ? "bg-white text-stone-900 shadow-2xs"
                        : "text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {zoom !== "full" && (
              <div>
                <div
                  onWheel={(e) => {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? 2 : -2;
                    seekTo(currentTime + delta, false);
                  }}
                  title="Drag for second-by-second scrubbing, or scroll wheel to nudge ±2s"
                  className="relative h-5 flex items-center"
                >
                  <div className="w-full h-2 rounded-full bg-blue-100 border border-blue-200/80 relative overflow-hidden">
                    <div
                      style={{ width: `${finePct}%` }}
                      className="absolute inset-y-0 left-0 bg-blue-600 rounded-full"
                    />
                  </div>
                  {/* Playhead knob */}
                  <div
                    style={{ left: `calc(${finePct}% - 6px)` }}
                    className="absolute w-3 h-3 rounded-full bg-white border-2 border-blue-700 shadow-xs pointer-events-none"
                  />
                  <input
                    type="range"
                    min={fineBounds.start}
                    max={fineBounds.end}
                    step={0.25}
                    value={Math.max(
                      fineBounds.start,
                      Math.min(fineBounds.end, currentTime)
                    )}
                    onChange={(e) => seekTo(Number(e.target.value), false)}
                    aria-label="Zoomed fine audio scrubber"
                    className="absolute inset-0 w-full opacity-0 cursor-pointer"
                  />
                </div>
                <div className="flex items-center justify-between font-mono-code text-[9px] text-stone-400">
                  <span>{formatClock(fineBounds.start)}</span>
                  <span>{formatClock((fineBounds.start + fineBounds.end) / 2)}</span>
                  <span>{formatClock(fineBounds.end)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 4: Quick Precision Jump Buttons */}
      <div className="grid grid-cols-8 gap-1">
        {(
          [
            [-60, "-1m"],
            [-15, "-15s"],
            [-5, "-5s"],
            [-1, "-1s"],
            [1, "+1s"],
            [5, "+5s"],
            [15, "+15s"],
            [60, "+1m"],
          ] as const
        ).map(([delta, label]) => (
          <button
            key={label}
            type="button"
            onClick={() => seekTo(currentTime + delta, Math.abs(delta) >= 15)}
            className="py-1 rounded-md bg-white border border-stone-200 text-[10px] font-mono-code font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition"
            title={`Jump ${label}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

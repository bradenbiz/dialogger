import { useEffect, useState } from "react";
import { Clock, Loader2, Sparkles, X, Youtube } from "lucide-react";
import type { DialogueSession } from "@shared/schemas/models";
import { api, type YouTubeMetadata } from "@/lib/api";
import { formatTime } from "@/lib/export";

interface YouTubeModalProps {
  session: DialogueSession;
  onClose: () => void;
  onStartImport: (params: {
    url: string;
    startSec?: number;
    durationSec?: number;
    asrModel?: string;
    createNewSession?: boolean;
  }) => Promise<void>;
}

function parseStartTimeFromUrl(url: string): number {
  try {
    const parsed = new URL(url.trim());
    const t = parsed.searchParams.get("t") || parsed.searchParams.get("start");
    if (!t) return 0;
    if (/^\d+$/.test(t)) return Number(t);
    let sec = 0;
    const h = t.match(/(\d+)h/i);
    const m = t.match(/(\d+)m/i);
    const s = t.match(/(\d+)s/i);
    if (h) sec += Number(h[1]) * 3600;
    if (m) sec += Number(m[1]) * 60;
    if (s) sec += Number(s[1]);
    return sec;
  } catch {
    return 0;
  }
}

export function YouTubeModal({
  session,
  onClose,
  onStartImport,
}: YouTubeModalProps) {
  const [url, setUrl] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [meta, setMeta] = useState<YouTubeMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clipPreset, setClipPreset] = useState<"2m" | "5m" | "full" | "custom">(
    "2m"
  );
  const [startSec, setStartSec] = useState(0);
  const [customDurationSec, setCustomDurationSec] = useState(180);
  const [asrModel, setAsrModel] = useState(
    session.speechConfig.streamingAsrModel || "nemotron-3.5"
  );
  const hasExistingContent =
    session.turns.length > 0 || session.nodes.length > 0 || Boolean(session.audio);
  const [createNewSession, setCreateNewSession] = useState(hasExistingContent);
  const [submitting, setSubmitting] = useState(false);

  // Auto-parse ?t= timestamp when pasting a YouTube URL
  useEffect(() => {
    const t = parseStartTimeFromUrl(url);
    if (t > 0) setStartSec(t);
  }, [url]);

  const handleInspect = async () => {
    if (!url.trim()) return;
    setInspecting(true);
    setError(null);
    try {
      const { metadata } = await api.inspectYouTube(url.trim());
      setMeta(metadata);
      // If video is already short (<= 5 min), default to Full video!
      if (metadata.durationSec > 0 && metadata.durationSec <= 300) {
        setClipPreset("full");
      }
    } catch (err) {
      setMeta(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInspecting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || submitting) return;
    setError(null);
    setSubmitting(true);

    const durationSec =
      clipPreset === "2m"
        ? 120
        : clipPreset === "5m"
          ? 300
          : clipPreset === "custom"
            ? Math.max(15, customDurationSec)
            : undefined;

    try {
      // Close modal right away so user watches live progress + audio + map appear in real time
      const promise = onStartImport({
        url: url.trim(),
        startSec: startSec > 0 ? startSec : undefined,
        durationSec,
        asrModel,
        createNewSession,
      });
      onClose();
      await promise;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-stone-200 rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              <Youtube className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-stone-900">
                Import YouTube Conversation
              </h2>
              <p className="text-xs text-stone-500">
                Downloads audio locally, diarizes up to 8 speakers, and maps live with synced playback.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800">
              {error}
            </div>
          )}

          {/* URL Input */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-1.5">
              YouTube URL
            </label>
            <div className="flex gap-2">
              <input
                autoFocus
                type="url"
                required
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setMeta(null);
                }}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  if (pasted && /youtu\.?be/i.test(pasted)) {
                    setTimeout(() => void handleInspect(), 100);
                  }
                }}
                placeholder="https://www.youtube.com/watch?v=..."
                className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 outline-none focus:bg-white focus:border-blue-500"
              />
              <button
                type="button"
                disabled={!url.trim() || inspecting}
                onClick={() => void handleInspect()}
                className="px-3 py-2 rounded-xl bg-stone-100 border border-stone-200 text-stone-700 font-semibold hover:bg-stone-200/70 disabled:opacity-40"
              >
                {inspecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Check"
                )}
              </button>
            </div>
          </div>

          {/* Inspected Metadata Card */}
          {meta && (
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200/90 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-stone-900 truncate text-sm">
                  {meta.title}
                </div>
                <div className="text-[11px] text-stone-500 truncate">
                  {meta.channel || "YouTube"}
                </div>
              </div>
              {meta.durationSec > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-stone-200 font-mono-code text-[11px] text-stone-600 shrink-0">
                  <Clock className="w-3 h-3" />
                  {formatTime(meta.durationSec)}
                </span>
              )}
            </div>
          )}

          {/* Clip Length Selector */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-1.5">
              Segment to Transcribe &amp; Diarize
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  ["2m", "2 min clip"],
                  ["5m", "5 min clip"],
                  ["full", "Full video"],
                  ["custom", "Custom"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setClipPreset(id)}
                  className={`py-2 px-2 rounded-xl border font-semibold transition ${
                    clipPreset === id
                      ? "bg-stone-900 text-white border-stone-900"
                      : "bg-white border-stone-200 text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-stone-500">
              Tip: A 2-minute clip from a podcast/panel transcribes &amp; diarizes in ~20s on CPU and gives you synced audio playback immediately.
            </p>

            {(clipPreset === "custom" || startSec > 0) && (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-stone-400 mb-1">
                    Start offset (seconds)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={startSec}
                    onChange={(e) => setStartSec(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono-code"
                  />
                </div>
                {clipPreset === "custom" && (
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-stone-400 mb-1">
                      Clip length (seconds)
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={7200}
                      value={customDurationSec}
                      onChange={(e) =>
                        setCustomDurationSec(Math.max(15, Number(e.target.value)))
                      }
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono-code"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Model Selection */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[10px] font-semibold uppercase text-stone-400 mb-1">
                Local ASR Model
              </label>
              <select
                value={asrModel}
                onChange={(e) => setAsrModel(e.target.value)}
                className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-medium text-stone-800"
              >
                <option value="nemotron-3.5">
                  Nemotron 3.5 Streaming (Live map)
                </option>
                <option value="parakeet-tdt">
                  Parakeet TDT 0.6B v3 (Offline batch)
                </option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase text-stone-400 mb-1">
                Local Diarization
              </label>
              <div className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 font-medium text-stone-600 truncate">
                Nemotron 3 Diarization (8 spk)
              </div>
            </div>
          </div>

          {hasExistingContent && (
            <label className="flex items-center gap-2 text-xs text-stone-600 cursor-pointer">
              <input
                type="checkbox"
                checked={createNewSession}
                onChange={(e) => setCreateNewSession(e.target.checked)}
                className="rounded border-stone-300 text-blue-600"
              />
              Open in a new session (keeps your current map separate)
            </label>
          )}

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-stone-200 text-stone-600 font-medium hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!url.trim() || submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-stone-900 text-white font-semibold hover:bg-stone-800 disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Transcribe, Diarize &amp; Map
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

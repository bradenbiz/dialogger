import { lazy, Suspense, useEffect, useRef, useState } from "react";
import AudioLines from "lucide-react/icons/audio-lines";
import Check from "lucide-react/icons/check";
import ChevronDown from "lucide-react/icons/chevron-down";
import Edit3 from "lucide-react/icons/pen-line";
import ExternalLink from "lucide-react/icons/external-link";
import Layers from "lucide-react/icons/layers";
import Play from "lucide-react/icons/play";
import Plus from "lucide-react/icons/plus";
import Scissors from "lucide-react/icons/scissors";
import Send from "lucide-react/icons/send";
import Sparkles from "lucide-react/icons/sparkles";
import Square from "lucide-react/icons/square";
import UploadCloud from "lucide-react/icons/cloud-upload";
import Users from "lucide-react/icons/users";
import Volume2 from "lucide-react/icons/volume-2";
import type { DialogueSession, Speaker, TranscriptTurn } from "@shared/schemas/models";
import { formatTime } from "@/lib/format";
import { Skeleton } from "@/components/Skeleton";

// The scrubber only shows for sessions with audio, so it loads separately from the main bundle
const AudioScrubber = lazy(() =>
  import("./AudioScrubber").then((m) => ({ default: m.AudioScrubber }))
);

const PANEL_CLASS =
  "w-[360px] xl:w-[400px] border-r border-stone-200/90 bg-white flex flex-col shrink-0 relative";

/** The transcript panel while its session loads: the real header, with skeleton turns. */
export function TranscriptPanelSkeleton() {
  return (
    <aside className={PANEL_CLASS} aria-busy="true">
      <div className="px-4 py-3 border-b border-stone-200/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AudioLines className="w-4 h-4 text-stone-500" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-600">
            Diarized Transcript
          </h2>
          <Skeleton className="w-5 h-3" />
        </div>
        <Skeleton className="w-16 h-3" />
      </div>
      <div className="flex-1 p-3 space-y-3 overflow-hidden">
        {["w-11/12", "w-2/3", "w-full", "w-3/5"].map((w, i) => (
          <div key={i} className="rounded-xl border border-stone-100 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="w-20 h-3" />
              <Skeleton className="w-10 h-3" />
            </div>
            <Skeleton className="block w-full h-3" />
            <Skeleton className={`block ${w} h-3`} />
          </div>
        ))}
      </div>
    </aside>
  );
}

interface TranscriptPanelProps {
  session: DialogueSession;
  partialText: string;
  highlightedTurnIds: Set<string>;
  playingTurnId: string | null;
  seekRequest: { sec: number; nonce: number } | null;
  activeSpeakerFilter: string | null;
  mapperBusy: boolean;
  isTranscribing: boolean;
  onAudioTimeUpdate: (sec: number, playing: boolean) => void;
  onTranscribeSavedAudio: (startSec: number) => void;
  onTrimAudio: (params: {
    startSec: number;
    endSec?: number;
    clearTranscriptAndMap?: boolean;
  }) => Promise<void>;
  onStopTranscribing: () => void;
  onSelectTurn: (turn: TranscriptTurn) => void;
  onReassignTurnSpeaker: (
    turnId: string,
    patch: { speakerId?: string; speakerName?: string }
  ) => void;
  onFilterSpeaker: (speakerId: string | null) => void;
  onRenameSpeaker: (speakerId: string, name: string) => void;
  onSubmitManualTurn: (speakerChannel: number, text: string) => Promise<void>;
  onToggleAutoMap: (enabled: boolean) => void;
  onAnalyzeUnmapped: () => void;
  onDropAudioFile: (file: File) => void;
}

export function TranscriptPanel({
  session,
  partialText,
  highlightedTurnIds,
  playingTurnId,
  seekRequest,
  activeSpeakerFilter,
  mapperBusy,
  isTranscribing,
  onAudioTimeUpdate,
  onTranscribeSavedAudio,
  onTrimAudio,
  onStopTranscribing,
  onSelectTurn,
  onReassignTurnSpeaker,
  onFilterSpeaker,
  onRenameSpeaker,
  onSubmitManualTurn,
  onToggleAutoMap,
  onAnalyzeUnmapped,
  onDropAudioFile,
}: TranscriptPanelProps) {
  const [editingSpeakerId, setEditingSpeakerId] = useState<string | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState("");
  const [manualSpeaker, setManualSpeaker] = useState(1);
  const [manualText, setManualText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [speakerMenuTurnId, setSpeakerMenuTurnId] = useState<string | null>(null);
  const [newSpeakerDraft, setNewSpeakerDraft] = useState("");
  const [showTrimPanel, setShowTrimPanel] = useState(false);
  const [trimStartInput, setTrimStartInput] = useState("0:00");
  const [trimEndInput, setTrimEndInput] = useState("");
  const [trimClearMap, setTrimClearMap] = useState(true);
  const [trimming, setTrimming] = useState(false);

  const parseTimestampInput = (raw: string): number | undefined => {
    const t = raw.trim();
    if (!t) return undefined;
    if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
    const parts = t.split(":").map((p) => Number(p));
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return undefined;
  };

  const listEndRef = useRef<HTMLDivElement>(null);
  const turnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!playingTurnId || isTranscribing) return;
    const el = turnRefs.current.get(playingTurnId);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [playingTurnId, isTranscribing]);

  const speakerMap = new Map<string, Speaker>(
    session.speakers.map((s) => [s.id, s])
  );
  const unmappedCount = session.turns.filter((t) => !t.mapped).length;

  // Scroll highlighted turn into view when user explicitly clicks a map node
  useEffect(() => {
    const firstId = Array.from(highlightedTurnIds)[0];
    if (firstId) {
      const el = turnRefs.current.get(firstId);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedTurnIds]);

  const handleManualSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = manualText.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await onSubmitManualTurn(manualSpeaker, text);
      setManualText("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onDropAudioFile(file);
  };

  const visibleTurns = activeSpeakerFilter
    ? session.turns.filter((t) => t.speakerId === activeSpeakerFilter)
    : session.turns;

  // Map turnId -> linked IBIS node count
  const nodeCountByTurn = new Map<string, number>();
  for (const node of session.nodes) {
    for (const tid of node.turnIds) {
      nodeCountByTurn.set(tid, (nodeCountByTurn.get(tid) || 0) + 1);
    }
  }

  return (
    <aside
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`${PANEL_CLASS} transition ${
        dragOver ? "ring-2 ring-inset ring-blue-500 bg-blue-50/30" : ""
      }`}
    >
      {dragOver && (
        <div className="absolute inset-0 z-30 bg-blue-50/90 backdrop-blur-xs flex flex-col items-center justify-center gap-2 pointer-events-none">
          <UploadCloud className="w-10 h-10 text-blue-600" />
          <p className="text-sm font-semibold text-blue-900">
            Drop audio file to transcribe &amp; diarize locally
          </p>
          <p className="text-xs text-blue-700">
            {session.speechConfig.offlineAsrModel} + {session.speechConfig.diarizationModel}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="px-4 py-3 border-b border-stone-200/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AudioLines className="w-4 h-4 text-stone-500" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-600">
            Diarized Transcript
          </h2>
          <span className="text-[11px] font-mono-code text-stone-400">
            ({session.turns.length})
          </span>
        </div>

        <label
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-stone-600 cursor-pointer select-none"
          title="Automatically map new diarized turns onto the Conklin Dialogue Map"
        >
          <input
            type="checkbox"
            checked={session.autoMap}
            onChange={(e) => onToggleAutoMap(e.target.checked)}
            className="rounded border-stone-300 text-blue-600 focus:ring-blue-500"
          />
          Auto-map
        </label>
      </div>

      {/* Attached Audio Player (Synced with Diarized Transcript & Map!) */}
      {session.audio && (
        <div className="px-3.5 py-2.5 border-b border-stone-200/80 bg-stone-50/90 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-stone-700 truncate">
              <Volume2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span className="truncate">
                {session.audio.sourceTitle || "Session Audio"}
              </span>
            </span>
            {session.audio.sourceUrl && (
              <a
                href={session.audio.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-700 hover:underline shrink-0"
              >
                YouTube <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>
          <Suspense fallback={<Skeleton className="block w-full h-[79px] rounded-lg" />}>
            <AudioScrubber
              src={`/api/sessions/${encodeURIComponent(session.id)}/audio?v=${encodeURIComponent(session.updatedAt)}`}
              durationHintSec={session.audio.durationSec}
              seekRequest={seekRequest}
              onTimeUpdate={onAudioTimeUpdate}
              onPlayheadChange={setPlayheadSec}
            />
          </Suspense>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            {isTranscribing ? (
              <button
                type="button"
                onClick={onStopTranscribing}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-semibold hover:bg-rose-700 transition"
              >
                <Square className="w-3 h-3 fill-current" />
                Stop Diarizing
              </button>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => onTranscribeSavedAudio(0)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-900 text-white text-[11px] font-semibold hover:bg-stone-800 transition"
                >
                  <Play className="w-3 h-3 fill-current text-amber-400" />
                  {session.turns.length > 0
                    ? "Re-diarize & Map from 0:00"
                    : "Diarize & Map Audio"}
                </button>
                {playheadSec >= 3 && (
                  <button
                    type="button"
                    onClick={() => onTranscribeSavedAudio(Math.floor(playheadSec))}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-stone-200 text-stone-700 text-[11px] font-medium hover:bg-stone-100 transition"
                    title="Start diarizing and mapping from the current audio playhead position"
                  >
                    From {formatTime(playheadSec)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!showTrimPanel && playheadSec > 0) {
                      setTrimStartInput(formatTime(playheadSec));
                    }
                    setTrimClearMap(session.turns.length > 0);
                    setShowTrimPanel((v) => !v);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition ${
                    showTrimPanel
                      ? "bg-stone-900 text-white border-stone-900"
                      : "bg-white border-stone-200 text-stone-700 hover:bg-stone-100"
                  }`}
                  title="Clip/trim intro or outro from the saved audio file"
                >
                  <Scissors className="w-3 h-3" />
                  Trim
                </button>
              </div>
            )}
          </div>

          {showTrimPanel && !isTranscribing && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const s = parseTimestampInput(trimStartInput);
                const end = parseTimestampInput(trimEndInput);
                if (s === undefined) return;
                setTrimming(true);
                try {
                  await onTrimAudio({
                    startSec: s,
                    endSec: end,
                    clearTranscriptAndMap: trimClearMap,
                  });
                  setShowTrimPanel(false);
                  setTrimStartInput("0:00");
                  setTrimEndInput("");
                  setPlayheadSec(0);
                } finally {
                  setTrimming(false);
                }
              }}
              className="mt-2 p-2.5 rounded-xl bg-white border border-stone-200 space-y-2 text-[11px]"
            >
              <div className="font-semibold text-stone-700">
                Clip Audio (remove marketing intro / outro)
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex items-center justify-between text-[10px] text-stone-400 mb-0.5">
                    <span>Start (m:ss)</span>
                    <button
                      type="button"
                      onClick={() => setTrimStartInput(formatTime(playheadSec))}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Use {formatTime(playheadSec)}
                    </button>
                  </div>
                  <input
                    value={trimStartInput}
                    onChange={(e) => setTrimStartInput(e.target.value)}
                    placeholder="e.g. 2:15"
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 font-mono-code text-xs"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between text-[10px] text-stone-400 mb-0.5">
                    <span>End (optional)</span>
                    <button
                      type="button"
                      onClick={() => setTrimEndInput(formatTime(playheadSec))}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Use {formatTime(playheadSec)}
                    </button>
                  </div>
                  <input
                    value={trimEndInput}
                    onChange={(e) => setTrimEndInput(e.target.value)}
                    placeholder="End of file"
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 font-mono-code text-xs"
                  />
                </div>
              </div>
              {session.turns.length > 0 && (
                <label className="flex items-center gap-1.5 text-[11px] text-stone-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trimClearMap}
                    onChange={(e) => setTrimClearMap(e.target.checked)}
                    className="rounded border-stone-300 text-blue-600"
                  />
                  Reset transcript &amp; map after trimming
                </label>
              )}
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowTrimPanel(false)}
                  className="px-2 py-1 rounded-lg text-stone-500 hover:bg-stone-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={trimming}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-900 text-white font-semibold hover:bg-stone-800 disabled:opacity-50"
                >
                  <Scissors className="w-3 h-3" />
                  {trimming ? "Trimming…" : "Trim Audio"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Speakers Strip (Nemotron 3 Diarization — up to 8 speakers, inline rename!) */}
      <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50/60">
        <div className="flex items-center justify-between mb-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-500">
            <Users className="w-3 h-3" />
            Speakers ({session.speakers.length}/8)
          </span>
          <span className="text-[10px] font-mono-code text-stone-400 truncate max-w-[190px]">
            {session.speechConfig.diarizationModel}
          </span>
        </div>

        {session.speakers.length === 0 ? (
          <p className="text-[11px] text-stone-400">
            Speakers appear automatically as Nemotron 3 Diarization detects voices.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {session.speakers.map((spk) => {
              const isEditing = editingSpeakerId === spk.id;
              const isFiltered = activeSpeakerFilter === spk.id;

              if (isEditing) {
                return (
                  <form
                    key={spk.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (speakerDraft.trim()) {
                        onRenameSpeaker(spk.id, speakerDraft.trim());
                      }
                      setEditingSpeakerId(null);
                    }}
                    className="inline-flex items-center gap-1 bg-white border border-blue-400 rounded-full pl-2 pr-1 py-0.5"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: spk.color }}
                    />
                    <input
                      autoFocus
                      value={speakerDraft}
                      onChange={(e) => setSpeakerDraft(e.target.value)}
                      onBlur={() => {
                        if (speakerDraft.trim()) {
                          onRenameSpeaker(spk.id, speakerDraft.trim());
                        }
                        setEditingSpeakerId(null);
                      }}
                      className="text-xs w-24 outline-none text-stone-800"
                    />
                    <button type="submit" className="text-blue-600 p-0.5">
                      <Check className="w-3 h-3" />
                    </button>
                  </form>
                );
              }

              return (
                <div
                  key={spk.id}
                  className={`group inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-full text-xs border transition cursor-pointer ${
                    isFiltered
                      ? "bg-stone-900 text-white border-stone-900"
                      : "bg-white text-stone-700 border-stone-200 hover:border-stone-300"
                  }`}
                  onClick={() =>
                    onFilterSpeaker(isFiltered ? null : spk.id)
                  }
                  title="Click to spotlight speaker on map · Click pencil to rename"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: spk.color }}
                  />
                  <span className="font-medium max-w-[110px] truncate">
                    {spk.name}
                  </span>
                  {spk.voiceEnrolled && (
                    <span
                      className="text-[9px] font-semibold px-1 rounded bg-emerald-100 text-emerald-800"
                      title="Voice seed enrolled for Nemotron 3 Diarization — helps recognize this speaker in future windows & recordings"
                    >
                      enrolled
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSpeakerDraft(spk.name);
                      setEditingSpeakerId(spk.id);
                    }}
                    className={`p-0.5 rounded-full opacity-50 group-hover:opacity-100 ${
                      isFiltered ? "hover:bg-white/20" : "hover:bg-stone-100"
                    }`}
                    title="Rename speaker"
                  >
                    <Edit3 className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Unmapped Turns Banner */}
      {unmappedCount > 0 && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200/80 flex items-center justify-between gap-2">
          <span className="text-xs text-amber-900">
            {unmappedCount} unmapped turn{unmappedCount === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            disabled={mapperBusy}
            onClick={onAnalyzeUnmapped}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <Sparkles className="w-3 h-3" />
            {mapperBusy ? "Mapping…" : "Map Now"}
          </button>
        </div>
      )}

      {/* Transcript Turns Feed */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {visibleTurns.length === 0 && !partialText && !isTranscribing ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 text-stone-400">
            <AudioLines className="w-8 h-8 mb-3 text-stone-300" />
            <p className="text-sm font-medium text-stone-600 mb-1">
              Ready to listen &amp; diarize
            </p>
            <p className="text-xs leading-relaxed">
              Start <strong>Live Mic</strong>, drop an audio file here, run the{" "}
              <strong>Live Demo</strong>, or push turns from an external agent via{" "}
              <strong>Agent API</strong>.
            </p>
          </div>
        ) : (
          visibleTurns.map((turn) => {
            const spk = speakerMap.get(turn.speakerId);
            const isHighlighted = highlightedTurnIds.has(turn.id);
            const isPlayingNow = playingTurnId === turn.id;
            const linkedNodes = nodeCountByTurn.get(turn.id) || 0;

            return (
              <div
                key={turn.id}
                ref={(el) => {
                  if (el) turnRefs.current.set(turn.id, el);
                  else turnRefs.current.delete(turn.id);
                }}
                onClick={() => onSelectTurn(turn)}
                className={`group rounded-xl p-2.5 border cursor-pointer transition ${
                  isPlayingNow
                    ? "bg-amber-50/90 border-amber-400 shadow-xs ring-2 ring-amber-400/20"
                    : isHighlighted
                      ? "bg-blue-50/90 border-blue-400 shadow-xs"
                      : "bg-white border-stone-200/80 hover:border-stone-300 hover:bg-stone-50/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="relative flex items-center gap-1.5 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNewSpeakerDraft("");
                        setSpeakerMenuTurnId((prev) =>
                          prev === turn.id ? null : turn.id
                        );
                      }}
                      title="Click to reassign this turn to a specific speaker"
                      className="inline-flex items-center gap-1.5 px-1.5 py-0.5 -ml-1.5 rounded-md hover:bg-stone-100 transition min-w-0"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: spk?.color || "#64748B" }}
                      />
                      <span className="text-xs font-semibold text-stone-800 truncate">
                        {spk?.name || turn.speakerId}
                      </span>
                      <ChevronDown className="w-3 h-3 text-stone-400 shrink-0" />
                    </button>

                    {speakerMenuTurnId === turn.id && (
                      <>
                        <div
                          className="fixed inset-0 z-30"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSpeakerMenuTurnId(null);
                          }}
                        />
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute left-0 top-7 w-56 bg-white border border-stone-200 rounded-xl shadow-lg py-1.5 z-40"
                        >
                          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                            Assign speaker
                          </div>
                          <div className="max-h-44 overflow-y-auto">
                            {session.speakers.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  onReassignTurnSpeaker(turn.id, {
                                    speakerId: s.id,
                                  });
                                  setSpeakerMenuTurnId(null);
                                }}
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs hover:bg-stone-50 text-left ${
                                  s.id === turn.speakerId
                                    ? "bg-blue-50/70 font-semibold text-blue-900"
                                    : "text-stone-700"
                                }`}
                              >
                                <span className="inline-flex items-center gap-2 min-w-0">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: s.color }}
                                  />
                                  <span className="truncate">{s.name}</span>
                                </span>
                                {s.id === turn.speakerId && (
                                  <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                )}
                              </button>
                            ))}
                          </div>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const name = newSpeakerDraft.trim();
                              if (!name) return;
                              onReassignTurnSpeaker(turn.id, {
                                speakerName: name,
                              });
                              setNewSpeakerDraft("");
                              setSpeakerMenuTurnId(null);
                            }}
                            className="mt-1 pt-1.5 px-2 border-t border-stone-100 flex items-center gap-1"
                          >
                            <input
                              value={newSpeakerDraft}
                              onChange={(e) =>
                                setNewSpeakerDraft(e.target.value)
                              }
                              placeholder="New speaker name…"
                              className="flex-1 text-xs bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 outline-none focus:bg-white focus:border-blue-400"
                            />
                            <button
                              type="submit"
                              disabled={!newSpeakerDraft.trim()}
                              className="p-1 rounded-lg bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-40"
                              title="Create and assign new speaker"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </form>
                        </div>
                      </>
                    )}

                    {spk?.role && (
                      <span className="text-[10px] text-stone-400 truncate">
                        · {spk.role}
                      </span>
                    )}
                    {turn.kind === "host_context" && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.2 rounded bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-medium shrink-0"
                        title="Classified as session-level host/framing context (kept off the IBIS map)"
                      >
                        host context
                      </span>
                    )}
                    {turn.overlap && (
                      <span
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-medium shrink-0"
                        title="Overlapping speech detected by Nemotron 3 Diarization"
                      >
                        <Layers className="w-2.5 h-2.5" />
                        overlap
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono-code text-stone-400 shrink-0">
                    {formatTime(turn.startSec)}
                  </span>
                </div>

                <p className="text-[13px] leading-relaxed text-stone-700">
                  {turn.text}
                </p>

                <div className="mt-1.5 flex items-center justify-between text-[10px] text-stone-400">
                  <span className="font-mono-code uppercase">{turn.source}</span>
                  {linkedNodes > 0 ? (
                    <span className="text-blue-600 font-medium">
                      {linkedNodes} map node{linkedNodes === 1 ? "" : "s"} →
                    </span>
                  ) : turn.mapped ? (
                    <span>reviewed</span>
                  ) : (
                    <span className="text-amber-600">unmapped</span>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Live Partial Streaming Caption */}
        {partialText && (
          <div className="rounded-xl p-2.5 border border-dashed border-blue-300 bg-blue-50/50">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Live speech (diarizing &amp; finalizing next turn…)
            </div>
            <p className="text-[13px] text-blue-950 leading-relaxed max-h-32 overflow-y-auto">
              {partialText}
            </p>
          </div>
        )}

        <div ref={listEndRef} />
      </div>

      {/* Quick Turn Composer (Simulate / Add Live Utterance) */}
      <form
        onSubmit={handleManualSend}
        className="p-3 border-t border-stone-200/80 bg-stone-50/80 space-y-2"
      >
        <div className="flex items-center gap-1.5">
          <select
            value={manualSpeaker}
            onChange={(e) => setManualSpeaker(Number(e.target.value))}
            className="text-xs font-medium bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-stone-700 outline-none focus:border-blue-400"
            title="Select speaker channel"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((ch) => {
              const found = session.speakers.find((s) => s.channel === ch);
              return (
                <option key={ch} value={ch}>
                  {found ? found.name : `Speaker ${ch}`}
                </option>
              );
            })}
          </select>
          <input
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Type a spoken turn to map live…"
            className="flex-1 text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-stone-800 placeholder:text-stone-400 outline-none focus:border-blue-400"
          />
          <button
            type="submit"
            disabled={!manualText.trim() || submitting}
            className="p-1.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-40 transition"
            title="Add turn and map"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </aside>
  );
}

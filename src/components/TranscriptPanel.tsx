import { Suspense, useEffect, useRef, useState } from "react";
import AudioLines from "lucide-react/icons/audio-lines";
import Check from "lucide-react/icons/check";
import ChevronDown from "lucide-react/icons/chevron-down";
import Edit3 from "lucide-react/icons/pen-line";
import ExternalLink from "lucide-react/icons/external-link";
import Layers from "lucide-react/icons/layers";
import Send from "lucide-react/icons/send";
import Sparkles from "lucide-react/icons/sparkles";
import UploadCloud from "lucide-react/icons/cloud-upload";
import Users from "lucide-react/icons/users";
import Volume2 from "lucide-react/icons/volume-2";
import type { DialogueSession, Speaker, TranscriptTurn } from "@shared/schemas/models";
import { formatTime } from "@/lib/format";
import { Skeleton } from "@/components/Skeleton";
import { lazyWithPreload } from "@/lib/lazy";
import { preloadNodeEditor } from "@/components/panels";

// The audio controls only show for sessions with audio, so they load separately from the main bundle
const { Component: SessionAudioControls } = lazyWithPreload(() =>
  import("./SessionAudioControls").then((m) => m.SessionAudioControls)
);

// The speaker menu only shows once a turn's speaker is clicked; it loads on hover or focus
const { Component: SpeakerMenu, preloadOnIntent: preloadSpeakerMenu } = lazyWithPreload(() =>
  import("./SpeakerMenu").then((m) => m.SpeakerMenu)
);

/** Same size as SessionAudioControls with the trim form closed: scrubber, then the button row. */
function SessionAudioControlsSkeleton() {
  return (
    <>
      <Skeleton className="block w-full h-[79px] rounded-lg" />
      <div className="pt-0.5">
        <Skeleton className="block w-44 h-[26px] rounded-lg" />
      </div>
    </>
  );
}

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
  const [speakerMenuTurnId, setSpeakerMenuTurnId] = useState<string | null>(null);

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
          <Suspense fallback={<SessionAudioControlsSkeleton />}>
            <SessionAudioControls
              session={session}
              audio={session.audio}
              seekRequest={seekRequest}
              isTranscribing={isTranscribing}
              onAudioTimeUpdate={onAudioTimeUpdate}
              onTranscribeSavedAudio={onTranscribeSavedAudio}
              onTrimAudio={onTrimAudio}
              onStopTranscribing={onStopTranscribing}
            />
          </Suspense>
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
                {...(linkedNodes > 0 ? preloadNodeEditor : {})}
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
                      {...preloadSpeakerMenu}
                      onClick={(e) => {
                        e.stopPropagation();
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
                      <Suspense fallback={null}>
                        <SpeakerMenu
                          speakers={session.speakers}
                          speakerId={turn.speakerId}
                          onAssign={(patch) => onReassignTurnSpeaker(turn.id, patch)}
                          onClose={() => setSpeakerMenuTurnId(null)}
                        />
                      </Suspense>
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

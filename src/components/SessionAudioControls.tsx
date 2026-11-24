import { useState } from "react";
import Play from "lucide-react/icons/play";
import Scissors from "lucide-react/icons/scissors";
import Square from "lucide-react/icons/square";
import type { DialogueSession, SessionAudioMeta } from "@shared/schemas/models";
import { AudioScrubber, parseClock } from "@/components/AudioScrubber";
import { formatTime } from "@/lib/format";

interface SessionAudioControlsProps {
  session: DialogueSession;
  audio: SessionAudioMeta;
  seekRequest: { sec: number; nonce: number } | null;
  isTranscribing: boolean;
  onAudioTimeUpdate: (sec: number, playing: boolean) => void;
  onTranscribeSavedAudio: (startSec: number) => void;
  onTrimAudio: (params: {
    startSec: number;
    endSec?: number;
    clearTranscriptAndMap?: boolean;
  }) => Promise<void>;
  onStopTranscribing: () => void;
}

/**
 * The session audio's scrubber, diarize buttons, and trim form. Only sessions with audio show
 * it, so it loads separately from the main bundle (see TranscriptPanel).
 */
export function SessionAudioControls({
  session,
  audio,
  seekRequest,
  isTranscribing,
  onAudioTimeUpdate,
  onTranscribeSavedAudio,
  onTrimAudio,
  onStopTranscribing,
}: SessionAudioControlsProps) {
  const [playheadSec, setPlayheadSec] = useState(0);
  const [showTrimPanel, setShowTrimPanel] = useState(false);
  const [trimStartInput, setTrimStartInput] = useState("0:00");
  const [trimEndInput, setTrimEndInput] = useState("");
  const [trimClearMap, setTrimClearMap] = useState(true);
  const [trimming, setTrimming] = useState(false);

  return (
    <>
      <AudioScrubber
        src={`/api/sessions/${encodeURIComponent(session.id)}/audio?v=${encodeURIComponent(session.updatedAt)}`}
        durationHintSec={audio.durationSec}
        seekRequest={seekRequest}
        onTimeUpdate={onAudioTimeUpdate}
        onPlayheadChange={setPlayheadSec}
      />
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
            const s = parseClock(trimStartInput) ?? undefined;
            const end = parseClock(trimEndInput) ?? undefined;
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
    </>
  );
}

import { useState } from "react";
import Check from "lucide-react/icons/check";
import Plus from "lucide-react/icons/plus";
import type { Speaker } from "@shared/schemas/models";

interface SpeakerMenuProps {
  speakers: Speaker[];
  /** The turn's current speaker (checked in the list). */
  speakerId: string;
  onAssign: (patch: { speakerId?: string; speakerName?: string }) => void;
  onClose: () => void;
}

/**
 * The menu for reassigning a transcript turn to another speaker, or a new one. It only shows
 * once opened, so it loads separately from the main bundle (see TranscriptPanel).
 */
export function SpeakerMenu({ speakers, speakerId, onAssign, onClose }: SpeakerMenuProps) {
  const [newSpeakerDraft, setNewSpeakerDraft] = useState("");

  return (
    <>
      <div
        className="fixed inset-0 z-30"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
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
          {speakers.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onAssign({ speakerId: s.id });
                onClose();
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs hover:bg-stone-50 text-left ${
                s.id === speakerId
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
              {s.id === speakerId && (
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
            onAssign({ speakerName: name });
            setNewSpeakerDraft("");
            onClose();
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
  );
}

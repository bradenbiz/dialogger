import { useState } from "react";
import {
  BookMarked,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import type {
  HostContextCategory,
  HostContextItem,
  Speaker,
} from "@shared/schemas/models";

interface HostContextBarProps {
  items: HostContextItem[];
  speakers: Speaker[];
  onAddContext: (category: HostContextCategory, summary: string) => void;
  onRemoveContext: (id: string) => void;
  onFocusTurn: (turnId: string) => void;
}

const CATEGORY_META: Record<
  HostContextCategory,
  { label: string; bg: string; border: string; text: string }
> = {
  framing: {
    label: "Framing",
    bg: "#F5F3FF",
    border: "#DDD6FE",
    text: "#5B21B6",
  },
  participants: {
    label: "Participants",
    bg: "#EFF6FF",
    border: "#BFDBFE",
    text: "#1E40AF",
  },
  format: {
    label: "Format",
    bg: "#F0FDF4",
    border: "#BBF7D0",
    text: "#166534",
  },
  ground_rules: {
    label: "Ground Rules",
    bg: "#FFFBEB",
    border: "#FDE68A",
    text: "#92400E",
  },
  background: {
    label: "Background",
    bg: "#F8FAFC",
    border: "#CBD5E1",
    text: "#334155",
  },
};

const CATEGORIES: HostContextCategory[] = [
  "framing",
  "participants",
  "format",
  "ground_rules",
  "background",
];

export function HostContextBar({
  items,
  speakers,
  onAddContext,
  onRemoveContext,
  onFocusTurn,
}: HostContextBarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<HostContextCategory>("framing");
  const [draft, setDraft] = useState("");

  const speakerMap = new Map(speakers.map((s) => [s.id, s]));

  // When empty and not adding, show a subtle 1-line bar to add session-level context manually
  if (items.length === 0 && !adding) {
    return (
      <div className="border-b border-stone-200/70 bg-stone-50/70 px-4 py-1.5 flex items-center justify-between text-[11px] text-stone-500">
        <span className="inline-flex items-center gap-1.5">
          <BookMarked className="w-3.5 h-3.5 text-violet-600" />
          <span>
            <strong>Session Context:</strong> Host intros, format, and framing
            captured by the mapper appear here (off the IBIS map).
          </span>
        </span>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-stone-200 text-stone-700 font-medium hover:bg-stone-100"
        >
          <Plus className="w-3 h-3" /> Add Context
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-stone-200/80 bg-violet-50/40 px-4 py-2 space-y-2 z-10">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-900 hover:text-violet-700"
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          <BookMarked className="w-3.5 h-3.5 text-violet-600" />
          <span>Session Host Context</span>
          <span className="font-mono-code text-[10px] px-1.5 py-0.2 rounded-full bg-violet-100 text-violet-800">
            {items.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setCollapsed(false);
            setAdding((v) => !v);
          }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-violet-200 text-[11px] font-medium text-violet-800 hover:bg-violet-50"
        >
          <Plus className="w-3 h-3" /> Add Context
        </button>
      </div>

      {!collapsed && (
        <>
          {items.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
              {items.map((item) => {
                const meta = CATEGORY_META[item.category] || CATEGORY_META.framing;
                const spkNames = item.speakerIds
                  .map((id) => speakerMap.get(id)?.name)
                  .filter((name): name is string => Boolean(name))
                  .join(", ");
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (item.turnIds[0]) onFocusTurn(item.turnIds[0]);
                    }}
                    style={{
                      backgroundColor: meta.bg,
                      borderColor: meta.border,
                    }}
                    className={`group flex items-start justify-between gap-2 px-2.5 py-1.5 rounded-xl border text-xs ${
                      item.turnIds[0] ? "cursor-pointer hover:shadow-xs" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span
                          style={{ color: meta.text }}
                          className="text-[10px] font-bold uppercase tracking-wider shrink-0"
                        >
                          {meta.label}
                        </span>
                        {spkNames && (
                          <span className="text-[10px] text-stone-400 truncate">
                            · {spkNames}
                          </span>
                        )}
                      </div>
                      <p className="text-stone-800 leading-snug text-[11.5px]">
                        {item.summary}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveContext(item.id);
                      }}
                      className="opacity-40 group-hover:opacity-100 p-0.5 rounded text-stone-500 hover:text-rose-600 shrink-0"
                      title="Remove context item"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {adding && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                onAddContext(category, draft.trim());
                setDraft("");
                setAdding(false);
              }}
              className="flex flex-wrap items-center gap-1.5 pt-1"
            >
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as HostContextCategory)
                }
                className="text-xs bg-white border border-stone-200 rounded-lg px-2 py-1 font-medium text-stone-700"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add session framing, format, participant info, or ground rules…"
                className="flex-1 min-w-[240px] text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1 outline-none focus:border-violet-400"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="px-2.5 py-1 rounded-lg bg-violet-700 text-white text-xs font-semibold hover:bg-violet-800 disabled:opacity-40"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="px-2 py-1 rounded-lg text-xs text-stone-500 hover:bg-stone-100"
              >
                Cancel
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import Activity from "lucide-react/icons/activity";
import Award from "lucide-react/icons/award";
import BookOpen from "lucide-react/icons/book-open";
import MessageSquareQuote from "lucide-react/icons/message-square-quote";
import Plus from "lucide-react/icons/plus";
import Trash2 from "lucide-react/icons/trash";
import X from "lucide-react/icons/x";
import {
  type DialogueSession,
  type IBISNode,
  type IBISNodeType,
  type Speaker,
  type TranscriptTurn,
} from "@shared/schemas/models";
import { IBIS_NODE_META, LEGAL_IBIS_CHILDREN } from "@shared/ibis";
import { formatTime } from "@/lib/format";
import { Skeleton } from "@/components/Skeleton";

interface NodeInspectorProps {
  /** Undefined while the session loads: the activity feed shows skeleton rows. */
  session?: DialogueSession;
  selectedNode: IBISNode | null;
  onClose: () => void;
  onUpdateNode: (
    id: string,
    patch: { label?: string; detail?: string; type?: IBISNodeType }
  ) => void;
  onDeleteNode: (id: string) => void;
  onAddChild: (parentId: string, type: IBISNodeType, label: string) => void;
  onFocusTurn: (turnId: string) => void;
  onSelectNode: (nodeId: string) => void;
}

const ALL_TYPES: IBISNodeType[] = [
  "question",
  "idea",
  "pro",
  "con",
  "decision",
  "note",
];

export function NodeInspector({
  session,
  selectedNode,
  onClose,
  onUpdateNode,
  onDeleteNode,
  onAddChild,
  onFocusTurn,
  onSelectNode,
}: NodeInspectorProps) {
  const [labelDraft, setLabelDraft] = useState("");
  const [detailDraft, setDetailDraft] = useState("");
  const [childType, setChildType] = useState<IBISNodeType>("idea");
  const [childLabel, setChildLabel] = useState("");

  useEffect(() => {
    if (selectedNode) {
      setLabelDraft(selectedNode.label);
      setDetailDraft(selectedNode.detail || "");
      setChildType(LEGAL_IBIS_CHILDREN[selectedNode.type][0] || "question");
      setChildLabel("");
    }
  }, [selectedNode?.id, selectedNode?.label, selectedNode?.detail, selectedNode?.type]);

  // When no node is selected, show a compact Conklin Live Activity & Grammar Drawer
  if (!selectedNode || !session) {
    return (
      <aside className="hidden 2xl:flex w-[310px] border-l border-stone-200/90 bg-white flex-col shrink-0">
        <div className="px-4 py-3 border-b border-stone-200/80 flex items-center gap-2">
          <Activity className="w-4 h-4 text-stone-500" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-600">
            Live Mapping Feed
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {!session ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="p-2.5 rounded-xl border border-stone-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="w-14 h-2.5" />
                  <Skeleton className="w-12 h-2.5" />
                </div>
                <Skeleton className="block w-full h-3" />
                <Skeleton className="block w-2/3 h-3" />
              </div>
            ))
          ) : session.activity.length === 0 ? (
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 text-xs text-stone-600 space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-stone-800">
                <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                Conklin IBIS Quick Guide
              </div>
              <p className="leading-relaxed text-stone-500">
                Click any node on the map to inspect its verbatim speaker
                provenance, edit wording, or branch new IBIS nodes.
              </p>
              <ul className="space-y-1 text-[11px] text-stone-600">
                <li>
                  <strong className="text-blue-700">? Question</strong> — Open
                  issue driving inquiry
                </li>
                <li>
                  <strong className="text-amber-700">💡 Idea</strong> — Proposed
                  answer to a Question
                </li>
                <li>
                  <strong className="text-emerald-700">+ Pro</strong> — Reason
                  supporting an Idea
                </li>
                <li>
                  <strong className="text-rose-700">− Con</strong> — Risk or
                  objection to an Idea
                </li>
                <li>
                  <strong className="text-indigo-700">✓ Decision</strong> —
                  Explicit group agreement
                </li>
                <li>
                  <strong className="text-slate-700">i Note</strong> — Facts,
                  data, or constraints
                </li>
              </ul>
            </div>
          ) : (
            [...session.activity].reverse().map((act) => (
              <div
                key={act.id}
                onClick={() => {
                  if (act.affectedNodeIds?.[0]) {
                    onSelectNode(act.affectedNodeIds[0]);
                  }
                }}
                className="p-2.5 rounded-xl border border-stone-200/80 bg-stone-50/50 hover:bg-stone-50 cursor-pointer transition"
              >
                <div className="flex items-center justify-between text-[10px] text-stone-400 mb-1">
                  <span className="font-mono-code uppercase font-semibold text-stone-500">
                    {act.actor}
                  </span>
                  <span>
                    {new Date(act.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-xs text-stone-700 leading-snug">
                  {act.summary}
                </p>
              </div>
            ))
          )}
        </div>
      </aside>
    );
  }

  const speakerMap = new Map<string, Speaker>(
    session.speakers.map((s) => [s.id, s])
  );
  const turnMap = new Map<string, TranscriptTurn>(
    session.turns.map((t) => [t.id, t])
  );

  const meta = IBIS_NODE_META[selectedNode.type];
  const legalChildren = LEGAL_IBIS_CHILDREN[selectedNode.type];
  const linkedTurns = selectedNode.turnIds
    .map((id) => turnMap.get(id))
    .filter((t): t is TranscriptTurn => Boolean(t));

  const commitEdits = () => {
    const trimmedLabel = labelDraft.trim();
    const trimmedDetail = detailDraft.trim();
    if (
      (trimmedLabel && trimmedLabel !== selectedNode.label) ||
      trimmedDetail !== (selectedNode.detail || "")
    ) {
      onUpdateNode(selectedNode.id, {
        label: trimmedLabel || selectedNode.label,
        detail: trimmedDetail,
      });
    }
  };

  return (
    <aside className="w-[330px] border-l border-stone-200/90 bg-white flex flex-col shrink-0 z-20">
      {/* Header */}
      <div className="px-4 py-3 border-b border-stone-200/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            style={{ backgroundColor: meta.badgeBg, color: meta.badgeText }}
            className="w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center"
          >
            {meta.symbol}
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-stone-700">
            {meta.name} Node
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Node Type Switcher */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
            IBIS Grammar Role
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {ALL_TYPES.map((t) => {
              const m = IBIS_NODE_META[t];
              const active = selectedNode.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onUpdateNode(selectedNode.id, { type: t })}
                  style={
                    active
                      ? {
                          backgroundColor: m.bg,
                          borderColor: m.accent,
                          color: m.accent,
                        }
                      : undefined
                  }
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    active
                      ? "shadow-xs"
                      : "bg-white border-stone-200 text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  <span>{m.symbol}</span>
                  <span>{m.shortName}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-stone-500 leading-relaxed bg-stone-50 rounded-lg p-2 border border-stone-100">
            <strong>Conklin tip:</strong> {meta.conklinGuidance}
          </p>
        </div>

        {/* Promote Idea -> Decision Shortcut */}
        {selectedNode.type === "idea" && (
          <button
            type="button"
            onClick={() => onUpdateNode(selectedNode.id, { type: "decision" })}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-indigo-50 border border-indigo-200 text-indigo-800 hover:bg-indigo-100 transition"
          >
            <Award className="w-4 h-4" />
            Promote Idea to Agreed Decision (✓)
          </button>
        )}

        {/* Label & Detail Editor */}
        <div className="space-y-2.5">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1">
              Distilled Label
            </label>
            <textarea
              rows={3}
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitEdits}
              className="w-full text-sm text-stone-900 bg-stone-50 border border-stone-200 rounded-xl p-2.5 outline-none focus:bg-white focus:border-blue-400 resize-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1">
              Framing Note / Criteria
            </label>
            <textarea
              rows={2}
              value={detailDraft}
              onChange={(e) => setDetailDraft(e.target.value)}
              onBlur={commitEdits}
              placeholder="Optional constraints, nuance, or assumptions…"
              className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-xl p-2.5 outline-none focus:bg-white focus:border-blue-400 resize-none"
            />
          </div>
        </div>

        {/* Add Legal Child Node */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!childLabel.trim()) return;
            onAddChild(selectedNode.id, childType, childLabel.trim());
            setChildLabel("");
          }}
          className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 space-y-2"
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            Branch Child Node
          </div>
          <div className="flex flex-wrap gap-1">
            {legalChildren.map((ct) => {
              const cm = IBIS_NODE_META[ct];
              return (
                <button
                  key={ct}
                  type="button"
                  onClick={() => setChildType(ct)}
                  style={
                    childType === ct
                      ? {
                          backgroundColor: cm.badgeBg,
                          color: cm.badgeText,
                          borderColor: cm.badgeBg,
                        }
                      : undefined
                  }
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border transition ${
                    childType === ct
                      ? ""
                      : "bg-white border-stone-200 text-stone-600 hover:bg-stone-100"
                  }`}
                >
                  {cm.symbol} {cm.shortName}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1.5">
            <input
              value={childLabel}
              onChange={(e) => setChildLabel(e.target.value)}
              placeholder={`Add ${IBIS_NODE_META[childType].shortName.toLowerCase()}…`}
              className="flex-1 text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400"
            />
            <button
              type="submit"
              disabled={!childLabel.trim()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-900 text-white text-xs font-semibold hover:bg-stone-800 disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>

        {/* Verbatim Transcript Provenance */}
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-2">
            <MessageSquareQuote className="w-3.5 h-3.5" />
            Transcript Provenance ({linkedTurns.length})
          </div>
          {linkedTurns.length === 0 ? (
            <p className="text-xs text-stone-400 italic">
              Added manually — no transcript quote linked yet.
            </p>
          ) : (
            <div className="space-y-2">
              {linkedTurns.map((t) => {
                const spk = speakerMap.get(t.speakerId);
                return (
                  <div
                    key={t.id}
                    onClick={() => onFocusTurn(t.id)}
                    className="p-2.5 rounded-xl bg-stone-50 border border-stone-200/80 hover:border-blue-300 cursor-pointer transition"
                  >
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-stone-800">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: spk?.color || "#64748B" }}
                        />
                        {spk?.name || t.speakerId}
                      </span>
                      <span className="font-mono-code text-[10px] text-stone-400">
                        {formatTime(t.startSec)}–{formatTime(t.endSec)}
                      </span>
                    </div>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      &ldquo;{t.text}&rdquo;
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer Danger Zone */}
      <div className="p-3 border-t border-stone-200/80 flex items-center justify-between text-xs">
        <span className="font-mono-code text-[10px] text-stone-400">
          {selectedNode.id} · by {selectedNode.createdBy}
        </span>
        <button
          type="button"
          onClick={() => onDeleteNode(selectedNode.id)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-rose-700 hover:bg-rose-50 font-medium transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Branch
        </button>
      </div>
    </aside>
  );
}

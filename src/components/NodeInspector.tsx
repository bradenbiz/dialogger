import { Suspense } from "react";
import Activity from "lucide-react/icons/activity";
import BookOpen from "lucide-react/icons/book-open";
import type { DialogueSession, IBISNode, IBISNodeType } from "@shared/schemas/models";
import { Skeleton } from "@/components/Skeleton";
import { NodeEditor, preloadNodeEditor } from "@/components/panels";

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
                {...(act.affectedNodeIds?.[0] ? preloadNodeEditor : {})}
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

  return (
    <Suspense fallback={<NodeEditorSkeleton />}>
      <NodeEditor
        session={session}
        selectedNode={selectedNode}
        onClose={onClose}
        onUpdateNode={onUpdateNode}
        onDeleteNode={onDeleteNode}
        onAddChild={onAddChild}
        onFocusTurn={onFocusTurn}
      />
    </Suspense>
  );
}

/** The editor panel's frame while its chunk loads (same width as NodeEditor). */
function NodeEditorSkeleton() {
  return (
    <aside className="w-[330px] border-l border-stone-200/90 bg-white flex flex-col shrink-0 z-20" aria-busy="true">
      <div className="px-4 py-3 border-b border-stone-200/80 flex items-center gap-2">
        <Skeleton className="w-6 h-6 rounded-md" />
        <Skeleton className="w-28 h-3" />
      </div>
      <div className="p-4 space-y-3">
        <Skeleton className="block w-full h-8 rounded-lg" />
        <Skeleton className="block w-full h-20 rounded-lg" />
        <Skeleton className="block w-2/3 h-3" />
      </div>
    </aside>
  );
}

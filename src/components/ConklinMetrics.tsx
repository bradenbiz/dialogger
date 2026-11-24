import AlertCircle from "lucide-react/icons/circle-exclamation-point";
import CheckCircle2 from "lucide-react/icons/circle-check";
import HelpCircle from "lucide-react/icons/circle-question-mark";
import Scale from "lucide-react/icons/scale";
import Sparkles from "lucide-react/icons/sparkles";
import { type IBISNodeType } from "@shared/schemas/models";
import { IBIS_NODE_META, type ConklinMapStats } from "@shared/ibis";
import { Skeleton } from "@/components/Skeleton";

export type FacilitationLens = "all" | "open-questions" | "contested" | "decisions";

interface ConklinMetricsProps {
  /** Undefined while the session loads: counts show skeletons, the buttons stay. */
  stats?: ConklinMapStats;
  lens: FacilitationLens;
  onChangeLens: (lens: FacilitationLens) => void;
  onHighlightNodes?: (ids: string[]) => void;
}

const ORDERED_TYPES: IBISNodeType[] = [
  "question",
  "idea",
  "pro",
  "con",
  "decision",
  "note",
];

export function ConklinMetrics({
  stats,
  lens,
  onChangeLens,
  onHighlightNodes,
}: ConklinMetricsProps) {
  return (
    <div className="border-b border-stone-200/80 bg-white/85 backdrop-blur px-4 py-2 flex flex-wrap items-center justify-between gap-2 z-20">
      {/* Left: Conklin Facilitation Lens Filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mr-1">
          Lens
        </span>
        <LensButton
          active={lens === "all"}
          onClick={() => onChangeLens("all")}
          label="Full Map"
          count={stats?.totalNodes}
        />
        <LensButton
          active={lens === "open-questions"}
          onClick={() => onChangeLens("open-questions")}
          label="Open Questions"
          count={stats?.openQuestionIds.length}
          icon={<HelpCircle className="w-3 h-3 text-blue-600" />}
        />
        <LensButton
          active={lens === "contested"}
          onClick={() => onChangeLens("contested")}
          label="Contested"
          count={stats?.contestedIdeaIds.length}
          icon={<Scale className="w-3 h-3 text-amber-600" />}
        />
        <LensButton
          active={lens === "decisions"}
          onClick={() => onChangeLens("decisions")}
          label="Decisions"
          count={stats?.counts.decision}
          icon={<CheckCircle2 className="w-3 h-3 text-indigo-600" />}
        />
      </div>

      {/* Right: IBIS Node Type Legend Counts + Top Facilitation Nudge */}
      <div className="flex items-center gap-3 flex-wrap">
        {stats && stats.nudges.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const first = stats.nudges[0];
              if (first.nodeIds?.length) onHighlightNodes?.(first.nodeIds);
            }}
            className={`hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
              stats.nudges[0].severity === "attention"
                ? "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100"
                : "bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100"
            }`}
            title="Jeffrey Conklin Facilitation Signal"
          >
            {stats.nudges[0].severity === "attention" ? (
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 shrink-0 text-blue-600" />
            )}
            <span className="truncate max-w-[340px]">{stats.nudges[0].message}</span>
          </button>
        )}

        <div className="flex items-center gap-1.5">
          {ORDERED_TYPES.map((t) => {
            const meta = IBIS_NODE_META[t];
            return (
              <span
                key={t}
                title={`${meta.name}: ${meta.description}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium border"
                style={{
                  backgroundColor: meta.bg,
                  borderColor: meta.border,
                  color: meta.accent,
                }}
              >
                <span className="font-bold leading-none">{meta.symbol}</span>
                {stats ? <span>{stats.counts[t]}</span> : <Skeleton className="w-2.5 h-2.5" />}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LensButton({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  /** Undefined while loading */
  count?: number;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition border ${
        active
          ? "bg-stone-900 text-white border-stone-900 shadow-xs"
          : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50 hover:text-stone-900"
      }`}
    >
      {icon}
      <span>{label}</span>
      <span
        className={`text-[10px] px-1.5 py-0.2 rounded-full ${
          active ? "bg-white/20 text-white" : "bg-stone-100 text-stone-500"
        }`}
      >
        {count ?? <Skeleton className="w-2.5 h-2" />}
      </span>
    </button>
  );
}

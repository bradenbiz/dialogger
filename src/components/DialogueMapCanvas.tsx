import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChevronRight from "lucide-react/icons/chevron-right";
import Compass from "lucide-react/icons/compass";
import Maximize2 from "lucide-react/icons/maximize-2";
import Minus from "lucide-react/icons/minus";
import Play from "lucide-react/icons/play";
import Plus from "lucide-react/icons/plus";
import Upload from "lucide-react/icons/upload";
import { YoutubeIcon as Youtube } from "@/components/YoutubeIcon";
import {
  type DialogueSession,
  type IBISNodeType,
  type Speaker,
} from "@shared/schemas/models";
import { IBIS_NODE_META, LEGAL_IBIS_CHILDREN, type ConklinMapStats } from "@shared/ibis";
import { computeDialogueMapLayout, type PositionedNode } from "@/lib/layout";
import { preloadNodeEditor, preloadOnIntent } from "@/components/panels";
import type { FacilitationLens } from "./ConklinMetrics";

interface DialogueMapCanvasProps {
  session: DialogueSession;
  stats: ConklinMapStats;
  lens: FacilitationLens;
  activeSpeakerFilter: string | null;
  selectedNodeId: string | null;
  highlightedNodeIds: Set<string>;
  recentNodeIds: Set<string>;
  onSelectNode: (nodeId: string | null) => void;
  onQuickAddChild: (parentId: string | null, type: IBISNodeType) => void;
  onStartDemo: () => void;
  onTriggerUpload: () => void;
  onOpenYouTube: () => void;
}

/**
 * The map surface while its session loads: the empty dot grid, with no nodes and no
 * get-started card (which would flash for a session that does have nodes).
 */
export function DialogueMapCanvasPlaceholder() {
  return <div className="flex-1 relative overflow-hidden canvas-dot-grid" aria-busy="true" />;
}

export function DialogueMapCanvas({
  session,
  stats,
  lens,
  activeSpeakerFilter,
  selectedNodeId,
  highlightedNodeIds,
  recentNodeIds,
  onSelectNode,
  onQuickAddChild,
  onStartDemo,
  onTriggerUpload,
  onOpenYouTube,
}: DialogueMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 40, y: 40, scale: 1 });
  const [followLive, setFollowLive] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const layout = useMemo(
    () =>
      computeDialogueMapLayout(session.nodes, session.crossLinks, collapsedIds),
    [session.nodes, session.crossLinks, collapsedIds]
  );

  const speakerMap = useMemo(
    () => new Map<string, Speaker>(session.speakers.map((s) => [s.id, s])),
    [session.speakers]
  );

  // Determine which nodes match the current Conklin lens / speaker filter
  const spotlightSet = useMemo(() => {
    const hasLens = lens !== "all";
    const hasSpeaker = Boolean(activeSpeakerFilter);
    const hasExplicitHighlight = highlightedNodeIds.size > 0;
    if (!hasLens && !hasSpeaker && !hasExplicitHighlight) return null;

    const matched = new Set<string>();
    const lensIds =
      lens === "open-questions"
        ? new Set(stats.openQuestionIds)
        : lens === "contested"
          ? new Set(stats.contestedIdeaIds)
          : lens === "decisions"
            ? new Set(
                session.nodes
                  .filter((n) => n.type === "decision")
                  .map((n) => n.id)
              )
            : null;

    for (const n of session.nodes) {
      let ok = true;
      if (lensIds && !lensIds.has(n.id)) ok = false;
      if (activeSpeakerFilter && !n.speakerIds.includes(activeSpeakerFilter)) {
        ok = false;
      }
      if (hasExplicitHighlight && !highlightedNodeIds.has(n.id)) ok = false;
      if (ok) matched.add(n.id);
    }
    return matched;
  }, [lens, activeSpeakerFilter, highlightedNodeIds, stats, session.nodes]);

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || layout.nodes.length === 0) return;
    const rect = el.getBoundingClientRect();
    const scaleX = (rect.width - 64) / layout.bounds.width;
    const scaleY = (rect.height - 64) / layout.bounds.height;
    const scale = Math.max(0.35, Math.min(1.05, Math.min(scaleX, scaleY)));
    const x = (rect.width - layout.bounds.width * scale) / 2;
    const y = (rect.height - layout.bounds.height * scale) / 2;
    setTransform({ x, y, scale });
  }, [layout.bounds, layout.nodes.length]);

  const panToNode = useCallback(
    (nodeId: string) => {
      const el = containerRef.current;
      const target = layout.nodes.find((p) => p.node.id === nodeId);
      if (!el || !target) return;
      const rect = el.getBoundingClientRect();
      setTransform((prev) => ({
        ...prev,
        x: rect.width / 2 - (target.x + target.width / 2) * prev.scale,
        y: rect.height / 2 - (target.y + target.height / 2) * prev.scale,
      }));
    },
    [layout.nodes]
  );

  // Auto-fit when a new map starts or grows significantly while Follow Live is active
  useEffect(() => {
    if (!followLive || layout.nodes.length === 0) return;
    if (layout.nodes.length <= 16) {
      fitView();
    } else if (recentNodeIds.size > 0) {
      const latestId = Array.from(recentNodeIds)[recentNodeIds.size - 1];
      if (latestId) panToNode(latestId);
    }
  }, [layout.nodes.length, recentNodeIds, followLive, fitView, panToNode]);

  // Pan to first highlighted node when clicking a transcript turn
  useEffect(() => {
    if (highlightedNodeIds.size === 1) {
      const only = Array.from(highlightedNodeIds)[0];
      panToNode(only);
    }
  }, [highlightedNodeIds, panToNode]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
      const zoomFactor = e.deltaY < 0 ? 1.09 : 0.92;
      setTransform((prev) => {
        const nextScale = Math.max(0.25, Math.min(2, prev.scale * zoomFactor));
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          x: mouseX - (mouseX - prev.x) * ratio,
          y: mouseY - (mouseY - prev.y) * ratio,
        };
      });
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-ibis-node]")) return;
    setFollowLive(false);
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: transform.x,
      origY: transform.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setTransform((prev) => ({
      ...prev,
      x: dragRef.current.origX + dx,
      y: dragRef.current.origY + dy,
    }));
  };

  const handlePointerUp = () => {
    dragRef.current.dragging = false;
  };

  const toggleCollapse = (nodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("[data-ibis-node]")) {
          onSelectNode(null);
        }
      }}
      className="flex-1 relative overflow-hidden canvas-dot-grid select-none cursor-grab active:cursor-grabbing"
    >
      {/* Empty State — Authentic Conklin Dialogue Mapping Onboarding */}
      {session.nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none">
          <div className="max-w-xl bg-white/95 backdrop-blur border border-stone-200 rounded-2xl shadow-sm p-8 text-center pointer-events-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold mb-4">
              Jeffrey Conklin&apos;s Dialogue Mapping (IBIS)
            </div>
            <h1 className="font-display text-2xl font-semibold text-stone-900 mb-2">
              Turn messy conversations into shared understanding
            </h1>
            <p className="text-sm text-stone-600 leading-relaxed mb-6">
              As speakers talk (via local <strong>Nemotron 3 Diarization</strong> +{" "}
              <strong>Parakeet TDT v3 / Nemotron 3.5</strong>) or as an AI agent
              pushes updates, Dialogger distills the discussion live into{" "}
              <strong className="text-blue-700">Questions (?)</strong>,{" "}
              <strong className="text-amber-700">Ideas (💡)</strong>,{" "}
              <strong className="text-emerald-700">Pros (+)</strong>,{" "}
              <strong className="text-rose-700">Cons (−)</strong>, and{" "}
              <strong className="text-indigo-700">Decisions (✓)</strong>.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={onOpenYouTube}
                {...preloadOnIntent("youtube")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-stone-900 text-white hover:bg-stone-800 transition shadow-xs"
              >
                <Youtube className="w-4 h-4 text-rose-400" />
                Try a YouTube Link
              </button>
              <button
                type="button"
                onClick={onTriggerUpload}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white border border-stone-300 text-stone-800 hover:bg-stone-50 transition"
              >
                <Upload className="w-4 h-4 text-stone-500" />
                Audio File
              </button>
              <button
                type="button"
                onClick={onStartDemo}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white border border-stone-300 text-stone-800 hover:bg-stone-50 transition"
              >
                <Play className="w-4 h-4 fill-current text-amber-500" />
                Silent Demo
              </button>
              <button
                type="button"
                onClick={() => onQuickAddChild(null, "question")}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-blue-50 border border-blue-200 text-blue-800 hover:bg-blue-100 transition"
              >
                <Plus className="w-4 h-4" />
                Root Question
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Transformed Spatial Plane */
        <div
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "0 0",
            width: layout.bounds.width,
            height: layout.bounds.height,
          }}
          className="relative transition-transform duration-150 ease-out will-change-transform"
        >
          {/* SVG Edges & Cross-Links Layer */}
          <svg
            width={layout.bounds.width}
            height={layout.bounds.height}
            className="absolute inset-0 pointer-events-none overflow-visible"
          >
            <defs>
              <marker
                id="ibis-arrow-muted"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 8 5 L 0 9 z" fill="#94A3B8" />
              </marker>
            </defs>

            {/* Primary IBIS Tree Connections */}
            {layout.edges.map((edge) => {
              const meta = IBIS_NODE_META[edge.targetType];
              const dimmed =
                spotlightSet &&
                !spotlightSet.has(edge.sourceId) &&
                !spotlightSet.has(edge.targetId);
              const isSelectedEdge =
                selectedNodeId === edge.sourceId ||
                selectedNodeId === edge.targetId;

              return (
                <g
                  key={edge.id}
                  style={{ opacity: dimmed ? 0.18 : 1 }}
                  className="transition-opacity duration-200"
                >
                  <path
                    d={edge.path}
                    fill="none"
                    stroke={isSelectedEdge ? meta.accent : meta.border}
                    strokeWidth={isSelectedEdge ? 2.6 : 2}
                    strokeLinecap="round"
                  />
                  {edge.label && (
                    <g>
                      <rect
                        x={edge.labelX - edge.label.length * 3.1 - 6}
                        y={edge.labelY - 9}
                        width={edge.label.length * 6.2 + 12}
                        height={15}
                        rx={7.5}
                        fill="#FAF9F6"
                        fillOpacity={0.92}
                      />
                      <text
                        x={edge.labelX}
                        y={edge.labelY + 1.5}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight={500}
                        fill="#78716C"
                      >
                        {edge.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Optional Non-Tree Cross-Links */}
            {layout.crossLinks.map((cl) => (
              <g key={cl.link.id}>
                <path
                  d={cl.path}
                  fill="none"
                  stroke="#94A3B8"
                  strokeWidth={1.6}
                  strokeDasharray="5 4"
                  markerEnd="url(#ibis-arrow-muted)"
                />
                <text
                  x={cl.labelX}
                  y={cl.labelY}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={500}
                  fill="#64748B"
                >
                  {cl.link.label || cl.link.kind.replace(/_/g, " ")}
                </text>
              </g>
            ))}
          </svg>

          {/* HTML Interactive IBIS Node Cards */}
          {layout.nodes.map((item) => (
            <IBISNodeCard
              key={item.node.id}
              item={item}
              speakerMap={speakerMap}
              isSelected={selectedNodeId === item.node.id}
              isRecent={recentNodeIds.has(item.node.id)}
              isDimmed={Boolean(spotlightSet && !spotlightSet.has(item.node.id))}
              isCollapsed={collapsedIds.has(item.node.id)}
              onSelect={() => onSelectNode(item.node.id)}
              onToggleCollapse={() => toggleCollapse(item.node.id)}
              onQuickAdd={(type) => onQuickAddChild(item.node.id, type)}
            />
          ))}
        </div>
      )}

      {/* Floating Canvas Controls (Bottom Right) */}
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 bg-white/95 backdrop-blur border border-stone-200 rounded-xl shadow-sm p-1">
        <button
          type="button"
          onClick={() => onQuickAddChild(null, "question")}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50 transition"
          title="Add a new root Question (?)"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Question</span>
        </button>

        <div className="w-px h-5 bg-stone-200" />

        <button
          type="button"
          onClick={() => setFollowLive((v) => !v)}
          className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition ${
            followLive
              ? "bg-blue-50 text-blue-700"
              : "text-stone-500 hover:bg-stone-100"
          }`}
          title="Automatically frame new nodes as they arrive live"
        >
          <Compass className="w-3.5 h-3.5" />
          <span>Follow</span>
        </button>

        <div className="w-px h-5 bg-stone-200" />

        <button
          type="button"
          onClick={() =>
            setTransform((t) => ({ ...t, scale: Math.max(0.25, t.scale / 1.15) }))
          }
          className="p-1.5 rounded-lg text-stone-600 hover:bg-stone-100"
          title="Zoom out"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] font-mono-code text-stone-500 w-10 text-center">
          {Math.round(transform.scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() =>
            setTransform((t) => ({ ...t, scale: Math.min(2, t.scale * 1.15) }))
          }
          className="p-1.5 rounded-lg text-stone-600 hover:bg-stone-100"
          title="Zoom in"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={fitView}
          className="p-1.5 rounded-lg text-stone-600 hover:bg-stone-100"
          title="Fit entire Dialogue Map to screen"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function IBISNodeCard({
  item,
  speakerMap,
  isSelected,
  isRecent,
  isDimmed,
  isCollapsed,
  onSelect,
  onToggleCollapse,
  onQuickAdd,
}: {
  item: PositionedNode;
  speakerMap: Map<string, Speaker>;
  isSelected: boolean;
  isRecent: boolean;
  isDimmed: boolean;
  isCollapsed: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onQuickAdd: (type: IBISNodeType) => void;
}) {
  const { node } = item;
  const meta = IBIS_NODE_META[node.type];
  const legalChildren = LEGAL_IBIS_CHILDREN[node.type].slice(0, 4);

  return (
    <div
      data-ibis-node={node.id}
      {...preloadNodeEditor}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        minHeight: item.height,
        backgroundColor: meta.bg,
        borderColor: isSelected ? meta.accent : meta.border,
        opacity: isDimmed ? 0.22 : 1,
      }}
      className={`group absolute rounded-xl border-2 px-3 py-2.5 cursor-pointer transition-all duration-200 shadow-xs hover:shadow-md ${
        isSelected ? "ring-3 ring-blue-500/20 shadow-md z-20" : "z-10"
      } ${node.type === "decision" ? "outline outline-2 outline-offset-2 outline-indigo-300/70" : ""} ${
        isRecent ? "animate-ibis-enter" : ""
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Authentic Conklin IBIS Symbol Badge */}
        <div
          style={{ backgroundColor: meta.badgeBg, color: meta.badgeText }}
          className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 shadow-xs mt-0.5"
          title={`${meta.name} — ${meta.description}`}
        >
          {meta.symbol}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span
              style={{ color: meta.accent }}
              className="text-[10px] font-bold uppercase tracking-wider"
            >
              {meta.shortName}
            </span>
            {node.turnIds.length > 0 && (
              <span className="text-[10px] font-mono-code text-stone-400">
                {node.turnIds.length} quote{node.turnIds.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <p className="text-[13px] font-semibold leading-snug text-stone-900 break-words">
            {node.label}
          </p>

          {node.detail && (
            <p className="mt-1 text-[11px] leading-snug text-stone-500 line-clamp-2">
              {node.detail}
            </p>
          )}

          {/* Speaker Provenance Chips */}
          {node.speakerIds.length > 0 && (
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              {node.speakerIds.map((sid) => {
                const spk = speakerMap.get(sid);
                return (
                  <span
                    key={sid}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/80 border border-stone-200/80 text-[10px] font-medium text-stone-600"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: spk?.color || "#64748B" }}
                    />
                    {spk?.name || sid}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Collapse / Expand Subtree Handle */}
      {item.childCount > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          className="absolute -right-3 top-1/2 -translate-y-1/2 h-6 min-w-6 px-1 rounded-full bg-white border border-stone-300 shadow-xs text-[10px] font-semibold text-stone-600 hover:border-stone-500 flex items-center justify-center gap-0.5"
          title={isCollapsed ? "Expand branch" : "Collapse branch"}
        >
          {isCollapsed ? (
            <>
              <span>+{item.hiddenDescendantCount}</span>
            </>
          ) : (
            <ChevronRight className="w-3 h-3 rotate-180" />
          )}
        </button>
      )}

      {/* Hover Quick-Add Legal IBIS Child Bar */}
      <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity absolute -bottom-3.5 left-3 flex items-center gap-1 bg-white border border-stone-200 rounded-full px-1.5 py-0.5 shadow-sm">
        {legalChildren.map((childType) => {
          const cm = IBIS_NODE_META[childType];
          return (
            <button
              key={childType}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onQuickAdd(childType);
              }}
              style={{ color: cm.accent }}
              className="w-5 h-5 rounded-full hover:bg-stone-100 text-[11px] font-bold flex items-center justify-center"
              title={`Add child ${cm.name} (${cm.symbol})`}
            >
              {cm.symbol}
            </button>
          );
        })}
      </div>
    </div>
  );
}

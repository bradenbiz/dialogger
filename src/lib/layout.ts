import { hierarchy, tree } from "d3-hierarchy";
import type { IBISCrossLink, IBISNode } from "@shared/ibis";

export const NODE_WIDTH = 286;
export const NODE_BASE_HEIGHT = 84;
export const HORIZONTAL_GAP = 104;
export const VERTICAL_GAP = 28;

export interface PositionedNode {
  node: IBISNode;
  x: number; // left edge in canvas px
  y: number; // top edge in canvas px
  width: number;
  height: number;
  depth: number;
  childCount: number;
  hiddenDescendantCount: number;
}

export interface PositionedEdge {
  id: string;
  sourceId: string;
  targetId: string;
  path: string;
  label: string;
  labelX: number;
  labelY: number;
  targetType: IBISNode["type"];
}

export interface PositionedCrossLink {
  link: IBISCrossLink;
  path: string;
  labelX: number;
  labelY: number;
}

export interface MapLayoutResult {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  crossLinks: PositionedCrossLink[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
}

interface TreeDatum {
  id: string;
  node?: IBISNode;
  children: TreeDatum[];
  hiddenDescendantCount: number;
}

function estimateNodeHeight(node: IBISNode): number {
  const lines = Math.max(1, Math.ceil(node.label.length / 34));
  const detailBonus = node.detail ? 20 : 0;
  return Math.max(NODE_BASE_HEIGHT, 46 + lines * 20 + detailBonus);
}

function countDescendants(
  id: string,
  childrenMap: Map<string, IBISNode[]>,
  seen = new Set<string>()
): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const kids = childrenMap.get(id) || [];
  let total = kids.length;
  for (const k of kids) {
    total += countDescendants(k.id, childrenMap, seen);
  }
  return total;
}

/**
 * Deterministic left-to-right Conklin IBIS tree layout using d3-hierarchy.
 * Supports multiple root questions (forest) stacked cleanly with generous spacing.
 */
export function computeDialogueMapLayout(
  nodes: IBISNode[],
  crossLinks: IBISCrossLink[],
  collapsedIds: Set<string>
): MapLayoutResult {
  if (nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      crossLinks: [],
      bounds: { minX: 0, minY: 0, maxX: 800, maxY: 500, width: 800, height: 500 },
    };
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const childrenMap = new Map<string, IBISNode[]>();
  const roots: IBISNode[] = [];

  for (const n of nodes) {
    if (n.parentId && nodeById.has(n.parentId) && n.parentId !== n.id) {
      const arr = childrenMap.get(n.parentId) || [];
      arr.push(n);
      childrenMap.set(n.parentId, arr);
    } else {
      roots.push(n);
    }
  }

  const buildDatum = (node: IBISNode, visited = new Set<string>()): TreeDatum => {
    visited.add(node.id);
    const rawKids = (childrenMap.get(node.id) || []).filter((k) => !visited.has(k.id));
    const isCollapsed = collapsedIds.has(node.id) || Boolean(node.collapsed);
    if (isCollapsed) {
      return {
        id: node.id,
        node,
        children: [],
        hiddenDescendantCount: countDescendants(node.id, childrenMap),
      };
    }
    return {
      id: node.id,
      node,
      children: rawKids.map((k) => buildDatum(k, new Set(visited))),
      hiddenDescendantCount: 0,
    };
  };

  const virtualRoot: TreeDatum = {
    id: "__virtual_root__",
    children: roots.map((r) => buildDatum(r)),
    hiddenDescendantCount: 0,
  };

  const rootHierarchy = hierarchy(virtualRoot, (d) => d.children);
  const layout = tree<TreeDatum>()
    .nodeSize([NODE_BASE_HEIGHT + VERTICAL_GAP + 18, NODE_WIDTH + HORIZONTAL_GAP])
    .separation((a, b) => {
      const ha = a.data.node ? estimateNodeHeight(a.data.node) : NODE_BASE_HEIGHT;
      const hb = b.data.node ? estimateNodeHeight(b.data.node) : NODE_BASE_HEIGHT;
      const avg = (ha + hb) / 2;
      const factor = avg / NODE_BASE_HEIGHT;
      return (a.parent === b.parent ? 1.0 : 1.25) * Math.max(1, factor);
    });

  const laidOut = layout(rootHierarchy);

  const positioned: PositionedNode[] = [];
  const posById = new Map<string, PositionedNode>();

  for (const h of laidOut.descendants()) {
    if (!h.data.node) continue;
    const node = h.data.node;
    const height = estimateNodeHeight(node);
    // Horizontal layout: h.y -> x axis, h.x -> y axis; shift left by 1 column since virtualRoot is at depth 0
    const x = h.y - (NODE_WIDTH + HORIZONTAL_GAP);
    const y = h.x - height / 2;
    const item: PositionedNode = {
      node,
      x,
      y,
      width: NODE_WIDTH,
      height,
      depth: Math.max(0, h.depth - 1),
      childCount: (childrenMap.get(node.id) || []).length,
      hiddenDescendantCount: h.data.hiddenDescendantCount,
    };
    positioned.push(item);
    posById.set(node.id, item);
  }

  // Normalize coordinates so minX/minY sit comfortably at positive padding
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positioned) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }

  const padX = 72;
  const padY = 72;
  const shiftX = padX - minX;
  const shiftY = padY - minY;
  for (const p of positioned) {
    p.x += shiftX;
    p.y += shiftY;
  }

  const bounds = {
    minX: 0,
    minY: 0,
    maxX: maxX + shiftX + padX,
    maxY: maxY + shiftY + padY,
    width: Math.max(800, maxX - minX + padX * 2),
    height: Math.max(520, maxY - minY + padY * 2),
  };

  const edges: PositionedEdge[] = [];
  for (const p of positioned) {
    if (!p.node.parentId) continue;
    const parent = posById.get(p.node.parentId);
    if (!parent) continue;

    const sx = parent.x + parent.width;
    const sy = parent.y + parent.height / 2;
    const tx = p.x;
    const ty = p.y + p.height / 2;
    const midX = sx + (tx - sx) * 0.52;

    const path = `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`;
    edges.push({
      id: `${parent.node.id}->${p.node.id}`,
      sourceId: parent.node.id,
      targetId: p.node.id,
      path,
      label: p.node.relationLabel || "",
      labelX: (sx + tx) / 2,
      labelY: (sy + ty) / 2 - 7,
      targetType: p.node.type,
    });
  }

  const positionedCrossLinks: PositionedCrossLink[] = [];
  for (const link of crossLinks) {
    const from = posById.get(link.fromId);
    const to = posById.get(link.toId);
    if (!from || !to) continue;

    const sx = from.x + from.width / 2;
    const sy = from.y;
    const tx = to.x + to.width / 2;
    const ty = to.y + to.height;
    const curveOffset = Math.max(56, Math.abs(sx - tx) * 0.28);
    const cx = (sx + tx) / 2 - curveOffset;
    const cy = (sy + ty) / 2;

    const path = `M ${sx} ${sy} Q ${cx} ${cy}, ${tx} ${ty}`;
    positionedCrossLinks.push({
      link,
      path,
      labelX: (sx + 2 * cx + tx) / 4,
      labelY: (sy + 2 * cy + ty) / 4 - 6,
    });
  }

  return {
    nodes: positioned,
    edges,
    crossLinks: positionedCrossLinks,
    bounds,
  };
}

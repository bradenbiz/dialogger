/**
 * IBIS map helpers shared by the server and the UI: node display metadata, the speaker
 * palette, legal parent/child node types, and Conklin facilitation stats.
 * The data shapes themselves are Zod schemas in ./schemas/models.ts.
 */
import type { IBISNode, IBISNodeType, TranscriptTurn } from "./schemas/models";

/**
 * Palette for up to 8 concurrent speakers (matching Nemotron 3 Diarization's 8 slots).
 */
export const SPEAKER_PALETTE = [
  "#2563EB", // Cobalt
  "#D97706", // Amber
  "#059669", // Emerald
  "#DB2777", // Rose
  "#7C3AED", // Violet
  "#0891B2", // Cyan
  "#EA580C", // Terracotta
  "#4F46E5", // Indigo
] as const;

export const IBIS_NODE_META: Record<
  IBISNodeType,
  {
    name: string;
    shortName: string;
    symbol: string;
    description: string;
    conklinGuidance: string;
    accent: string;
    bg: string;
    border: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  question: {
    name: "Question",
    shortName: "Question",
    symbol: "?",
    description: "An open issue or problem to explore",
    conklinGuidance:
      "Phrase neutrally as an open question (How, What, Should). Questions organize the shared inquiry.",
    accent: "#1D4ED8",
    bg: "#EFF6FF",
    border: "#93C5FD",
    badgeBg: "#1D4ED8",
    badgeText: "#FFFFFF",
  },
  idea: {
    name: "Idea",
    shortName: "Idea",
    symbol: "💡",
    description: "A proposed answer or position responding to a Question",
    conklinGuidance:
      "Distill the proposal clearly without bias. If an Idea appears without a Question, surface the implicit Question first.",
    accent: "#B45309",
    bg: "#FFFBEB",
    border: "#FCD34D",
    badgeBg: "#D97706",
    badgeText: "#FFFFFF",
  },
  pro: {
    name: "Pro",
    shortName: "Pro",
    symbol: "+",
    description: "A supporting argument or benefit for an Idea",
    conklinGuidance:
      "State the substantive reason why the parent Idea works or advances the group's goals.",
    accent: "#047857",
    bg: "#ECFDF5",
    border: "#6EE7B7",
    badgeBg: "#059669",
    badgeText: "#FFFFFF",
  },
  con: {
    name: "Con",
    shortName: "Con",
    symbol: "−",
    description: "An objection, risk, or trade-off against an Idea",
    conklinGuidance:
      "Capture objections steel-manned and neutrally—dissent is fuel for shared understanding.",
    accent: "#BE123C",
    bg: "#FFF1F2",
    border: "#FDA4AF",
    badgeBg: "#E11D48",
    badgeText: "#FFFFFF",
  },
  decision: {
    name: "Decision",
    shortName: "Decision",
    symbol: "✓",
    description: "An agreed resolution or shared commitment",
    conklinGuidance:
      "Use only when participants explicitly agree—never force premature closure on a wicked problem.",
    accent: "#4338CA",
    bg: "#EEF2FF",
    border: "#A5B4FC",
    badgeBg: "#4338CA",
    badgeText: "#FFFFFF",
  },
  note: {
    name: "Note",
    shortName: "Note",
    symbol: "i",
    description: "Facts, data, constraints, or background context",
    conklinGuidance:
      "Anchor constraints, metrics, and shared context without cluttering the argumentative branches.",
    accent: "#475569",
    bg: "#F8FAFC",
    border: "#CBD5E1",
    badgeBg: "#475569",
    badgeText: "#FFFFFF",
  },
};

/**
 * Conklin IBIS legal child types for a given parent type.
 * Used both as facilitation hints in the UI and as soft grammar checks.
 */
export const LEGAL_IBIS_CHILDREN: Record<IBISNodeType, IBISNodeType[]> = {
  question: ["idea", "question", "decision", "note"],
  idea: ["pro", "con", "question", "decision", "note"],
  pro: ["question", "pro", "con", "note"],
  con: ["question", "pro", "con", "note"],
  decision: ["question", "pro", "con", "note"],
  note: ["question", "note"],
};

export function defaultRelationLabel(
  parentType: IBISNodeType | null,
  childType: IBISNodeType
): string {
  if (!parentType) return "root";
  switch (childType) {
    case "idea":
      return parentType === "question" ? "answers" : "proposes";
    case "pro":
      return "supports";
    case "con":
      return "objects to";
    case "question":
      return parentType === "question" ? "sub-question" : "questions";
    case "decision":
      return "decides";
    case "note":
      return "context";
  }
}

export interface ConklinMapStats {
  totalNodes: number;
  counts: Record<IBISNodeType, number>;
  openQuestionIds: string[];
  resolvedQuestionIds: string[];
  contestedIdeaIds: string[];
  unbackedIdeaIds: string[];
  overlappingTurns: number;
  nudges: Array<{
    id: string;
    severity: "info" | "attention";
    message: string;
    nodeIds?: string[];
  }>;
}

/**
 * Computes Conklin facilitation metrics and nudges from the live IBIS graph.
 */
export function computeConklinStats(
  nodes: IBISNode[],
  turns: TranscriptTurn[]
): ConklinMapStats {
  const counts: Record<IBISNodeType, number> = {
    question: 0,
    idea: 0,
    pro: 0,
    con: 0,
    decision: 0,
    note: 0,
  };

  const childrenByParent = new Map<string, IBISNode[]>();
  for (const n of nodes) {
    counts[n.type]++;
    if (n.parentId) {
      const list = childrenByParent.get(n.parentId) || [];
      list.push(n);
      childrenByParent.set(n.parentId, list);
    }
  }

  const hasDescendantDecision = (nodeId: string, seen = new Set<string>()): boolean => {
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);
    const kids = childrenByParent.get(nodeId) || [];
    for (const k of kids) {
      if (k.type === "decision") return true;
      if (k.type === "idea" && hasDescendantDecision(k.id, seen)) return true;
    }
    return false;
  };

  const openQuestionIds: string[] = [];
  const resolvedQuestionIds: string[] = [];
  const contestedIdeaIds: string[] = [];
  const unbackedIdeaIds: string[] = [];

  for (const n of nodes) {
    const kids = childrenByParent.get(n.id) || [];
    if (n.type === "question") {
      if (hasDescendantDecision(n.id)) {
        resolvedQuestionIds.push(n.id);
      } else {
        openQuestionIds.push(n.id);
      }
    }
    if (n.type === "idea") {
      const hasPro = kids.some((k) => k.type === "pro");
      const hasCon = kids.some((k) => k.type === "con");
      if (hasPro && hasCon) {
        contestedIdeaIds.push(n.id);
      } else if (!hasPro && !hasCon) {
        unbackedIdeaIds.push(n.id);
      }
    }
  }

  const overlappingTurns = turns.filter((t) => t.overlap).length;
  const nudges: ConklinMapStats["nudges"] = [];

  if (counts.idea >= 2 && counts.con === 0) {
    nudges.push({
      id: "missing-cons",
      severity: "attention",
      message:
        "Several ideas captured with no Cons yet — invite risks or trade-offs to avoid premature convergence.",
    });
  }
  if (contestedIdeaIds.length > 0 && counts.decision === 0) {
    nudges.push({
      id: "contested-ideas",
      severity: "info",
      message: `${contestedIdeaIds.length} contested idea${contestedIdeaIds.length > 1 ? "s have" : " has"} both Pros and Cons — ask what criteria would decide between them.`,
      nodeIds: contestedIdeaIds,
    });
  }
  if (openQuestionIds.length >= 3) {
    nudges.push({
      id: "open-questions",
      severity: "info",
      message: `${openQuestionIds.length} open questions are active — consider prioritizing which question to resolve first.`,
      nodeIds: openQuestionIds,
    });
  }
  if (unbackedIdeaIds.length >= 2) {
    nudges.push({
      id: "unbacked-ideas",
      severity: "info",
      message: `${unbackedIdeaIds.length} ideas lack explicit Pros or Cons — probe their assumptions.`,
      nodeIds: unbackedIdeaIds,
    });
  }

  return {
    totalNodes: nodes.length,
    counts,
    openQuestionIds,
    resolvedQuestionIds,
    contestedIdeaIds,
    unbackedIdeaIds,
    overlappingTurns,
    nudges,
  };
}

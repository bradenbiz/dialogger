import { z } from "zod";

/**
 * Jeffrey Conklin's Dialogue Mapping / IBIS (Issue-Based Information System) Grammar.
 *
 * Reference: Jeff Conklin, "Dialogue Mapping: Building Shared Understanding of
 * Wicked Problems" (Wiley, 2005).
 */

export const IBISNodeTypeSchema = z.enum([
  "question", // Issue (?) — the backbone of the dialogue map; always phrased as an open question
  "idea",     // Position (💡) — a proposed answer or response to a Question
  "pro",      // Supporting Argument (+) — reasons supporting an Idea (or argument)
  "con",      // Objecting Argument (-) — concerns, risks, or objections to an Idea (or argument)
  "decision", // Agreed Resolution (✓) — explicit shared commitment reached by the group
  "note",     // Reference / Context (i) — constraints, evidence, facts, or background info
]);

export type IBISNodeType = z.infer<typeof IBISNodeTypeSchema>;

export const IBISCrossLinkKindSchema = z.enum([
  "relates_to",
  "conflicts_with",
  "depends_on",
  "supersedes",
]);

export type IBISCrossLinkKind = z.infer<typeof IBISCrossLinkKindSchema>;

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
}

export interface Speaker {
  id: string; // e.g. "speaker_1" .. "speaker_8"
  channel: number; // 1-based speaker slot from Nemotron 3 Diarization (up to 8)
  name: string; // Display name (defaults to "Speaker 1", editable inline or by agent)
  color: string; // Hex accent color
  role?: string;
  voiceEnrolled?: boolean; // True when a clean voice seed is stored for Nemotron 3 Diarization
}

export interface TranscriptTurn {
  id: string;
  speakerId: string;
  text: string;
  startSec: number;
  endSec: number;
  overlap?: boolean; // True when speech overlapped another speaker
  overlapWith?: string[]; // Speaker IDs active simultaneously
  words?: WordTiming[];
  source: "live" | "file" | "agent" | "manual" | "demo";
  kind?: "discussion" | "host_context"; // Set when the mapper classifies a turn as host/moderator framing context
  createdAt: string;
  mapped: boolean; // Whether the Conklin mapper has already incorporated this turn
}

export const HostContextCategorySchema = z.enum([
  "framing",
  "participants",
  "format",
  "ground_rules",
  "background",
]);

export type HostContextCategory = z.infer<typeof HostContextCategorySchema>;

export interface HostContextItem {
  id: string;
  category: HostContextCategory;
  summary: string;
  turnIds: string[];
  speakerIds: string[];
  createdAt: string;
}

export interface IBISNode {
  id: string;
  type: IBISNodeType;
  label: string; // Crisp, distilled Conklin summary (5-14 words, neutral phrasing)
  detail?: string; // Optional nuance, criteria, or framing note
  parentId: string | null;
  relationLabel?: string; // e.g. "answers", "supports", "objects to", "questions", "decides", "context"
  turnIds: string[]; // Provenance links back to verbatim diarized transcript turns
  speakerIds: string[]; // Speakers who contributed or endorsed this node
  createdAt: string;
  updatedAt: string;
  createdBy: "model" | "agent" | "human" | "heuristic";
  collapsed?: boolean;
}

export interface IBISCrossLink {
  id: string;
  fromId: string;
  toId: string;
  kind: IBISCrossLinkKind;
  label?: string;
}

export interface MapActivityEntry {
  id: string;
  timestamp: string;
  actor: "model" | "agent" | "human" | "heuristic" | "speech";
  summary: string;
  affectedNodeIds?: string[];
}

export interface SessionAudioMeta {
  filename: string;
  mimeType: string;
  durationSec: number;
  sourceUrl?: string;
  sourceTitle?: string;
  clipStartSec?: number;
}

export interface DialogueSession {
  id: string;
  title: string;
  rootFocus?: string; // Framing problem statement
  createdAt: string;
  updatedAt: string;
  speakers: Speaker[];
  turns: TranscriptTurn[];
  nodes: IBISNode[];
  crossLinks: IBISCrossLink[];
  hostContext: HostContextItem[];
  activity: MapActivityEntry[];
  audio?: SessionAudioMeta;
  speechConfig: {
    streamingAsrModel: string;
    offlineAsrModel: string;
    diarizationModel: string;
  };
  autoMap: boolean;
}

const optStr = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === null || v === "" ? undefined : v));

const optStrArr = () =>
  z
    .array(z.string())
    .nullish()
    .transform((v) => (v == null ? undefined : v));

export const IBISMapOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    id: z
      .string()
      .min(1)
      .nullish()
      .transform((v) => (v == null ? undefined : v)),
    type: IBISNodeTypeSchema,
    label: z.string().min(1).max(240),
    detail: optStr(1000),
    parentId: z.string().nullable().optional(),
    relationLabel: optStr(48),
    turnIds: optStrArr(),
    speakerIds: optStrArr(),
  }),
  z.object({
    op: z.literal("update_node"),
    id: z.string().min(1),
    type: IBISNodeTypeSchema.nullish().transform((v) =>
      v == null ? undefined : v
    ),
    label: z
      .string()
      .min(1)
      .max(240)
      .nullish()
      .transform((v) => (v == null ? undefined : v)),
    detail: optStr(1000),
    relationLabel: optStr(48),
    addTurnIds: optStrArr(),
    addSpeakerIds: optStrArr(),
  }),
  z.object({
    op: z.literal("move_node"),
    id: z.string().min(1),
    parentId: z.string().nullable(),
    relationLabel: optStr(48),
  }),
  z.object({
    op: z.literal("delete_node"),
    id: z.string().min(1),
    cascade: z.boolean().nullish().transform((v) => (v == null ? undefined : v)),
  }),
  z.object({
    op: z.literal("add_cross_link"),
    id: z
      .string()
      .min(1)
      .nullish()
      .transform((v) => (v == null ? undefined : v)),
    fromId: z.string().min(1),
    toId: z.string().min(1),
    kind: IBISCrossLinkKindSchema.nullish().transform((v) => v ?? "relates_to"),
    label: optStr(64),
  }),
  z.object({
    op: z.literal("remove_cross_link"),
    id: z.string().min(1),
  }),
  z.object({
    op: z.literal("rename_speaker"),
    speakerId: z.string().min(1),
    name: z.string().min(1).max(64),
    role: optStr(64),
  }),
  z.object({
    op: z.literal("set_title"),
    title: z.string().min(1).max(160),
    rootFocus: optStr(300),
  }),
  z.object({
    op: z.literal("add_host_context"),
    id: z
      .string()
      .min(1)
      .nullish()
      .transform((v) => (v == null ? undefined : v)),
    category: HostContextCategorySchema.nullish().transform(
      (v) => v ?? "framing"
    ),
    summary: z.string().min(1).max(320),
    turnIds: optStrArr(),
    speakerIds: optStrArr(),
  }),
  z.object({
    op: z.literal("remove_host_context"),
    id: z.string().min(1),
  }),
]);

export type IBISMapOp = z.infer<typeof IBISMapOpSchema>;

export const IBISOpBatchSchema = z.object({
  actor: z.enum(["model", "agent", "human", "heuristic"]).default("agent"),
  summary: z.string().max(240).optional(),
  markTurnIdsMapped: z.array(z.string()).optional(),
  ops: z.array(IBISMapOpSchema),
});

export type IBISOpBatch = z.infer<typeof IBISOpBatchSchema>;

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

import { z } from "zod";
import { named } from "./registry";

/**
 * Jeffrey Conklin's Dialogue Mapping / IBIS (Issue-Based Information System) Grammar.
 *
 * Reference: Jeff Conklin, "Dialogue Mapping: Building Shared Understanding of
 * Wicked Problems" (Wiley, 2005).
 */

export const IBISNodeTypeSchema = named(
  "IBISNodeType",
  z.enum([
    "question", // Issue (?) — the backbone of the dialogue map; always phrased as an open question
    "idea", // Position (💡) — a proposed answer or response to a Question
    "pro", // Supporting Argument (+) — reasons supporting an Idea (or argument)
    "con", // Objecting Argument (-) — concerns, risks, or objections to an Idea (or argument)
    "decision", // Agreed Resolution (✓) — explicit shared commitment reached by the group
    "note", // Reference / Context (i) — constraints, evidence, facts, or background info
  ])
);

export type IBISNodeType = z.infer<typeof IBISNodeTypeSchema>;

export const IBISCrossLinkKindSchema = named(
  "IBISCrossLinkKind",
  z.enum(["relates_to", "conflicts_with", "depends_on", "supersedes"])
);

export type IBISCrossLinkKind = z.infer<typeof IBISCrossLinkKindSchema>;

export const WordTimingSchema = named(
  "WordTiming",
  z.object({
    word: z.string(),
    start: z.number(),
    end: z.number(),
    confidence: z.number().optional(),
    speaker: z.number().optional(),
  })
);

export type WordTiming = z.infer<typeof WordTimingSchema>;

export const SpeakerSchema = named(
  "Speaker",
  z.object({
    id: z.string().describe('e.g. "speaker_1" .. "speaker_8"'),
    channel: z.number().int().describe("1-based speaker slot from Nemotron 3 Diarization (up to 8)"),
    name: z.string().describe('Display name (defaults to "Speaker 1", editable inline or by agent)'),
    color: z.string().describe("Hex accent color"),
    role: z.string().optional(),
    voiceEnrolled: z
      .boolean()
      .optional()
      .describe("True when a clean voice seed is stored for Nemotron 3 Diarization"),
  })
);

export type Speaker = z.infer<typeof SpeakerSchema>;

export const TurnSourceSchema = z.enum(["live", "file", "agent", "manual", "demo"]);

export const TranscriptTurnSchema = named(
  "TranscriptTurn",
  z.object({
    id: z.string(),
    speakerId: z.string(),
    text: z.string(),
    startSec: z.number(),
    endSec: z.number(),
    overlap: z.boolean().optional().describe("True when speech overlapped another speaker"),
    overlapWith: z.array(z.string()).optional().describe("Speaker IDs active simultaneously"),
    words: z.array(WordTimingSchema).optional(),
    source: TurnSourceSchema,
    kind: z
      .enum(["discussion", "host_context"])
      .optional()
      .describe("Set when the mapper classifies a turn as host/moderator framing context"),
    createdAt: z.string(),
    mapped: z.boolean().describe("Whether the Conklin mapper has already incorporated this turn"),
  })
);

export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

export const HostContextCategorySchema = named(
  "HostContextCategory",
  z.enum(["framing", "participants", "format", "ground_rules", "background"])
);

export type HostContextCategory = z.infer<typeof HostContextCategorySchema>;

export const HostContextItemSchema = named(
  "HostContextItem",
  z.object({
    id: z.string(),
    category: HostContextCategorySchema,
    summary: z.string(),
    turnIds: z.array(z.string()),
    speakerIds: z.array(z.string()),
    createdAt: z.string(),
  })
);

export type HostContextItem = z.infer<typeof HostContextItemSchema>;

export const MapActorSchema = z.enum(["model", "agent", "human", "heuristic"]);

export const IBISNodeSchema = named(
  "IBISNode",
  z.object({
    id: z.string(),
    type: IBISNodeTypeSchema,
    label: z.string().describe("Crisp, distilled Conklin summary (5-14 words, neutral phrasing)"),
    detail: z.string().optional().describe("Optional nuance, criteria, or framing note"),
    parentId: z.string().nullable(),
    relationLabel: z
      .string()
      .optional()
      .describe('e.g. "answers", "supports", "objects to", "questions", "decides", "context"'),
    turnIds: z.array(z.string()).describe("Provenance links back to verbatim diarized transcript turns"),
    speakerIds: z.array(z.string()).describe("Speakers who contributed or endorsed this node"),
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: MapActorSchema,
    collapsed: z.boolean().optional(),
  })
);

export type IBISNode = z.infer<typeof IBISNodeSchema>;

export const IBISCrossLinkSchema = named(
  "IBISCrossLink",
  z.object({
    id: z.string(),
    fromId: z.string(),
    toId: z.string(),
    kind: IBISCrossLinkKindSchema,
    label: z.string().optional(),
  })
);

export type IBISCrossLink = z.infer<typeof IBISCrossLinkSchema>;

export const MapActivityEntrySchema = named(
  "MapActivityEntry",
  z.object({
    id: z.string(),
    timestamp: z.string(),
    actor: z.enum(["model", "agent", "human", "heuristic", "speech"]),
    summary: z.string(),
    affectedNodeIds: z.array(z.string()).optional(),
  })
);

export type MapActivityEntry = z.infer<typeof MapActivityEntrySchema>;

export const SessionAudioMetaSchema = named(
  "SessionAudioMeta",
  z.object({
    filename: z.string(),
    mimeType: z.string(),
    durationSec: z.number(),
    sourceUrl: z.string().optional(),
    sourceTitle: z.string().optional(),
    clipStartSec: z.number().optional(),
  })
);

export type SessionAudioMeta = z.infer<typeof SessionAudioMetaSchema>;

export const SpeechConfigSchema = named(
  "SpeechConfig",
  z.object({
    streamingAsrModel: z.string(),
    offlineAsrModel: z.string(),
    diarizationModel: z.string(),
  })
);

export const DialogueSessionSchema = named(
  "Session",
  z.object({
    id: z.string(),
    title: z.string(),
    rootFocus: z.string().optional().describe("Framing problem statement"),
    createdAt: z.string(),
    updatedAt: z.string(),
    speakers: z.array(SpeakerSchema),
    turns: z.array(TranscriptTurnSchema),
    nodes: z.array(IBISNodeSchema),
    crossLinks: z.array(IBISCrossLinkSchema),
    hostContext: z.array(HostContextItemSchema),
    activity: z.array(MapActivityEntrySchema),
    audio: SessionAudioMetaSchema.optional(),
    speechConfig: SpeechConfigSchema,
    autoMap: z.boolean(),
  }),
  "A dialogue mapping session: speakers, diarized transcript, and the IBIS map."
);

export type DialogueSession = z.infer<typeof DialogueSessionSchema>;

// Agents and LLMs often send null or "" for absent fields; normalize those to undefined.
const nullToUndefined = <T>(v: T | null | undefined): T | undefined =>
  v === null ? undefined : v;

const optStr = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === null || v === "" ? undefined : v))
    .optional();

const optStrArr = () => z.array(z.string()).nullish().transform(nullToUndefined).optional();

const optId = () => z.string().min(1).nullish().transform(nullToUndefined).optional();

export const IBISMapOpSchema = named(
  "IBISMapOp",
  z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    id: optId(),
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
    type: IBISNodeTypeSchema.nullish().transform(nullToUndefined).optional(),
    label: z.string().min(1).max(240).nullish().transform(nullToUndefined).optional(),
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
    cascade: z.boolean().nullish().transform(nullToUndefined).optional(),
  }),
  z.object({
    op: z.literal("add_cross_link"),
    id: optId(),
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
    id: optId(),
    category: HostContextCategorySchema.nullish().transform((v) => v ?? "framing"),
    summary: z.string().min(1).max(320),
    turnIds: optStrArr(),
    speakerIds: optStrArr(),
  }),
  z.object({
    op: z.literal("remove_host_context"),
    id: z.string().min(1),
  }),
  ]),
  "One incremental IBIS map operation, discriminated by `op`."
);

export type IBISMapOp = z.infer<typeof IBISMapOpSchema>;

export const IBISOpBatchSchema = named(
  "IBISOpBatch",
  z.object({
    actor: MapActorSchema.default("agent"),
    summary: z.string().max(240).optional(),
    markTurnIdsMapped: z.array(z.string()).optional(),
    ops: z.array(IBISMapOpSchema),
  }),
  "A batch of IBIS map operations applied atomically."
);

export type IBISOpBatch = z.infer<typeof IBISOpBatchSchema>;

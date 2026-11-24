import { z } from "zod";
import {
  DialogueSessionSchema,
  HostContextItemSchema,
  IBISCrossLinkSchema,
  IBISNodeSchema,
  MapActivityEntrySchema,
  SessionAudioMetaSchema,
  SpeakerSchema,
  TranscriptTurnSchema,
} from "./ibis";
import { named } from "./schema-registry";

/** Events pushed over `GET /api/sessions/:id/events` (each SSE `data:` line is one of these). */
export const SessionSSEEventSchema = named(
  "SessionEvent",
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("session.snapshot"), session: DialogueSessionSchema }),
    z.object({
      type: z.literal("session.updated"),
      title: z.string(),
      rootFocus: z.string().optional(),
      autoMap: z.boolean(),
    }),
    z.object({ type: z.literal("session.audio"), audio: SessionAudioMetaSchema }),
    z.object({
      type: z.literal("session.context_updated"),
      hostContext: z.array(HostContextItemSchema),
      hostTurnIds: z.array(z.string()),
    }),
    z.object({ type: z.literal("speaker.updated"), speaker: SpeakerSchema }),
    z.object({
      type: z.literal("transcript.partial"),
      text: z.string(),
      speakerId: z.string().optional(),
      timestamp: z.string(),
    }),
    z.object({ type: z.literal("transcript.turn"), turn: TranscriptTurnSchema }),
    z.object({ type: z.literal("transcript.turn_updated"), turn: TranscriptTurnSchema }),
    z.object({
      type: z.literal("transcript.turns_batch"),
      turns: z.array(TranscriptTurnSchema),
    }),
    z.object({
      type: z.literal("map.updated"),
      nodes: z.array(IBISNodeSchema),
      crossLinks: z.array(IBISCrossLinkSchema),
      affectedNodeIds: z.array(z.string()),
      activity: MapActivityEntrySchema.optional(),
    }),
    z.object({
      type: z.literal("mapper.status"),
      status: z.enum(["idle", "analyzing", "error"]),
      message: z.string().optional(),
    }),
    z.object({
      type: z.literal("speech.status"),
      state: z.enum(["idle", "listening", "transcribing", "error"]),
      message: z.string().optional(),
    }),
  ]),
  "One server-sent event on a session's live stream, discriminated by `type`."
);

export type SessionSSEEvent = z.infer<typeof SessionSSEEventSchema>;

export const SpeechEngineStatusSchema = named(
  "SpeechEngineStatus",
  z.object({
    installed: z.boolean(),
    binaryPath: z.string().nullable(),
    version: z.string().nullable(),
    ffmpegInstalled: z.boolean(),
    serverRunning: z.boolean(),
    serverUrl: z.string(),
    streamingAsrModel: z.string(),
    offlineAsrModel: z.string(),
    diarizationModel: z.string(),
    cachedModels: z.array(
      z.object({
        name: z.string(),
        repo: z.string(),
        role: z.enum(["asr", "diarization", "tts", "codec"]),
        cached: z.boolean(),
      })
    ),
  })
);

export type SpeechEngineStatus = z.infer<typeof SpeechEngineStatusSchema>;

export const MapperModeSchema = z.enum(["llm", "heuristic", "agent-only"]);
export const MapperProviderSchema = z.enum([
  "claude-cli",
  "codex-cli",
  "openai-compatible",
  "anthropic",
  "heuristic",
]);

export const MapperConfigInfoSchema = named(
  "MapperConfig",
  z.object({
    mode: MapperModeSchema,
    provider: MapperProviderSchema,
    baseUrl: z.string(),
    model: z.string(),
    hasApiKey: z.boolean(),
    claudeCliAvailable: z.boolean(),
    codexCliAvailable: z.boolean(),
  })
);

export type MapperConfigInfo = z.infer<typeof MapperConfigInfoSchema>;

export const EnrolledVoiceInfoSchema = named(
  "EnrolledVoice",
  z.object({
    id: z.string(),
    name: z.string(),
    durationSec: z.number(),
    sampleCount: z.number().int(),
    updatedAt: z.string(),
  })
);

export type EnrolledVoiceInfo = z.infer<typeof EnrolledVoiceInfoSchema>;

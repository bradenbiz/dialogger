/**
 * Request and response contracts for the Dialogger HTTP API.
 *
 * The server validates request bodies with these schemas and type-checks its responses
 * against them; the web client uses the same types; the OpenAPI spec is generated from them.
 */
import { z } from "zod";
import {
  DialogueSessionSchema,
  IBISOpBatchSchema,
  MapActivityEntrySchema,
  SpeakerSchema,
  TranscriptTurnSchema,
  TurnSourceSchema,
} from "./models";
import {
  EnrolledVoiceInfoSchema,
  MapperModeSchema,
  MapperProviderSchema,
} from "./events";
import { named } from "./registry";

// --- Shared building blocks ---

export const ValidationErrorSchema = named(
  "ValidationError",
  z.object({
    formErrors: z.array(z.string()),
    fieldErrors: z.record(z.string(), z.array(z.string())),
  }),
  "Request body failed validation."
);

export const ErrorResponseSchema = named(
  "ErrorResponse",
  z.object({
    error: z.union([z.string(), ValidationErrorSchema]),
  }),
  "Every non-2xx response has this shape."
);
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const CancelledResponseSchema = named(
  "CancelledResponse",
  z.object({ cancelled: z.literal(true) }),
  "Returned when the job was stopped or superseded by a newer one before finishing."
);
export type CancelledResponse = z.infer<typeof CancelledResponseSchema>;

export const SessionResponseSchema = named(
  "SessionResponse",
  z.object({ session: DialogueSessionSchema })
);
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const OkResponseSchema = named("OkResponse", z.object({ ok: z.boolean() }));
export type OkResponse = z.infer<typeof OkResponseSchema>;

const SpeechModelOptions = {
  asrModel: z.string().optional(),
  diarizationModel: z.string().optional(),
  autoMap: z.boolean().optional(),
};

// --- Health & auth ---

export const HealthResponseSchema = named(
  "HealthResponse",
  z.object({
    ok: z.literal(true),
    service: z.literal("dialogger"),
    authRequired: z.boolean(),
    authenticated: z.boolean(),
    sessions: z.number().int().optional().describe("Only present when authenticated"),
  })
);
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const LoginRequestSchema = named(
  "LoginRequest",
  z.object({ apiKey: z.string() })
);
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = named(
  "LoginResponse",
  z.object({ ok: z.literal(true), authRequired: z.boolean().optional() })
);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// --- Speech runtime & mapper config ---

export const SpeechStartRequestSchema = named(
  "SpeechStartRequest",
  z.object({ asrModel: z.string().optional(), diarModel: z.string().optional() })
);
export type SpeechStartRequest = z.infer<typeof SpeechStartRequestSchema>;

export const MapperConfigUpdateSchema = named(
  "MapperConfigUpdate",
  z.object({
    mode: MapperModeSchema.optional(),
    provider: MapperProviderSchema.optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    apiKey: z.string().optional(),
  })
);
export type MapperConfigUpdate = z.infer<typeof MapperConfigUpdateSchema>;

export const ConklinPromptResponseSchema = named(
  "ConklinPromptResponse",
  z.object({
    methodology: z.string(),
    systemPrompt: z.string(),
    openApi: z.string(),
    swaggerUi: z.string(),
    endpoints: z.record(z.string(), z.string()),
  })
);
export type ConklinPromptResponse = z.infer<typeof ConklinPromptResponseSchema>;

// --- Voices ---

export const VoiceListResponseSchema = named(
  "VoiceListResponse",
  z.object({ voices: z.array(EnrolledVoiceInfoSchema) })
);
export type VoiceListResponse = z.infer<typeof VoiceListResponseSchema>;

export const VoiceDeletedResponseSchema = named(
  "VoiceDeletedResponse",
  z.object({ deleted: z.literal(true), voices: z.array(EnrolledVoiceInfoSchema) })
);
export type VoiceDeletedResponse = z.infer<typeof VoiceDeletedResponseSchema>;

// --- Sessions ---

export const SessionSummarySchema = named(
  "SessionSummary",
  z.object({
    id: z.string(),
    title: z.string(),
    rootFocus: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    nodeCount: z.number().int(),
    turnCount: z.number().int(),
    speakerCount: z.number().int(),
  })
);
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionListResponseSchema = named(
  "SessionListResponse",
  z.object({ sessions: z.array(SessionSummarySchema) })
);
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const SessionInputSchema = named(
  "SessionInput",
  z.object({
    title: z.string().max(160).optional(),
    rootFocus: z.string().max(300).optional(),
    autoMap: z.boolean().optional(),
    speechConfig: z
      .object({
        streamingAsrModel: z.string().optional(),
        offlineAsrModel: z.string().optional(),
        diarizationModel: z.string().optional(),
      })
      .optional(),
  }),
  "Fields for creating or updating a session. All optional."
);
export type SessionInput = z.infer<typeof SessionInputSchema>;

export const DeletedResponseSchema = named(
  "DeletedResponse",
  z.object({ deleted: z.literal(true) })
);
export type DeletedResponse = z.infer<typeof DeletedResponseSchema>;

export const StoppedResponseSchema = named(
  "StoppedResponse",
  z.object({ stopped: z.boolean() })
);
export type StoppedResponse = z.infer<typeof StoppedResponseSchema>;

// --- Speakers & turns ---

export const RenameSpeakerRequestSchema = named(
  "RenameSpeakerRequest",
  z.object({
    name: z.string().min(1).max(64),
    role: z.string().max(64).optional(),
  })
);
export type RenameSpeakerRequest = z.infer<typeof RenameSpeakerRequestSchema>;

export const SpeakerResponseSchema = named(
  "SpeakerResponse",
  z.object({ speaker: SpeakerSchema })
);
export type SpeakerResponse = z.infer<typeof SpeakerResponseSchema>;

export const TurnInputSchema = named(
  "TurnInput",
  z.object({
    id: z.string().optional(),
    speakerId: z.string().optional(),
    speakerChannel: z.number().int().min(1).max(16).optional(),
    speakerName: z.string().max(64).optional(),
    speakerRole: z.string().max(64).optional(),
    text: z.string().min(1),
    startSec: z.number().nonnegative().optional(),
    endSec: z.number().nonnegative().optional(),
    overlap: z.boolean().optional(),
    overlapWith: z.array(z.string()).optional(),
    source: TurnSourceSchema.default("agent"),
  })
);
export type TurnInput = z.input<typeof TurnInputSchema>;

export const AppendTurnsRequestSchema = named(
  "AppendTurnsRequest",
  z.object({
    turn: TurnInputSchema.optional(),
    turns: z.array(TurnInputSchema).optional(),
    autoMap: z.boolean().optional(),
  }),
  "Send either `turn` or `turns`. Turns are auto-mapped unless `autoMap` is false."
);
export type AppendTurnsRequest = z.input<typeof AppendTurnsRequestSchema>;

export const AppendTurnsResponseSchema = named(
  "AppendTurnsResponse",
  z.object({
    added: z.array(TranscriptTurnSchema),
    session: DialogueSessionSchema,
  })
);
export type AppendTurnsResponse = z.infer<typeof AppendTurnsResponseSchema>;

export const UpdateTurnRequestSchema = named(
  "UpdateTurnRequest",
  z.object({
    speakerId: z.string().min(1).optional(),
    speakerChannel: z.number().int().min(1).max(16).optional(),
    speakerName: z.string().min(1).max(64).optional(),
    speakerRole: z.string().max(64).optional(),
    text: z.string().min(1).optional(),
  })
);
export type UpdateTurnRequest = z.infer<typeof UpdateTurnRequestSchema>;

export const UpdateTurnResponseSchema = named(
  "UpdateTurnResponse",
  z.object({
    turn: TranscriptTurnSchema,
    speaker: SpeakerSchema,
    voiceEnrolled: z.boolean(),
    session: DialogueSessionSchema,
  })
);
export type UpdateTurnResponse = z.infer<typeof UpdateTurnResponseSchema>;

// --- Transcription & audio ---

export const TranscribeFileResponseSchema = named(
  "TranscribeFileResponse",
  z.object({
    asrModel: z.string(),
    diarizationModel: z.string(),
    duration: z.number(),
    text: z.string(),
    turnsAdded: z.number().int(),
    turns: z.array(TranscriptTurnSchema),
    session: DialogueSessionSchema,
  })
);
export type TranscribeFileResponse = z.infer<typeof TranscribeFileResponseSchema>;

export const TranscribeSavedAudioRequestSchema = named(
  "TranscribeSavedAudioRequest",
  z.object({
    startSec: z
      .number()
      .nonnegative()
      .optional()
      .describe("Resume from this playhead, replacing later turns"),
    ...SpeechModelOptions,
    clearExisting: z.boolean().optional(),
  })
);
export type TranscribeSavedAudioRequest = z.infer<typeof TranscribeSavedAudioRequestSchema>;

export const TranscribeSavedAudioResponseSchema = named(
  "TranscribeSavedAudioResponse",
  z.object({
    asrModel: z.string(),
    diarizationModel: z.string(),
    turnsAdded: z.number().int(),
    stagedResetDone: z.boolean(),
    cancelled: z.boolean(),
    session: DialogueSessionSchema,
  })
);
export type TranscribeSavedAudioResponse = z.infer<typeof TranscribeSavedAudioResponseSchema>;

export const TrimAudioRequestSchema = named(
  "TrimAudioRequest",
  z.object({
    startSec: z.number().nonnegative(),
    endSec: z.number().positive().optional(),
    clearTranscriptAndMap: z.boolean().optional(),
  })
);
export type TrimAudioRequest = z.infer<typeof TrimAudioRequestSchema>;

// --- YouTube ---

export const YouTubeMetadataSchema = named(
  "YouTubeMetadata",
  z.object({
    id: z.string(),
    title: z.string(),
    channel: z.string(),
    durationSec: z.number(),
    webpageUrl: z.string(),
  })
);
export type YouTubeMetadata = z.infer<typeof YouTubeMetadataSchema>;

export const YouTubeInspectRequestSchema = named(
  "YouTubeInspectRequest",
  z.object({ url: z.string().min(1) })
);
export type YouTubeInspectRequest = z.infer<typeof YouTubeInspectRequestSchema>;

export const YouTubeInspectResponseSchema = named(
  "YouTubeInspectResponse",
  z.object({ metadata: YouTubeMetadataSchema })
);
export type YouTubeInspectResponse = z.infer<typeof YouTubeInspectResponseSchema>;

export const YouTubeImportRequestSchema = named(
  "YouTubeImportRequest",
  z.object({
    url: z.string().min(1),
    startSec: z.number().nonnegative().optional(),
    durationSec: z
      .number()
      .nonnegative()
      .optional()
      .describe("Clip length in seconds; omit for the whole video"),
    ...SpeechModelOptions,
    clearExisting: z.boolean().optional(),
  })
);
export type YouTubeImportRequest = z.infer<typeof YouTubeImportRequestSchema>;

export const YouTubeImportResponseSchema = named(
  "YouTubeImportResponse",
  z.object({
    metadata: YouTubeMetadataSchema,
    asrModel: z.string(),
    diarizationModel: z.string(),
    duration: z.number(),
    turnsAdded: z.number().int(),
    cancelled: z.boolean().optional(),
    session: DialogueSessionSchema,
  })
);
export type YouTubeImportResponse = z.infer<typeof YouTubeImportResponseSchema>;

// --- Map ---

export { IBISOpBatchSchema };

export const ApplyMapOpsResponseSchema = named(
  "ApplyMapOpsResponse",
  z.object({
    session: DialogueSessionSchema,
    affectedNodeIds: z.array(z.string()),
    activity: MapActivityEntrySchema.optional(),
  })
);
export type ApplyMapOpsResponse = z.infer<typeof ApplyMapOpsResponseSchema>;

export const MapAnalyzeRequestSchema = named(
  "MapAnalyzeRequest",
  z.object({
    remapAll: z.boolean().optional().describe("Clear the map first and remap every turn"),
  })
);
export type MapAnalyzeRequest = z.infer<typeof MapAnalyzeRequestSchema>;

// --- Demo ---

export const DemoStartRequestSchema = named(
  "DemoStartRequest",
  z.object({
    instant: z.boolean().optional(),
    intervalMs: z
      .number()
      .optional()
      .describe("Delay between demo turns in ms, clamped to 400–8000 (default 1850)"),
  })
);
export type DemoStartRequest = z.infer<typeof DemoStartRequestSchema>;

export const DemoStartResponseSchema = named(
  "DemoStartResponse",
  z.object({
    started: z.literal(true),
    instant: z.boolean(),
    beats: z.number().int(),
  })
);
export type DemoStartResponse = z.infer<typeof DemoStartResponseSchema>;

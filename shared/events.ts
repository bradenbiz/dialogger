import type {
  DialogueSession,
  HostContextItem,
  IBISCrossLink,
  IBISNode,
  MapActivityEntry,
  SessionAudioMeta,
  Speaker,
  TranscriptTurn,
} from "./ibis";

export type SessionSSEEvent =
  | { type: "session.snapshot"; session: DialogueSession }
  | { type: "session.updated"; title: string; rootFocus?: string; autoMap: boolean }
  | { type: "session.audio"; audio: SessionAudioMeta }
  | {
      type: "session.context_updated";
      hostContext: HostContextItem[];
      hostTurnIds: string[];
    }
  | { type: "speaker.updated"; speaker: Speaker }
  | {
      type: "transcript.partial";
      text: string;
      speakerId?: string;
      timestamp: string;
    }
  | { type: "transcript.turn"; turn: TranscriptTurn }
  | { type: "transcript.turn_updated"; turn: TranscriptTurn }
  | { type: "transcript.turns_batch"; turns: TranscriptTurn[] }
  | {
      type: "map.updated";
      nodes: IBISNode[];
      crossLinks: IBISCrossLink[];
      affectedNodeIds: string[];
      activity?: MapActivityEntry;
    }
  | {
      type: "mapper.status";
      status: "idle" | "analyzing" | "error";
      message?: string;
    }
  | {
      type: "speech.status";
      state: "idle" | "listening" | "transcribing" | "error";
      message?: string;
    };

export interface SpeechEngineStatus {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  ffmpegInstalled: boolean;
  serverRunning: boolean;
  serverUrl: string;
  streamingAsrModel: string;
  offlineAsrModel: string;
  diarizationModel: string;
  cachedModels: Array<{
    name: string;
    repo: string;
    role: "asr" | "diarization" | "tts" | "codec";
    cached: boolean;
  }>;
}

export interface MapperConfigInfo {
  mode: "llm" | "heuristic" | "agent-only";
  provider: "claude-cli" | "codex-cli" | "openai-compatible" | "anthropic" | "heuristic";
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  claudeCliAvailable: boolean;
  codexCliAvailable: boolean;
}

export interface EnrolledVoiceInfo {
  id: string;
  name: string;
  durationSec: number;
  sampleCount: number;
  updatedAt: string;
}

import type {
  AppendTurnsResponse,
  ApplyMapOpsResponse,
  DeletedResponse,
  DemoStartRequest,
  DemoStartResponse,
  ErrorResponse,
  LoginResponse,
  MapperConfigUpdate,
  SessionInput,
  SessionListResponse,
  SessionResponse,
  SpeakerResponse,
  SpeechStartRequest,
  StoppedResponse,
  TranscribeFileResponse,
  TranscribeSavedAudioRequest,
  TranscribeSavedAudioResponse,
  TrimAudioRequest,
  TurnInput,
  UpdateTurnRequest,
  UpdateTurnResponse,
  CancelledResponse,
  VoiceDeletedResponse,
  VoiceListResponse,
  YouTubeImportRequest,
  YouTubeImportResponse,
  YouTubeInspectResponse,
} from "@shared/schemas/contracts";
import type {
  MapperConfigInfo,
  SessionSSEEvent,
  SpeechEngineStatus,
} from "@shared/schemas/events";
import type { IBISOpBatch } from "@shared/schemas/models";

export type { SessionSummary, YouTubeMetadata } from "@shared/schemas/contracts";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as Partial<ErrorResponse>;
      if (typeof body.error === "string") msg = body.error;
      else if (body.error) msg = JSON.stringify(body.error);
    } catch {
      msg = await res.text();
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

const sessionUrl = (id: string, suffix = "") =>
  `/api/sessions/${encodeURIComponent(id)}${suffix}`;

export const api = {
  authLogin(apiKey: string): Promise<LoginResponse> {
    return req("/api/auth/login", json("POST", { apiKey }));
  },

  listSessions(): Promise<SessionListResponse> {
    return req("/api/sessions");
  },

  createSession(body?: SessionInput): Promise<SessionResponse> {
    return req("/api/sessions", json("POST", body));
  },

  getSession(id: string): Promise<SessionResponse> {
    return req(sessionUrl(id));
  },

  updateSession(id: string, patch: SessionInput): Promise<SessionResponse> {
    return req(sessionUrl(id), json("PATCH", patch));
  },

  deleteSession(id: string): Promise<DeletedResponse> {
    return req(sessionUrl(id), { method: "DELETE" });
  },

  renameSpeaker(
    sessionId: string,
    speakerId: string,
    name: string,
    role?: string
  ): Promise<SpeakerResponse> {
    return req(
      sessionUrl(sessionId, `/speakers/${encodeURIComponent(speakerId)}`),
      json("PATCH", { name, role })
    );
  },

  addTurn(sessionId: string, turn: TurnInput, autoMap?: boolean): Promise<AppendTurnsResponse> {
    return req(
      sessionUrl(sessionId, "/turns"),
      json("POST", { turn: { source: "manual", ...turn }, autoMap })
    );
  },

  updateTurnSpeaker(
    sessionId: string,
    turnId: string,
    patch: UpdateTurnRequest
  ): Promise<UpdateTurnResponse> {
    return req(
      sessionUrl(sessionId, `/turns/${encodeURIComponent(turnId)}`),
      json("PATCH", patch)
    );
  },

  transcribeFile(
    sessionId: string,
    file: File,
    options?: { asrModel?: string; diarizationModel?: string; autoMap?: boolean }
  ): Promise<TranscribeFileResponse | CancelledResponse> {
    const form = new FormData();
    form.append("file", file);
    if (options?.asrModel) form.append("asrModel", options.asrModel);
    if (options?.diarizationModel) {
      form.append("diarizationModel", options.diarizationModel);
    }
    if (options?.autoMap !== undefined) {
      form.append("autoMap", String(options.autoMap));
    }
    return req(sessionUrl(sessionId, "/transcribe"), { method: "POST", body: form });
  },

  inspectYouTube(url: string): Promise<YouTubeInspectResponse> {
    return req("/api/youtube/inspect", json("POST", { url }));
  },

  importYouTube(
    sessionId: string,
    params: YouTubeImportRequest
  ): Promise<YouTubeImportResponse | CancelledResponse> {
    return req(sessionUrl(sessionId, "/youtube"), json("POST", params));
  },

  stopTranscription(sessionId: string): Promise<StoppedResponse> {
    return req(sessionUrl(sessionId, "/transcribe/stop"), { method: "POST" });
  },

  transcribeSavedAudio(
    sessionId: string,
    options?: TranscribeSavedAudioRequest
  ): Promise<TranscribeSavedAudioResponse | CancelledResponse> {
    return req(sessionUrl(sessionId, "/audio/transcribe"), json("POST", options));
  },

  trimSessionAudio(sessionId: string, params: TrimAudioRequest): Promise<SessionResponse> {
    return req(sessionUrl(sessionId, "/audio/trim"), json("POST", params));
  },

  applyMapOps(sessionId: string, batch: IBISOpBatch): Promise<ApplyMapOpsResponse> {
    return req(sessionUrl(sessionId, "/map/ops"), json("POST", batch));
  },

  analyzeMap(sessionId: string, remapAll = false): Promise<SessionResponse> {
    return req(sessionUrl(sessionId, "/map/analyze"), json("POST", { remapAll }));
  },

  resetMap(sessionId: string): Promise<SessionResponse> {
    return req(sessionUrl(sessionId, "/map/reset"), { method: "POST" });
  },

  startDemo(sessionId: string, options?: DemoStartRequest): Promise<DemoStartResponse> {
    return req(sessionUrl(sessionId, "/demo/start"), json("POST", options));
  },

  stopDemo(sessionId: string): Promise<StoppedResponse> {
    return req(sessionUrl(sessionId, "/demo/stop"), { method: "POST" });
  },

  getSpeechStatus(): Promise<SpeechEngineStatus> {
    return req("/api/speech/status");
  },

  startSpeechServer(options?: SpeechStartRequest): Promise<SpeechEngineStatus> {
    return req("/api/speech/start", json("POST", options));
  },

  getMapperConfig(): Promise<MapperConfigInfo> {
    return req("/api/mapper/config");
  },

  updateMapperConfig(patch: MapperConfigUpdate): Promise<MapperConfigInfo> {
    return req("/api/mapper/config", json("PATCH", patch));
  },

  listVoices(): Promise<VoiceListResponse> {
    return req("/api/voices");
  },

  deleteVoice(id: string): Promise<VoiceDeletedResponse> {
    return req(`/api/voices/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  subscribeToSession(
    sessionId: string,
    onEvent: (event: SessionSSEEvent) => void,
    onError?: () => void
  ): () => void {
    const es = new EventSource(sessionUrl(sessionId, "/events"));
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as SessionSSEEvent;
        onEvent(parsed);
      } catch {
        // ignore keepalive/malformed
      }
    };
    es.onerror = () => {
      onError?.();
    };
    return () => {
      es.close();
    };
  },
};

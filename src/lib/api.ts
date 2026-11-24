import type {
  DialogueSession,
  IBISOpBatch,
  Speaker,
} from "@shared/ibis";
import type {
  EnrolledVoiceInfo,
  MapperConfigInfo,
  SessionSSEEvent,
  SpeechEngineStatus,
} from "@shared/events";

export interface SessionSummary {
  id: string;
  title: string;
  rootFocus?: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  turnCount: number;
  speakerCount: number;
}

export interface YouTubeMetadata {
  id: string;
  title: string;
  channel: string;
  durationSec: number;
  webpageUrl: string;
}

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
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string") msg = body.error;
      else if (body.error) msg = JSON.stringify(body.error);
    } catch {
      msg = await res.text();
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  authLogin(apiKey: string): Promise<{ ok: boolean }> {
    return req("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
  },

  listSessions(): Promise<{ sessions: SessionSummary[] }> {
    return req("/api/sessions");
  },

  createSession(body?: {
    title?: string;
    rootFocus?: string;
    autoMap?: boolean;
  }): Promise<{ session: DialogueSession }> {
    return req("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  },

  getSession(id: string): Promise<{ session: DialogueSession }> {
    return req(`/api/sessions/${encodeURIComponent(id)}`);
  },

  updateSession(
    id: string,
    patch: Partial<{
      title: string;
      rootFocus: string;
      autoMap: boolean;
      speechConfig: Partial<DialogueSession["speechConfig"]>;
    }>
  ): Promise<{ session: DialogueSession }> {
    return req(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  deleteSession(id: string): Promise<{ deleted: boolean }> {
    return req(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  renameSpeaker(
    sessionId: string,
    speakerId: string,
    name: string,
    role?: string
  ): Promise<{ speaker: Speaker }> {
    return req(
      `/api/sessions/${encodeURIComponent(sessionId)}/speakers/${encodeURIComponent(speakerId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, role }),
      }
    );
  },

  addTurn(
    sessionId: string,
    turn: {
      speakerChannel?: number;
      speakerId?: string;
      speakerName?: string;
      text: string;
      source?: "manual" | "agent" | "live" | "file" | "demo";
    },
    autoMap?: boolean
  ): Promise<{ session: DialogueSession }> {
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turn: { source: "manual", ...turn }, autoMap }),
    });
  },

  updateTurnSpeaker(
    sessionId: string,
    turnId: string,
    patch: {
      speakerId?: string;
      speakerChannel?: number;
      speakerName?: string;
      speakerRole?: string;
    }
  ): Promise<{ turn: DialogueSession["turns"][number]; speaker: Speaker }> {
    return req(
      `/api/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
  },

  transcribeFile(
    sessionId: string,
    file: File,
    options?: { asrModel?: string; diarizationModel?: string; autoMap?: boolean }
  ): Promise<{
    asrModel: string;
    diarizationModel: string;
    duration: number;
    turnsAdded: number;
    session: DialogueSession;
  }> {
    const form = new FormData();
    form.append("file", file);
    if (options?.asrModel) form.append("asrModel", options.asrModel);
    if (options?.diarizationModel) {
      form.append("diarizationModel", options.diarizationModel);
    }
    if (options?.autoMap !== undefined) {
      form.append("autoMap", String(options.autoMap));
    }
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/transcribe`, {
      method: "POST",
      body: form,
    });
  },

  inspectYouTube(url: string): Promise<{ metadata: YouTubeMetadata }> {
    return req("/api/youtube/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
  },

  importYouTube(
    sessionId: string,
    params: {
      url: string;
      startSec?: number;
      durationSec?: number;
      asrModel?: string;
      diarizationModel?: string;
      autoMap?: boolean;
      clearExisting?: boolean;
    }
  ): Promise<{
    metadata: YouTubeMetadata;
    asrModel: string;
    diarizationModel: string;
    duration: number;
    turnsAdded: number;
    session: DialogueSession;
  }> {
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/youtube`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  },

  stopTranscription(sessionId: string): Promise<{ stopped: boolean }> {
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/transcribe/stop`, {
      method: "POST",
    });
  },

  transcribeSavedAudio(
    sessionId: string,
    options?: {
      startSec?: number;
      asrModel?: string;
      diarizationModel?: string;
      autoMap?: boolean;
      clearExisting?: boolean;
    }
  ): Promise<{ turnsAdded: number; cancelled: boolean; session: DialogueSession }> {
    return req(
      `/api/sessions/${encodeURIComponent(sessionId)}/audio/transcribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options || {}),
      }
    );
  },

  trimSessionAudio(
    sessionId: string,
    params: {
      startSec: number;
      endSec?: number;
      clearTranscriptAndMap?: boolean;
    }
  ): Promise<{ session: DialogueSession }> {
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/audio/trim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  },

  applyMapOps(
    sessionId: string,
    batch: IBISOpBatch
  ): Promise<{ session: DialogueSession; affectedNodeIds: string[] }> {
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/map/ops`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
  },

  analyzeMap(
    sessionId: string,
    remapAll = false
  ): Promise<{ session: DialogueSession }> {
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/map/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ remapAll }),
    });
  },

  resetMap(sessionId: string): Promise<{ session: DialogueSession }> {
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/map/reset`, {
      method: "POST",
    });
  },

  startDemo(
    sessionId: string,
    options?: { instant?: boolean; intervalMs?: number }
  ): Promise<{ started: boolean; beats: number }> {
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/demo/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options || {}),
    });
  },

  stopDemo(sessionId: string): Promise<{ stopped: boolean }> {
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/demo/stop`, {
      method: "POST",
    });
  },

  getSpeechStatus(): Promise<SpeechEngineStatus> {
    return req("/api/speech/status");
  },

  startSpeechServer(options?: {
    asrModel?: string;
    diarModel?: string;
  }): Promise<SpeechEngineStatus> {
    return req("/api/speech/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options || {}),
    });
  },

  getMapperConfig(): Promise<MapperConfigInfo> {
    return req("/api/mapper/config");
  },

  updateMapperConfig(patch: {
    mode?: MapperConfigInfo["mode"];
    provider?: MapperConfigInfo["provider"];
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  }): Promise<MapperConfigInfo> {
    return req("/api/mapper/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  listVoices(): Promise<{ voices: EnrolledVoiceInfo[] }> {
    return req("/api/voices");
  },

  deleteVoice(id: string): Promise<{ deleted: boolean; voices: EnrolledVoiceInfo[] }> {
    return req(`/api/voices/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  subscribeToSession(
    sessionId: string,
    onEvent: (event: SessionSSEEvent) => void,
    onError?: () => void
  ): () => void {
    const es = new EventSource(
      `/api/sessions/${encodeURIComponent(sessionId)}/events`
    );
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

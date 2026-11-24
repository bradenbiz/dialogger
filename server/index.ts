import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import multer from "multer";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import { IBISOpBatchSchema, type WordTiming } from "../shared/ibis";
import {
  WICKED_PROBLEM_DEMO_BEATS,
  WICKED_PROBLEM_DEMO_TITLE,
} from "../shared/demo-conversation";
import {
  createDiarizationWindowContext,
  sessionStore,
  type DiarizationWindowContext,
} from "./store";
import {
  alignWordsToDiarization,
  speechEngine,
  wordsToDiarizedTurns,
} from "./speech";
import { dialogueMapper } from "./mapper";
import { CONKLIN_DIALOGUE_MAPPING_SYSTEM_PROMPT } from "./prompt";
import {
  downloadYouTubeAudio,
  encodePlayableMp3,
  fetchYouTubeMetadata,
  hasYtDlp,
} from "./youtube";
import { voiceBank } from "./voicebank";

const HOST = process.env.DIALOGGER_HOST || "127.0.0.1";
const PORT = Number(process.env.DIALOGGER_PORT || 4310);
const API_KEY = (process.env.DIALOGGER_API_KEY || "").trim();
const OWNER_KEY = (process.env.DIALOGGER_OWNER_KEY || "").trim();
const ALLOW_UNAUTHENTICATED =
  process.env.DIALOGGER_ALLOW_UNAUTHENTICATED === "true";

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost"
  );
}

function isLoopbackRemote(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function computeSessionCookieToken(secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update("dialogger-session-v1")
    .digest("hex");
}

function parseCookieValue(
  cookieHeader: string | undefined,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function matchesSecret(
  headers: http.IncomingHttpHeaders,
  queryApiKey: string | null | undefined,
  expectedSecret: string
): boolean {
  if (!expectedSecret) return false;
  const authHeader = headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    if (timingSafeEqualStr(authHeader.slice(7).trim(), expectedSecret)) {
      return true;
    }
  }
  const cookieToken = parseCookieValue(headers.cookie, "dialogger_session");
  if (
    cookieToken &&
    timingSafeEqualStr(cookieToken, computeSessionCookieToken(expectedSecret))
  ) {
    return true;
  }
  if (queryApiKey && timingSafeEqualStr(queryApiKey.trim(), expectedSecret)) {
    return true;
  }
  return false;
}

const app = express();
app.use(express.json({ limit: "16mb" }));

function isAuthorizedRequest(
  headers: http.IncomingHttpHeaders,
  queryApiKey: string | null | undefined
): boolean {
  if (!API_KEY && !OWNER_KEY) return true;
  if (API_KEY && matchesSecret(headers, queryApiKey, API_KEY)) return true;
  if (OWNER_KEY && matchesSecret(headers, queryApiKey, OWNER_KEY)) return true;
  return false;
}

function isOwnerRequest(req: express.Request): boolean {
  if (OWNER_KEY) {
    const ownerHeader = req.headers["x-dialogger-owner-key"];
    if (
      typeof ownerHeader === "string" &&
      timingSafeEqualStr(ownerHeader.trim(), OWNER_KEY)
    ) {
      return true;
    }
    return matchesSecret(req.headers, undefined, OWNER_KEY);
  }
  if (API_KEY) {
    return isAuthorizedRequest(req.headers, undefined);
  }
  return isLoopbackRemote(req.socket.remoteAddress) || ALLOW_UNAUTHENTICATED;
}

app.use("/api", (req, res, next) => {
  if (
    req.path === "/health" ||
    req.path === "/auth/login" ||
    req.path === "/auth/logout"
  ) {
    next();
    return;
  }
  const queryKey =
    typeof req.query.api_key === "string" ? req.query.api_key : undefined;
  if (!isAuthorizedRequest(req.headers, queryKey)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

const upload = multer({
  dest: path.join(os.tmpdir(), "dialogger-uploads"),
  limits: { fileSize: 512 * 1024 * 1024 },
});

// Unified per-session serialized mapping queue + active transcription/live job ownership
const mapQueues = new Map<string, Promise<void>>();
const activeTranscribeJobs = new Map<string, AbortController>();
const activeLiveJobs = new Map<string, Set<AbortController>>();

function isCurrentJob(sessionId: string, ctrl: AbortController): boolean {
  return activeTranscribeJobs.get(sessionId) === ctrl && !ctrl.signal.aborted;
}

function registerLiveController(
  sessionId: string,
  ctrl: AbortController
): () => void {
  let set = activeLiveJobs.get(sessionId);
  if (!set) {
    set = new Set();
    activeLiveJobs.set(sessionId, set);
  }
  set.add(ctrl);
  return () => {
    set?.delete(ctrl);
    if (set && set.size === 0 && activeLiveJobs.get(sessionId) === set) {
      activeLiveJobs.delete(sessionId);
    }
  };
}

function cancelLiveWork(sessionId: string): void {
  const set = activeLiveJobs.get(sessionId);
  if (!set) return;
  for (const ctrl of set) {
    ctrl.abort();
  }
  activeLiveJobs.delete(sessionId);
}

function cancelActiveTranscribe(sessionId: string): boolean {
  cancelLiveWork(sessionId);
  const ctrl = activeTranscribeJobs.get(sessionId);
  if (!ctrl) return false;
  activeTranscribeJobs.delete(sessionId);
  ctrl.abort();
  sessionStore.broadcast(sessionId, { type: "speech.status", state: "idle" });
  sessionStore.broadcast(sessionId, {
    type: "transcript.partial",
    text: "",
    timestamp: new Date().toISOString(),
  });
  return true;
}

function enqueueMapRun(
  sessionId: string,
  options?: { force?: boolean; turnIds?: string[] }
): Promise<void> {
  const prev = mapQueues.get(sessionId) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const session = sessionStore.getSession(sessionId);
      if (!session) return;
      if (!options?.force && !session.autoMap) return;

      const startGen = sessionStore.getGeneration(sessionId);
      const idFilter = options?.turnIds ? new Set(options.turnIds) : null;
      const unmapped = session.turns.filter(
        (t) => !t.mapped && (!idFilter || idFilter.has(t.id))
      );
      if (unmapped.length === 0) return;

      sessionStore.broadcast(sessionId, {
        type: "mapper.status",
        status: "analyzing",
        message: `Mapping ${unmapped.length} new turn${unmapped.length === 1 ? "" : "s"}…`,
      });

      try {
        const batch = await dialogueMapper.analyzeTurns(session, unmapped);
        // Discard stale results if session was trimmed, reset, replaced, or deleted mid-inference
        if (
          !sessionStore.getSession(sessionId) ||
          sessionStore.getGeneration(sessionId) !== startGen
        ) {
          sessionStore.broadcast(sessionId, {
            type: "mapper.status",
            status: "idle",
          });
          return;
        }
        if (batch.ops.length > 0 || (batch.markTurnIdsMapped?.length ?? 0) > 0) {
          sessionStore.applyMapOps(sessionId, batch);
        }
        sessionStore.broadcast(sessionId, {
          type: "mapper.status",
          status: "idle",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[autoMap] error:", msg);
        sessionStore.broadcast(sessionId, {
          type: "mapper.status",
          status: "error",
          message: msg,
        });
      }
    });

  mapQueues.set(sessionId, next);
  return next.finally(() => {
    if (mapQueues.get(sessionId) === next) {
      mapQueues.delete(sessionId);
    }
  });
}

async function runAutoMap(sessionId: string): Promise<void> {
  await enqueueMapRun(sessionId, { force: false });
}

// --- Health, Auth & Engine Status ---

app.get("/api/health", (req, res) => {
  const queryKey =
    typeof req.query.api_key === "string" ? req.query.api_key : undefined;
  const authRequired = Boolean(API_KEY || OWNER_KEY);
  const authenticated = isAuthorizedRequest(req.headers, queryKey);
  res.json({
    ok: true,
    service: "dialogger",
    authRequired,
    authenticated,
    sessions: authenticated ? sessionStore.listSessions().length : undefined,
  });
});

app.post("/api/auth/login", (req, res) => {
  if (!API_KEY && !OWNER_KEY) {
    res.json({ ok: true, authRequired: false });
    return;
  }
  const token =
    typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  let matchedSecret = "";
  if (OWNER_KEY && timingSafeEqualStr(token, OWNER_KEY)) {
    matchedSecret = OWNER_KEY;
  } else if (API_KEY && timingSafeEqualStr(token, API_KEY)) {
    matchedSecret = API_KEY;
  }
  if (!matchedSecret) {
    res.status(401).json({ error: "Invalid access token" });
    return;
  }
  const secure =
    req.secure || req.headers["x-forwarded-proto"] === "https"
      ? "; Secure"
      : "";
  res.setHeader(
    "Set-Cookie",
    `dialogger_session=${computeSessionCookieToken(matchedSecret)}; HttpOnly; SameSite=Lax; Path=/${secure}`
  );
  res.json({ ok: true });
});

app.post("/api/auth/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    "dialogger_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
  );
  res.json({ ok: true });
});

app.get("/api/speech/status", async (_req, res) => {
  try {
    const status = await speechEngine.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/speech/start", async (req, res) => {
  try {
    const asrModel =
      typeof req.body?.asrModel === "string" ? req.body.asrModel : undefined;
    const diarModel =
      typeof req.body?.diarModel === "string" ? req.body.diarModel : undefined;
    await speechEngine.ensureStreamingServer({ asrModel, diarModel });
    const status = await speechEngine.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/mapper/config", (_req, res) => {
  res.json(dialogueMapper.getPublicConfig());
});

app.patch("/api/mapper/config", (req, res) => {
  if (!isOwnerRequest(req)) {
    res.status(403).json({ error: "Owner authentication required to modify mapper settings" });
    return;
  }
  const schema = z.object({
    mode: z.enum(["llm", "heuristic", "agent-only"]).optional(),
    provider: z
      .enum(["claude-cli", "codex-cli", "openai-compatible", "anthropic", "heuristic"])
      .optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    apiKey: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(dialogueMapper.updateConfig(parsed.data));
});

app.get("/api/voices", (_req, res) => {
  res.json({ voices: voiceBank.listVoices() });
});

app.delete("/api/voices/:id", (req, res) => {
  const deleted = voiceBank.deleteVoice(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Voice not found" });
    return;
  }
  res.json({ deleted: true, voices: voiceBank.listVoices() });
});

app.get("/api/prompt/conklin", (_req, res) => {
  res.json({
    methodology: "Jeffrey Conklin's Dialogue Mapping (IBIS)",
    systemPrompt: CONKLIN_DIALOGUE_MAPPING_SYSTEM_PROMPT,
    endpoints: {
      createSession: "POST /api/sessions",
      getSession: "GET /api/sessions/:id",
      liveEventsSSE: "GET /api/sessions/:id/events",
      transcribeFile: "POST /api/sessions/:id/transcribe",
      appendTurns: "POST /api/sessions/:id/turns",
      applyMapOps: "POST /api/sessions/:id/map/ops",
      analyzeTurns: "POST /api/sessions/:id/map/analyze",
    },
  });
});

// --- Sessions CRUD ---

app.get("/api/sessions", (_req, res) => {
  res.json({ sessions: sessionStore.listSessions() });
});

app.post("/api/sessions", (req, res) => {
  const schema = z.object({
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
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const session = sessionStore.createSession(parsed.data);
  res.status(201).json({ session });
});

app.get("/api/sessions/:id", (req, res) => {
  const session = sessionStore.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ session });
});

app.patch("/api/sessions/:id", (req, res) => {
  const schema = z.object({
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
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const updated = sessionStore.updateSessionMeta(req.params.id, parsed.data);
  if (!updated) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ session: updated });
});

app.delete("/api/sessions/:id", (req, res) => {
  cancelActiveTranscribe(req.params.id);
  const ok = sessionStore.deleteSession(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ deleted: true });
});

// --- SSE Live Stream ---

app.get("/api/sessions/:id/events", (req, res) => {
  const session = sessionStore.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: "session.snapshot", session });

  const unsubscribe = sessionStore.subscribe(session.id, (evt) => send(evt));
  const keepAlive = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 15_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

// --- Speakers ---

app.patch("/api/sessions/:id/speakers/:speakerId", async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(64),
    role: z.string().max(64).optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const speaker = sessionStore.renameSpeaker(
    req.params.id,
    req.params.speakerId,
    parsed.data.name,
    parsed.data.role
  );
  if (!speaker) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Auto-enroll speaker voice seed from their cleanest turn if session has audio!
  const session = sessionStore.getSession(req.params.id);
  const audioPath = sessionStore.getAudioFilePath(req.params.id);
  if (session && audioPath) {
    const spkTurns = session.turns
      .filter((t) => t.speakerId === speaker.id && !t.overlap && t.endSec - t.startSec >= 1.5)
      .sort((a, b) => b.endSec - b.startSec - (a.endSec - a.startSec));
    const best = spkTurns[0];
    if (best) {
      const enrolled = await voiceBank.enrollFromAudioSnippet({
        name: speaker.name,
        audioPath,
        startSec: best.startSec,
        endSec: best.endSec,
      });
      if (enrolled) {
        sessionStore.markSpeakerVoiceEnrolled(session.id, speaker.id, true);
      }
    }
  }

  res.json({ speaker: session?.speakers.find((s) => s.id === speaker.id) || speaker });
});

// --- Transcript Turns (Human / Agent / Model push) ---

app.post("/api/sessions/:id/turns", async (req, res) => {
  const session = sessionStore.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const turnSchema = z.object({
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
    source: z.enum(["live", "file", "agent", "manual", "demo"]).default("agent"),
  });

  const bodySchema = z.object({
    turns: z.array(turnSchema).optional(),
    turn: turnSchema.optional(),
    autoMap: z.boolean().optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const list = parsed.data.turns || (parsed.data.turn ? [parsed.data.turn] : []);
  if (list.length === 0) {
    res.status(400).json({ error: "Provide 'turn' or 'turns' array" });
    return;
  }

  const added = sessionStore.appendTurns(session.id, list);
  const shouldMap = parsed.data.autoMap ?? session.autoMap;
  if (shouldMap) {
    await runAutoMap(session.id);
  }

  res.status(201).json({
    added,
    session: sessionStore.getSession(session.id),
  });
});

app.patch("/api/sessions/:id/turns/:turnId", async (req, res) => {
  const schema = z.object({
    speakerId: z.string().min(1).optional(),
    speakerChannel: z.number().int().min(1).max(16).optional(),
    speakerName: z.string().min(1).max(64).optional(),
    speakerRole: z.string().max(64).optional(),
    text: z.string().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const updated = sessionStore.updateTurn(
    req.params.id,
    req.params.turnId,
    parsed.data
  );
  if (!updated) {
    res.status(404).json({ error: "Session or turn not found" });
    return;
  }

  // Enroll this exact snippet into the persistent Nemotron 3 Voicebank so future
  // windows and future recordings recognize this person automatically!
  let voiceEnrolled = false;
  const audioPath = sessionStore.getAudioFilePath(req.params.id);
  if (audioPath && updated.turn.endSec - updated.turn.startSec >= 1.2) {
    const enrolled = await voiceBank.enrollFromAudioSnippet({
      name: updated.speaker.name,
      audioPath,
      startSec: updated.turn.startSec,
      endSec: updated.turn.endSec,
    });
    if (enrolled) {
      voiceEnrolled = true;
      sessionStore.markSpeakerVoiceEnrolled(
        req.params.id,
        updated.speaker.id,
        true
      );
    }
  }

  res.json({
    ...updated,
    voiceEnrolled,
    session: sessionStore.getSession(req.params.id),
  });
});

// --- Local NVIDIA File Transcription + Diarization ---

app.post(
  "/api/sessions/:id/transcribe",
  upload.single("file"),
  async (req, res) => {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const session = sessionStore.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const uploadedFile = req.file;
    if (!uploadedFile?.path || !fs.existsSync(uploadedFile.path)) {
      res.status(400).json({
        error: "Upload an audio file as multipart form field 'file'",
      });
      return;
    }

    cancelActiveTranscribe(session.id);
    const abortController = new AbortController();
    activeTranscribeJobs.set(session.id, abortController);

    const asrModel =
      (typeof req.body?.asrModel === "string" && req.body.asrModel) ||
      session.speechConfig.offlineAsrModel ||
      "parakeet-tdt";
    const diarizationModel =
      (typeof req.body?.diarizationModel === "string" &&
        req.body.diarizationModel) ||
      session.speechConfig.diarizationModel ||
      "nemotron-3-diarization";
    const autoMap =
      req.body?.autoMap === undefined
        ? session.autoMap
        : req.body.autoMap === true || req.body.autoMap === "true";

    sessionStore.broadcast(session.id, {
      type: "speech.status",
      state: "transcribing",
      message: `Transcribing with ${asrModel} + diarizing with ${diarizationModel}…`,
    });

    const stagingMp3 = path.join(
      sessionStore.getAudioDir(),
      `${session.id}.staging-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`
    );

    try {
      const seeds = voiceBank.getSeeds(session.speakers.map((s) => s.name));
      const result = await speechEngine.transcribeAndDiarizeFile(
        uploadedFile.path,
        {
          asrModel,
          diarizationModel,
          seeds,
          signal: abortController.signal,
        }
      );

      if (!isCurrentJob(session.id, abortController)) {
        res.json({ cancelled: true });
        return;
      }

      // Encode seekable MP3 to a unique staging path BEFORE modifying session state or existing audio (R3 S1).
      // Propagate failures so we never clear/replace transcript while leaving old audio behind.
      const audioFilename = `${session.id}.mp3`;
      const audioOut = path.join(sessionStore.getAudioDir(), audioFilename);
      const playableDur = await encodePlayableMp3(
        uploadedFile.path,
        stagingMp3,
        abortController.signal
      );

      if (!isCurrentJob(session.id, abortController)) {
        res.json({ cancelled: true });
        return;
      }

      if (!fs.existsSync(stagingMp3)) {
        throw new Error("Failed to stage playable MP3 audio");
      }

      // Rename staged audio FIRST; only after rename succeeds reset and publish new session state (R3 S1)
      fs.renameSync(stagingMp3, audioOut);
      if (session.turns.length > 0 || session.audio) {
        sessionStore.clearForFreshRun(session.id, true);
      }
      sessionStore.setSessionAudio(session.id, {
        filename: audioFilename,
        mimeType: "audio/mpeg",
        durationSec: playableDur || result.duration,
        sourceTitle: uploadedFile.originalname || "Uploaded Audio",
      });

      const uploadWindowCtx = createDiarizationWindowContext(result.slotNames);
      const added = sessionStore.appendTurns(
        session.id,
        result.turns.map((t) => ({
          speakerChannel: t.speakerChannel,
          speakerName: t.speakerName,
          text: t.text,
          startSec: t.startSec,
          endSec: t.endSec,
          overlap: t.overlap,
          overlapWith: t.overlapWithChannels.map((c) => `speaker_${c}`),
          words: t.words,
          source: "file" as const,
        })),
        uploadWindowCtx
      );
      result.turns.forEach((t, idx) => {
        if (t.speakerName && added[idx]) {
          sessionStore.markSpeakerVoiceEnrolled(
            session.id,
            added[idx].speakerId,
            true
          );
        }
      });

      if (isCurrentJob(session.id, abortController)) {
        sessionStore.broadcast(session.id, {
          type: "speech.status",
          state: "idle",
        });
      }

      if (autoMap && added.length > 0 && isCurrentJob(session.id, abortController)) {
        const chunkSize = 4;
        for (let i = 0; i < added.length; i += chunkSize) {
          if (!isCurrentJob(session.id, abortController)) break;
          const sliceIds = added.slice(i, i + chunkSize).map((t) => t.id);
          await enqueueMapRun(session.id, { force: true, turnIds: sliceIds });
        }
      }

      res.json({
        asrModel: result.asrModel,
        diarizationModel: result.diarizationModel,
        duration: result.duration,
        text: result.text,
        turnsAdded: added.length,
        turns: added,
        session: sessionStore.getSession(session.id),
      });
    } catch (err) {
      if (abortController.signal.aborted) {
        res.json({ cancelled: true });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (isCurrentJob(session.id, abortController)) {
        sessionStore.broadcast(session.id, {
          type: "speech.status",
          state: "error",
          message: msg,
        });
      }
      res.status(500).json({ error: msg });
    } finally {
      if (activeTranscribeJobs.get(session.id) === abortController) {
        activeTranscribeJobs.delete(session.id);
      }
      try {
        if (fs.existsSync(stagingMp3)) fs.unlinkSync(stagingMp3);
      } catch {
        // ignore
      }
      try {
        fs.unlinkSync(uploadedFile.path);
      } catch {
        // ignore
      }
    }
  }
);

// --- Audio Playback Streaming (HTTP Range) & YouTube Import ---

app.get("/api/sessions/:id/audio", (req, res) => {
  const audioPath = sessionStore.getAudioFilePath(req.params.id);
  if (!audioPath) {
    res.status(404).json({ error: "No audio attached to this session" });
    return;
  }

  const stat = fs.statSync(audioPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match?.[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
    if (start >= fileSize || end >= fileSize || start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    res.setHeader("Content-Length", String(end - start + 1));
    fs.createReadStream(audioPath, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", String(fileSize));
    fs.createReadStream(audioPath).pipe(res);
  }
});

app.post("/api/youtube/inspect", async (req, res) => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url) {
    res.status(400).json({ error: "Missing 'url'" });
    return;
  }
  try {
    if (!(await hasYtDlp())) {
      res.status(501).json({ error: "yt-dlp is not installed on this server." });
      return;
    }
    const metadata = await fetchYouTubeMetadata(url);
    res.json({ metadata });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/transcribe/stop", (req, res) => {
  const stopped = cancelActiveTranscribe(req.params.id);
  res.json({ stopped });
});

app.post("/api/sessions/:id/audio/trim", async (req, res) => {
  const session = sessionStore.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const audioPath = sessionStore.getAudioFilePath(session.id);
  if (!audioPath) {
    res.status(404).json({ error: "No saved audio attached to this session" });
    return;
  }

  const schema = z.object({
    startSec: z.number().nonnegative(),
    endSec: z.number().positive().optional(),
    clearTranscriptAndMap: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { startSec, endSec, clearTranscriptAndMap } = parsed.data;
  if (endSec !== undefined && endSec <= startSec + 1) {
    res.status(400).json({ error: "endSec must be at least 1 second after startSec" });
    return;
  }

  cancelActiveTranscribe(session.id);
  const tmpOut = `${audioPath}.trim-${Date.now()}.mp3`;

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const ffArgs = ["-y", "-ss", String(startSec), "-i", audioPath];
    if (endSec !== undefined) {
      ffArgs.push("-t", String(endSec - startSec));
    }
    ffArgs.push("-vn", "-ac", "1", "-ar", "24000", "-b:a", "96k", tmpOut);

    await promisify(execFile)("ffmpeg", ffArgs, { timeout: 180_000 });
    fs.renameSync(tmpOut, audioPath);

    const { probeDurationSec } = await import("./youtube");
    const newDurationSec = await probeDurationSec(audioPath);

    const updated = sessionStore.applyAudioTrimState(session.id, {
      startSec,
      endSec,
      newDurationSec:
        newDurationSec ||
        Math.max(0, (endSec ?? session.audio?.durationSec ?? 0) - startSec),
      clearTranscriptAndMap: Boolean(clearTranscriptAndMap),
    });

    res.json({ session: updated });
  } catch (err) {
    try {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    } catch {
      // ignore
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/audio/transcribe", async (req, res) => {
  const session = sessionStore.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const audioPath = sessionStore.getAudioFilePath(session.id);
  if (!audioPath) {
    res.status(404).json({ error: "No saved audio attached to this session" });
    return;
  }

  const schema = z.object({
    startSec: z.number().nonnegative().optional(),
    asrModel: z.string().optional(),
    diarizationModel: z.string().optional(),
    autoMap: z.boolean().optional(),
    clearExisting: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  cancelActiveTranscribe(session.id);
  const abortController = new AbortController();
  activeTranscribeJobs.set(session.id, abortController);

  const asrModel =
    parsed.data.asrModel || session.speechConfig.streamingAsrModel || "nemotron-3.5";
  const diarizationModel =
    parsed.data.diarizationModel ||
    session.speechConfig.diarizationModel ||
    "nemotron-3-diarization";
  const autoMap = parsed.data.autoMap ?? session.autoMap;
  const startSec = Math.max(0, parsed.data.startSec || 0);

  let inputForStream = audioPath;
  let cleanupSlice: (() => void) | null = null;
  let stagedResetDone = false;

  try {
    // Verify streaming server & slice audio BEFORE modifying existing session state (S7)
    await speechEngine.ensureStreamingServer({
      asrModel,
      diarModel: diarizationModel,
    });

    if (!isCurrentJob(session.id, abortController)) {
      res.json({ cancelled: true });
      return;
    }

    if (startSec > 0) {
      const slicePath = path.join(
        os.tmpdir(),
        `dialogger-slice-${Date.now()}.wav`
      );
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)(
        "ffmpeg",
        [
          "-y",
          "-ss",
          String(startSec),
          "-i",
          audioPath,
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          slicePath,
        ],
        { timeout: 120_000, signal: abortController.signal }
      );
      inputForStream = slicePath;
      cleanupSlice = () => {
        try {
          fs.unlinkSync(slicePath);
        } catch {
          // ignore
        }
      };
    }

    if (!isCurrentJob(session.id, abortController)) {
      res.json({ cancelled: true });
      return;
    }

    // Now that speech startup & slicing succeeded, apply staged clear or exact playhead truncation (S7)
    if (parsed.data.clearExisting) {
      sessionStore.clearForFreshRun(session.id, true);
      stagedResetDone = true;
    } else if (startSec > 0) {
      sessionStore.truncateTurnsFrom(session.id, startSec);
      stagedResetDone = true;
    }

    sessionStore.broadcast(session.id, {
      type: "speech.status",
      state: "transcribing",
      message: `Live streaming saved audio (${asrModel} + ${diarizationModel})…`,
    });

    let turnsAdded = 0;
    const savedAudioWindowContexts = new Map<number, DiarizationWindowContext>();
    const streamRes = await speechEngine.streamTranscribeAndDiarizeFile(
      inputForStream,
      {
        asrModel,
        diarizationModel,
        signal: abortController.signal,
        getVoiceSeeds: () => {
          const cur = sessionStore.getSession(session.id);
          return voiceBank.getSeeds(
            cur ? cur.speakers.map((s) => s.name) : []
          );
        },
        onStatus: (message) => {
          if (!isCurrentJob(session.id, abortController)) return;
          sessionStore.broadcast(session.id, {
            type: "speech.status",
            state: "transcribing",
            message,
          });
        },
        onPartial: (text) => {
          if (!isCurrentJob(session.id, abortController)) return;
          sessionStore.broadcast(session.id, {
            type: "transcript.partial",
            text,
            timestamp: new Date().toISOString(),
          });
        },
        onProgress: (processedSec, totalSec) => {
          if (!isCurrentJob(session.id, abortController)) return;
          const absNow = startSec + processedSec;
          const absTotal = startSec + totalSec;
          const pct = totalSec > 0 ? Math.min(100, Math.round((processedSec / totalSec) * 100)) : 0;
          sessionStore.broadcast(session.id, {
            type: "speech.status",
            state: "transcribing",
            message: `Live diarizing ${Math.floor(absNow / 60)}:${String(Math.floor(absNow % 60)).padStart(2, "0")} / ${Math.floor(absTotal / 60)}:${String(Math.floor(absTotal % 60)).padStart(2, "0")} (${pct}%)`,
          });
        },
        onTurns: (turns, _sec, windowInfo) => {
          if (!isCurrentJob(session.id, abortController)) return;
          const winKey = windowInfo?.windowIndex ?? 0;
          let winCtx = savedAudioWindowContexts.get(winKey);
          if (!winCtx) {
            winCtx = createDiarizationWindowContext(windowInfo?.slotNames);
            savedAudioWindowContexts.set(winKey, winCtx);
          }
          const added = sessionStore.appendTurns(
            session.id,
            turns.map((t) => ({
              speakerChannel: t.speakerChannel,
              speakerName: t.speakerName,
              text: t.text,
              startSec: Number((t.startSec + startSec).toFixed(2)),
              endSec: Number((t.endSec + startSec).toFixed(2)),
              overlap: t.overlap,
              overlapWith: t.overlapWithChannels.map((c) => `speaker_${c}`),
              words: t.words?.map((w) => ({
                ...w,
                start: Number((w.start + startSec).toFixed(2)),
                end: Number((w.end + startSec).toFixed(2)),
              })),
              source: "file" as const,
            })),
            winCtx
          );
          turns.forEach((t, idx) => {
            if (t.speakerName && added[idx]) {
              sessionStore.markSpeakerVoiceEnrolled(
                session.id,
                added[idx].speakerId,
                true
              );
            }
          });
          turnsAdded += added.length;
          if (autoMap && added.length > 0) {
            void runAutoMap(session.id);
          }
        },
      }
    );

    if (isCurrentJob(session.id, abortController)) {
      sessionStore.broadcast(session.id, { type: "speech.status", state: "idle" });
      sessionStore.broadcast(session.id, {
        type: "transcript.partial",
        text: "",
        timestamp: new Date().toISOString(),
      });
    }

    if (autoMap && !streamRes.cancelled && isCurrentJob(session.id, abortController)) {
      await runAutoMap(session.id);
    }

    res.json({
      asrModel,
      diarizationModel,
      turnsAdded,
      stagedResetDone,
      cancelled: streamRes.cancelled,
      session: sessionStore.getSession(session.id),
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      res.json({ cancelled: true });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (isCurrentJob(session.id, abortController)) {
      sessionStore.broadcast(session.id, {
        type: "speech.status",
        state: "error",
        message: msg,
      });
    }
    res.status(500).json({ error: msg });
  } finally {
    if (activeTranscribeJobs.get(session.id) === abortController) {
      activeTranscribeJobs.delete(session.id);
    }
    cleanupSlice?.();
  }
});

app.post("/api/sessions/:id/youtube", async (req, res) => {
  const session = sessionStore.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const schema = z.object({
    url: z.string().min(1),
    startSec: z.number().nonnegative().optional(),
    durationSec: z.number().nonnegative().optional(),
    asrModel: z.string().optional(),
    diarizationModel: z.string().optional(),
    autoMap: z.boolean().optional(),
    clearExisting: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (!(await hasYtDlp())) {
    res.status(501).json({ error: "yt-dlp is not installed on this server." });
    return;
  }

  // Cancel any prior transcription on this session
  cancelActiveTranscribe(session.id);
  const abortController = new AbortController();
  activeTranscribeJobs.set(session.id, abortController);

  const { url, startSec, durationSec } = parsed.data;
  const asrModel =
    parsed.data.asrModel || session.speechConfig.streamingAsrModel || "nemotron-3.5";
  const diarizationModel =
    parsed.data.diarizationModel ||
    session.speechConfig.diarizationModel ||
    "nemotron-3-diarization";
  const autoMap = parsed.data.autoMap ?? session.autoMap;
  const isStreamingModel =
    asrModel === "nemotron-3.5" || asrModel === "nemotron-en";

  sessionStore.broadcast(session.id, {
    type: "speech.status",
    state: "transcribing",
    message: "Downloading public YouTube audio via yt-dlp…",
  });

  let downloaded: Awaited<ReturnType<typeof downloadYouTubeAudio>> | null = null;
  const stagingMp3 = path.join(
    sessionStore.getAudioDir(),
    `${session.id}.staging-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`
  );
  try {
    downloaded = await downloadYouTubeAudio(url, {
      startSec,
      durationSec,
      signal: abortController.signal,
    });
    if (!isCurrentJob(session.id, abortController)) {
      res.json({ cancelled: true });
      return;
    }

    // Encode seekable browser MP3 to a unique staging file BEFORE touching existing audio or session state (S3)
    const audioFilename = `${session.id}.mp3`;
    const audioOut = path.join(sessionStore.getAudioDir(), audioFilename);
    const playableDur = await encodePlayableMp3(
      downloaded.rawPath,
      stagingMp3,
      abortController.signal
    );

    if (!isCurrentJob(session.id, abortController)) {
      res.json({ cancelled: true });
      return;
    }

    // Atomically swap staged audio & replace any previous transcript/map together (S3)
    fs.renameSync(stagingMp3, audioOut);
    if (parsed.data.clearExisting || session.turns.length > 0 || session.audio) {
      sessionStore.clearForFreshRun(session.id, true);
    }

    if (
      !session.title ||
      session.title === "New Dialogue Map" ||
      session.title === "Untitled Dialogue Map" ||
      session.title === "YouTube Dialogue Map" ||
      parsed.data.clearExisting
    ) {
      sessionStore.updateSessionMeta(session.id, {
        title: downloaded.metadata.title.slice(0, 140),
      });
    }

    sessionStore.setSessionAudio(session.id, {
      filename: audioFilename,
      mimeType: "audio/mpeg",
      durationSec: playableDur || downloaded.durationSec,
      sourceUrl: downloaded.metadata.webpageUrl,
      sourceTitle: downloaded.metadata.title,
      clipStartSec: downloaded.clipStartSec,
    });

    let turnsAdded = 0;

    if (isStreamingModel) {
      sessionStore.broadcast(session.id, {
        type: "speech.status",
        state: "transcribing",
        message: `Live streaming "${downloaded.metadata.title.slice(0, 34)}" (${asrModel} + ${diarizationModel})…`,
      });

      const ytWindowContexts = new Map<number, DiarizationWindowContext>();
      const streamRes = await speechEngine.streamTranscribeAndDiarizeFile(
        downloaded.rawPath,
        {
          asrModel,
          diarizationModel,
          signal: abortController.signal,
          getVoiceSeeds: () => {
            const cur = sessionStore.getSession(session.id);
            return voiceBank.getSeeds(
              cur ? cur.speakers.map((s) => s.name) : []
            );
          },
          onStatus: (message) => {
            if (!isCurrentJob(session.id, abortController)) return;
            sessionStore.broadcast(session.id, {
              type: "speech.status",
              state: "transcribing",
              message,
            });
          },
          onPartial: (text) => {
            if (!isCurrentJob(session.id, abortController)) return;
            sessionStore.broadcast(session.id, {
              type: "transcript.partial",
              text,
              timestamp: new Date().toISOString(),
            });
          },
          onProgress: (processedSec, totalSec) => {
            if (!isCurrentJob(session.id, abortController)) return;
            const pct = totalSec > 0 ? Math.min(100, Math.round((processedSec / totalSec) * 100)) : 0;
            sessionStore.broadcast(session.id, {
              type: "speech.status",
              state: "transcribing",
              message: `Live diarizing ${Math.floor(processedSec / 60)}:${String(Math.floor(processedSec % 60)).padStart(2, "0")} / ${Math.floor(totalSec / 60)}:${String(Math.floor(totalSec % 60)).padStart(2, "0")} (${pct}%)`,
            });
          },
          onTurns: (turns, _sec, windowInfo) => {
            if (!isCurrentJob(session.id, abortController)) return;
            const winKey = windowInfo?.windowIndex ?? 0;
            let winCtx = ytWindowContexts.get(winKey);
            if (!winCtx) {
              winCtx = createDiarizationWindowContext(windowInfo?.slotNames);
              ytWindowContexts.set(winKey, winCtx);
            }
            const added = sessionStore.appendTurns(
              session.id,
              turns.map((t) => ({
                speakerChannel: t.speakerChannel,
                speakerName: t.speakerName,
                text: t.text,
                startSec: t.startSec,
                endSec: t.endSec,
                overlap: t.overlap,
                overlapWith: t.overlapWithChannels.map((c) => `speaker_${c}`),
                words: t.words,
                source: "file" as const,
              })),
              winCtx
            );
            turns.forEach((t, idx) => {
              if (t.speakerName && added[idx]) {
                sessionStore.markSpeakerVoiceEnrolled(
                  session.id,
                  added[idx].speakerId,
                  true
                );
              }
            });
            turnsAdded += added.length;
            if (autoMap && added.length > 0) {
              void runAutoMap(session.id);
            }
          },
        }
      );

      if (isCurrentJob(session.id, abortController)) {
        sessionStore.broadcast(session.id, { type: "speech.status", state: "idle" });
        sessionStore.broadcast(session.id, {
          type: "transcript.partial",
          text: "",
          timestamp: new Date().toISOString(),
        });
      }

      if (autoMap && !streamRes.cancelled && isCurrentJob(session.id, abortController)) {
        await runAutoMap(session.id);
      }

      res.json({
        metadata: downloaded.metadata,
        asrModel,
        diarizationModel,
        duration: playableDur || streamRes.durationSec,
        turnsAdded,
        cancelled: streamRes.cancelled,
        session: sessionStore.getSession(session.id),
      });
      return;
    }

    // Offline Parakeet TDT batch path (with full abort propagation + enrolled voice seeds!)
    sessionStore.broadcast(session.id, {
      type: "speech.status",
      state: "transcribing",
      message: `Batch transcribing "${downloaded.metadata.title.slice(0, 36)}" (${asrModel} + ${diarizationModel})…`,
    });

    const seeds = voiceBank.getSeeds(session.speakers.map((s) => s.name));
    const result = await speechEngine.transcribeAndDiarizeFile(
      downloaded.rawPath,
      {
        asrModel,
        diarizationModel,
        seeds,
        signal: abortController.signal,
      }
    );

    if (!isCurrentJob(session.id, abortController)) {
      res.json({ cancelled: true });
      return;
    }

    const ytBatchWindowCtx = createDiarizationWindowContext(result.slotNames);
    const added = sessionStore.appendTurns(
      session.id,
      result.turns.map((t) => ({
        speakerChannel: t.speakerChannel,
        speakerName: t.speakerName,
        text: t.text,
        startSec: t.startSec,
        endSec: t.endSec,
        overlap: t.overlap,
        overlapWith: t.overlapWithChannels.map((c) => `speaker_${c}`),
        words: t.words,
        source: "file" as const,
      })),
      ytBatchWindowCtx
    );
    result.turns.forEach((t, idx) => {
      if (t.speakerName && added[idx]) {
        sessionStore.markSpeakerVoiceEnrolled(
          session.id,
          added[idx].speakerId,
          true
        );
      }
    });
    turnsAdded = added.length;

    if (isCurrentJob(session.id, abortController)) {
      sessionStore.broadcast(session.id, { type: "speech.status", state: "idle" });
    }

    if (autoMap && added.length > 0 && isCurrentJob(session.id, abortController)) {
      const chunkSize = 4;
      for (let i = 0; i < added.length; i += chunkSize) {
        if (!isCurrentJob(session.id, abortController)) break;
        const sliceIds = added.slice(i, i + chunkSize).map((t) => t.id);
        await enqueueMapRun(session.id, { force: true, turnIds: sliceIds });
      }
    }

    res.json({
      metadata: downloaded.metadata,
      asrModel: result.asrModel,
      diarizationModel: result.diarizationModel,
      duration: playableDur || result.duration,
      turnsAdded,
      session: sessionStore.getSession(session.id),
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      res.json({ cancelled: true });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (isCurrentJob(session.id, abortController)) {
      sessionStore.broadcast(session.id, {
        type: "speech.status",
        state: "error",
        message: msg,
      });
    }
    res.status(500).json({ error: msg });
  } finally {
    if (activeTranscribeJobs.get(session.id) === abortController) {
      activeTranscribeJobs.delete(session.id);
    }
    try {
      if (fs.existsSync(stagingMp3)) fs.unlinkSync(stagingMp3);
    } catch {
      // ignore
    }
    downloaded?.cleanup();
  }
});

// --- IBIS Dialogue Map Operations (Direct Agent / Model / Human mutations) ---

app.post("/api/sessions/:id/map/ops", (req, res) => {
  const session = sessionStore.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const parsed = IBISOpBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const result = sessionStore.applyMapOps(session.id, parsed.data);
  res.json(result);
});

app.post("/api/sessions/:id/map/analyze", async (req, res) => {
  const session = sessionStore.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const remapAll = Boolean(req.body?.remapAll);
  if (remapAll) {
    sessionStore.resetMap(session.id);
  }

  await enqueueMapRun(session.id, { force: true });
  res.json({ session: sessionStore.getSession(session.id) });
});

app.post("/api/sessions/:id/map/reset", (req, res) => {
  const session = sessionStore.resetMap(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ session });
});

// --- Built-in Live Wicked Problem Demo Runner ---

const activeDemoTimers = new Map<string, NodeJS.Timeout[]>();

function stopDemo(sessionId: string): void {
  const timers = activeDemoTimers.get(sessionId);
  if (timers) {
    for (const t of timers) clearTimeout(t);
    activeDemoTimers.delete(sessionId);
  }
}

app.post("/api/sessions/:id/demo/start", (req, res) => {
  const session = sessionStore.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  stopDemo(session.id);

  const instant = Boolean(req.body?.instant);
  const intervalMs = Math.max(400, Math.min(8000, Number(req.body?.intervalMs || 1850)));

  // Reset to clean slate for the demo
  session.turns = [];
  session.speakers = [];
  session.nodes = [];
  session.crossLinks = [];
  session.hostContext = [];
  session.activity = [];
  sessionStore.updateSessionMeta(session.id, {
    title: WICKED_PROBLEM_DEMO_TITLE,
    rootFocus: "How should we run transcription & diarization for sensitive meetings?",
  });
  sessionStore.broadcast(session.id, { type: "session.snapshot", session });

  const playBeat = (idx: number) => {
    const beat = WICKED_PROBLEM_DEMO_BEATS[idx];
    if (!beat) return;
    const cur = sessionStore.getSession(session.id);
    if (!cur) return;

    const [turn] = sessionStore.appendTurns(session.id, [
      {
        speakerChannel: beat.speakerChannel,
        speakerName: beat.speakerName,
        speakerRole: beat.speakerRole,
        text: beat.text,
        startSec: beat.startSec,
        endSec: beat.endSec,
        overlap: beat.overlap,
        overlapWith: beat.overlapWithChannels?.map((c) => `speaker_${c}`),
        source: "demo",
        mapped: true,
      },
    ]);

    const opsWithProvenance = beat.ops.map((op) => {
      if (op.op === "add_node") {
        return {
          ...op,
          turnIds: [turn.id],
          speakerIds: [turn.speakerId],
        };
      }
      return op;
    });

    sessionStore.applyMapOps(session.id, {
      actor: "model",
      summary: beat.activitySummary,
      markTurnIdsMapped: [turn.id],
      ops: opsWithProvenance,
    });
  };

  if (instant) {
    for (let i = 0; i < WICKED_PROBLEM_DEMO_BEATS.length; i++) {
      playBeat(i);
    }
    res.json({ started: true, instant: true, beats: WICKED_PROBLEM_DEMO_BEATS.length });
    return;
  }

  const timers: NodeJS.Timeout[] = [];
  WICKED_PROBLEM_DEMO_BEATS.forEach((_, idx) => {
    const t = setTimeout(() => {
      playBeat(idx);
      if (idx === WICKED_PROBLEM_DEMO_BEATS.length - 1) {
        activeDemoTimers.delete(session.id);
        sessionStore.broadcast(session.id, { type: "speech.status", state: "idle" });
      }
    }, idx * intervalMs + 250);
    timers.push(t);
  });
  activeDemoTimers.set(session.id, timers);
  sessionStore.broadcast(session.id, {
    type: "speech.status",
    state: "listening",
    message: "Live demo conversation streaming…",
  });

  res.json({ started: true, instant: false, beats: WICKED_PROBLEM_DEMO_BEATS.length });
});

app.post("/api/sessions/:id/demo/stop", (req, res) => {
  stopDemo(req.params.id);
  sessionStore.broadcast(req.params.id, { type: "speech.status", state: "idle" });
  res.json({ stopped: true });
});

// --- Static Frontend Serving (Production / Single-Port Mode) ---

const clientDist = path.resolve(process.cwd(), "dist", "client");
if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// --- HTTP + WebSocket Server (Live Mic -> NeMo-Speech.cpp Realtime Proxy) ---

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  let url: URL;
  let sessionId: string;
  try {
    url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const match = url.pathname.match(/^\/ws\/sessions\/([^/]+)\/live$/);
    if (!match) {
      socket.destroy();
      return;
    }
    sessionId = decodeURIComponent(match[1]);
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!isAuthorizedRequest(req.headers, url.searchParams.get("api_key"))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!sessionStore.getSession(sessionId)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    void handleLiveAudioSocket(ws, sessionId);
  });
});

function pcm16ToWavBuffer(pcm: Buffer, sampleRate = 16000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function handleLiveAudioSocket(
  clientWs: WebSocket,
  sessionId: string
): Promise<void> {
  const session = sessionStore.getSession(sessionId);
  if (!session) {
    clientWs.close(1008, "Session not found");
    return;
  }

  let upstream: WebSocket | null = null;
  const queuedFrames: Buffer[] = [];
  let windowPcmChunks: Buffer[] = [];
  let windowPcmBytes = 0;
  const committedPcmQueue: Buffer[] = [];
  let liveSegmentQueue: Promise<void> = Promise.resolve();
  const liveAbort = new AbortController();
  const unregisterLive = registerLiveController(sessionId, liveAbort);
  liveAbort.signal.addEventListener(
    "abort",
    () => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1000, "Session audio changed");
      }
      if (upstream && upstream.readyState === WebSocket.OPEN) {
        upstream.close();
      }
    },
    { once: true }
  );
  let upstreamReady = false;
  let closed = false;
  let finalCommitSent = false;
  let finalCloseTimer: NodeJS.Timeout | null = null;
  let partialBuffer = "";
  let liveOffsetSec = 0;
  let liveWindowBytes = 0;
  const LIVE_AUTO_COMMIT_BYTES = 16000 * 2 * 22; // auto-commit after 22s continuous speech in noisy rooms
  const LIVE_MAX_PCM_BYTES = 16000 * 2 * 45; // cap buffered PCM per window (~1.4 MB)

  const pushPcmForDiarization = (buf: Buffer) => {
    if (windowPcmBytes + buf.length <= LIVE_MAX_PCM_BYTES) {
      windowPcmChunks.push(buf);
      windowPcmBytes += buf.length;
    }
  };

  const flushPcmWindowForCommit = () => {
    if (windowPcmChunks.length > 0) {
      committedPcmQueue.push(Buffer.concat(windowPcmChunks));
      windowPcmChunks = [];
      windowPcmBytes = 0;
    }
  };

  const sendClient = (payload: unknown) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(payload));
    }
  };

  sessionStore.broadcast(sessionId, {
    type: "speech.status",
    state: "listening",
    message: `Starting local ${session.speechConfig.streamingAsrModel} + ${session.speechConfig.diarizationModel}…`,
  });

  clientWs.on("message", (data, isBinary) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (upstreamReady && upstream?.readyState === WebSocket.OPEN) {
        upstream.send(buf);
        pushPcmForDiarization(buf);
        liveWindowBytes += buf.length;
        if (
          liveWindowBytes >= LIVE_AUTO_COMMIT_BYTES &&
          (/[.?!]["')\]\s]*$/.test(partialBuffer) ||
            liveWindowBytes >= LIVE_AUTO_COMMIT_BYTES * 1.4)
        ) {
          liveWindowBytes = 0;
          flushPcmWindowForCommit();
          upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        }
      } else if (queuedFrames.length < 200) {
        queuedFrames.push(buf);
      }
      return;
    }

    try {
      const msg = JSON.parse(data.toString()) as { type?: string };
      if (msg.type === "commit" && upstream?.readyState === WebSocket.OPEN) {
        flushPcmWindowForCommit();
        upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      } else if (msg.type === "clear" && upstream?.readyState === WebSocket.OPEN) {
        windowPcmChunks = [];
        windowPcmBytes = 0;
        liveWindowBytes = 0;
        upstream.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
      }
    } catch {
      // ignore malformed JSON
    }
  });

  clientWs.on("close", () => {
    closed = true;
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      if (!finalCommitSent && (liveWindowBytes > 0 || partialBuffer.trim())) {
        finalCommitSent = true;
        flushPcmWindowForCommit();
        try {
          upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        } catch {
          // ignore
        }
        // Wait for input_audio_buffer.committed (bounded 5s safety timeout) before closing upstream (S12)
        finalCloseTimer = setTimeout(() => {
          upstream?.close();
        }, 5000);
      } else {
        upstream.close();
      }
    }
    sessionStore.broadcast(sessionId, { type: "speech.status", state: "idle" });
  });

  try {
    await speechEngine.ensureStreamingServer({
      asrModel: session.speechConfig.streamingAsrModel,
      diarModel: session.speechConfig.diarizationModel,
    });

    if (closed) return;

    upstream = new WebSocket(speechEngine.serverWsUrl);

    upstream.on("open", () => {
      sendClient({ type: "live.ready", message: "Connected to local NVIDIA speech runtime" });
      sessionStore.broadcast(sessionId, {
        type: "speech.status",
        state: "listening",
        message: `Live: ${session.speechConfig.streamingAsrModel} + ${session.speechConfig.diarizationModel}`,
      });
    });

    upstream.on("message", (raw) => {
      try {
        const evt = JSON.parse(raw.toString()) as {
          type?: string;
          delta?: string;
          transcript?: string;
          text?: string;
          words?: WordTiming[];
          message?: string;
        };

        if (evt.type === "session.created") {
          upstream?.send(
            JSON.stringify({
              type: "session.update",
              session: {
                sample_rate: 16000,
                word_timestamps: true,
                speaker_diarization: true,
                automatic_punctuation: true,
              },
            })
          );
          return;
        }

        if (evt.type === "session.updated") {
          upstreamReady = true;
          while (queuedFrames.length > 0 && upstream?.readyState === WebSocket.OPEN) {
            const frame = queuedFrames.shift();
            if (frame) {
              upstream.send(frame);
              pushPcmForDiarization(frame);
            }
          }
          return;
        }

        if (evt.type === "conversation.item.input_audio_transcription.delta") {
          const piece = evt.delta || evt.text || "";
          if (piece) {
            partialBuffer += piece;
            sessionStore.broadcast(sessionId, {
              type: "transcript.partial",
              text: partialBuffer.trim(),
              timestamp: new Date().toISOString(),
            });
          }
          return;
        }

        if (evt.type === "conversation.item.input_audio_transcription.completed") {
          const segOffset = liveOffsetSec;
          const segGen = sessionStore.getGeneration(sessionId);
          // Preserve new frames arriving in windowPcmChunks when consuming an earlier committed buffer (S5)
          let segPcm: Buffer;
          if (committedPcmQueue.length > 0) {
            segPcm = committedPcmQueue.shift()!;
          } else if (windowPcmChunks.length > 0) {
            segPcm = Buffer.concat(windowPcmChunks);
            windowPcmChunks = [];
            windowPcmBytes = 0;
          } else {
            segPcm = Buffer.alloc(0);
          }
          const rawWords = Array.isArray(evt.words) ? evt.words : [];
          const maxWordEnd = rawWords.reduce((m, w) => Math.max(m, w.end || 0), 0);
          const pcmDur = segPcm.length / 32000;
          const evtDur = Number((evt as { audio_processed?: number }).audio_processed) || 0;
          const segDur = Math.max(evtDur, pcmDur, maxWordEnd);
          liveOffsetSec = Number((liveOffsetSec + segDur).toFixed(2));
          const segEndSec = liveOffsetSec;
          liveWindowBytes = 0;
          partialBuffer = "";
          sessionStore.broadcast(sessionId, {
            type: "transcript.partial",
            text: "",
            timestamp: new Date().toISOString(),
          });

          const rawTranscript = evt.transcript?.trim() || "";

          liveSegmentQueue = liveSegmentQueue
            .catch(() => {})
            .then(async () => {
              if (
                liveAbort.signal.aborted ||
                sessionStore.getGeneration(sessionId) !== segGen
              ) {
                return;
              }
              const cur = sessionStore.getSession(sessionId);
              if (!cur) return;

              let alignedRawWords = rawWords;
              const seedNameBySlot = new Map<number, string>();
              const seeds = voiceBank.getSeeds(cur.speakers.map((s) => s.name));

              if (
                seeds.length > 0 &&
                rawWords.length > 0 &&
                segPcm.length >= 16000
              ) {
                const tmpWav = path.join(
                  os.tmpdir(),
                  `dialogger-live-seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`
                );
                try {
                  fs.writeFileSync(tmpWav, pcm16ToWavBuffer(segPcm, 16000));
                  const diar = await speechEngine.diarizeWavWithSeeds(tmpWav, {
                    diarizationModel: cur.speechConfig.diarizationModel,
                    seeds,
                    signal: liveAbort.signal,
                  });
                  if (diar.segments.length > 0) {
                    alignedRawWords = alignWordsToDiarization(
                      rawWords,
                      diar.segments
                    );
                    for (const [slot, name] of diar.slotNames.entries()) {
                      seedNameBySlot.set(slot, name);
                    }
                  }
                } catch (err) {
                  if (liveAbort.signal.aborted) return;
                  console.warn(
                    "[live] Seeded voice diarization fallback:",
                    err instanceof Error ? err.message : err
                  );
                } finally {
                  try {
                    if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
                  } catch {
                    // ignore
                  }
                }
              }

              // Re-verify live cancellation & generation before publishing turns (S6)
              if (
                liveAbort.signal.aborted ||
                !sessionStore.getSession(sessionId) ||
                sessionStore.getGeneration(sessionId) !== segGen
              ) {
                return;
              }

              const words: WordTiming[] = alignedRawWords.map((w) => ({
                ...w,
                start: Number((w.start + segOffset).toFixed(2)),
                end: Number((w.end + segOffset).toFixed(2)),
              }));
              const turns =
                words.length > 0
                  ? wordsToDiarizedTurns(words)
                  : rawTranscript
                    ? [
                        {
                          speakerChannel: 1,
                          text: rawTranscript,
                          startSec: segOffset,
                          endSec: segEndSec,
                          overlap: false,
                          overlapWithChannels: [],
                          words: [],
                        },
                      ]
                    : [];

              if (turns.length > 0) {
                const liveWindowCtx = createDiarizationWindowContext(seedNameBySlot);
                const added = sessionStore.appendTurns(
                  sessionId,
                  turns.map((t) => ({
                    speakerChannel: t.speakerChannel,
                    speakerName: seedNameBySlot.get(t.speakerChannel),
                    text: t.text,
                    startSec: t.startSec > 0 ? t.startSec : undefined,
                    endSec: t.endSec > 0 ? t.endSec : undefined,
                    overlap: t.overlap,
                    overlapWith: t.overlapWithChannels.map((c) => `speaker_${c}`),
                    words: t.words,
                    source: "live" as const,
                  })),
                  liveWindowCtx
                );
                for (let idx = 0; idx < turns.length; idx++) {
                  if (seedNameBySlot.has(turns[idx].speakerChannel) && added[idx]) {
                    sessionStore.markSpeakerVoiceEnrolled(
                      sessionId,
                      added[idx].speakerId,
                      true
                    );
                  }
                }
                void runAutoMap(sessionId);
              }
            });
          return;
        }

        if (evt.type === "input_audio_buffer.committed") {
          if (closed && finalCommitSent) {
            if (finalCloseTimer) clearTimeout(finalCloseTimer);
            upstream?.close();
          }
          return;
        }

        if (evt.type === "error") {
          const msg = evt.message || "Speech server error";
          sendClient({ type: "live.error", message: msg });
          sessionStore.broadcast(sessionId, {
            type: "speech.status",
            state: "error",
            message: msg,
          });
        }
      } catch {
        // ignore non-json
      }
    });

    upstream.on("error", (err) => {
      sendClient({ type: "live.error", message: err.message });
      sessionStore.broadcast(sessionId, {
        type: "speech.status",
        state: "error",
        message: err.message,
      });
    });

    upstream.on("close", () => {
      if (!closed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
      void liveSegmentQueue.finally(() => unregisterLive());
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendClient({ type: "live.error", message: msg });
    sessionStore.broadcast(sessionId, {
      type: "speech.status",
      state: "error",
      message: msg,
    });
    unregisterLive();
    clientWs.close(1011, msg.slice(0, 120));
  }
}

// Refuse to expose unauthenticated server on non-loopback interfaces unless explicitly opted in (S1)
if (!isLoopbackHost(HOST) && !API_KEY && !OWNER_KEY && !ALLOW_UNAUTHENTICATED) {
  console.error(
    `[dialogger] Refusing to bind to non-loopback host "${HOST}" without DIALOGGER_API_KEY. ` +
      `Set DIALOGGER_API_KEY (recommended), bind DIALOGGER_HOST=127.0.0.1, ` +
      `or set DIALOGGER_ALLOW_UNAUTHENTICATED=true on a private tailnet.`
  );
  process.exit(1);
}

// Seed one starter session if empty so the UI opens cleanly
if (sessionStore.listSessions().length === 0) {
  sessionStore.createSession({
    title: "New Dialogue Map",
  });
}

server.listen(PORT, HOST, () => {
  console.log(`[dialogger] API + WebSocket server listening on http://${HOST}:${PORT}`);
  if (fs.existsSync(path.join(clientDist, "index.html"))) {
    console.log(`[dialogger] Serving built web UI on http://${HOST === "0.0.0.0" ? "malta" : HOST}:${PORT}`);
  }
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import type { WebSocketPeer as Peer } from "nitro/h3";
import type { WordTiming } from "../shared/schemas/models";
import { createDiarizationWindowContext, sessionStore } from "./store";
import {
  alignWordsToDiarization,
  speechEngine,
  wordsToDiarizedTurns,
} from "./speech";
import { voiceBank } from "./voicebank";
import { registerLiveController, runAutoMap } from "./jobs";

/** Minimal client-socket surface the live handler needs, so it works on any crossws peer. */
interface LiveClient {
  isOpen(): boolean;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Per-connection hooks returned by startLiveAudioSession. */
export interface LiveSessionHandlers {
  onMessage(data: Buffer | string): void;
  onClose(): void;
}

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

/**
 * Proxies one browser mic connection to the local NeMo-Speech.cpp realtime server,
 * diarizes each committed segment, and appends the turns to the session.
 */
export function startLiveAudioSession(
  peer: Peer,
  sessionId: string
): LiveSessionHandlers | null {
  let clientOpen = true;
  const clientWs: LiveClient = {
    isOpen: () => clientOpen,
    send: (data) => peer.send(data),
    close: (code, reason) => {
      clientOpen = false;
      peer.close(code, reason);
    },
  };
  const session = sessionStore.getSession(sessionId);
  if (!session) {
    clientWs.close(1008, "Session not found");
    return null;
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
      if (clientWs.isOpen()) {
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
    if (clientWs.isOpen()) {
      clientWs.send(JSON.stringify(payload));
    }
  };

  sessionStore.broadcast(sessionId, {
    type: "speech.status",
    state: "listening",
    message: `Starting local ${session.speechConfig.streamingAsrModel} + ${session.speechConfig.diarizationModel}…`,
  });

  const onMessage = (data: Buffer | string) => {
    if (typeof data !== "string") {
      const buf = data;
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
  };

  const onClose = () => {
    clientOpen = false;
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
  };

  const connectUpstream = async (): Promise<void> => {
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
        if (!closed && clientWs.isOpen()) {
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
  };

  void connectUpstream();
  return { onMessage, onClose };
}

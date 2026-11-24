import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { defineHandler, defineRouteMeta } from "nitro";
import {
  TranscribeSavedAudioRequestSchema,
  type CancelledResponse,
  type TranscribeSavedAudioResponse,
} from "../../../../../shared/schemas/contracts";
import { fail, getSessionParam, parseBody } from "../../../../lib/http";
import {
  broadcastJobIdle,
  finishTranscribeJob,
  isCurrentJob,
  reportJobError,
  runAutoMap,
  startTranscribeJob,
} from "../../../../lib/jobs";
import { speechEngine } from "../../../../lib/speech";
import {
  createDiarizationWindowContext,
  sessionStore,
  type DiarizationWindowContext,
} from "../../../../lib/store";
import { voiceBank } from "../../../../lib/voicebank";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Transcription"
    ],
    "summary": "Re-run live streaming transcription over the session's saved audio",
    "description": "Streams the saved audio through Nemotron 3.5 + Nemotron 3 diarization. Turns, partial text, and progress arrive on the session's SSE events while this request is open.",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/TranscribeSavedAudioRequest"
          }
        }
      }
    },
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "oneOf": [
                {
                  "$ref": "#/components/schemas/TranscribeSavedAudioResponse"
                },
                {
                  "$ref": "#/components/schemas/CancelledResponse"
                }
              ]
            }
          }
        }
      },
      "400": {
        "description": "Invalid request body",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      },
      "401": {
        "description": "Missing or invalid API key (only when DIALOGGER_API_KEY or DIALOGGER_OWNER_KEY is set)",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      },
      "404": {
        "description": "Session not found, or it has no saved audio",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      },
      "500": {
        "description": "Server error",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      }
    }
  },
});


export default defineHandler(async (event) => {
  const session = getSessionParam(event);
  if (!session) {
    return fail(404, "Session not found");
  }

  const audioPath = sessionStore.getAudioFilePath(session.id);
  if (!audioPath) {
    return fail(404, "No saved audio attached to this session");
  }

  const body = await parseBody(event, TranscribeSavedAudioRequestSchema);
  if (body instanceof Response) return body;

  const abortController = startTranscribeJob(session.id);

  const asrModel =
    body.asrModel || session.speechConfig.streamingAsrModel || "nemotron-3.5";
  const diarizationModel =
    body.diarizationModel ||
    session.speechConfig.diarizationModel ||
    "nemotron-3-diarization";
  const autoMap = body.autoMap ?? session.autoMap;
  const startSec = Math.max(0, body.startSec || 0);

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
      return { cancelled: true } satisfies CancelledResponse;
    }

    if (startSec > 0) {
      const slicePath = path.join(
        os.tmpdir(),
        `dialogger-slice-${Date.now()}.wav`
      );
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
      return { cancelled: true } satisfies CancelledResponse;
    }

    // Now that speech startup & slicing succeeded, apply staged clear or exact playhead truncation (S7)
    if (body.clearExisting) {
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
      broadcastJobIdle(session.id);
    }

    if (autoMap && !streamRes.cancelled && isCurrentJob(session.id, abortController)) {
      await runAutoMap(session.id);
    }

    return {
      asrModel,
      diarizationModel,
      turnsAdded,
      stagedResetDone,
      cancelled: streamRes.cancelled,
      session: sessionStore.getSession(session.id) ?? session,
    } satisfies TranscribeSavedAudioResponse;
  } catch (err) {
    if (abortController.signal.aborted) {
      return { cancelled: true } satisfies CancelledResponse;
    }
    return fail(500, reportJobError(session.id, abortController, err));
  } finally {
    finishTranscribeJob(session.id, abortController);
    cleanupSlice?.();
  }
});

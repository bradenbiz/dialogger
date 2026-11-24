import fs from "node:fs";
import path from "node:path";
import { defineHandler, defineRouteMeta } from "nitro";
import {
  YouTubeImportRequestSchema,
  type CancelledResponse,
  type YouTubeImportResponse,
} from "../../../../shared/schemas/contracts";
import { fail, getSessionParam, parseBody } from "../../../lib/http";
import {
  broadcastJobIdle,
  finishTranscribeJob,
  isCurrentJob,
  mapAddedTurnsInChunks,
  reportJobError,
  runAutoMap,
  startTranscribeJob,
} from "../../../lib/jobs";
import { speechEngine } from "../../../lib/speech";
import {
  createDiarizationWindowContext,
  sessionStore,
  type DiarizationWindowContext,
} from "../../../lib/store";
import { voiceBank } from "../../../lib/voicebank";
import { downloadYouTubeAudio, encodePlayableMp3, hasYtDlp } from "../../../lib/youtube";

defineRouteMeta({
  openAPI: {
    "tags": [
      "YouTube"
    ],
    "summary": "Download a public YouTube video's audio, then transcribe, diarize, and map it live",
    "description": "Download progress (`Downloading YouTube audio… 42%`), then transcription progress, arrive as `speech.status` events on the session's SSE stream while this request is open.",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/YouTubeImportRequest"
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
                  "$ref": "#/components/schemas/YouTubeImportResponse"
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
        "description": "Session not found",
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
      },
      "501": {
        "description": "yt-dlp is not installed on the server",
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

  const body = await parseBody(event, YouTubeImportRequestSchema);
  if (body instanceof Response) return body;

  if (!(await hasYtDlp())) {
    return fail(501, "yt-dlp is not installed on this server.");
  }

  // Cancel any prior transcription on this session
  const abortController = startTranscribeJob(session.id);

  const { url, startSec, durationSec } = body;
  const asrModel =
    body.asrModel || session.speechConfig.streamingAsrModel || "nemotron-3.5";
  const diarizationModel =
    body.diarizationModel ||
    session.speechConfig.diarizationModel ||
    "nemotron-3-diarization";
  const autoMap = body.autoMap ?? session.autoMap;
  const isStreamingModel =
    asrModel === "nemotron-3.5" || asrModel === "nemotron-en";

  sessionStore.broadcast(session.id, {
    type: "speech.status",
    state: "transcribing",
    message: "Downloading YouTube audio… 0%",
  });

  let downloaded: Awaited<ReturnType<typeof downloadYouTubeAudio>> | null = null;
  const stagingMp3 = path.join(
    sessionStore.getAudioDir(),
    `${session.id}.staging-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`
  );
  try {
    let lastDownloadPct = -1;
    downloaded = await downloadYouTubeAudio(url, {
      startSec,
      durationSec,
      signal: abortController.signal,
      onProgress: (fraction) => {
        if (!isCurrentJob(session.id, abortController)) return;
        const pct = Math.floor(fraction * 100);
        if (pct === lastDownloadPct) return;
        lastDownloadPct = pct;
        sessionStore.broadcast(session.id, {
          type: "speech.status",
          state: "transcribing",
          message: `Downloading YouTube audio… ${pct}%`,
        });
      },
    });
    if (!isCurrentJob(session.id, abortController)) {
      return { cancelled: true } satisfies CancelledResponse;
    }
    sessionStore.broadcast(session.id, {
      type: "speech.status",
      state: "transcribing",
      message: "Preparing downloaded audio…",
    });

    // Encode seekable browser MP3 to a unique staging file BEFORE touching existing audio or session state (S3)
    const audioFilename = `${session.id}.mp3`;
    const audioOut = path.join(sessionStore.getAudioDir(), audioFilename);
    const playableDur = await encodePlayableMp3(
      downloaded.rawPath,
      stagingMp3,
      abortController.signal
    );

    if (!isCurrentJob(session.id, abortController)) {
      return { cancelled: true } satisfies CancelledResponse;
    }

    // Atomically swap staged audio & replace any previous transcript/map together (S3)
    fs.renameSync(stagingMp3, audioOut);
    if (body.clearExisting || session.turns.length > 0 || session.audio) {
      sessionStore.clearForFreshRun(session.id, true);
    }

    if (
      !session.title ||
      session.title === "New Dialogue Map" ||
      session.title === "Untitled Dialogue Map" ||
      session.title === "YouTube Dialogue Map" ||
      body.clearExisting
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
        broadcastJobIdle(session.id);
      }

      if (autoMap && !streamRes.cancelled && isCurrentJob(session.id, abortController)) {
        await runAutoMap(session.id);
      }

      return {
        metadata: downloaded.metadata,
        asrModel,
        diarizationModel,
        duration: playableDur || streamRes.durationSec,
        turnsAdded,
        cancelled: streamRes.cancelled,
        session: sessionStore.getSession(session.id) ?? session,
      } satisfies YouTubeImportResponse;
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
      return { cancelled: true } satisfies CancelledResponse;
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
      await mapAddedTurnsInChunks(session.id, abortController, added.map((t) => t.id));
    }

    return {
      metadata: downloaded.metadata,
      asrModel: result.asrModel,
      diarizationModel: result.diarizationModel,
      duration: playableDur || result.duration,
      turnsAdded,
      session: sessionStore.getSession(session.id) ?? session,
    } satisfies YouTubeImportResponse;
  } catch (err) {
    if (abortController.signal.aborted) {
      return { cancelled: true } satisfies CancelledResponse;
    }
    return fail(500, reportJobError(session.id, abortController, err));
  } finally {
    finishTranscribeJob(session.id, abortController);
    try {
      if (fs.existsSync(stagingMp3)) fs.unlinkSync(stagingMp3);
    } catch {
      // ignore
    }
    downloaded?.cleanup();
  }
});

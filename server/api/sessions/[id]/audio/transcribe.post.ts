import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readBody } from "nitro/h3";
import { defineHandler, defineRouteMeta } from "nitro";
import { z } from "zod";
import { fail, getSessionParam } from "../../../../http";
import {
  broadcastJobIdle,
  finishTranscribeJob,
  isCurrentJob,
  reportJobError,
  runAutoMap,
  startTranscribeJob,
} from "../../../../jobs";
import { speechEngine } from "../../../../speech";
import {
  createDiarizationWindowContext,
  sessionStore,
  type DiarizationWindowContext,
} from "../../../../store";
import { voiceBank } from "../../../../voicebank";

defineRouteMeta({
  openAPI: {
    tags: ["Transcription"],
    summary: "Re-run live streaming transcription over the session's saved audio",
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              startSec: { type: "number", minimum: 0, description: "Resume from this playhead, replacing later turns" },
              asrModel: { type: "string" },
              diarizationModel: { type: "string" },
              autoMap: { type: "boolean" },
              clearExisting: { type: "boolean" },
            },
          },
        },
      },
    },
  },
});

const schema = z.object({
  startSec: z.number().nonnegative().optional(),
  asrModel: z.string().optional(),
  diarizationModel: z.string().optional(),
  autoMap: z.boolean().optional(),
  clearExisting: z.boolean().optional(),
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

  const parsed = schema.safeParse((await readBody(event)) || {});
  if (!parsed.success) {
    return fail(400, parsed.error.flatten());
  }

  const abortController = startTranscribeJob(session.id);

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
      return { cancelled: true };
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
      return { cancelled: true };
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
      session: sessionStore.getSession(session.id),
    };
  } catch (err) {
    if (abortController.signal.aborted) {
      return { cancelled: true };
    }
    return fail(500, reportJobError(session.id, abortController, err));
  } finally {
    finishTranscribeJob(session.id, abortController);
    cleanupSlice?.();
  }
});

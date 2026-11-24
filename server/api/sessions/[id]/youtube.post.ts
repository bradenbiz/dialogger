import fs from "node:fs";
import path from "node:path";
import { readBody } from "nitro/h3";
import { defineHandler, defineRouteMeta } from "nitro";
import { z } from "zod";
import { fail, getSessionParam } from "../../../http";
import {
  broadcastJobIdle,
  finishTranscribeJob,
  isCurrentJob,
  mapAddedTurnsInChunks,
  reportJobError,
  runAutoMap,
  startTranscribeJob,
} from "../../../jobs";
import { speechEngine } from "../../../speech";
import {
  createDiarizationWindowContext,
  sessionStore,
  type DiarizationWindowContext,
} from "../../../store";
import { voiceBank } from "../../../voicebank";
import { downloadYouTubeAudio, encodePlayableMp3, hasYtDlp } from "../../../youtube";

defineRouteMeta({
  openAPI: {
    tags: ["YouTube"],
    summary: "Download a public YouTube video's audio, then transcribe, diarize, and map it live",
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string" },
              startSec: { type: "number", minimum: 0 },
              durationSec: { type: "number", minimum: 0, description: "Clip length; omit for the whole video" },
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
  url: z.string().min(1),
  startSec: z.number().nonnegative().optional(),
  durationSec: z.number().nonnegative().optional(),
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

  const parsed = schema.safeParse((await readBody(event)) || {});
  if (!parsed.success) {
    return fail(400, parsed.error.flatten());
  }

  if (!(await hasYtDlp())) {
    return fail(501, "yt-dlp is not installed on this server.");
  }

  // Cancel any prior transcription on this session
  const abortController = startTranscribeJob(session.id);

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
      return { cancelled: true };
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
      return { cancelled: true };
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
        session: sessionStore.getSession(session.id),
      };
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
      return { cancelled: true };
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
      session: sessionStore.getSession(session.id),
    };
  } catch (err) {
    if (abortController.signal.aborted) {
      return { cancelled: true };
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

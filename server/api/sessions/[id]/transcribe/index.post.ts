import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { defineHandler, defineRouteMeta } from "nitro";
import { encodePlayableMp3 } from "../../../../youtube";
import { fail, getSessionParam } from "../../../../http";
import {
  finishTranscribeJob,
  isCurrentJob,
  mapAddedTurnsInChunks,
  reportJobError,
  startTranscribeJob,
} from "../../../../jobs";
import { speechEngine } from "../../../../speech";
import { createDiarizationWindowContext, sessionStore } from "../../../../store";
import { voiceBank } from "../../../../voicebank";

const UPLOAD_DIR = path.join(os.tmpdir(), "dialogger-uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

defineRouteMeta({
  openAPI: {
    tags: ["Transcription"],
    summary: "Upload an audio/video file to transcribe, diarize, and map (replaces the session's audio)",
    requestBody: {
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["file"],
            properties: {
              file: { type: "string", format: "binary" },
              asrModel: { type: "string", default: "parakeet-tdt" },
              diarizationModel: { type: "string", default: "nemotron-3-diarization" },
              autoMap: { type: "string", enum: ["true", "false"] },
            },
          },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const session = getSessionParam(event);
  if (!session) {
    return fail(404, "Session not found");
  }

  const form = await event.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail(400, "Upload an audio file as multipart form field 'file'");
  }
  const field = (name: string) => {
    const v = form?.get(name);
    return typeof v === "string" && v ? v : undefined;
  };
  const uploadedFile = {
    path: path.join(UPLOAD_DIR, `${crypto.randomUUID()}${path.extname(file.name || "")}`),
    originalname: file.name,
  };
  await pipeline(
    Readable.fromWeb(file.stream() as unknown as NodeReadableStream),
    fs.createWriteStream(uploadedFile.path)
  );

  const abortController = startTranscribeJob(session.id);

  const asrModel =
    field("asrModel") ||
    session.speechConfig.offlineAsrModel ||
    "parakeet-tdt";
  const diarizationModel =
    field("diarizationModel") ||
    session.speechConfig.diarizationModel ||
    "nemotron-3-diarization";
  const autoMapField = field("autoMap");
  const autoMap =
    autoMapField === undefined ? session.autoMap : autoMapField === "true";

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
      return { cancelled: true };
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
      return { cancelled: true };
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
      await mapAddedTurnsInChunks(session.id, abortController, added.map((t) => t.id));
    }

    return {
      asrModel: result.asrModel,
      diarizationModel: result.diarizationModel,
      duration: result.duration,
      text: result.text,
      turnsAdded: added.length,
      turns: added,
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
    try {
      fs.unlinkSync(uploadedFile.path);
    } catch {
      // ignore
    }
  }
});

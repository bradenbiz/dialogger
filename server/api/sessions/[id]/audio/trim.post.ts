import { defineHandler, defineRouteMeta } from "nitro";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readBody } from "nitro/h3";
import { z } from "zod";
import { fail, getSessionParam } from "../../../../http";
import { cancelActiveTranscribe } from "../../../../jobs";
import { sessionStore } from "../../../../store";
import { probeDurationSec } from "../../../../youtube";

defineRouteMeta({
  openAPI: {
    tags: ["Audio"],
    summary: "Trim the session's saved audio",
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["startSec"],
            properties: {
              startSec: { type: "number", minimum: 0 },
              endSec: { type: "number" },
              clearTranscriptAndMap: { type: "boolean" },
            },
          },
        },
      },
    },
  },
});

const schema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().positive().optional(),
  clearTranscriptAndMap: z.boolean().optional(),
});

export default defineHandler(async (event) => {
  const session = getSessionParam(event);
  if (!session) return fail(404, "Session not found");
  const audioPath = sessionStore.getAudioFilePath(session.id);
  if (!audioPath) return fail(404, "No saved audio attached to this session");

  const parsed = schema.safeParse((await readBody(event)) || {});
  if (!parsed.success) return fail(400, parsed.error.flatten());

  const { startSec, endSec, clearTranscriptAndMap } = parsed.data;
  if (endSec !== undefined && endSec <= startSec + 1) {
    return fail(400, "endSec must be at least 1 second after startSec");
  }

  cancelActiveTranscribe(session.id);
  const tmpOut = `${audioPath}.trim-${Date.now()}.mp3`;

  try {
    const ffArgs = ["-y", "-ss", String(startSec), "-i", audioPath];
    if (endSec !== undefined) {
      ffArgs.push("-t", String(endSec - startSec));
    }
    ffArgs.push("-vn", "-ac", "1", "-ar", "24000", "-b:a", "96k", tmpOut);
    await promisify(execFile)("ffmpeg", ffArgs, { timeout: 180_000 });
    fs.renameSync(tmpOut, audioPath);

    const newDurationSec = await probeDurationSec(audioPath);
    const updated = sessionStore.applyAudioTrimState(session.id, {
      startSec,
      endSec,
      newDurationSec:
        newDurationSec || Math.max(0, (endSec ?? session.audio?.durationSec ?? 0) - startSec),
      clearTranscriptAndMap: Boolean(clearTranscriptAndMap),
    });
    return { session: updated };
  } catch (err) {
    try {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    } catch {
      // ignore
    }
    return fail(500, err instanceof Error ? err.message : String(err));
  }
});

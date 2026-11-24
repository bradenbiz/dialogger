import { defineHandler, defineRouteMeta } from "nitro";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TrimAudioRequestSchema, type SessionResponse } from "../../../../../shared/schemas/contracts";
import { fail, getSessionParam, parseBody } from "../../../../http";
import { cancelActiveTranscribe } from "../../../../jobs";
import { sessionStore } from "../../../../store";
import { probeDurationSec } from "../../../../youtube";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Audio"
    ],
    "summary": "Trim the session's saved audio",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/TrimAudioRequest"
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
              "$ref": "#/components/schemas/SessionResponse"
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
        "description": "Session or its saved audio not found",
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
  if (!session) return fail(404, "Session not found");
  const audioPath = sessionStore.getAudioFilePath(session.id);
  if (!audioPath) return fail(404, "No saved audio attached to this session");

  const body = await parseBody(event, TrimAudioRequestSchema);
  if (body instanceof Response) return body;

  const { startSec, endSec, clearTranscriptAndMap } = body;
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
    if (!updated) return fail(404, "Session not found");
    return { session: updated } satisfies SessionResponse;
  } catch (err) {
    try {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    } catch {
      // ignore
    }
    return fail(500, err instanceof Error ? err.message : String(err));
  }
});

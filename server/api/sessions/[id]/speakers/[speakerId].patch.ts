import { defineHandler, defineRouteMeta } from "nitro";
import { RenameSpeakerRequestSchema, type SpeakerResponse } from "../../../../../shared/api";
import { fail, param, parseBody } from "../../../../http";
import { sessionStore } from "../../../../store";
import { voiceBank } from "../../../../voicebank";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Speakers"
    ],
    "summary": "Rename a speaker (also enrolls their voice from their cleanest turn)",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/RenameSpeakerRequest"
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
              "$ref": "#/components/schemas/SpeakerResponse"
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
      }
    }
  },
});

export default defineHandler(async (event) => {
  const body = await parseBody(event, RenameSpeakerRequestSchema);
  if (body instanceof Response) return body;
  const sessionId = param(event, "id");
  const speaker = sessionStore.renameSpeaker(
    sessionId,
    param(event, "speakerId"),
    body.name,
    body.role
  );
  if (!speaker) return fail(404, "Session not found");

  // Auto-enroll speaker voice seed from their cleanest turn if session has audio
  const session = sessionStore.getSession(sessionId);
  const audioPath = sessionStore.getAudioFilePath(sessionId);
  if (session && audioPath) {
    const best = session.turns
      .filter((t) => t.speakerId === speaker.id && !t.overlap && t.endSec - t.startSec >= 1.5)
      .sort((a, b) => b.endSec - b.startSec - (a.endSec - a.startSec))[0];
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

  return {
    speaker: session?.speakers.find((s) => s.id === speaker.id) || speaker,
  } satisfies SpeakerResponse;
});

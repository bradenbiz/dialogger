import { defineHandler, defineRouteMeta } from "nitro";
import { UpdateTurnRequestSchema, type UpdateTurnResponse } from "../../../../../shared/schemas/contracts";
import { fail, param, parseBody } from "../../../../lib/http";
import { sessionStore } from "../../../../lib/store";
import { voiceBank } from "../../../../lib/voicebank";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Transcript"
    ],
    "summary": "Edit a turn or reassign its speaker (enrolls that snippet as a voice sample)",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/UpdateTurnRequest"
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
              "$ref": "#/components/schemas/UpdateTurnResponse"
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
        "description": "Session or turn not found",
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
  const body = await parseBody(event, UpdateTurnRequestSchema);
  if (body instanceof Response) return body;

  const sessionId = param(event, "id");
  const updated = sessionStore.updateTurn(sessionId, param(event, "turnId"), body);
  const session = sessionStore.getSession(sessionId);
  if (!updated || !session) return fail(404, "Session or turn not found");

  // Enroll this exact snippet into the persistent voicebank so future recordings recognize this person
  let voiceEnrolled = false;
  const audioPath = sessionStore.getAudioFilePath(sessionId);
  if (audioPath && updated.turn.endSec - updated.turn.startSec >= 1.2) {
    const enrolled = await voiceBank.enrollFromAudioSnippet({
      name: updated.speaker.name,
      audioPath,
      startSec: updated.turn.startSec,
      endSec: updated.turn.endSec,
    });
    if (enrolled) {
      voiceEnrolled = true;
      sessionStore.markSpeakerVoiceEnrolled(sessionId, updated.speaker.id, true);
    }
  }

  return { ...updated, voiceEnrolled, session } satisfies UpdateTurnResponse;
});

import { defineHandler, defineRouteMeta } from "nitro";
import type { VoiceDeletedResponse } from "../../../shared/schemas/contracts";
import { fail, param } from "../../http";
import { voiceBank } from "../../voicebank";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Voices"
    ],
    "summary": "Delete an enrolled voice",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/VoiceDeletedResponse"
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
        "description": "Voice not found",
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

export default defineHandler((event) => {
  if (!voiceBank.deleteVoice(param(event, "id"))) {
    return fail(404, "Voice not found");
  }
  return { deleted: true, voices: voiceBank.listVoices() } satisfies VoiceDeletedResponse;
});

import { defineHandler, defineRouteMeta } from "nitro";
import type { SpeechEngineStatus } from "../../../shared/schemas/events";
import { fail } from "../../lib/http";
import { speechEngine } from "../../lib/speech";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Speech"
    ],
    "summary": "Local speech runtime status (nemo-speech, ffmpeg, cached models)",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/SpeechEngineStatus"
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

export default defineHandler(async () => {
  try {
    return (await speechEngine.getStatus()) satisfies SpeechEngineStatus;
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : String(err));
  }
});

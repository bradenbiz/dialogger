import { defineHandler, defineRouteMeta } from "nitro";
import { SpeechStartRequestSchema } from "../../../shared/schemas/contracts";
import type { SpeechEngineStatus } from "../../../shared/schemas/events";
import { fail, parseBody } from "../../lib/http";
import { speechEngine } from "../../lib/speech";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Speech"
    ],
    "summary": "Start the local streaming speech server",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/SpeechStartRequest"
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
              "$ref": "#/components/schemas/SpeechEngineStatus"
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
  const body = await parseBody(event, SpeechStartRequestSchema);
  if (body instanceof Response) return body;
  try {
    await speechEngine.ensureStreamingServer(body);
    return (await speechEngine.getStatus()) satisfies SpeechEngineStatus;
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : String(err));
  }
});

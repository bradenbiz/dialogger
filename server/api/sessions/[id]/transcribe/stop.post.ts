import { defineHandler, defineRouteMeta } from "nitro";
import type { StoppedResponse } from "../../../../../shared/schemas/contracts";
import { param } from "../../../../lib/http";
import { cancelActiveTranscribe } from "../../../../lib/jobs";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Transcription"
    ],
    "summary": "Stop the running transcription, keeping everything mapped so far",
    "description": "`stopped` is false when nothing was running.",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/StoppedResponse"
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
      }
    }
  },
});

export default defineHandler(
  (event) => ({ stopped: cancelActiveTranscribe(param(event, "id")) }) satisfies StoppedResponse
);

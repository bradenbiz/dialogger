import { defineHandler, defineRouteMeta } from "nitro";
import type { VoiceListResponse } from "../../../shared/schemas/contracts";
import { voiceBank } from "../../lib/voicebank";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Voices"
    ],
    "summary": "List enrolled speaker voices",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/VoiceListResponse"
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

export default defineHandler(() => ({ voices: voiceBank.listVoices() }) satisfies VoiceListResponse);

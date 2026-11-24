import { defineHandler, defineRouteMeta } from "nitro";
import type { ConklinPromptResponse } from "../../../shared/schemas/contracts";
import { CONKLIN_DIALOGUE_MAPPING_SYSTEM_PROMPT } from "../../lib/prompt";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Mapper"
    ],
    "summary": "Conklin dialogue mapping system prompt and key endpoints for agents",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ConklinPromptResponse"
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
  () =>
    ({
      methodology: "Jeffrey Conklin's Dialogue Mapping (IBIS)",
      systemPrompt: CONKLIN_DIALOGUE_MAPPING_SYSTEM_PROMPT,
      openApi: "/_openapi.json",
      swaggerUi: "/_swagger",
      endpoints: {
        createSession: "POST /api/sessions",
        getSession: "GET /api/sessions/:id",
        liveEventsSSE: "GET /api/sessions/:id/events",
        transcribeFile: "POST /api/sessions/:id/transcribe",
        appendTurns: "POST /api/sessions/:id/turns",
        applyMapOps: "POST /api/sessions/:id/map/ops",
        analyzeTurns: "POST /api/sessions/:id/map/analyze",
      },
    }) satisfies ConklinPromptResponse
);

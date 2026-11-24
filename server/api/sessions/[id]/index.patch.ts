import { defineHandler, defineRouteMeta } from "nitro";
import { SessionInputSchema, type SessionResponse } from "../../../../shared/schemas/contracts";
import { fail, param, parseBody } from "../../../http";
import { sessionStore } from "../../../store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Sessions"
    ],
    "summary": "Update session title, focus, auto-map, or speech models",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/SessionInput"
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
  const body = await parseBody(event, SessionInputSchema);
  if (body instanceof Response) return body;
  const updated = sessionStore.updateSessionMeta(param(event, "id"), body);
  if (!updated) return fail(404, "Session not found");
  return { session: updated } satisfies SessionResponse;
});

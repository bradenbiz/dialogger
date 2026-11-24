import { defineHandler, defineRouteMeta } from "nitro";
import { MapAnalyzeRequestSchema, type SessionResponse } from "../../../../../shared/schemas/contracts";
import { fail, getSessionParam, parseBody } from "../../../../lib/http";
import { enqueueMapRun } from "../../../../lib/jobs";
import { sessionStore } from "../../../../lib/store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Map"
    ],
    "summary": "Run the mapper over unmapped turns (or remap everything)",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/MapAnalyzeRequest"
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
  const session = getSessionParam(event);
  if (!session) return fail(404, "Session not found");
  const body = await parseBody(event, MapAnalyzeRequestSchema);
  if (body instanceof Response) return body;
  if (body.remapAll) {
    sessionStore.resetMap(session.id);
  }
  await enqueueMapRun(session.id, { force: true });
  return { session: sessionStore.getSession(session.id) ?? session } satisfies SessionResponse;
});

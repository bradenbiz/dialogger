import { defineHandler, defineRouteMeta } from "nitro";
import { IBISOpBatchSchema, type ApplyMapOpsResponse } from "../../../../../shared/api";
import { fail, getSessionParam, parseBody } from "../../../../http";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Map"
    ],
    "summary": "Apply IBIS map operations directly (add/update/move/delete nodes, cross-links, host context)",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/IBISOpBatch"
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
              "$ref": "#/components/schemas/ApplyMapOpsResponse"
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
  const body = await parseBody(event, IBISOpBatchSchema);
  if (body instanceof Response) return body;
  return sessionStore.applyMapOps(session.id, body) satisfies ApplyMapOpsResponse;
});

import { defineHandler, defineRouteMeta } from "nitro";
import { AppendTurnsRequestSchema, type AppendTurnsResponse } from "../../../../../shared/schemas/contracts";
import { fail, getSessionParam, json, parseBody } from "../../../../lib/http";
import { runAutoMap } from "../../../../lib/jobs";
import { sessionStore } from "../../../../lib/store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Transcript"
    ],
    "summary": "Append transcript turns (from a human, agent, or model)",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/AppendTurnsRequest"
          }
        }
      }
    },
    "responses": {
      "201": {
        "description": "Created",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/AppendTurnsResponse"
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

  const body = await parseBody(event, AppendTurnsRequestSchema);
  if (body instanceof Response) return body;

  const list = body.turns || (body.turn ? [body.turn] : []);
  if (list.length === 0) return fail(400, "Provide 'turn' or 'turns' array");

  const added = sessionStore.appendTurns(session.id, list);
  if (body.autoMap ?? session.autoMap) {
    await runAutoMap(session.id);
  }
  return json(201, {
    added,
    session: sessionStore.getSession(session.id) ?? session,
  } satisfies AppendTurnsResponse);
});

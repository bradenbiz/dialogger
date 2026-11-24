import { defineHandler, defineRouteMeta } from "nitro";
import { SessionInputSchema, type SessionResponse } from "../../../shared/api";
import { json, parseBody } from "../../http";
import { sessionStore } from "../../store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Sessions"
    ],
    "summary": "Create a session",
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
      "201": {
        "description": "Created",
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
      }
    }
  },
});

export default defineHandler(async (event) => {
  const body = await parseBody(event, SessionInputSchema);
  if (body instanceof Response) return body;
  return json(201, { session: sessionStore.createSession(body) } satisfies SessionResponse);
});

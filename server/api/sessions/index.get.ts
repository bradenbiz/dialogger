import { defineHandler, defineRouteMeta } from "nitro";
import type { SessionListResponse } from "../../../shared/schemas/contracts";
import { sessionStore } from "../../store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Sessions"
    ],
    "summary": "List sessions, most recently updated first",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/SessionListResponse"
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
  () => ({ sessions: sessionStore.listSessions() }) satisfies SessionListResponse
);

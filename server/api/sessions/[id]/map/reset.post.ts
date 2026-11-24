import { defineHandler, defineRouteMeta } from "nitro";
import type { SessionResponse } from "../../../../../shared/schemas/contracts";
import { fail, param } from "../../../../lib/http";
import { sessionStore } from "../../../../lib/store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Map"
    ],
    "summary": "Clear the dialogue map, keeping the transcript",
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

export default defineHandler((event) => {
  const session = sessionStore.resetMap(param(event, "id"));
  if (!session) return fail(404, "Session not found");
  return { session } satisfies SessionResponse;
});

import { defineHandler, defineRouteMeta } from "nitro";
import type { DeletedResponse } from "../../../../shared/api";
import { fail, param } from "../../../http";
import { cancelActiveTranscribe } from "../../../jobs";
import { sessionStore } from "../../../store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Sessions"
    ],
    "summary": "Delete a session",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/DeletedResponse"
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
  const id = param(event, "id");
  cancelActiveTranscribe(id);
  if (!sessionStore.deleteSession(id)) return fail(404, "Session not found");
  return { deleted: true } satisfies DeletedResponse;
});

import { defineHandler, defineRouteMeta } from "nitro";
import type { StoppedResponse } from "../../../../../shared/api";
import { param } from "../../../../http";
import { stopDemo } from "../../../../jobs";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Demo"
    ],
    "summary": "Stop the demo replay",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/StoppedResponse"
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

export default defineHandler((event) => {
  const id = param(event, "id");
  stopDemo(id);
  sessionStore.broadcast(id, { type: "speech.status", state: "idle" });
  return { stopped: true } satisfies StoppedResponse;
});

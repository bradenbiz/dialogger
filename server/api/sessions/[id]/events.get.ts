import { defineHandler, defineRouteMeta } from "nitro";
import { createEventStream } from "nitro/h3";
import type { SessionSSEEvent } from "../../../../shared/schemas/events";
import { fail, getSessionParam } from "../../../lib/http";
import { sessionStore } from "../../../lib/store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Sessions"
    ],
    "summary": "Server-sent event stream of live session updates",
    "description": "Each `data:` line is a JSON `SessionEvent`. The first event is always `session.snapshot`. A comment ping is sent every 15 seconds.",
    "responses": {
      "200": {
        "description": "text/event-stream of `SessionEvent` JSON payloads",
        "content": {
          "text/event-stream": {
            "schema": {
              "$ref": "#/components/schemas/SessionEvent"
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
  const session = getSessionParam(event);
  if (!session) return fail(404, "Session not found");

  const stream = createEventStream(event);
  const send = (data: SessionSSEEvent) => void stream.push(JSON.stringify(data));

  send({ type: "session.snapshot", session });
  const unsubscribe = sessionStore.subscribe(session.id, send);
  const keepAlive = setInterval(() => {
    void stream.pushComment(`ping ${Date.now()}`);
  }, 15_000);

  stream.onClosed(() => {
    clearInterval(keepAlive);
    unsubscribe();
  });
  event.res.headers.set("x-accel-buffering", "no");
  return stream.send();
});

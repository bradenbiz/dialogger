import { defineHandler, defineRouteMeta } from "nitro";
import { DemoStartRequestSchema, type DemoStartResponse } from "../../../../../shared/api";
import { WICKED_PROBLEM_DEMO_BEATS, WICKED_PROBLEM_DEMO_TITLE } from "../../../../../shared/demo-conversation";
import { fail, getSessionParam, parseBody } from "../../../../http";
import { clearDemoTimers, setDemoTimers, stopDemo } from "../../../../jobs";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Demo"
    ],
    "summary": "Replay the built-in wicked-problem demo conversation into the session",
    "description": "Clears the session first. With `instant: true` all turns land at once; otherwise they stream in on a timer.",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/DemoStartRequest"
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
              "$ref": "#/components/schemas/DemoStartResponse"
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

  const body = await parseBody(event, DemoStartRequestSchema);
  if (body instanceof Response) return body;

  stopDemo(session.id);
  const instant = Boolean(body.instant);
  const intervalMs = Math.max(400, Math.min(8000, Number(body.intervalMs || 1850)));

  // Reset to clean slate for the demo
  session.turns = [];
  session.speakers = [];
  session.nodes = [];
  session.crossLinks = [];
  session.hostContext = [];
  session.activity = [];
  sessionStore.updateSessionMeta(session.id, {
    title: WICKED_PROBLEM_DEMO_TITLE,
    rootFocus: "How should we run transcription & diarization for sensitive meetings?",
  });
  sessionStore.broadcast(session.id, { type: "session.snapshot", session });

  const playBeat = (idx: number) => {
    const beat = WICKED_PROBLEM_DEMO_BEATS[idx];
    if (!beat || !sessionStore.getSession(session.id)) return;

    const [turn] = sessionStore.appendTurns(session.id, [
      {
        speakerChannel: beat.speakerChannel,
        speakerName: beat.speakerName,
        speakerRole: beat.speakerRole,
        text: beat.text,
        startSec: beat.startSec,
        endSec: beat.endSec,
        overlap: beat.overlap,
        overlapWith: beat.overlapWithChannels?.map((c) => `speaker_${c}`),
        source: "demo",
        mapped: true,
      },
    ]);

    sessionStore.applyMapOps(session.id, {
      actor: "model",
      summary: beat.activitySummary,
      markTurnIdsMapped: [turn.id],
      ops: beat.ops.map((op) =>
        op.op === "add_node"
          ? { ...op, turnIds: [turn.id], speakerIds: [turn.speakerId] }
          : op
      ),
    });
  };

  const beats = WICKED_PROBLEM_DEMO_BEATS.length;
  if (instant) {
    WICKED_PROBLEM_DEMO_BEATS.forEach((_, i) => playBeat(i));
    return { started: true, instant: true, beats } satisfies DemoStartResponse;
  }

  const timers = WICKED_PROBLEM_DEMO_BEATS.map((_, idx) =>
    setTimeout(() => {
      playBeat(idx);
      if (idx === beats - 1) {
        clearDemoTimers(session.id);
        sessionStore.broadcast(session.id, { type: "speech.status", state: "idle" });
      }
    }, idx * intervalMs + 250)
  );
  setDemoTimers(session.id, timers);
  sessionStore.broadcast(session.id, {
    type: "speech.status",
    state: "listening",
    message: "Live demo conversation streaming…",
  });

  return { started: true, instant: false, beats } satisfies DemoStartResponse;
});

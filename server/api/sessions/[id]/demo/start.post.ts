import { defineHandler, defineRouteMeta } from "nitro";
import { readBody } from "nitro/h3";
import { WICKED_PROBLEM_DEMO_BEATS, WICKED_PROBLEM_DEMO_TITLE } from "../../../../../shared/demo-conversation";
import { fail, getSessionParam } from "../../../../http";
import { clearDemoTimers, setDemoTimers, stopDemo } from "../../../../jobs";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Demo"],
    summary: "Replay the built-in wicked-problem demo conversation into the session",
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              instant: { type: "boolean" },
              intervalMs: { type: "integer", minimum: 400, maximum: 8000, default: 1850 },
            },
          },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const session = getSessionParam(event);
  if (!session) return fail(404, "Session not found");

  stopDemo(session.id);

  const body = await readBody<{ instant?: unknown; intervalMs?: unknown }>(event);
  const instant = Boolean(body?.instant);
  const intervalMs = Math.max(400, Math.min(8000, Number(body?.intervalMs || 1850)));

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

  if (instant) {
    WICKED_PROBLEM_DEMO_BEATS.forEach((_, i) => playBeat(i));
    return { started: true, instant: true, beats: WICKED_PROBLEM_DEMO_BEATS.length };
  }

  const timers = WICKED_PROBLEM_DEMO_BEATS.map((_, idx) =>
    setTimeout(() => {
      playBeat(idx);
      if (idx === WICKED_PROBLEM_DEMO_BEATS.length - 1) {
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

  return { started: true, instant: false, beats: WICKED_PROBLEM_DEMO_BEATS.length };
});

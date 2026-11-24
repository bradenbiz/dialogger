import { defineHandler, defineRouteMeta } from "nitro";
import { createEventStream } from "nitro/h3";
import { fail, getSessionParam } from "../../../http";
import { sessionStore } from "../../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Sessions"],
    summary: "Server-sent event stream of live session updates",
    responses: { 200: { description: "text/event-stream of session events", content: { "text/event-stream": {} } } },
  },
});

export default defineHandler((event) => {
  const session = getSessionParam(event);
  if (!session) return fail(404, "Session not found");

  const stream = createEventStream(event);
  const send = (data: unknown) => void stream.push(JSON.stringify(data));

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

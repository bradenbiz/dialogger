import { defineHandler, defineRouteMeta } from "nitro";
import { param } from "../../../../http";
import { stopDemo } from "../../../../jobs";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Demo"], summary: "Stop the demo replay",
  },
});

export default defineHandler((event) => {
  const id = param(event, "id");
  stopDemo(id);
  sessionStore.broadcast(id, { type: "speech.status", state: "idle" });
  return { stopped: true };
});

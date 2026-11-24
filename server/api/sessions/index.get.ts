import { defineHandler, defineRouteMeta } from "nitro";
import { sessionStore } from "../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Sessions"], summary: "List sessions",
  },
});

export default defineHandler(() => ({ sessions: sessionStore.listSessions() }));

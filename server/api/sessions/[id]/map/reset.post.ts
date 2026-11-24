import { defineHandler, defineRouteMeta } from "nitro";
import { fail, param } from "../../../../http";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Map"], summary: "Clear the dialogue map, keeping the transcript",
  },
});

export default defineHandler((event) => {
  const session = sessionStore.resetMap(param(event, "id"));
  if (!session) return fail(404, "Session not found");
  return { session };
});

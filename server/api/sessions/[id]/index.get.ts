import { defineHandler, defineRouteMeta } from "nitro";
import { fail, getSessionParam } from "../../../http";

defineRouteMeta({
  openAPI: {
    tags: ["Sessions"], summary: "Get a session with its transcript and map",
  },
});

export default defineHandler((event) => {
  const session = getSessionParam(event);
  if (!session) return fail(404, "Session not found");
  return { session };
});

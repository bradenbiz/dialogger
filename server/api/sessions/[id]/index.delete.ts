import { defineHandler, defineRouteMeta } from "nitro";
import { fail, param } from "../../../http";
import { cancelActiveTranscribe } from "../../../jobs";
import { sessionStore } from "../../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Sessions"], summary: "Delete a session",
  },
});

export default defineHandler((event) => {
  const id = param(event, "id");
  cancelActiveTranscribe(id);
  if (!sessionStore.deleteSession(id)) return fail(404, "Session not found");
  return { deleted: true };
});

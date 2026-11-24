import { defineHandler, defineRouteMeta } from "nitro";
import { readBody } from "nitro/h3";
import { fail, getSessionParam } from "../../../../http";
import { enqueueMapRun } from "../../../../jobs";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Map"],
    summary: "Run the mapper over unmapped turns (or remap everything)",
    requestBody: {
      content: {
        "application/json": { schema: { type: "object", properties: { remapAll: { type: "boolean" } } } },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const session = getSessionParam(event);
  if (!session) return fail(404, "Session not found");
  const body = await readBody<{ remapAll?: unknown }>(event);
  if (body?.remapAll) {
    sessionStore.resetMap(session.id);
  }
  await enqueueMapRun(session.id, { force: true });
  return { session: sessionStore.getSession(session.id) };
});

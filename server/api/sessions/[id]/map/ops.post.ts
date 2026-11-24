import { defineHandler, defineRouteMeta } from "nitro";
import { readBody } from "nitro/h3";
import { IBISOpBatchSchema } from "../../../../../shared/ibis";
import { fail, getSessionParam } from "../../../../http";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Map"],
    summary: "Apply IBIS map operations directly (add/update/link/remove nodes)",
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["ops"],
            properties: {
              actor: { type: "string" },
              summary: { type: "string" },
              markTurnIdsMapped: { type: "array", items: { type: "string" } },
              ops: { type: "array", items: { type: "object" } },
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
  const parsed = IBISOpBatchSchema.safeParse(await readBody(event));
  if (!parsed.success) return fail(400, parsed.error.flatten());
  return sessionStore.applyMapOps(session.id, parsed.data);
});

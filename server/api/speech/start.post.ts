import { defineHandler, defineRouteMeta } from "nitro";
import { readBody } from "nitro/h3";
import { fail } from "../../http";
import { speechEngine } from "../../speech";

defineRouteMeta({
  openAPI: {
    tags: ["Speech"],
    summary: "Start the local streaming speech server",
    requestBody: {
      content: {
        "application/json": {
          schema: { type: "object", properties: { asrModel: { type: "string" }, diarModel: { type: "string" } } },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  try {
    const body = await readBody<{ asrModel?: unknown; diarModel?: unknown }>(event);
    const asrModel = typeof body?.asrModel === "string" ? body.asrModel : undefined;
    const diarModel = typeof body?.diarModel === "string" ? body.diarModel : undefined;
    await speechEngine.ensureStreamingServer({ asrModel, diarModel });
    return await speechEngine.getStatus();
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : String(err));
  }
});

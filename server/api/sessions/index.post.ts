import { defineHandler, defineRouteMeta } from "nitro";
import { readBody } from "nitro/h3";
import { z } from "zod";
import { fail, json } from "../../http";
import { sessionStore } from "../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Sessions"],
    summary: "Create a session",
    requestBody: { content: { "application/json": {
          schema: {
            type: "object",
            properties: {
              title: { type: "string", maxLength: 160 },
              rootFocus: { type: "string", maxLength: 300 },
              autoMap: { type: "boolean" },
              speechConfig: {
                type: "object",
                properties: {
                  streamingAsrModel: { type: "string" },
                  offlineAsrModel: { type: "string" },
                  diarizationModel: { type: "string" },
                },
              },
            },
          },
        } } },
  },
});

const schema = z.object({
  title: z.string().max(160).optional(),
  rootFocus: z.string().max(300).optional(),
  autoMap: z.boolean().optional(),
  speechConfig: z
    .object({
      streamingAsrModel: z.string().optional(),
      offlineAsrModel: z.string().optional(),
      diarizationModel: z.string().optional(),
    })
    .optional(),
});

export default defineHandler(async (event) => {
  const parsed = schema.safeParse((await readBody(event)) || {});
  if (!parsed.success) return fail(400, parsed.error.flatten());
  return json(201, { session: sessionStore.createSession(parsed.data) });
});

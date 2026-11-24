import { defineHandler, defineRouteMeta } from "nitro";
import { readBody } from "nitro/h3";
import { z } from "zod";
import { fail, getSessionParam, json } from "../../../../http";
import { runAutoMap } from "../../../../jobs";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Transcript"],
    summary: "Append transcript turns (from a human, agent, or model)",
    description: "Send either `turn` or `turns`. Turns are auto-mapped unless `autoMap` is false.",
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              turn: { $ref: "#/components/schemas/TurnInput" },
              turns: { type: "array", items: { $ref: "#/components/schemas/TurnInput" } },
              autoMap: { type: "boolean" },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          TurnInput: {
            type: "object",
            required: ["text"],
            properties: {
              id: { type: "string" },
              speakerId: { type: "string" },
              speakerChannel: { type: "integer", minimum: 1, maximum: 16 },
              speakerName: { type: "string", maxLength: 64 },
              speakerRole: { type: "string", maxLength: 64 },
              text: { type: "string" },
              startSec: { type: "number", minimum: 0 },
              endSec: { type: "number", minimum: 0 },
              overlap: { type: "boolean" },
              overlapWith: { type: "array", items: { type: "string" } },
              source: { type: "string", enum: ["live", "file", "agent", "manual", "demo"], default: "agent" },
            },
          },
        },
      },
    },
  },
});

const turnSchema = z.object({
  id: z.string().optional(),
  speakerId: z.string().optional(),
  speakerChannel: z.number().int().min(1).max(16).optional(),
  speakerName: z.string().max(64).optional(),
  speakerRole: z.string().max(64).optional(),
  text: z.string().min(1),
  startSec: z.number().nonnegative().optional(),
  endSec: z.number().nonnegative().optional(),
  overlap: z.boolean().optional(),
  overlapWith: z.array(z.string()).optional(),
  source: z.enum(["live", "file", "agent", "manual", "demo"]).default("agent"),
});

const bodySchema = z.object({
  turns: z.array(turnSchema).optional(),
  turn: turnSchema.optional(),
  autoMap: z.boolean().optional(),
});

export default defineHandler(async (event) => {
  const session = getSessionParam(event);
  if (!session) return fail(404, "Session not found");

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) return fail(400, parsed.error.flatten());

  const list = parsed.data.turns || (parsed.data.turn ? [parsed.data.turn] : []);
  if (list.length === 0) return fail(400, "Provide 'turn' or 'turns' array");

  const added = sessionStore.appendTurns(session.id, list);
  if (parsed.data.autoMap ?? session.autoMap) {
    await runAutoMap(session.id);
  }
  return json(201, { added, session: sessionStore.getSession(session.id) });
});

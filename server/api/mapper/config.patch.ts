import { defineHandler, defineRouteMeta } from "nitro";
import { readBody } from "nitro/h3";
import { z } from "zod";
import { isOwnerRequest } from "../../auth";
import { fail } from "../../http";
import { dialogueMapper } from "../../mapper";

defineRouteMeta({
  openAPI: {
    tags: ["Mapper"],
    summary: "Update the dialogue mapper configuration (owner only)",
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["llm", "heuristic", "agent-only"] },
              provider: {
                type: "string",
                enum: ["claude-cli", "codex-cli", "openai-compatible", "anthropic", "heuristic"],
              },
              baseUrl: { type: "string" },
              model: { type: "string" },
              apiKey: { type: "string" },
            },
          },
        },
      },
    },
  },
});

const schema = z.object({
  mode: z.enum(["llm", "heuristic", "agent-only"]).optional(),
  provider: z
    .enum(["claude-cli", "codex-cli", "openai-compatible", "anthropic", "heuristic"])
    .optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
});

export default defineHandler(async (event) => {
  if (!isOwnerRequest(event)) {
    return fail(403, "Owner authentication required to modify mapper settings");
  }
  const parsed = schema.safeParse(await readBody(event));
  if (!parsed.success) return fail(400, parsed.error.flatten());
  return dialogueMapper.updateConfig(parsed.data);
});

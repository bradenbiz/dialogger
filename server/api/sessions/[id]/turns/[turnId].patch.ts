import { defineHandler, defineRouteMeta } from "nitro";
import { readBody } from "nitro/h3";
import { z } from "zod";
import { fail, param } from "../../../../http";
import { sessionStore } from "../../../../store";
import { voiceBank } from "../../../../voicebank";

defineRouteMeta({
  openAPI: {
    tags: ["Transcript"],
    summary: "Edit a turn or reassign its speaker (enrolls that snippet as a voice sample)",
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              speakerId: { type: "string" },
              speakerChannel: { type: "integer", minimum: 1, maximum: 16 },
              speakerName: { type: "string", maxLength: 64 },
              speakerRole: { type: "string", maxLength: 64 },
              text: { type: "string" },
            },
          },
        },
      },
    },
  },
});

const schema = z.object({
  speakerId: z.string().min(1).optional(),
  speakerChannel: z.number().int().min(1).max(16).optional(),
  speakerName: z.string().min(1).max(64).optional(),
  speakerRole: z.string().max(64).optional(),
  text: z.string().min(1).optional(),
});

export default defineHandler(async (event) => {
  const parsed = schema.safeParse((await readBody(event)) || {});
  if (!parsed.success) return fail(400, parsed.error.flatten());

  const sessionId = param(event, "id");
  const updated = sessionStore.updateTurn(sessionId, param(event, "turnId"), parsed.data);
  if (!updated) return fail(404, "Session or turn not found");

  // Enroll this exact snippet into the persistent voicebank so future recordings recognize this person
  let voiceEnrolled = false;
  const audioPath = sessionStore.getAudioFilePath(sessionId);
  if (audioPath && updated.turn.endSec - updated.turn.startSec >= 1.2) {
    const enrolled = await voiceBank.enrollFromAudioSnippet({
      name: updated.speaker.name,
      audioPath,
      startSec: updated.turn.startSec,
      endSec: updated.turn.endSec,
    });
    if (enrolled) {
      voiceEnrolled = true;
      sessionStore.markSpeakerVoiceEnrolled(sessionId, updated.speaker.id, true);
    }
  }

  return { ...updated, voiceEnrolled, session: sessionStore.getSession(sessionId) };
});

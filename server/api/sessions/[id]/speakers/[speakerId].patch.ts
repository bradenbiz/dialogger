import { defineHandler, defineRouteMeta } from "nitro";
import { readBody } from "nitro/h3";
import { z } from "zod";
import { fail, param } from "../../../../http";
import { sessionStore } from "../../../../store";
import { voiceBank } from "../../../../voicebank";

defineRouteMeta({
  openAPI: {
    tags: ["Speakers"],
    summary: "Rename a speaker (also enrolls their voice from their cleanest turn)",
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string", maxLength: 64 }, role: { type: "string", maxLength: 64 } },
          },
        },
      },
    },
  },
});

const schema = z.object({
  name: z.string().min(1).max(64),
  role: z.string().max(64).optional(),
});

export default defineHandler(async (event) => {
  const parsed = schema.safeParse((await readBody(event)) || {});
  if (!parsed.success) return fail(400, parsed.error.flatten());
  const sessionId = param(event, "id");
  const speaker = sessionStore.renameSpeaker(
    sessionId,
    param(event, "speakerId"),
    parsed.data.name,
    parsed.data.role
  );
  if (!speaker) return fail(404, "Session not found");

  // Auto-enroll speaker voice seed from their cleanest turn if session has audio
  const session = sessionStore.getSession(sessionId);
  const audioPath = sessionStore.getAudioFilePath(sessionId);
  if (session && audioPath) {
    const best = session.turns
      .filter((t) => t.speakerId === speaker.id && !t.overlap && t.endSec - t.startSec >= 1.5)
      .sort((a, b) => b.endSec - b.startSec - (a.endSec - a.startSec))[0];
    if (best) {
      const enrolled = await voiceBank.enrollFromAudioSnippet({
        name: speaker.name,
        audioPath,
        startSec: best.startSec,
        endSec: best.endSec,
      });
      if (enrolled) {
        sessionStore.markSpeakerVoiceEnrolled(session.id, speaker.id, true);
      }
    }
  }

  return { speaker: session?.speakers.find((s) => s.id === speaker.id) || speaker };
});

import { defineHandler, defineRouteMeta } from "nitro";
import { fail, param } from "../../http";
import { voiceBank } from "../../voicebank";

defineRouteMeta({
  openAPI: {
    tags: ["Voices"], summary: "Delete an enrolled voice",
  },
});

export default defineHandler((event) => {
  if (!voiceBank.deleteVoice(param(event, "id"))) {
    return fail(404, "Voice not found");
  }
  return { deleted: true, voices: voiceBank.listVoices() };
});

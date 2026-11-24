import { defineHandler, defineRouteMeta } from "nitro";
import { voiceBank } from "../../voicebank";

defineRouteMeta({
  openAPI: {
    tags: ["Voices"], summary: "List enrolled speaker voices",
  },
});

export default defineHandler(() => ({ voices: voiceBank.listVoices() }));

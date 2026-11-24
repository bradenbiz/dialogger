import { defineHandler, defineRouteMeta } from "nitro";
import { fail } from "../../http";
import { speechEngine } from "../../speech";

defineRouteMeta({
  openAPI: {
    tags: ["Speech"], summary: "Local speech runtime status (nemo-speech, ffmpeg, cached models)",
  },
});

export default defineHandler(async () => {
  try {
    return await speechEngine.getStatus();
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : String(err));
  }
});

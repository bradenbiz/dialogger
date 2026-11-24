import { defineHandler, defineRouteMeta } from "nitro";
import { param } from "../../../../http";
import { cancelActiveTranscribe } from "../../../../jobs";

defineRouteMeta({
  openAPI: {
    tags: ["Transcription"], summary: "Stop the running transcription, keeping everything mapped so far",
  },
});

export default defineHandler((event) => ({
  stopped: cancelActiveTranscribe(param(event, "id")),
}));

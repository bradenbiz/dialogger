import { defineHandler, defineRouteMeta } from "nitro";
import { dialogueMapper } from "../../mapper";

defineRouteMeta({
  openAPI: {
    tags: ["Mapper"], summary: "Get the dialogue mapper configuration",
  },
});

export default defineHandler(() => dialogueMapper.getPublicConfig());

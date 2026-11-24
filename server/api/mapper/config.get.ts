import { defineHandler, defineRouteMeta } from "nitro";
import type { MapperConfigInfo } from "../../../shared/schemas/events";
import { dialogueMapper } from "../../lib/mapper";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Mapper"
    ],
    "summary": "Get the dialogue mapper configuration",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/MapperConfig"
            }
          }
        }
      },
      "401": {
        "description": "Missing or invalid API key (only when DIALOGGER_API_KEY or DIALOGGER_OWNER_KEY is set)",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      }
    }
  },
});

export default defineHandler(() => dialogueMapper.getPublicConfig() satisfies MapperConfigInfo);

import { defineHandler, defineRouteMeta } from "nitro";
import { MapperConfigUpdateSchema } from "../../../shared/schemas/contracts";
import type { MapperConfigInfo } from "../../../shared/schemas/events";
import { isOwnerRequest } from "../../lib/auth";
import { fail, parseBody } from "../../lib/http";
import { dialogueMapper } from "../../lib/mapper";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Mapper"
    ],
    "summary": "Update the dialogue mapper configuration (owner only)",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/MapperConfigUpdate"
          }
        }
      }
    },
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
      "400": {
        "description": "Invalid request body",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
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
      },
      "403": {
        "description": "Owner authentication required",
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

export default defineHandler(async (event) => {
  if (!isOwnerRequest(event)) {
    return fail(403, "Owner authentication required to modify mapper settings");
  }
  const body = await parseBody(event, MapperConfigUpdateSchema);
  if (body instanceof Response) return body;
  return dialogueMapper.updateConfig(body) satisfies MapperConfigInfo;
});

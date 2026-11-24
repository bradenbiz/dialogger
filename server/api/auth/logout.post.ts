import { defineHandler, defineRouteMeta } from "nitro";
import type { OkResponse } from "../../../shared/schemas/contracts";
import { SESSION_COOKIE } from "../../lib/auth";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Auth"
    ],
    "summary": "Clear the session cookie",
    "responses": {
      "200": {
        "description": "OK",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/OkResponse"
            }
          }
        }
      }
    }
  },
});

export default defineHandler((event) => {
  event.res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
  return { ok: true } satisfies OkResponse;
});

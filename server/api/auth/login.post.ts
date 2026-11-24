import { defineHandler, defineRouteMeta } from "nitro";
import { getRequestProtocol } from "nitro/h3";
import { LoginRequestSchema, type LoginResponse } from "../../../shared/schemas/contracts";
import { API_KEY, OWNER_KEY, SESSION_COOKIE, computeSessionCookieToken, timingSafeEqualStr } from "../../lib/auth";
import { fail, parseBody } from "../../lib/http";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Auth"
    ],
    "summary": "Exchange an access token for a session cookie",
    "description": "Sets an HttpOnly `dialogger_session` cookie. Responds 401 with `Invalid access token` when the key doesn't match.",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/LoginRequest"
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
              "$ref": "#/components/schemas/LoginResponse"
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
      }
    }
  },
});

export default defineHandler(async (event) => {
  if (!API_KEY && !OWNER_KEY) {
    return { ok: true, authRequired: false } satisfies LoginResponse;
  }
  const body = await parseBody(event, LoginRequestSchema);
  if (body instanceof Response) return body;

  const token = body.apiKey.trim();
  let matchedSecret = "";
  if (OWNER_KEY && timingSafeEqualStr(token, OWNER_KEY)) {
    matchedSecret = OWNER_KEY;
  } else if (API_KEY && timingSafeEqualStr(token, API_KEY)) {
    matchedSecret = API_KEY;
  }
  if (!matchedSecret) {
    return fail(401, "Invalid access token");
  }
  const secure =
    getRequestProtocol(event, { xForwardedProto: true }) === "https" ? "; Secure" : "";
  event.res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${computeSessionCookieToken(matchedSecret)}; HttpOnly; SameSite=Lax; Path=/${secure}`
  );
  return { ok: true } satisfies LoginResponse;
});

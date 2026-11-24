import { defineHandler, defineRouteMeta } from "nitro";
import { getRequestProtocol, readBody } from "nitro/h3";
import { API_KEY, OWNER_KEY, SESSION_COOKIE, computeSessionCookieToken, timingSafeEqualStr } from "../../auth";
import { fail } from "../../http";

defineRouteMeta({
  openAPI: {
    tags: ["Auth"],
    summary: "Exchange an access token for a session cookie",
    requestBody: {
      content: {
        "application/json": {
          schema: { type: "object", required: ["apiKey"], properties: { apiKey: { type: "string" } } },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  if (!API_KEY && !OWNER_KEY) {
    return { ok: true, authRequired: false };
  }
  const body = await readBody<{ apiKey?: unknown }>(event);
  const token = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  let matchedSecret = "";
  if (OWNER_KEY && timingSafeEqualStr(token, OWNER_KEY)) {
    matchedSecret = OWNER_KEY;
  } else if (API_KEY && timingSafeEqualStr(token, API_KEY)) {
    matchedSecret = API_KEY;
  }
  if (!matchedSecret) {
    return fail(401, "Invalid access token");
  }
  const secure = getRequestProtocol(event, { xForwardedProto: true }) === "https" ? "; Secure" : "";
  event.res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${computeSessionCookieToken(matchedSecret)}; HttpOnly; SameSite=Lax; Path=/${secure}`
  );
  return { ok: true };
});

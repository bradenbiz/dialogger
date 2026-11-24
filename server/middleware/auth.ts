import { defineMiddleware, getQuery } from "nitro/h3";
import { isAuthorizedRequest } from "../auth";
import { fail } from "../http";

const PUBLIC_API_PATHS = new Set(["/api/health", "/api/auth/login", "/api/auth/logout"]);

/** Requires the API key (Bearer, session cookie, or ?api_key=) on /api routes when one is configured. */
export default defineMiddleware((event) => {
  const pathname = event.url.pathname;
  if (!pathname.startsWith("/api/") || PUBLIC_API_PATHS.has(pathname)) return;
  const { api_key } = getQuery(event);
  if (!isAuthorizedRequest(event.req.headers, typeof api_key === "string" ? api_key : undefined)) {
    return fail(401, "Unauthorized");
  }
});

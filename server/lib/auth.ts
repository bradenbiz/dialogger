import crypto from "node:crypto";
import { getRequestIP, type H3Event } from "nitro/h3";

export const HOST = process.env.DIALOGGER_HOST || "127.0.0.1";
export const API_KEY = (process.env.DIALOGGER_API_KEY || "").trim();
export const OWNER_KEY = (process.env.DIALOGGER_OWNER_KEY || "").trim();
export const ALLOW_UNAUTHENTICATED =
  process.env.DIALOGGER_ALLOW_UNAUTHENTICATED === "true";

export const SESSION_COOKIE = "dialogger_session";

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost"
  );
}

function isLoopbackRemote(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function computeSessionCookieToken(secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update("dialogger-session-v1")
    .digest("hex");
}

function parseCookieValue(
  cookieHeader: string | null,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function matchesSecret(
  headers: Headers,
  queryApiKey: string | null | undefined,
  expectedSecret: string
): boolean {
  if (!expectedSecret) return false;
  const authHeader = headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    if (timingSafeEqualStr(authHeader.slice(7).trim(), expectedSecret)) {
      return true;
    }
  }
  const cookieToken = parseCookieValue(headers.get("cookie"), SESSION_COOKIE);
  if (
    cookieToken &&
    timingSafeEqualStr(cookieToken, computeSessionCookieToken(expectedSecret))
  ) {
    return true;
  }
  if (queryApiKey && timingSafeEqualStr(queryApiKey.trim(), expectedSecret)) {
    return true;
  }
  return false;
}

/** Accepts a Bearer token, the session cookie, or an `api_key` query param. */
export function isAuthorizedRequest(
  headers: Headers,
  queryApiKey: string | null | undefined
): boolean {
  if (!API_KEY && !OWNER_KEY) return true;
  if (API_KEY && matchesSecret(headers, queryApiKey, API_KEY)) return true;
  if (OWNER_KEY && matchesSecret(headers, queryApiKey, OWNER_KEY)) return true;
  return false;
}

export function isOwnerRequest(event: H3Event): boolean {
  const headers = event.req.headers;
  if (OWNER_KEY) {
    const ownerHeader = headers.get("x-dialogger-owner-key");
    if (ownerHeader && timingSafeEqualStr(ownerHeader.trim(), OWNER_KEY)) {
      return true;
    }
    return matchesSecret(headers, undefined, OWNER_KEY);
  }
  if (API_KEY) {
    return isAuthorizedRequest(headers, undefined);
  }
  return isLoopbackRemote(getRequestIP(event)) || ALLOW_UNAUTHENTICATED;
}

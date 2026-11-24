import { getRouterParam, type H3Event } from "nitro/h3";
import { sessionStore } from "./store";

/** JSON error response in the `{ error }` shape the web client expects. */
export function fail(status: number, error: unknown): Response {
  return Response.json({ error }, { status });
}

/** JSON response with an explicit status code. */
export function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

export function param(event: H3Event, name: string): string {
  return decodeURIComponent(getRouterParam(event, name) || "");
}

export function getSessionParam(event: H3Event) {
  return sessionStore.getSession(param(event, "id"));
}

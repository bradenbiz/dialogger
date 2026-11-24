import { getRouterParam, readBody, type H3Event } from "nitro/h3";
import { z } from "zod";
import type { ErrorResponse } from "../shared/api";
import { sessionStore } from "./store";

/** JSON error response in the shared `ErrorResponse` shape. */
export function fail(status: number, error: ErrorResponse["error"]): Response {
  return Response.json({ error } satisfies ErrorResponse, { status });
}

/** JSON response with an explicit status code. */
export function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

/**
 * Reads the JSON body and validates it against a shared schema.
 * Returns the parsed data, or a 400 Response to return as-is.
 */
export async function parseBody<S extends z.ZodType>(
  event: H3Event,
  schema: S
): Promise<z.output<S> | Response> {
  let raw: unknown;
  try {
    raw = await readBody(event);
  } catch {
    return fail(400, "Request body is not valid JSON");
  }
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const { formErrors, fieldErrors } = z.flattenError(parsed.error);
    return fail(400, {
      formErrors,
      fieldErrors: fieldErrors as Record<string, string[]>,
    });
  }
  return parsed.data;
}

export function param(event: H3Event, name: string): string {
  return decodeURIComponent(getRouterParam(event, name) || "");
}

export function getSessionParam(event: H3Event) {
  return sessionStore.getSession(param(event, "id"));
}

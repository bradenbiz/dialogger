import { getRouterParam, readBody, type H3Event } from "nitro/h3";
import { z } from "zod";
import type { ErrorResponse } from "../../shared/schemas/contracts";
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

/** Largest audio/video upload the server accepts (same cap the Express server had). */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

class BodyTooLargeError extends Error {}

/**
 * Reads a multipart body, refusing anything over `maxBytes` with a 413.
 * `Request.formData()` holds the whole body in memory, so the size is checked from
 * Content-Length up front and counted while streaming (for chunked uploads).
 * Returns the form, or a Response to return as-is (400 when the body isn't a form).
 */
export async function readFormData(
  request: Request,
  maxBytes = MAX_UPLOAD_BYTES
): Promise<FormData | Response> {
  const tooLarge = () =>
    fail(413, `Upload is larger than ${Math.floor(maxBytes / (1024 * 1024))} MB`);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  if (!request.body) return fail(400, "Request body is not multipart form data");

  let received = 0;
  const limited = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) controller.error(new BodyTooLargeError());
        else controller.enqueue(chunk);
      },
    })
  );
  try {
    return await new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: limited,
      duplex: "half",
    } as RequestInit).formData();
  } catch (err) {
    if (err instanceof BodyTooLargeError || received > maxBytes) return tooLarge();
    return fail(400, "Request body is not multipart form data");
  }
}

export function param(event: H3Event, name: string): string {
  return decodeURIComponent(getRouterParam(event, name) || "");
}

export function getSessionParam(event: H3Event) {
  return sessionStore.getSession(param(event, "id"));
}

import { defineHandler, defineRouteMeta } from "nitro";
import fs from "node:fs";
import { Readable } from "node:stream";
import { fail, param } from "../../../../http";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    "tags": [
      "Audio"
    ],
    "summary": "Stream the session's audio (supports HTTP Range)",
    "responses": {
      "200": {
        "description": "The full MP3 (or `206 Partial Content` for a Range request; `416` for an unsatisfiable range)",
        "content": {
          "audio/mpeg": {
            "schema": {
              "type": "string",
              "format": "binary"
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
      "404": {
        "description": "No audio attached to this session",
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

function fileBody(audioPath: string, range?: { start: number; end: number }): BodyInit {
  return Readable.toWeb(fs.createReadStream(audioPath, range)) as unknown as ReadableStream;
}

export default defineHandler((event) => {
  const audioPath = sessionStore.getAudioFilePath(param(event, "id"));
  if (!audioPath) return fail(404, "No audio attached to this session");

  const fileSize = fs.statSync(audioPath).size;
  const headers = new Headers({
    "content-type": "audio/mpeg",
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });

  const range = event.req.headers.get("range");
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match?.[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
    if (start >= fileSize || end >= fileSize || start > end) {
      headers.set("content-range", `bytes */${fileSize}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("content-range", `bytes ${start}-${end}/${fileSize}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(fileBody(audioPath, { start, end }), { status: 206, headers });
  }

  headers.set("content-length", String(fileSize));
  return new Response(fileBody(audioPath), { status: 200, headers });
});

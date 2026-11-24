import { defineHandler, defineRouteMeta } from "nitro";
import { YouTubeInspectRequestSchema, type YouTubeInspectResponse } from "../../../shared/api";
import { fail, parseBody } from "../../http";
import { fetchYouTubeMetadata, hasYtDlp } from "../../youtube";

defineRouteMeta({
  openAPI: {
    "tags": [
      "YouTube"
    ],
    "summary": "Look up a public YouTube video's title, channel, and duration",
    "description": "Responds 400 when the URL isn't a public YouTube video or YouTube refuses the lookup.",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/YouTubeInspectRequest"
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
              "$ref": "#/components/schemas/YouTubeInspectResponse"
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
      "501": {
        "description": "yt-dlp is not installed on the server",
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
  const body = await parseBody(event, YouTubeInspectRequestSchema);
  if (body instanceof Response) return body;
  try {
    if (!(await hasYtDlp())) {
      return fail(501, "yt-dlp is not installed on this server.");
    }
    return { metadata: await fetchYouTubeMetadata(body.url.trim()) } satisfies YouTubeInspectResponse;
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : String(err));
  }
});

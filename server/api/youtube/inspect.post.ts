import { defineHandler, defineRouteMeta } from "nitro";
import { readBody } from "nitro/h3";
import { fail } from "../../http";
import { fetchYouTubeMetadata, hasYtDlp } from "../../youtube";

defineRouteMeta({
  openAPI: {
    tags: ["YouTube"],
    summary: "Look up a public YouTube video's title, channel, and duration",
    requestBody: {
      content: {
        "application/json": {
          schema: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
        },
      },
    },
  },
});

export default defineHandler(async (event) => {
  const body = await readBody<{ url?: unknown }>(event);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) return fail(400, "Missing 'url'");
  try {
    if (!(await hasYtDlp())) {
      return fail(501, "yt-dlp is not installed on this server.");
    }
    return { metadata: await fetchYouTubeMetadata(url) };
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : String(err));
  }
});

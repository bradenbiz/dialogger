import { defineRouteMeta } from "nitro";
import { defineWebSocketHandler } from "nitro/h3";
import { isAuthorizedRequest } from "../../../../auth";
import { startLiveAudioSession, type LiveSessionHandlers } from "../../../../live";
import { sessionStore } from "../../../../store";

defineRouteMeta({
  openAPI: {
    tags: ["Live"],
    summary: "WebSocket: stream 16 kHz mono PCM16 mic frames for live transcription",
    description:
      "Upgrade to a WebSocket and send binary PCM16 frames. Send `{\"type\":\"commit\"}` to end a segment or `{\"type\":\"clear\"}` to discard it. The server replies with `live.ready` / `live.error`; transcript and map updates arrive on the session's SSE stream.",
    responses: {
      101: { description: "Switching Protocols (WebSocket established)" },
      401: { description: "Missing or invalid API key (only when DIALOGGER_API_KEY is set)" },
      404: { description: "Session not found" },
    },
  },
});

const LIVE_PATH_RE = /^\/ws\/sessions\/([^/]+)\/live$/;
const liveSessions = new Map<string, LiveSessionHandlers>();

function sessionIdFromUrl(url: string): string | null {
  const match = new URL(url).pathname.match(LIVE_PATH_RE);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Live mic: browser streams 16 kHz PCM16 frames; server proxies to the local speech runtime. */
export default defineWebSocketHandler({
  upgrade(request) {
    const url = new URL(request.url);
    if (!isAuthorizedRequest(request.headers, url.searchParams.get("api_key"))) {
      return new Response("Unauthorized", { status: 401 });
    }
    const sessionId = sessionIdFromUrl(request.url);
    if (!sessionId || !sessionStore.getSession(sessionId)) {
      return new Response("Session not found", { status: 404 });
    }
  },
  open(peer) {
    const sessionId = sessionIdFromUrl(peer.request.url);
    if (!sessionId) {
      peer.close(1008, "Session not found");
      return;
    }
    const handlers = startLiveAudioSession(peer, sessionId);
    if (handlers) liveSessions.set(peer.id, handlers);
  },
  message(peer, message) {
    const raw = message.rawData;
    const data =
      typeof raw === "string" ? raw : Buffer.from(message.uint8Array());
    liveSessions.get(peer.id)?.onMessage(data);
  },
  close(peer) {
    liveSessions.get(peer.id)?.onClose();
    liveSessions.delete(peer.id);
  },
});

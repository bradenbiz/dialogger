import { definePlugin } from "nitro";
import {
  ALLOW_UNAUTHENTICATED,
  API_KEY,
  HOST,
  OWNER_KEY,
  isLoopbackHost,
} from "../lib/auth";
import { sessionStore } from "../lib/store";

export default definePlugin(() => {
  // The speech runtime and live mic use Node's global WebSocket (stable since Node 22.4)
  if (typeof globalThis.WebSocket !== "function") {
    console.error(
      `[dialogger] Node ${process.version} has no global WebSocket. Dialogger needs Node 22.4 or later.`
    );
    process.exit(1);
  }

  // Refuse to expose an unauthenticated server on non-loopback interfaces unless explicitly opted in (S1)
  if (!isLoopbackHost(HOST) && !API_KEY && !OWNER_KEY && !ALLOW_UNAUTHENTICATED) {
    console.error(
      `[dialogger] Refusing to bind to non-loopback host "${HOST}" without DIALOGGER_API_KEY. ` +
        `Set DIALOGGER_API_KEY (recommended), bind DIALOGGER_HOST=127.0.0.1, ` +
        `or set DIALOGGER_ALLOW_UNAUTHENTICATED=true on a private tailnet.`
    );
    process.exit(1);
  }

  // Seed one starter session if empty so the UI opens cleanly
  if (sessionStore.listSessions().length === 0) {
    sessionStore.createSession({ title: "New Dialogue Map" });
  }
});

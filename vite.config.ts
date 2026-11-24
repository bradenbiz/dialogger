import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import path from "node:path";

const PORT = Number(process.env.DIALOGGER_PORT || 4310);
const DEV_HOST = process.env.DIALOGGER_HOST || "127.0.0.1";

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost"
  );
}

export default defineConfig(({ command }) => {
  if (
    command === "serve" &&
    !isLoopbackHost(DEV_HOST) &&
    !(process.env.DIALOGGER_API_KEY || "").trim() &&
    !(process.env.DIALOGGER_OWNER_KEY || "").trim() &&
    process.env.DIALOGGER_ALLOW_UNAUTHENTICATED !== "true"
  ) {
    throw new Error(
      `[dialogger] Refusing to bind Vite dev server to non-loopback host "${DEV_HOST}" without DIALOGGER_API_KEY. ` +
        `Set DIALOGGER_API_KEY, bind DIALOGGER_HOST=127.0.0.1, or set DIALOGGER_ALLOW_UNAUTHENTICATED=true on a private tailnet.`
    );
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      nitro({
        serverDir: "./server",
        features: { websocket: true },
        experimental: { openAPI: true },
        openAPI: {
          meta: {
            title: "Dialogger API",
            description:
              "Local diarization and live Conklin IBIS dialogue mapping. Send `Authorization: Bearer <DIALOGGER_API_KEY>` when an API key is configured.",
            version: "1.0.0",
          },
          production: "runtime",
          ui: { swagger: { route: "/_swagger" }, scalar: false },
        },
      }),
    ],
    resolve: {
      alias: {
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@": path.resolve(import.meta.dirname, "src"),
        // React 19 has useSyncExternalStore built in; skip SWR's polyfill
        "use-sync-external-store/shim": path.resolve(
          import.meta.dirname,
          "src/lib/use-sync-external-store-shim.ts"
        ),
      },
    },
    server: {
      host: DEV_HOST,
      port: PORT,
      strictPort: true,
      allowedHosts: ["malta", ".tail6771a0.ts.net"],
      fs: {
        deny: [".dialogger-data", "**/.dialogger-data/**", ".env", ".env.*"],
      },
    },
  };
});

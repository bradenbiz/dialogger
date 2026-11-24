import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const API_PORT = Number(process.env.DIALOGGER_PORT || 4310);
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
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@shared": path.resolve(__dirname, "shared"),
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      host: DEV_HOST,
      port: 4311,
      allowedHosts: ["malta", ".tail6771a0.ts.net"],
      fs: {
        deny: [".dialogger-data", "**/.dialogger-data/**", ".env", ".env.*"],
      },
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${API_PORT}`,
          changeOrigin: true,
        },
        "/ws": {
          target: `ws://127.0.0.1:${API_PORT}`,
          ws: true,
        },
      },
    },
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
    },
  };
});

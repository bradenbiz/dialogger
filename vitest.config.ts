import path from "node:path";
import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so tests don't boot the Nitro server plugin.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});

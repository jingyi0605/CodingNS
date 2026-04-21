import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const appVersion = resolveAppVersion();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true
  }
});

function resolveAppVersion(): string {
  try {
    return readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
  } catch {
    return process.env.npm_package_version?.trim() || "0.0.0";
  }
}

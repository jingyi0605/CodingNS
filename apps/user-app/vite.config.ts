import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appVersion = readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
const hostApiTarget = "http://127.0.0.1:3002";
const hostWsTarget = "ws://127.0.0.1:3002";
const desktopAndLocalOrigins = [
  /^tauri:\/\/localhost$/,
  /^https?:\/\/tauri\.localhost$/,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https?:\/\/localhost(?::\d+)?$/
];

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 4174,
    allowedHosts: ["cns.jacksonz.cn"],
    // 桌面壳直连 Vite 代理时，POST JSON 会先走 OPTIONS 预检。
    // 不显式放行 tauri://localhost，登录请求会在浏览器层被拦掉。
    cors: {
      origin: desktopAndLocalOrigins,
      credentials: true,
      allowedHeaders: ["Authorization", "Content-Type"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    },
    proxy: {
      "/api": {
        target: hostApiTarget,
        changeOrigin: true
      },
      "/ws": {
        target: hostWsTarget,
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
        timeout: 60000,
        proxyTimeout: 60000
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true
  }
});

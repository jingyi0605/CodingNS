import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 4174,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3002",
        changeOrigin: true
      },
      "/ws": {
        target: "ws://127.0.0.1:3002",
        ws: true,
        changeOrigin: true
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true
  }
});

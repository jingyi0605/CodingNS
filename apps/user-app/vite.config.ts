import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  extractProxySlugFromPath,
  isLikelyDocumentNavigation,
  PROXY_SLUG_COOKIE_NAME,
  rewriteToProxyContext
} from "./src/config/proxy-context-redirect";

const appVersion = resolveAppVersion();
const hostApiTarget = "http://127.0.0.1:3002";
const hostWsTarget = "ws://127.0.0.1:3002";
const desktopAndLocalOrigins = [
  /^tauri:\/\/localhost$/,
  /^https?:\/\/tauri\.localhost$/,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https?:\/\/localhost(?::\d+)?$/
];

function setProxySlugCookie(response: {
  getHeader: (name: string) => number | string | string[] | undefined;
  setHeader: (name: string, value: number | string | ReadonlyArray<string>) => void;
}, proxySlug: string): void {
  const nextCookie = `${PROXY_SLUG_COOKIE_NAME}=${proxySlug}; Path=/; SameSite=Lax`;
  const existing = response.getHeader("Set-Cookie");

  if (!existing) {
    response.setHeader("Set-Cookie", nextCookie);
    return;
  }

  if (Array.isArray(existing)) {
    response.setHeader("Set-Cookie", [...existing, nextCookie]);
    return;
  }

  response.setHeader("Set-Cookie", [String(existing), nextCookie]);
}

function clearProxySlugCookie(response: {
  getHeader: (name: string) => number | string | string[] | undefined;
  setHeader: (name: string, value: number | string | ReadonlyArray<string>) => void;
}): void {
  const expiredCookie = `${PROXY_SLUG_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  const existing = response.getHeader("Set-Cookie");

  if (!existing) {
    response.setHeader("Set-Cookie", expiredCookie);
    return;
  }

  if (Array.isArray(existing)) {
    response.setHeader("Set-Cookie", [...existing, expiredCookie]);
    return;
  }

  response.setHeader("Set-Cookie", [String(existing), expiredCookie]);
}
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [
    react(),
    {
      name: "codingns-proxy-context-redirect",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const existingProxySlug = extractProxySlugFromPath(request.url);

          if (existingProxySlug) {
            setProxySlugCookie(response, existingProxySlug);
          }

          const isDocumentNavigation = isLikelyDocumentNavigation({
            method: request.method,
            fetchDestinationHeader: request.headers["sec-fetch-dest"],
            acceptHeader: request.headers.accept
          });

          if (isDocumentNavigation && !existingProxySlug) {
            // 用户主动回到主站页面时，清理历史代理上下文，避免 HMR/业务 WS 被错误改写。
            clearProxySlugCookie(response);
          }

          const rewrittenPath = rewriteToProxyContext({
            rawPath: request.url,
            refererHeader: request.headers.referer,
            cookieHeader: request.headers.cookie,
            // 页面导航不允许仅靠 Cookie 回写，避免用户直接访问 / 被劫持到历史代理上下文。
            allowCookieFallback: !isDocumentNavigation
          });

          if (!isDocumentNavigation) {
            if (!rewrittenPath) {
              next();
              return;
            }
            request.url = rewrittenPath;
            next();
            return;
          }

          if (!rewrittenPath) {
            next();
            return;
          }

          // 文档导航使用 307，保证地址栏维持在 /proxy/<slug> 路径空间。
          response.statusCode = 307;
          response.setHeader("Location", rewrittenPath);
          response.end();
        });

        const upgradeHandler = (request: { url?: string; headers: Record<string, string | string[] | undefined> }) => {
          const rewrittenPath = rewriteToProxyContext({
            rawPath: request.url,
            refererHeader: request.headers.referer,
            cookieHeader: request.headers.cookie,
            allowCookieFallback: true
          });

          if (!rewrittenPath) {
            return;
          }

          request.url = rewrittenPath;
        };

        server.httpServer?.prependListener("upgrade", upgradeHandler);
      }
    }
  ],
  server: {
    host: "0.0.0.0",
    port: 4174,
    allowedHosts: ["cns.jacksonz.cn","cns-app.jacksonz.cn","cns-dev.jacksonz.cn"],
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
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
        timeout: 60000,
        proxyTimeout: 60000
      },
      "/preview": {
        target: hostApiTarget,
        changeOrigin: true
      },
      // /proxy/* 必须直通 Host 的反向代理服务，不能落到前端路由守卫。
      "/proxy": {
        target: hostApiTarget,
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
        timeout: 60000,
        proxyTimeout: 60000
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

function resolveAppVersion(): string {
  try {
    return readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
  } catch {
    return process.env.npm_package_version?.trim() || "0.0.0";
  }
}

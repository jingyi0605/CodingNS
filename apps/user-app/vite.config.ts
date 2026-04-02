import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appVersion = readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
const hostApiTarget = "http://127.0.0.1:3002";
const hostWsTarget = "ws://127.0.0.1:3002";
const PROXY_SLUG_COOKIE_NAME = "cns_proxy_slug";
const desktopAndLocalOrigins = [
  /^tauri:\/\/localhost$/,
  /^https?:\/\/tauri\.localhost$/,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https?:\/\/localhost(?::\d+)?$/
];

function extractProxySlugFromReferer(referer: string | undefined): string | null {
  if (!referer) {
    return null;
  }

  try {
    const parsed = new URL(referer);
    const match = parsed.pathname.match(/^\/proxy\/([a-z0-9]+)(?:\/|$)/i);

    if (!match) {
      return null;
    }

    return match[1].toLowerCase();
  } catch {
    return null;
  }
}

function pickHeaderValue(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
}

function extractProxySlugFromPath(pathname: string | undefined): string | null {
  if (!pathname) {
    return null;
  }

  const match = pathname.match(/^\/proxy\/([a-z0-9]+)(?:\/|$)/i);

  if (!match) {
    return null;
  }

  return match[1].toLowerCase();
}

function extractProxySlugFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookiePairs = cookieHeader.split(";").map((item) => item.trim());
  const targetPrefix = `${PROXY_SLUG_COOKIE_NAME}=`;

  for (const pair of cookiePairs) {
    if (!pair.startsWith(targetPrefix)) {
      continue;
    }

    const value = pair.slice(targetPrefix.length).trim().toLowerCase();

    if (/^[a-z0-9]+$/.test(value)) {
      return value;
    }
  }

  return null;
}

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
        const rewriteToProxyContext = (
          rawPath: string | undefined,
          refererHeader: string | string[] | undefined,
          cookieHeader: string | string[] | undefined
        ): string | null => {
          const requestPath = rawPath ?? "/";

          if (!requestPath.startsWith("/") || requestPath.startsWith("/proxy/")) {
            return null;
          }

          const proxySlug =
            extractProxySlugFromReferer(pickHeaderValue(refererHeader))
            ?? extractProxySlugFromCookie(pickHeaderValue(cookieHeader));

          if (!proxySlug) {
            return null;
          }

          return `/proxy/${proxySlug}${requestPath}`;
        };

        server.middlewares.use((request, response, next) => {
          const existingProxySlug = extractProxySlugFromPath(request.url);

          if (existingProxySlug) {
            setProxySlugCookie(response, existingProxySlug);
          }

          const rewrittenPath = rewriteToProxyContext(
            request.url,
            request.headers.referer,
            request.headers.cookie
          );

          if (!rewrittenPath) {
            next();
            return;
          }

          const method = (request.method ?? "GET").toUpperCase();
          const fetchDestination = pickHeaderValue(request.headers["sec-fetch-dest"]);
          const isDocumentNavigation =
            (method === "GET" || method === "HEAD") && fetchDestination === "document";

          if (!isDocumentNavigation) {
            request.url = rewrittenPath;
            next();
            return;
          }

          // 文档导航使用 307，保证地址栏维持在 /proxy/<slug> 路径空间。
          response.statusCode = 307;
          response.setHeader("Location", rewrittenPath);
          response.end();
        });

        const upgradeHandler = (request: { url?: string; headers: Record<string, string | string[] | undefined> }) => {
          const rewrittenPath = rewriteToProxyContext(
            request.url,
            request.headers.referer,
            request.headers.cookie
          );

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

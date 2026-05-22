import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright-core";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];
const activeHttpServers: Array<ReturnType<typeof createHttpServer>> = [];

const browserExecutablePath = resolveChromiumExecutablePath();
const itIfBrowser = browserExecutablePath ? it : it.skip;

afterEach(async () => {
  while (activeHttpServers.length > 0) {
    const server = activeHttpServers.pop();

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  while (activeServers.length > 0) {
    const server = activeServers.pop();

    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("静态 HTML 预览 workspace bridge 浏览器级 e2e", () => {
  itIfBrowser("真实 iframe 里一次跑穿 readText/readTexts/writeText/deleteFile/watchDir", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    seedWorkspaceFiles(fixture.workspaceDir);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const previewLinkResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview-link?workspaceId=${workspaceId}&path=${encodeURIComponent("site/index.html")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewLinkResponse.statusCode).toBe(200);
    const previewPath = previewLinkResponse.json().previewPath as string;

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const hostedAddress = hosted.app.server.address();
    if (!hostedAddress || typeof hostedAddress === "string") {
      throw new Error("Host 测试服务器地址异常");
    }

    const hostBaseUrl = `http://127.0.0.1:${hostedAddress.port}`;
    const harness = await startPreviewHarnessServer();
    activeHttpServers.push(harness.server);

    const browser = await chromium.launch({
      executablePath: browserExecutablePath,
      headless: true
    });

    try {
      const page = await browser.newPage();
      const parentUrl = new URL("/", harness.baseUrl);
      parentUrl.searchParams.set("hostBase", hostBaseUrl);
      parentUrl.searchParams.set("accessToken", accessToken);
      parentUrl.searchParams.set("workspaceId", workspaceId);
      parentUrl.searchParams.set("previewPath", previewPath);

      await page.goto(parentUrl.toString(), {
        waitUntil: "domcontentloaded"
      });
      await page.waitForSelector("#preview-frame");

      const frameHandle = await page.locator("#preview-frame").elementHandle();
      const frame = await frameHandle?.contentFrame();

      if (!frame) {
        throw new Error("没有拿到 HTML 预览 iframe");
      }

      await frame.waitForFunction(
        () => typeof window.CodingNSWorkspace?.readText === "function",
        undefined,
        {
          timeout: 15_000
        }
      );

      const bridgeSnapshot = await frame.evaluate(async () => {
        const single = await window.CodingNSWorkspace.readText("重要信息/会员信息/91飞机场.md");
        const batch = await window.CodingNSWorkspace.readTexts([
          "重要信息/会员信息/91飞机场.md",
          "重要信息/会员信息/.会员索引.json"
        ]);

        await window.CodingNSWorkspace.writeText(
          "重要信息/会员信息/浏览器级E2E会员.md",
          "# 浏览器级 E2E 会员\n\n名称：浏览器级 E2E 会员\n",
          {
            createIfMissing: true,
            overwrite: true
          }
        );

        const written = await window.CodingNSWorkspace.readText("重要信息/会员信息/浏览器级E2E会员.md");
        await window.CodingNSWorkspace.deleteFile("重要信息/会员信息/浏览器级E2E会员.md");
        const existsAfterDelete = await window.CodingNSWorkspace.exists("重要信息/会员信息/浏览器级E2E会员.md");

        window.__bridgeWatchEvents = [];
        window.__bridgeWatchHandle = await window.CodingNSWorkspace.watchDir(
          "重要信息/会员信息",
          {
            kind: "file",
            includeHidden: true
          },
          (event) => {
            window.__bridgeWatchEvents.push(event);
          }
        );

        return {
          hasBridge: typeof window.CodingNSWorkspace?.readText === "function",
          bridgeProtocol: window.CodingNSWorkspace.bridgeProtocol,
          bridgeDebug: window.CodingNSWorkspace.debug,
          single,
          batch,
          written,
          existsAfterDelete,
          watchId: window.__bridgeWatchHandle.watchId
        };
      });

      expect(bridgeSnapshot.hasBridge).toBe(true);
      expect(bridgeSnapshot.bridgeProtocol.parentOrigin).toBe(harness.baseUrl);
      expect(bridgeSnapshot.bridgeDebug.lastRequestTargetOrigin).toBe(harness.baseUrl);
      expect(bridgeSnapshot.single.content).toContain("91飞机场");
      expect(bridgeSnapshot.batch.items).toHaveLength(2);
      expect(bridgeSnapshot.written.content).toContain("浏览器级 E2E 会员");
      expect(bridgeSnapshot.existsAfterDelete.exists).toBe(false);
      expect(bridgeSnapshot.watchId).toBeTruthy();

      expect(
        existsSync(path.join(fixture.workspaceDir, "重要信息", "会员信息", "浏览器级E2E会员.md"))
      ).toBe(false);

      writeFileSync(
        path.join(fixture.workspaceDir, "重要信息", "会员信息", "91飞机场.md"),
        "# 91飞机场\n\n名称：91飞机场\n\n来源：浏览器级 E2E\n",
        "utf8"
      );

      await frame.waitForFunction(
        () => Array.isArray(window.__bridgeWatchEvents)
          && window.__bridgeWatchEvents.some((event) =>
            event
            && event.path === "重要信息/会员信息/91飞机场.md"
            && (event.type === "changed" || event.type === "created")
          ),
        undefined,
        {
          timeout: 15_000
        }
      );

      const watchEvents = await frame.evaluate(async () => {
        const events = Array.isArray(window.__bridgeWatchEvents)
          ? window.__bridgeWatchEvents.slice()
          : [];
        if (window.__bridgeWatchHandle) {
          await window.__bridgeWatchHandle.unsubscribe();
        }
        return events;
      });

      expect(watchEvents.some((event: { path?: string }) => event.path === "重要信息/会员信息/91飞机场.md")).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

async function startPreviewHarnessServer(): Promise<{
  server: ReturnType<typeof createHttpServer>;
  baseUrl: string;
}> {
  const server = createHttpServer((request, response) => {
    handleHarnessRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Harness 测试服务器地址异常");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

function handleHarnessRequest(request: IncomingMessage, response: ServerResponse): void {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

  if (requestUrl.pathname !== "/") {
    response.statusCode = 404;
    response.end("Not Found");
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(buildHarnessHtml());
}

function buildHarnessHtml(): string {
  return String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>CodingNS Workspace Bridge Harness</title>
    <style>
      html, body { margin: 0; height: 100%; }
      body { display: flex; background: #111827; }
      iframe { flex: 1; border: 0; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <iframe
      id="preview-frame"
      title="preview"
      sandbox="allow-forms allow-modals allow-scripts allow-same-origin"
    ></iframe>
    <script>
      (function () {
        const params = new URLSearchParams(window.location.search);
        const hostBase = params.get("hostBase") || "";
        const accessToken = params.get("accessToken") || "";
        const workspaceId = params.get("workspaceId") || "";
        const previewPath = params.get("previewPath") || "";
        const iframe = document.getElementById("preview-frame");
        const iframeOrigin = hostBase ? new URL(hostBase).origin : "";
        const watchPollers = new Map();

        if (!hostBase || !accessToken || !workspaceId || !previewPath || !iframe) {
          document.body.innerHTML = "<pre>Harness 缺少必要参数</pre>";
          return;
        }

        iframe.src = new URL(previewPath, hostBase).toString();

        window.addEventListener("message", function (event) {
          if (event.source !== iframe.contentWindow) {
            return;
          }

          if (event.origin !== iframeOrigin) {
            return;
          }

          const request = event.data;
          if (!request || typeof request !== "object" || request.type !== "codingns.workspace.request") {
            return;
          }

          handleRequest(event, request).catch(function (error) {
            const detail = normalizeError(error);
            postResponse(event, {
              type: "codingns.workspace.response",
              id: request.id,
              ok: false,
              error: detail
            });
          });
        });

        async function handleRequest(event, request) {
          const payload = request.payload && typeof request.payload === "object" ? request.payload : {};
          let result;

          switch (request.action) {
            case "capabilities":
              result = await fetchJson("/api/files/workspace-bridge/capabilities?workspaceId=" + encodeURIComponent(workspaceId), {
                method: "GET"
              });
              break;
            case "listDir":
              result = await fetchJson("/api/files/workspace-bridge/list-dir", {
                method: "POST",
                body: JSON.stringify({
                  workspaceId,
                  path: typeof payload.path === "string" ? payload.path : "",
                  options: payload.options && typeof payload.options === "object" ? payload.options : undefined
                })
              });
              break;
            case "readText":
              result = await fetchJson("/api/files/workspace-bridge/read-text", {
                method: "POST",
                body: JSON.stringify({
                  workspaceId,
                  path: typeof payload.path === "string" ? payload.path : ""
                })
              });
              break;
            case "readTexts":
              result = await fetchJson("/api/files/workspace-bridge/read-texts", {
                method: "POST",
                body: JSON.stringify({
                  workspaceId,
                  paths: Array.isArray(payload.paths) ? payload.paths : []
                })
              });
              break;
            case "writeText":
              result = await fetchJson("/api/files/workspace-bridge/write-text", {
                method: "POST",
                body: JSON.stringify({
                  workspaceId,
                  path: typeof payload.path === "string" ? payload.path : "",
                  content: typeof payload.content === "string" ? payload.content : "",
                  options: payload.options && typeof payload.options === "object" ? payload.options : undefined
                })
              });
              break;
            case "deleteFile":
              result = await fetchJson("/api/files/workspace-bridge/delete-file", {
                method: "POST",
                body: JSON.stringify({
                  workspaceId,
                  path: typeof payload.path === "string" ? payload.path : "",
                  options: payload.options && typeof payload.options === "object" ? payload.options : undefined
                })
              });
              break;
            case "exists":
              result = await fetchJson(
                "/api/files/workspace-bridge/exists?workspaceId="
                + encodeURIComponent(workspaceId)
                + "&path="
                + encodeURIComponent(typeof payload.path === "string" ? payload.path : ""),
                {
                  method: "GET"
                }
              );
              break;
            case "watchDir":
              result = await fetchJson("/api/files/workspace-bridge/watch-dir", {
                method: "POST",
                body: JSON.stringify({
                  workspaceId,
                  path: typeof payload.path === "string" ? payload.path : "",
                  options: payload.options && typeof payload.options === "object" ? payload.options : undefined
                })
              });
              if (result && typeof result.watchId === "string") {
                startWatchPolling(result.watchId);
              }
              break;
            case "unwatch": {
              const watchId = typeof payload.watchId === "string" ? payload.watchId : "";
              stopWatchPolling(watchId);
              result = await fetchJson("/api/files/workspace-bridge/unwatch", {
                method: "POST",
                body: JSON.stringify({ watchId })
              });
              break;
            }
            default:
              throw {
                code: "INTERNAL_ERROR",
                message: "Harness 不支持的 bridge 动作：" + request.action
              };
          }

          postResponse(event, {
            type: "codingns.workspace.response",
            id: request.id,
            ok: true,
            payload: result
          });
        }

        async function fetchJson(pathname, init) {
          const response = await fetch(new URL(pathname, hostBase).toString(), Object.assign({
            headers: {
              "content-type": "application/json",
              "authorization": "Bearer " + accessToken
            }
          }, init || {}));

          const body = await response.json();
          if (!response.ok) {
            throw {
              code: body && body.error_code ? body.error_code : "INTERNAL_ERROR",
              message: body && body.detail ? body.detail : "请求失败",
              path: body && body.data && typeof body.data.path === "string" ? body.data.path : undefined
            };
          }

          return body;
        }

        function postResponse(event, response) {
          event.source.postMessage(response, event.origin);
        }

        function postWatchEvent(watchId, payload) {
          if (!iframe.contentWindow) {
            return;
          }

          iframe.contentWindow.postMessage({
            type: "codingns.workspace.event",
            watchId: watchId,
            payload: payload
          }, iframeOrigin);
        }

        function startWatchPolling(watchId) {
          if (!watchId || watchPollers.has(watchId)) {
            return;
          }

          const state = {
            stopped: false,
            cursor: 0
          };
          watchPollers.set(watchId, state);

          const loop = async function () {
            if (state.stopped) {
              watchPollers.delete(watchId);
              return;
            }

            try {
              const result = await fetchJson(
                "/api/files/workspace-bridge/watch-events?watchId="
                + encodeURIComponent(watchId)
                + "&cursor="
                + encodeURIComponent(String(state.cursor)),
                {
                  method: "GET"
                }
              );

              if (typeof result.nextCursor === "number") {
                state.cursor = result.nextCursor;
              }

              if (Array.isArray(result.events)) {
                result.events.forEach(function (item) {
                  postWatchEvent(watchId, item);
                });
              }
            } catch (error) {
              const detail = normalizeError(error);
              if (detail.code === "WATCH_NOT_FOUND") {
                state.stopped = true;
              }
            } finally {
              if (!state.stopped) {
                window.setTimeout(loop, 300);
              } else {
                watchPollers.delete(watchId);
              }
            }
          };

          void loop();
        }

        function stopWatchPolling(watchId) {
          const state = watchPollers.get(watchId);
          if (!state) {
            return;
          }

          state.stopped = true;
          watchPollers.delete(watchId);
        }

        function normalizeError(error) {
          if (error && typeof error === "object") {
            return {
              code: typeof error.code === "string" ? error.code : "INTERNAL_ERROR",
              message: typeof error.message === "string" ? error.message : "请求失败",
              path: typeof error.path === "string" ? error.path : undefined
            };
          }

          return {
            code: "INTERNAL_ERROR",
            message: typeof error === "string" ? error : "请求失败"
          };
        }
      })();
    </script>
  </body>
</html>`;
}

function seedWorkspaceFiles(workspaceDir: string): void {
  mkdirSync(path.join(workspaceDir, "site"), { recursive: true });
  mkdirSync(path.join(workspaceDir, "重要信息", "会员信息"), { recursive: true });

  writeFileSync(
    path.join(workspaceDir, "site", "index.html"),
    [
      "<!doctype html>",
      "<html lang=\"zh-CN\">",
      "  <head>",
      "    <meta charset=\"utf-8\" />",
      "    <title>Workspace Bridge Browser E2E</title>",
      "  </head>",
      "  <body>",
      "    <main id=\"app\">workspace bridge browser e2e</main>",
      "  </body>",
      "</html>"
    ].join("\n"),
    "utf8"
  );

  writeFileSync(
    path.join(workspaceDir, "重要信息", "会员信息", "91飞机场.md"),
    "# 91飞机场\n\n名称：91飞机场\n",
    "utf8"
  );
  writeFileSync(
    path.join(workspaceDir, "重要信息", "会员信息", ".会员索引.json"),
    JSON.stringify({
      items: [
        {
          path: "重要信息/会员信息/91飞机场.md",
          name: "91飞机场"
        }
      ]
    }, null, 2),
    "utf8"
  );
}

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  const login = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return login.json().accessToken as string;
}

async function importWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  workspacePath: string
): Promise<string> {
  const imported = await hosted.app.inject({
    method: "POST",
    url: "/api/workspaces/import",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      path: workspacePath,
      name: "Static HTML Workspace Bridge Browser E2E"
    }
  });

  return imported.json().id as string;
}

function resolveChromiumExecutablePath(): string | null {
  const candidates = [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

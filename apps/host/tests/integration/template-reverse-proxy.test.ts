import http from "node:http";

import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeClosers: Array<() => Promise<void> | void> = [];
const activeFixtures: EmptyFixture[] = [];

afterEach(async () => {
  while (activeClosers.length > 0) {
    const close = activeClosers.pop();
    await close?.();
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("template reverse proxy", () => {
  it("支持 HTTP 与 WebSocket 代理，满足 Vite/Next 热更新链路", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const upstreamWss = new WebSocketServer({ noServer: true });
    const upstreamServer = http.createServer((request, response) => {
      if (request.method === "POST" && request.url === "/api/audit") {
        const chunks: Buffer[] = [];

        request.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        request.on("end", () => {
          const rawBody = Buffer.concat(chunks);
          const bodyText = rawBody.toString("utf8");

          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(
            JSON.stringify({
              path: request.url,
              contentType: request.headers["content-type"] ?? "",
              bodySize: rawBody.length,
              hasFilename: bodyText.includes('filename="contract.docx"'),
              hasPerspective: bodyText.includes('name="perspective"')
            })
          );
        });

        return;
      }

      if (request.method === "GET" && request.url === "/") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(`<!doctype html>
<html>
  <head>
    <script type="module">import { injectIntoGlobalHook } from "/@react-refresh";
injectIntoGlobalHook(window);</script>
    <link rel="stylesheet" href="/themes.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/App.jsx"></script>
  </body>
</html>`);
        return;
      }

      if (request.method === "GET" && request.url === "/src/main.jsx") {
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.end(`import React from "/node_modules/.vite/deps/react.js?v=demo";
import App from "/src/App.jsx";
import "/src/themes.css";
fetch("/api/ping");`);
        return;
      }

      if (request.method === "GET" && request.url === "/@vite/client") {
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.end(`const socketHost = \`\${location.hostname}:\${location.port}\${"/"}\`;
const base = "/" || "/";
const socket = new WebSocket(\`ws://\${socketHost}?token=demo\`, "vite-hmr");`);
        return;
      }

      response.setHeader("x-upstream-path", request.url ?? "/");
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(`upstream:${request.method}:${request.url ?? "/"}`);
    });

    upstreamServer.on("upgrade", (request, socket, head) => {
      upstreamWss.handleUpgrade(request, socket, head, (client) => {
        upstreamWss.emit("connection", client, request);
      });
    });

    upstreamWss.on("connection", (client) => {
      client.send("upstream-connected");
      client.on("message", (raw) => {
        client.send(`upstream-echo:${raw.toString()}`);
      });
    });

    await new Promise<void>((resolve, reject) => {
      upstreamServer.listen(0, "127.0.0.1", (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    activeClosers.push(() => {
      upstreamWss.close();
      upstreamServer.close();
    });

    const upstreamAddress = upstreamServer.address();

    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("upstream 服务地址异常");
    }

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const createTemplateResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/terminals/templates",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        name: "vite dev",
        cwd: fixture.workspaceDir,
        command: "pnpm",
        args: ["dev"],
        port: upstreamAddress.port,
        proxyEnabled: true
      }
    });
    expect(createTemplateResponse.statusCode).toBe(201);
    expect(createTemplateResponse.json().proxyEnabled).toBe(true);
    expect(createTemplateResponse.json().proxySlug).toEqual(expect.any(String));
    const proxySlug = createTemplateResponse.json().proxySlug as string;

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const hostedAddress = hosted.app.server.address();

    if (!hostedAddress || typeof hostedAddress === "string") {
      throw new Error("host 服务地址异常");
    }

    const proxyBase = `http://127.0.0.1:${hostedAddress.port}/proxy/${proxySlug}`;
    const httpResponse = await fetch(`${proxyBase}/src/main.tsx?import=1`);
    const httpBody = await httpResponse.text();

    expect(httpResponse.status).toBe(200);
    expect(httpResponse.headers.get("x-upstream-path")).toBe("/src/main.tsx?import=1");
    expect(httpBody).toContain("upstream:GET:/src/main.tsx?import=1");

    const htmlResponse = await fetch(`${proxyBase}/`);
    const htmlBody = await htmlResponse.text();

    expect(htmlResponse.status).toBe(200);
    expect(htmlBody).toContain(`from "/proxy/${proxySlug}/@react-refresh"`);
    expect(htmlBody).toContain(`href="/proxy/${proxySlug}/themes.css"`);
    expect(htmlBody).toContain(`src="/proxy/${proxySlug}/App.jsx"`);

    const moduleResponse = await fetch(`${proxyBase}/src/main.jsx`);
    const moduleBody = await moduleResponse.text();

    expect(moduleResponse.status).toBe(200);
    expect(moduleBody).toContain(`from "/proxy/${proxySlug}/node_modules/.vite/deps/react.js?v=demo"`);
    expect(moduleBody).toContain(`from "/proxy/${proxySlug}/src/App.jsx"`);
    expect(moduleBody).toContain(`import "/proxy/${proxySlug}/src/themes.css"`);
    expect(moduleBody).toContain(`fetch("/proxy/${proxySlug}/api/ping")`);

    const viteClientResponse = await fetch(`${proxyBase}/@vite/client`);
    const viteClientBody = await viteClientResponse.text();

    expect(viteClientResponse.status).toBe(200);
    expect(viteClientBody).toContain(`\${"/proxy/${proxySlug}/"}`);
    expect(viteClientBody).toContain(`const base = "/proxy/${proxySlug}/" || "/proxy/${proxySlug}/";`);

    const uploadForm = new FormData();
    uploadForm.append(
      "file",
      new Blob(["demo-contract-content"], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      }),
      "contract.docx"
    );
    uploadForm.append("perspective", "neutral");
    uploadForm.append("strictness", "standard");

    const uploadResponse = await fetch(`${proxyBase}/api/audit`, {
      method: "POST",
      body: uploadForm
    });
    const uploadPayload = await uploadResponse.json();

    expect(uploadResponse.status).toBe(200);
    expect(uploadPayload.path).toBe("/api/audit");
    expect(String(uploadPayload.contentType)).toContain("multipart/form-data");
    expect(uploadPayload.bodySize).toBeGreaterThan(0);
    expect(uploadPayload.hasFilename).toBe(true);
    expect(uploadPayload.hasPerspective).toBe(true);

    const ws = new WebSocket(`ws://127.0.0.1:${hostedAddress.port}/proxy/${proxySlug}/@vite/client`);
    activeClosers.push(() => ws.close());
    const wsMessages = createWsMessageQueue(ws);

    expect(await wsMessages.next()).toBe("upstream-connected");
    ws.send("hot-update");
    expect(await wsMessages.next()).toBe("upstream-echo:hot-update");
  });

  it("转发到带代理上下文改写逻辑的 Vite 上游时，会剥离内部代理头避免资源请求回环", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const upstreamServer = http.createServer((request, response) => {
      if (request.method === "GET" && request.url === "/") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(`<!doctype html>
<html>
  <body>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`);
        return;
      }

      if (request.method === "GET" && request.url === "/src/main.tsx") {
        const referer = String(request.headers.referer ?? "");
        const cookie = String(request.headers.cookie ?? "");

        // 模拟 user-app Vite dev server 的代理上下文重写；如果外层代理没清理头，这里会误判成 /proxy/* 请求。
        if (referer.includes("/proxy/") || cookie.includes("cns_proxy_slug=")) {
          response.statusCode = 404;
          response.end("proxy context leaked into upstream");
          return;
        }

        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.end(`import "/@vite/client";
import "/@react-refresh";`);
        return;
      }

      if (
        request.method === "GET"
        && (request.url === "/@vite/client" || request.url === "/@react-refresh")
      ) {
        const referer = String(request.headers.referer ?? "");
        const cookie = String(request.headers.cookie ?? "");

        if (referer.includes("/proxy/") || cookie.includes("cns_proxy_slug=")) {
          response.statusCode = 404;
          response.end("proxy context leaked into upstream");
          return;
        }

        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.end("export const ok = true;");
        return;
      }

      response.statusCode = 404;
      response.end(`missing:${request.url ?? "/"}`);
    });

    await new Promise<void>((resolve, reject) => {
      upstreamServer.listen(0, "127.0.0.1", (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    activeClosers.push(() => upstreamServer.close());

    const upstreamAddress = upstreamServer.address();

    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("upstream 服务地址异常");
    }

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const createTemplateResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/terminals/templates",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        name: "vite dev",
        cwd: fixture.workspaceDir,
        command: "pnpm",
        args: ["dev"],
        port: upstreamAddress.port,
        proxyEnabled: true
      }
    });
    expect(createTemplateResponse.statusCode).toBe(201);
    const proxySlug = createTemplateResponse.json().proxySlug as string;

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const hostedAddress = hosted.app.server.address();

    if (!hostedAddress || typeof hostedAddress === "string") {
      throw new Error("host 服务地址异常");
    }

    const proxyBase = `http://127.0.0.1:${hostedAddress.port}/proxy/${proxySlug}`;
    const sharedHeaders = {
      referer: `${proxyBase}/`,
      cookie: `foo=1; cns_proxy_slug=${proxySlug}; bar=2`
    };

    const htmlResponse = await fetch(`${proxyBase}/`, {
      headers: sharedHeaders
    });
    expect(htmlResponse.status).toBe(200);

    const entryResponse = await fetch(`${proxyBase}/src/main.tsx`, {
      headers: sharedHeaders
    });
    const entryBody = await entryResponse.text();
    expect(entryResponse.status).toBe(200);
    expect(entryBody).toContain(`import "/proxy/${proxySlug}/@vite/client"`);
    expect(entryBody).toContain(`import "/proxy/${proxySlug}/@react-refresh"`);

    const viteClientResponse = await fetch(`${proxyBase}/@vite/client`, {
      headers: sharedHeaders
    });
    expect(viteClientResponse.status).toBe(200);

    const reactRefreshResponse = await fetch(`${proxyBase}/@react-refresh`, {
      headers: sharedHeaders
    });
    expect(reactRefreshResponse.status).toBe(200);
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  const login = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "password123"
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
      name: "Proxy Workspace"
    }
  });

  expect(imported.statusCode).toBe(201);
  return imported.json().id as string;
}

function createWsMessageQueue(socket: WebSocket) {
  const pending: string[] = [];
  const waiters: Array<(value: string) => void> = [];

  socket.on("message", (raw) => {
    const text = raw.toString();
    const waiter = waiters.shift();

    if (waiter) {
      waiter(text);
      return;
    }

    pending.push(text);
  });

  return {
    async next(timeoutMs = 2000): Promise<string> {
      if (pending.length > 0) {
        return pending.shift()!;
      }

      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(resolve);

          if (index >= 0) {
            waiters.splice(index, 1);
          }

          reject(new Error(`等待 WebSocket 消息超时: ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    }
  };
}

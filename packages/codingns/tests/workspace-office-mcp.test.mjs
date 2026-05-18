import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(packageRoot, "bin", "office-mcp-server.mjs");

test("workspace office mcp 会列出浏览器与运维工具，并能调用 host API", async () => {
  let receivedAuthorization = null;
  let receivedPath = null;
  let receivedBrowserPayload = null;
  let receivedOpsBrowserPayload = null;
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/assistant/office/browser/tasks") {
      receivedAuthorization = request.headers.authorization ?? null;
      receivedPath = request.url;
      receivedBrowserPayload = await readJsonBody(request);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        ok: true,
        capability: "office.browser.task.create",
        auditId: "audit-browser-1",
        timestamp: "2026-05-16T12:00:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          task: {
            id: "browser-task-1"
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/assistant/office/ops/browser-tasks") {
      receivedAuthorization = request.headers.authorization ?? null;
      receivedPath = request.url;
      receivedOpsBrowserPayload = await readJsonBody(request);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        ok: true,
        capability: "office.ops.browser-task.create",
        auditId: "audit-ops-browser-1",
        timestamp: "2026-05-16T12:10:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          task: {
            id: "ops-browser-task-1"
          }
        }
      }));
      return;
    }

    response.writeHead(404, {
      "Content-Type": "application/json",
      "Connection": "close"
    });
    response.end(JSON.stringify({ detail: "not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      CODINGNS_OFFICE_MCP_BASE_URL: baseUrl,
      CODINGNS_OFFICE_MCP_ACCESS_TOKEN: "workspace-token"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    const initialize = await sendMcpRequest(child, 1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "0.1.0"
      }
    });
    assert.equal(initialize.result.protocolVersion, "2025-06-18");

    const tools = await sendMcpRequest(child, 2, "tools/list", {});
    const toolNames = tools.result.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("office_browser_task_create"));
    assert.ok(toolNames.includes("office_ops_task_execute"));
    assert.ok(toolNames.includes("office_document_create"));

    const callResult = await sendMcpRequest(child, 3, "tools/call", {
      name: "office_browser_task_create",
      arguments: {
        profileId: "profile-1",
        executionBackend: "opencli_bridge",
        execute: true,
        input: {
          startUrl: "https://www.zhihu.com/signin",
          actions: [{ type: "read_dom" }]
        }
      }
    });

    assert.equal(receivedAuthorization, "Bearer workspace-token");
    assert.equal(receivedPath, "/api/assistant/office/browser/tasks");
    assert.deepEqual(receivedBrowserPayload, {
      profileId: "profile-1",
      workspaceId: null,
      title: null,
      riskLevel: null,
      executionBackend: "opencli_bridge",
      execute: true,
      input: {
        startUrl: "https://www.zhihu.com/signin",
        actions: [{ type: "read_dom" }]
      }
    });
    assert.match(callResult.result.content[0].text, /office\.browser\.task\.create/);

    const bridgeCallResult = await sendMcpRequest(child, 4, "tools/call", {
      name: "office_browser_task_create",
      arguments: {
        executionBackend: "opencli_bridge",
        execute: true,
        input: {
          startUrl: "https://www.zhihu.com/signin",
          actions: [{ type: "read_dom" }]
        }
      }
    });

    assert.deepEqual(receivedBrowserPayload, {
      profileId: null,
      workspaceId: null,
      title: null,
      riskLevel: null,
      executionBackend: "opencli_bridge",
      execute: true,
      input: {
        startUrl: "https://www.zhihu.com/signin",
        actions: [{ type: "read_dom" }]
      }
    });
    assert.match(bridgeCallResult.result.content[0].text, /office\.browser\.task\.create/);

    const opsBridgeCallResult = await sendMcpRequest(child, 5, "tools/call", {
      name: "office_ops_browser_task_create",
      arguments: {
        targetId: "target-1",
        executionBackend: "opencli_bridge",
        input: {
          actions: [{ type: "read_dom" }]
        }
      }
    });

    assert.equal(receivedPath, "/api/assistant/office/ops/browser-tasks");
    assert.deepEqual(receivedOpsBrowserPayload, {
      targetId: "target-1",
      profileId: null,
      executionBackend: "opencli_bridge",
      title: null,
      riskLevel: null,
      input: {
        actions: [{ type: "read_dom" }]
      },
      confirm: null
    });
    assert.match(opsBridgeCallResult.result.content[0].text, /office\.ops\.browser-task\.create/);
  } finally {
    child.kill("SIGTERM");
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body.length > 0 ? JSON.parse(body) : null);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function sendMcpRequest(child, id, method, params) {
  const reader = createMcpReader(child.stdout);
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params
  });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
  return await reader.readOnce();
}

function createMcpReader(stream) {
  let buffer = "";
  const pending = [];

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    drain();
  });

  function drain() {
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");

      if (headerEnd === -1) {
        return;
      }

      const headerText = buffer.slice(0, headerEnd);
      const match = headerText.match(/Content-Length:\s*(\d+)/i);

      if (!match) {
        throw new Error("MCP 响应缺少 Content-Length");
      }

      const contentLength = Number.parseInt(match[1], 10);
      const payloadStart = headerEnd + 4;
      const bodyBuffer = Buffer.from(buffer.slice(payloadStart), "utf8");

      if (bodyBuffer.length < contentLength) {
        return;
      }

      const payload = bodyBuffer.subarray(0, contentLength).toString("utf8");
      const rest = bodyBuffer.subarray(contentLength).toString("utf8");
      buffer = rest;
      const next = pending.shift();
      if (next) {
        next.resolve(JSON.parse(payload));
      }
    }
  }

  return {
    readOnce() {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        drain();
      });
    }
  };
}

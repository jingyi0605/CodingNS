import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(packageRoot, "bin", "codingns.mjs");

test("codingns opencli help 会输出帮助", () => {
  const result = spawnSync(process.execPath, [cliPath, "opencli", "help"], {
    encoding: "utf8",
    env: createCliEnv()
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /codingns opencli overview/);
  assert.match(result.stdout, /codingns opencli config/);
});

test("codingns assistant office browser-task-create help 会输出动作模板", () => {
  const result = spawnSync(process.execPath, [cliPath, "assistant", "help", "office.browser-task-create"], {
    encoding: "utf8",
    env: createCliEnv()
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /支持动作/);
  assert.match(result.stdout, /read_dom/);
  assert.match(result.stdout, /screenshot/);
  assert.match(result.stdout, /https:\/\/www\.zhihu\.com\/signin/);
  assert.match(result.stdout, /登录、验证码、二次确认弹窗、复杂真实站点/);
  assert.match(result.stdout, /opencli_bridge/);
  assert.match(result.stdout, /不要退回去翻源码/);
});

test("codingns opencli config 会调用 Host API 并输出结果", async () => {
  let receivedPayload = null;
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/opencli/config") {
      receivedPayload = await readJsonBody(request);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        provider: {
          providerId: "opencli",
          enabled: true,
          installState: "installed",
          healthState: "bridge_missing",
          version: "1.7.7",
          installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
          lastCheckedAt: "2026-04-26T10:00:00.000Z",
          activeRuntimeId: "opencli-runtime-1",
          lastErrorCode: null,
          lastErrorDetail: null,
          catalogRefreshedAt: "2026-04-26T10:00:00.000Z",
          catalogSource: "manifest"
        },
        summary: {
          catalogCount: 1,
          enabledCount: 1,
          browserDependentCount: 0,
          installState: "installed",
          healthState: "bridge_missing"
        },
        effectiveCatalogSource: "manifest",
        activeRuntimeProfile: {
          id: "opencli-runtime-1",
          version: "1.7.7",
          sourceInstallPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
          runtimeRootPath: "/tmp/opencli-runtime-1",
          status: "ready",
          contentHash: "hash-1",
          enabledCommandIds: ["hackernews/top"],
          createdAt: "2026-04-26T10:00:00.000Z",
          updatedAt: "2026-04-26T10:00:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null
        },
        entries: [],
        siteGroups: [],
        runtimeAvailability: "ready",
        runtimeErrorCode: null,
        runtimeErrorDetail: null
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

  try {
    const result = await runCli([
      cliPath,
      "opencli",
      "config",
      "--base-url",
      baseUrl,
      "--token",
      "token-1",
      "--enabled",
      "true",
      "--command-id",
      "hackernews/top"
    ]);

    assert.equal(result.status, 0);
    assert.deepEqual(receivedPayload, {
      enabled: true,
      enabledCommandIds: ["hackernews/top"]
    });
    assert.match(result.stdout, /"providerId": "opencli"/);
    assert.match(result.stdout, /"runtimeAvailability": "ready"/);
  } finally {
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

test("codingns assistant office document-create 会调用 Host assistant API", async () => {
  let receivedPayload = null;
  let receivedHeaders = null;
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/assistant/office/documents") {
      receivedHeaders = request.headers;
      receivedPayload = await readJsonBody(request);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        ok: true,
        capability: "office.document.create",
        auditId: "audit-doc-1",
        timestamp: "2026-05-15T12:00:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          document: {
            id: "document-1",
            title: "周报"
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

  try {
    const result = await runCli([
      cliPath,
      "assistant",
      "office",
      "document-create",
      "--base-url",
      baseUrl,
      "--token",
      "token-1",
      "--title",
      "周报",
      "--template-key",
      "team.doct.weekly",
      "--content-json",
      "{\"sections\":[]}"
    ]);

    assert.equal(result.status, 0);
    assert.equal(receivedHeaders["x-codingns-assistant-source"], "assistant-cli");
    assert.deepEqual(receivedPayload, {
      workspaceId: null,
      title: "周报",
      templateId: null,
      templateKey: "team.doct.weekly",
      summary: null,
      content: {
        sections: []
      }
    });
    assert.match(result.stdout, /"capability": "office.document.create"/);
  } finally {
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

test("codingns assistant office browser-task-create 会调用 Host assistant API", async () => {
  let receivedPayload = null;
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/assistant/office/browser/tasks") {
      receivedPayload = await readJsonBody(request);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        ok: true,
        capability: "office.browser.task.create",
        auditId: "audit-browser-task-1",
        timestamp: "2026-05-15T12:05:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          task: {
            id: "browser-task-1"
          },
          execution: null
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

  try {
    const result = await runCli([
      cliPath,
      "assistant",
      "office",
      "browser-task-create",
      "--base-url",
      baseUrl,
      "--token",
      "token-1",
      "--profile-id",
      "profile-1",
      "--risk-level",
      "medium",
      "--execution-backend",
      "opencli_bridge",
      "--execute",
      "true",
      "--input-json",
      "{\"startUrl\":\"https://example.invalid\",\"actions\":[{\"type\":\"read_dom\"}]}"
    ]);

    assert.equal(result.status, 0);
    assert.deepEqual(receivedPayload, {
      workspaceId: null,
      title: null,
      profileId: "profile-1",
      riskLevel: "medium",
      executionBackend: "opencli_bridge",
      execute: true,
      input: {
        startUrl: "https://example.invalid",
        actions: [
          {
            type: "read_dom"
          }
        ]
      }
    });
    assert.match(result.stdout, /"capability": "office.browser.task.create"/);
  } finally {
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

test("codingns assistant office browser-profile-list 会调用 Host assistant API", async () => {
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/assistant/office/browser/profiles?workspaceId=workspace-1") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        ok: true,
        capability: "office.browser.profile.list",
        auditId: "audit-browser-profile-list-1",
        timestamp: "2026-05-16T10:05:00.000Z",
        targetRef: {
          kind: "workspace",
          id: "workspace-1"
        },
        payload: {
          items: [
            {
              id: "profile-1",
              displayName: "办公 Chrome"
            }
          ]
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

  try {
    const result = await runCli([
      cliPath,
      "assistant",
      "office",
      "browser-profile-list",
      "--base-url",
      baseUrl,
      "--token",
      "token-1",
      "--workspace-id",
      "workspace-1"
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /"capability": "office.browser.profile.list"/);
    assert.match(result.stdout, /"displayName": "办公 Chrome"/);
  } finally {
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

test("codingns assistant office ops-task-execute 会调用 Host assistant API", async () => {
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/assistant/office/ops/tasks/task-ssh-1/execute") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        ok: true,
        capability: "office.ops.task.execute",
        auditId: "audit-ops-task-execute-1",
        timestamp: "2026-05-15T12:10:00.000Z",
        targetRef: {
          kind: "none",
          id: "target-1"
        },
        payload: {
          task: {
            id: "task-ssh-1"
          },
          execution: {
            taskId: "task-ssh-1",
            executionTaskId: "exec-1",
            deduped: false
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

  try {
    const result = await runCli([
      cliPath,
      "assistant",
      "office",
      "ops-task-execute",
      "task-ssh-1",
      "--base-url",
      baseUrl,
      "--token",
      "token-1"
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /"capability": "office.ops.task.execute"/);
  } finally {
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

test("codingns assistant office task-approval-reply 会调用 Host assistant API", async () => {
  let receivedPayload = null;
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/assistant/office/task-approvals/approval-1/reply") {
      receivedPayload = await readJsonBody(request);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        ok: true,
        capability: "office.task.approval.reply",
        auditId: "audit-approval-reply-1",
        timestamp: "2026-05-15T12:11:00.000Z",
        targetRef: {
          kind: "none",
          id: "target-1"
        },
        payload: {
          approval: {
            id: "approval-1",
            status: "approved"
          },
          task: {
            id: "task-ssh-1"
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

  try {
    const result = await runCli([
      cliPath,
      "assistant",
      "office",
      "task-approval-reply",
      "approval-1",
      "--base-url",
      baseUrl,
      "--token",
      "token-1",
      "--status",
      "approved",
      "--decision-note",
      "通过"
    ]);

    assert.equal(result.status, 0);
    assert.deepEqual(receivedPayload, {
      status: "approved",
      decisionNote: "通过"
    });
    assert.match(result.stdout, /"capability": "office.task.approval.reply"/);
  } finally {
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

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createCliEnv() {
  return {
    ...process.env,
    NODE_OPTIONS: "",
    NODE_TEST_CONTEXT: ""
  };
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: createCliEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        status: code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8")
      });
    });
  });
}

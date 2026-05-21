import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(packageRoot, "bin", "codingns.mjs");

test("codingns plugins help 会输出帮助", () => {
  const result = spawnSync(process.execPath, [cliPath, "plugins", "help"], {
    encoding: "utf8",
    env: createCliEnv()
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /codingns plugins 用法/);
  assert.match(result.stdout, /codingns plugins list/);
});

test("codingns plugins list 会调用 Host API", async () => {
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/plugins") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        items: [
          {
            id: "demo.plugin",
            name: "演示插件",
            version: "1.0.0",
            enabled: false
          }
        ]
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
      "plugins",
      "list",
      "--base-url",
      baseUrl,
      "--token",
      "token-1"
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /"id": "demo.plugin"/);
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

test("codingns plugins disable 会调用 Host API", async () => {
  let receivedPayload = null;
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/plugins/demo.plugin/disable") {
      receivedPayload = await readJsonBody(request);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        pluginId: "demo.plugin",
        enabled: false
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
      "plugins",
      "disable",
      "demo.plugin",
      "--reason",
      "暂时停用",
      "--base-url",
      baseUrl,
      "--token",
      "token-1"
    ]);

    assert.equal(result.status, 0);
    assert.deepEqual(receivedPayload, {
      reason: "暂时停用"
    });
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


test("codingns plugins call 会调用插件动作 API", async () => {
  let receivedPayload = null;
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/plugins/demo.plugin/actions/run-report") {
      receivedPayload = await readJsonBody(request);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Connection": "close"
      });
      response.end(JSON.stringify({
        run: {
          id: "run-1",
          pluginId: "demo.plugin",
          workspaceId: "workspace-1",
          actionId: "run-report",
          status: "succeeded"
        },
        output: {
          ok: true
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
      "plugins",
      "call",
      "demo.plugin",
      "run-report",
      "--workspace-id",
      "workspace-1",
      "--input-json",
      '{"range":"today"}',
      "--base-url",
      baseUrl,
      "--token",
      "token-1"
    ]);

    assert.equal(result.status, 0);
    assert.deepEqual(receivedPayload, {
      workspaceId: "workspace-1",
      input: {
        range: "today"
      }
    });
    assert.match(result.stdout, /"pluginId": "demo.plugin"/);
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

function createCliEnv() {
  return {
    ...process.env,
    CODINGNS_ACCESS_TOKEN: "token-test",
    CODINGNS_BASE_URL: "http://127.0.0.1:3002"
  };
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: createCliEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (status) => {
      resolve({
        status,
        stdout,
        stderr
      });
    });
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

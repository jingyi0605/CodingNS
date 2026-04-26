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

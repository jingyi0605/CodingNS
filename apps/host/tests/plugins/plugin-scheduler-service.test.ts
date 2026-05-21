import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { hashPassword } from "../../src/shared/utils/hash.js";
import { createId } from "../../src/shared/utils/id.js";
import { createServer } from "../../src/server/create-server.js";

const startedServers: Array<ReturnType<typeof createServer>> = [];

function createPlugin(rootDir: string, directoryName: string, manifest: Record<string, unknown>, files: Record<string, string>) {
  const installRoot = path.join(rootDir, directoryName);
  fs.mkdirSync(installRoot, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(installRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
  }

  fs.writeFileSync(path.join(installRoot, "plugin.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function createSchedulerTestServer(options?: {
  actionScript?: string;
  workspaceCount?: number;
  enabled?: boolean;
}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-scheduler-"));
  const pluginRootDir = path.join(tempDir, "plugins");
  fs.mkdirSync(pluginRootDir, { recursive: true });

  createPlugin(
    pluginRootDir,
    "demo-plugin",
    {
      id: "demo.plugin",
      name: "演示插件",
      version: "1.0.0",
      backend: {
        runtime: "node",
        actions: [
          {
            id: "scheduled-action",
            title: "定时动作",
            entry: "action.js",
            timeoutMs: 3000
          }
        ]
      },
      permissions: {
        workspaceRead: true
      },
      schedules: [
        {
          id: "every-second",
          actionId: "scheduled-action",
          everySeconds: 1,
          inputJson: {
            from: "scheduler"
          }
        }
      ]
    },
    {
      "action.js": options?.actionScript ?? "export async function run(payload){ return { ok: true, workspaceId: payload.workspaceId, input: payload.input ?? null }; }"
    }
  );

  const config = resolveHostConfig({
    databasePath: path.join(tempDir, "host.sqlite"),
    pluginRootDir,
    webUiDir: null,
    demoMode: false
  });
  const server = createServer(config);
  startedServers.push(server);

  const now = new Date().toISOString();
  server.services.repositories.authUserRepository.create({
    id: "system-user",
    username: "system-user",
    passwordHash: hashPassword("password123"),
    role: "admin",
    createdAt: now,
    updatedAt: now
  });
  const workspaceCount = Math.max(0, options?.workspaceCount ?? 1);
  for (let index = 0; index < workspaceCount; index += 1) {
    const workspaceRoot = path.join(tempDir, `workspace-${index + 1}`);
    fs.mkdirSync(workspaceRoot, { recursive: true });
    server.services.repositories.workspaceRepository.create({
      id: `workspace-${index + 1}`,
      name: `工作区 ${index + 1}`,
      path: workspaceRoot,
      repoRoot: workspaceRoot,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      removedAt: null
    });
  }

  if (options?.enabled !== false) {
    server.services.modules.pluginRegistryService.enablePlugin("demo.plugin", "system-user");
  }

  return server;
}

function grantWorkspaceReadPermission(server: ReturnType<typeof createServer>, workspaceId = "workspace-1") {
  const now = new Date().toISOString();
  server.services.repositories.pluginPermissionGrantRepository.create({
    id: createId(),
    pluginId: "demo.plugin",
    workspaceId,
    permissionKey: "workspace.read_file",
    scopeType: "workspace",
    scopePath: null,
    grantMode: "persistent",
    grantedByUserId: "system-user",
    runtimeSessionId: null,
    createdAt: now,
    expiresAt: null,
    revokedAt: null
  });
}

async function runSingleTick(server: ReturnType<typeof createServer>) {
  const scheduler = server.services.modules.pluginSchedulerService as unknown as {
    tick: () => Promise<void>;
  };
  await scheduler.tick();
}

async function waitFor(check: () => boolean, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("等待测试条件超时");
}

afterEach(async () => {
  while (startedServers.length > 0) {
    const item = startedServers.pop();
    if (!item) {
      continue;
    }
    await item.app.close();
  }
});

describe("plugin-scheduler-service", () => {
  it("调度触发会创建运行记录并写审计", async () => {
    const server = createSchedulerTestServer();
    grantWorkspaceReadPermission(server);

    await runSingleTick(server);
    await waitFor(() => {
      const runs = server.services.repositories.pluginRunRepository.listByPluginId("demo.plugin", 20);
      return runs.length === 1 && runs[0]?.status === "succeeded";
    });

    const runs = server.services.repositories.pluginRunRepository.listByPluginId("demo.plugin", 20);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.triggerKind).toBe("schedule");
    expect(runs[0]?.status).toBe("succeeded");

    const events = server.services.repositories.pluginAuditEventRepository.listByPluginId("demo.plugin", 20);
    expect(events.some((item) => item.eventType === "plugin.schedule_triggered")).toBe(true);
    expect(events.some((item) => item.eventType === "plugin.action_invoked")).toBe(true);
  }, 20000);

  it("调度失败会复用任务重试并回写审计", async () => {
    const server = createSchedulerTestServer({
      actionScript: `
import fs from "node:fs";
import path from "node:path";

const markerPath = path.join(process.cwd(), ".attempt-marker");
let attempts = 0;
export async function run() {
  attempts = fs.existsSync(markerPath) ? Number(fs.readFileSync(markerPath, "utf8")) || 0 : 0;
  attempts += 1;
  fs.writeFileSync(markerPath, String(attempts), "utf8");
  if (attempts < 2) {
    throw new Error("fail once");
  }
  return { ok: true, attempts };
}
`
    });
    grantWorkspaceReadPermission(server);

    await runSingleTick(server);
    await waitFor(() =>
      server.services.repositories.pluginAuditEventRepository
        .listByPluginId("demo.plugin", 50)
        .some((item) => item.eventType === "plugin.schedule_retry_scheduled"),
    8000);
    await waitFor(() =>
      server.services.repositories.pluginRunRepository
        .listByPluginId("demo.plugin", 20)
        .some((item) => item.status === "succeeded"),
    8000);

    const runs = server.services.repositories.pluginRunRepository.listByPluginId("demo.plugin", 20);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.some((item) => item.status === "failed")).toBe(true);
    expect(runs.some((item) => item.status === "succeeded")).toBe(true);

    const events = server.services.repositories.pluginAuditEventRepository.listByPluginId("demo.plugin", 50);
    expect(events.some((item) => item.eventType === "plugin.schedule_retry_scheduled")).toBe(true);
    expect(events.some((item) => item.eventType === "plugin.action_invoked")).toBe(true);
  }, 20000);

  it("多工作区时调度不会偷偷触发", async () => {
    const server = createSchedulerTestServer({
      workspaceCount: 2
    });

    await runSingleTick(server);
    await waitFor(() =>
      server.services.repositories.pluginAuditEventRepository
        .listByPluginId("demo.plugin", 20)
        .some((item) => item.eventType === "plugin.schedule_skipped")
    );

    const runs = server.services.repositories.pluginRunRepository.listByPluginId("demo.plugin", 20);
    expect(runs).toHaveLength(0);

    const events = server.services.repositories.pluginAuditEventRepository.listByPluginId("demo.plugin", 20);
    expect(events.some((item) => item.eventType === "plugin.schedule_skipped")).toBe(true);
  }, 20000);

  it("插件禁用后调度停止触发", async () => {
    const server = createSchedulerTestServer({
      enabled: false
    });

    await runSingleTick(server);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const runs = server.services.repositories.pluginRunRepository.listByPluginId("demo.plugin", 20);
    expect(runs).toHaveLength(0);
  }, 20000);
});

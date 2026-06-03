import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenCliBridgeBrowserExecutor } from "../../src/modules/browser-runtime/opencli-bridge-browser-executor.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { OfficeArtifactRepository } from "../../src/storage/repositories/office-artifact-repository.js";
import { OfficeAuditEventRepository } from "../../src/storage/repositories/office-audit-event-repository.js";
import { OfficeReceiptRepository } from "../../src/storage/repositories/office-receipt-repository.js";
import { OfficeTaskRepository } from "../../src/storage/repositories/office-task-repository.js";
import { OfficeTaskStepRepository } from "../../src/storage/repositories/office-task-step-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import type { OfficeTask } from "../../src/types/domain.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("OpenCliBridgeBrowserExecutor", () => {
  it("只给 startUrl + read_dom 时，也会先导航到真实页面，而不是停在 about:blank", async () => {
    const fixture = createExecutorFixture();
    const installPath = createFakeOpenCliInstall({
      pageSource: `
        export class Page {
          constructor(workspace) {
            this.workspace = workspace;
            this.url = "about:blank";
          }
          async goto(url) { this.url = url; }
          async click() {}
          async typeText() {}
          async pressKey() {}
          async evaluate(code) {
            if (code.includes("window.location.href")) {
              return this.url;
            }
            return "fake dom";
          }
          async snapshot() { return {}; }
          async screenshot() { return ""; }
          async wait() {}
          async setFileInput() {}
          async getCurrentUrl() { return this.url; }
        }
      `
    });
    const executor = new OpenCliBridgeBrowserExecutor(
      fixture.databasePath,
      fixture.officeTaskRepository,
      fixture.officeTaskStepRepository,
      fixture.officeArtifactRepository,
      fixture.officeReceiptRepository,
      fixture.officeAuditEventRepository,
      {
        check: vi.fn(async () => ({
          installState: "installed",
          healthState: "ready",
          version: "1.0.0",
          installPath,
          checkedAt: "2026-06-02T09:00:00.000Z",
          errorCode: null,
          errorDetail: null
        }))
      } as any
    );
    const task = fixture.createTask({
      inputJson: JSON.stringify({
        startUrl: "https://example.com/real-page",
        actions: [{ type: "read_dom" }]
      })
    });

    const result = await executor.execute({ task });
    const receiptPayload = JSON.parse(result.receipt.payloadJson) as { finalUrl?: string | null };

    expect(result.task.status).toBe("succeeded");
    expect(result.stepResults).toHaveLength(1);
    expect(receiptPayload.finalUrl).toBe("https://example.com/real-page");
  });

  it("首跳仍是 about:blank 时，会按同一个 startUrl 自动重试一次", async () => {
    const fixture = createExecutorFixture();
    const installPath = createFakeOpenCliInstall({
      pageSource: `
        export class Page {
          constructor(workspace) {
            this.workspace = workspace;
            this.url = "about:blank";
            this.gotoCount = 0;
          }
          async goto(url) {
            this.gotoCount += 1;
            this.url = this.gotoCount >= 2 ? url : "about:blank";
          }
          async click() {}
          async typeText() {}
          async pressKey() {}
          async evaluate(code) {
            if (code.includes("window.location.href")) {
              return this.url;
            }
            return "fake dom";
          }
          async snapshot() { return {}; }
          async screenshot() { return ""; }
          async wait() {}
          async setFileInput() {}
          async getCurrentUrl() { return this.url; }
        }
      `
    });
    const executor = new OpenCliBridgeBrowserExecutor(
      fixture.databasePath,
      fixture.officeTaskRepository,
      fixture.officeTaskStepRepository,
      fixture.officeArtifactRepository,
      fixture.officeReceiptRepository,
      fixture.officeAuditEventRepository,
      {
        check: vi.fn(async () => ({
          installState: "installed",
          healthState: "ready",
          version: "1.0.0",
          installPath,
          checkedAt: "2026-06-02T09:00:00.000Z",
          errorCode: null,
          errorDetail: null
        }))
      } as any
    );
    const task = fixture.createTask({
      inputJson: JSON.stringify({
        startUrl: "https://example.com/retry-page",
        actions: [{ type: "read_dom" }]
      })
    });

    const result = await executor.execute({ task });
    const receiptPayload = JSON.parse(result.receipt.payloadJson) as { finalUrl?: string | null };

    expect(result.task.status).toBe("succeeded");
    expect(receiptPayload.finalUrl).toBe("https://example.com/retry-page");
  });

  it("首跳和补偿重试后仍是 about:blank 时，会抛出明确错误", async () => {
    const fixture = createExecutorFixture();
    const installPath = createFakeOpenCliInstall({
      pageSource: `
        export class Page {
          constructor(workspace) {
            this.workspace = workspace;
            this.url = "about:blank";
          }
          async goto() { this.url = "about:blank"; }
          async click() {}
          async typeText() {}
          async pressKey() {}
          async evaluate(code) {
            if (code.includes("window.location.href")) {
              return this.url;
            }
            return "fake dom";
          }
          async snapshot() { return {}; }
          async screenshot() { return ""; }
          async wait() {}
          async setFileInput() {}
          async getCurrentUrl() { return this.url; }
        }
      `
    });
    const executor = new OpenCliBridgeBrowserExecutor(
      fixture.databasePath,
      fixture.officeTaskRepository,
      fixture.officeTaskStepRepository,
      fixture.officeArtifactRepository,
      fixture.officeReceiptRepository,
      fixture.officeAuditEventRepository,
      {
        check: vi.fn(async () => ({
          installState: "installed",
          healthState: "ready",
          version: "1.0.0",
          installPath,
          checkedAt: "2026-06-02T09:00:00.000Z",
          errorCode: null,
          errorDetail: null
        }))
      } as any
    );
    const task = fixture.createTask({
      inputJson: JSON.stringify({
        startUrl: "https://example.com/still-blank",
        actions: [{ type: "read_dom" }]
      })
    });

    await expect(executor.execute({ task })).rejects.toMatchObject({
      errorCode: "OPENCLI_BRIDGE_START_URL_NOT_REACHED",
      message: expect.stringContaining("https://example.com/still-blank")
    });
  });

  it("bridge ready 时只使用健康检查返回的 installPath，不再二次 discover", async () => {
    const fixture = createExecutorFixture();
    const installPath = createFakeOpenCliInstall({
      pageSource: `
        export class Page {
          constructor(workspace) {
            this.workspace = workspace;
            this.url = "about:blank";
          }
          async goto(url) { this.url = url; }
          async click() {}
          async typeText() {}
          async pressKey() {}
          async evaluate() { return "fake dom"; }
          async snapshot() { return {}; }
          async screenshot() { return ""; }
          async wait() {}
          async setFileInput() {}
          async getCurrentUrl() { return this.url; }
        }
      `
    });
    const executor = new OpenCliBridgeBrowserExecutor(
      fixture.databasePath,
      fixture.officeTaskRepository,
      fixture.officeTaskStepRepository,
      fixture.officeArtifactRepository,
      fixture.officeReceiptRepository,
      fixture.officeAuditEventRepository,
      {
        check: vi.fn(async () => ({
          installState: "installed",
          healthState: "ready",
          version: "1.0.0",
          installPath,
          checkedAt: "2026-06-02T09:00:00.000Z",
          errorCode: null,
          errorDetail: null
        }))
      } as any
    );
    const discoverSpy = vi.spyOn<any, any>(executor as any, "installDiscovery", "get");
    const task = fixture.createTask({
      inputJson: JSON.stringify({
        startUrl: "https://example.com",
        actions: [{ type: "read_dom" }]
      })
    });

    const result = await executor.execute({ task });

    expect(result.task.status).toBe("succeeded");
    expect(result.stepResults).toHaveLength(1);
    expect(discoverSpy).not.toHaveBeenCalled();
  });

  it("bridge ready 但 page.js 加载失败时，保留 OPENCLI_BRIDGE_LOAD_FAILED 和真实错误", async () => {
    const fixture = createExecutorFixture();
    const installPath = createFakeOpenCliInstall({
      pageSource: `throw new Error("bridge module exploded");`
    });
    const executor = new OpenCliBridgeBrowserExecutor(
      fixture.databasePath,
      fixture.officeTaskRepository,
      fixture.officeTaskStepRepository,
      fixture.officeArtifactRepository,
      fixture.officeReceiptRepository,
      fixture.officeAuditEventRepository,
      {
        check: vi.fn(async () => ({
          installState: "installed",
          healthState: "ready",
          version: "1.0.0",
          installPath,
          checkedAt: "2026-06-02T09:00:00.000Z",
          errorCode: null,
          errorDetail: null
        }))
      } as any
    );
    const task = fixture.createTask({
      inputJson: JSON.stringify({
        startUrl: "https://example.com",
        actions: [{ type: "goto", url: "https://example.com" }]
      })
    });

    await expect(executor.execute({ task })).rejects.toMatchObject({
      errorCode: "OPENCLI_BRIDGE_LOAD_FAILED",
      message: expect.stringContaining("bridge module exploded")
    });
  });
});

function createExecutorFixture() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-bridge-executor-"));
  tempDirs.push(tempDir);
  const databasePath = path.join(tempDir, "host.sqlite");
  const client = createDatabaseClient(databasePath);
  seedOfficeTaskPrerequisites(client.db);

  const officeTaskRepository = new OfficeTaskRepository(client.db);
  const officeTaskStepRepository = new OfficeTaskStepRepository(client.db);
  const officeArtifactRepository = new OfficeArtifactRepository(client.db);
  const officeReceiptRepository = new OfficeReceiptRepository(client.db);
  const officeAuditEventRepository = new OfficeAuditEventRepository(client.db);

  return {
    databasePath,
    officeTaskRepository,
    officeTaskStepRepository,
    officeArtifactRepository,
    officeReceiptRepository,
    officeAuditEventRepository,
    createTask(input: { inputJson: string }): OfficeTask {
      const task: OfficeTask = {
        id: `task-${Math.random().toString(16).slice(2)}`,
        userId: "user-1",
        workspaceId: "workspace-1",
        taskType: "browser",
        title: "OpenCLI bridge test",
        description: null,
        connectorId: "browser.opencli_bridge",
        targetRefKind: null,
        targetRefId: null,
        inputJson: input.inputJson,
        status: "ready",
        riskLevel: "low",
        approvalPolicyId: null,
        currentStepId: null,
        idempotencyKey: null,
        startedAt: null,
        finishedAt: null,
        createdAt: "2026-06-02T09:00:00.000Z",
        updatedAt: "2026-06-02T09:00:00.000Z"
      };
      officeTaskRepository.create(task);
      officeAuditEventRepository.create({
        id: `audit-${task.id}`,
        taskId: task.id,
        stepId: null,
        eventKind: "task_created",
        actorKind: "user",
        actorId: "user-1",
        summary: "created",
        payloadJson: "{}",
        createdAt: task.createdAt
      });
      return task;
    }
  };
}

function seedOfficeTaskPrerequisites(db: Database.Database): void {
  db.prepare(
    `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run("user-1", "user-1", "hash", "admin", "2026-06-02T09:00:00.000Z", "2026-06-02T09:00:00.000Z");
  db.prepare(
    `INSERT INTO workspaces (id, name, path, repo_root, favorite, sort_order, created_at, updated_at, removed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "workspace-1",
    "Workspace 1",
    "/tmp/workspace-1",
    "/tmp/workspace-1",
    0,
    0,
    "2026-06-02T09:00:00.000Z",
    "2026-06-02T09:00:00.000Z",
    null
  );
}

function createFakeOpenCliInstall(input: { pageSource: string }): string {
  const installPath = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-install-"));
  tempDirs.push(installPath);
  const browserDir = path.join(installPath, "dist", "src", "browser");
  mkdirSync(browserDir, { recursive: true });
  writeFileSync(
    path.join(installPath, "package.json"),
    JSON.stringify({ name: "@jackwener/opencli", version: "1.0.0" }, null, 2),
    "utf8"
  );
  writeFileSync(path.join(installPath, "cli-manifest.json"), "{}", "utf8");
  writeFileSync(path.join(browserDir, "page.js"), input.pageSource, "utf8");
  return installPath;
}

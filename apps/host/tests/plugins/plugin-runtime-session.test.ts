import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { hashPassword } from "../../src/shared/utils/hash.js";
import { createId } from "../../src/shared/utils/id.js";
import { PluginAuditEventRepository } from "../../src/storage/repositories/plugin-audit-event-repository.js";
import { PluginDefinitionRepository } from "../../src/storage/repositories/plugin-definition-repository.js";
import { PluginEnablementRepository } from "../../src/storage/repositories/plugin-enablement-repository.js";
import { PluginRuntimeSessionRepository } from "../../src/storage/repositories/plugin-runtime-session-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import { PluginRegistryService } from "../../src/modules/plugins/plugin-registry-service.js";
import { PluginRuntimeSessionService } from "../../src/modules/plugins/plugin-runtime-session-service.js";
import { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";
import { WorkspaceNavigationStateRepository } from "../../src/storage/repositories/workspace-navigation-state-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";

function createTempDatabase() {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-runtime-session-db-"));
  return createDatabaseClient(path.join(dbDir, "host.sqlite"));
}

function createPluginRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-runtime-session-root-"));
}

function createPlugin(rootDir: string) {
  const installRoot = path.join(rootDir, "demo-plugin");
  fs.mkdirSync(installRoot, { recursive: true });
  fs.writeFileSync(path.join(installRoot, "index.html"), "<html>demo</html>", "utf8");
  fs.writeFileSync(path.join(installRoot, "plugin.json"), JSON.stringify({
    id: "demo.plugin",
    name: "演示插件",
    version: "1.0.0",
    frontend: {
      entry: "index.html"
    },
    permissions: {}
  }, null, 2), "utf8");
}

describe("plugin-runtime-session-service", () => {
  it("能创建、读取并关闭运行实例", () => {
    const database = createTempDatabase();
    const pluginRootDir = createPluginRoot();
    createPlugin(pluginRootDir);

    const userId = createId();
    const workspaceId = createId();
    const now = new Date().toISOString();
    database.db.prepare(
      `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', ?, ?)`
    ).run(userId, "admin", hashPassword("password123"), now, now);

    const workspaceRepository = new WorkspaceRepository(database.db);
    workspaceRepository.create({
      id: workspaceId,
      name: "测试工作区",
      path: fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-runtime-session-workspace-")),
      repoRoot: null,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      removedAt: null
    });

    const pluginRegistryService = new PluginRegistryService(
      new PluginDefinitionRepository(database.db),
      new PluginEnablementRepository(database.db),
      new PluginAuditEventRepository(database.db),
      pluginRootDir,
      { warn: () => undefined }
    );
    pluginRegistryService.syncPluginsFromDisk();
    pluginRegistryService.enablePlugin("demo.plugin", userId);

    const workspaceService = new WorkspaceService(
      workspaceRepository,
      { run: async () => ({ stdout: "", stderr: "", exitCode: 0 }) } as never,
      new WorkspaceNavigationStateRepository(database.db)
    );
    const service = new PluginRuntimeSessionService(
      pluginRegistryService,
      new PluginRuntimeSessionRepository(database.db),
      workspaceService
    );

    const session = service.createSession({
      pluginId: "demo.plugin",
      workspaceId,
      openedByUserId: userId,
      source: "frontend"
    });

    expect(session.pluginId).toBe("demo.plugin");
    expect(session.workspaceId).toBe(workspaceId);
    expect(session.status).toBe("active");

    const active = service.getActiveSessionOrThrow(session.id);
    expect(active.id).toBe(session.id);

    const closed = service.closeSession(session.id);
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).toBeTruthy();

    expect(() => service.getActiveSessionOrThrow(session.id)).toThrowError(AppError);

    database.close();
  });

  it("禁用插件或不存在实例时会拒绝", () => {
    const database = createTempDatabase();
    const pluginRootDir = createPluginRoot();
    createPlugin(pluginRootDir);

    const userId = createId();
    const workspaceId = createId();
    const now = new Date().toISOString();
    database.db.prepare(
      `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', ?, ?)`
    ).run(userId, "admin", hashPassword("password123"), now, now);

    const workspaceRepository = new WorkspaceRepository(database.db);
    workspaceRepository.create({
      id: workspaceId,
      name: "测试工作区",
      path: fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-runtime-session-workspace-")),
      repoRoot: null,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      removedAt: null
    });

    const pluginRegistryService = new PluginRegistryService(
      new PluginDefinitionRepository(database.db),
      new PluginEnablementRepository(database.db),
      new PluginAuditEventRepository(database.db),
      pluginRootDir,
      { warn: () => undefined }
    );
    pluginRegistryService.syncPluginsFromDisk();

    const workspaceService = new WorkspaceService(
      workspaceRepository,
      { run: async () => ({ stdout: "", stderr: "", exitCode: 0 }) } as never,
      new WorkspaceNavigationStateRepository(database.db)
    );
    const service = new PluginRuntimeSessionService(
      pluginRegistryService,
      new PluginRuntimeSessionRepository(database.db),
      workspaceService
    );

    expect(() => service.createSession({
      pluginId: "demo.plugin",
      workspaceId,
      openedByUserId: userId,
      source: "frontend"
    })).toThrowError(AppError);

    expect(() => service.getSessionOrThrow("missing-session")).toThrowError(AppError);

    database.close();
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { hashPassword } from "../../src/shared/utils/hash.js";
import { createId } from "../../src/shared/utils/id.js";
import { nowIso } from "../../src/shared/utils/time.js";
import { PluginDefinitionRepository } from "../../src/storage/repositories/plugin-definition-repository.js";
import { PluginPermissionGrantRepository } from "../../src/storage/repositories/plugin-permission-grant-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import { PluginPermissionService } from "../../src/modules/plugins/plugin-permission-service.js";

function createTempDatabase() {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-permission-db-"));
  return createDatabaseClient(path.join(dbDir, "host.sqlite"));
}

function seedPermissionDeps(database: ReturnType<typeof createDatabaseClient>) {
  const pluginId = "demo.plugin";
  const workspaceId = "workspace-1";
  const userId = "user-1";
  const now = nowIso();
  database.db.prepare(
    `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', ?, ?)`
  ).run(userId, "admin", hashPassword("password123"), now, now);

  new WorkspaceRepository(database.db).create({
    id: workspaceId,
    name: "测试工作区",
    path: fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-permission-workspace-")),
    repoRoot: null,
    favorite: false,
    createdAt: now,
    updatedAt: now,
    removedAt: null
  });

  new PluginDefinitionRepository(database.db).upsert({
    id: pluginId,
    version: "1.0.0",
    name: "演示插件",
    installRoot: "/tmp/demo-plugin",
    manifestJson: JSON.stringify({ id: pluginId }),
    hasFrontend: true,
    hasBackend: true,
    createdAt: now,
    updatedAt: now
  });

  return { pluginId, workspaceId, userId };
}

const baseManifest = {
  id: "demo.plugin",
  name: "演示插件",
  version: "1.0.0",
  permissions: {}
};

describe("plugin-permission-service", () => {
  it("未声明权限会直接拒绝", () => {
    const service = new PluginPermissionService();

    expect(() => service.assertWorkspaceRead(baseManifest, {
      pluginId: "demo.plugin",
      workspaceId: "workspace-1"
    })).toThrowError(AppError);

    try {
      service.assertWorkspaceRead(baseManifest, {
        pluginId: "demo.plugin",
        workspaceId: "workspace-1"
      });
    } catch (error) {
      expect((error as AppError).errorCode).toBe("PLUGIN_PERMISSION_DECLARATION_MISSING");
    }
  });

  it("已声明但未授权会返回正式 grant required 错误", () => {
    const service = new PluginPermissionService();

    expect(() => service.assertWorkspaceRead({
      ...baseManifest,
      permissions: {
        workspaceRead: true
      }
    }, {
      pluginId: "demo.plugin",
      workspaceId: "workspace-1"
    })).toThrowError(AppError);

    try {
      service.assertWorkspaceRead({
        ...baseManifest,
        permissions: {
          workspaceRead: true
        }
      }, {
        pluginId: "demo.plugin",
        workspaceId: "workspace-1"
      });
    } catch (error) {
      const appError = error as AppError;
      expect(appError.errorCode).toBe("PLUGIN_PERMISSION_GRANT_REQUIRED");
      expect(appError.data).toMatchObject({
        permissionKey: "workspace.read_file"
      });
    }
  });

  it("已授权会正常放行，撤销后重新变成未授权", () => {
    const database = createTempDatabase();
    const { pluginId, workspaceId, userId } = seedPermissionDeps(database);
    const repository = new PluginPermissionGrantRepository(database.db);
    const service = new PluginPermissionService(repository);
    const grant = repository.create({
      id: createId(),
      pluginId,
      workspaceId,
      permissionKey: "workspace.read_file",
      scopeType: "workspace",
      scopePath: null,
      grantMode: "persistent",
      grantedByUserId: userId,
      runtimeSessionId: null,
      createdAt: nowIso(),
      expiresAt: null,
      revokedAt: null
    });

    const allowed = service.assertWorkspaceRead({
      ...baseManifest,
      permissions: {
        workspaceRead: true
      }
    }, {
      pluginId,
      workspaceId
    });
    expect(allowed.id).toBe(grant.id);

    repository.revokeById(grant.id, nowIso());

    expect(() => service.assertWorkspaceRead({
      ...baseManifest,
      permissions: {
        workspaceRead: true
      }
    }, {
      pluginId,
      workspaceId
    })).toThrowError(AppError);

    database.close();
  });

  it("目录级授权会匹配子路径，session 授权只匹配当前实例", () => {
    const database = createTempDatabase();
    const { pluginId, workspaceId, userId } = seedPermissionDeps(database);
    const repository = new PluginPermissionGrantRepository(database.db);
    const service = new PluginPermissionService(repository);
    database.db.prepare(
      `INSERT INTO plugin_runtime_sessions (
         id,
         plugin_id,
         workspace_id,
         opened_by_user_id,
         source,
         status,
         created_at,
         updated_at,
         closed_at
       ) VALUES (?, ?, ?, ?, 'frontend', 'active', ?, ?, NULL)`
    ).run("runtime-1", pluginId, workspaceId, userId, nowIso(), nowIso());

    repository.create({
      id: createId(),
      pluginId,
      workspaceId,
      permissionKey: "desktop.open_file",
      scopeType: "directory",
      scopePath: "reports",
      grantMode: "session",
      grantedByUserId: userId,
      runtimeSessionId: "runtime-1",
      createdAt: nowIso(),
      expiresAt: null,
      revokedAt: null
    });

    const manifest = {
      ...baseManifest,
      permissions: {
        desktop: ["open_file"] as const
      }
    };

    const allowed = service.assertDesktopPermission(
      manifest,
      {
        pluginId,
        workspaceId
      },
      "open_file",
      "reports/today.txt",
      "runtime-1"
    );
    expect(allowed.scopeType).toBe("directory");

    expect(() => service.assertDesktopPermission(
      manifest,
      {
        pluginId,
        workspaceId
      },
      "open_file",
      "reports/today.txt",
      "runtime-2"
    )).toThrowError(AppError);

    database.close();
  });
});

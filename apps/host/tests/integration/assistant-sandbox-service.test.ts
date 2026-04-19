import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantSandboxService } from "../../src/modules/butler/assistant-sandbox-service.js";
import { AssistantSandboxWorkspaceRepository } from "../../src/storage/repositories/assistant-sandbox-workspace-repository.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/storage/sqlite/client.js";

describe("AssistantSandboxService", () => {
  const databases: DatabaseClient[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    while (databases.length > 0) {
      databases.pop()?.close();
    }

    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();

      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it("会创建空白沙箱，并支持晋升为项目与删除", async () => {
    const database = createDatabaseClient(":memory:");
    databases.push(database);
    database.db.exec(`
      INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
      VALUES ('user-1', 'admin', 'hash', 'admin', '2026-04-17T00:00:00.000Z', '2026-04-17T00:00:00.000Z');
    `);
    const butlerWorkspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-sandbox-"));
    tempDirs.push(butlerWorkspacePath);
    const importedWorkspace = {
      id: "workspace-sandbox-1",
      name: "CodingNS 临时沙箱",
      path: path.join(butlerWorkspacePath, "sandboxes", "codingns-sandbox"),
      repoRoot: path.join(butlerWorkspacePath, "sandboxes", "codingns-sandbox"),
      favorite: false,
      sortOrder: 0,
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
      removedAt: null
    };
    database.db.exec(`
      INSERT INTO workspaces (
        id,
        name,
        path,
        repo_root,
        favorite,
        sort_order,
        created_at,
        updated_at,
        removed_at
      ) VALUES (
        'workspace-sandbox-1',
        'CodingNS 临时沙箱',
        '${importedWorkspace.path}',
        '${importedWorkspace.repoRoot}',
        0,
        0,
        '2026-04-17T00:00:00.000Z',
        '2026-04-17T00:00:00.000Z',
        NULL
      );
    `);
    const workspaceService = {
      importWorkspace: vi.fn(() => importedWorkspace),
      cloneWorkspace: vi.fn(),
      removeWorkspace: vi.fn(() => ({
        ...importedWorkspace,
        removedAt: "2026-04-17T00:10:00.000Z"
      })),
      getWorkspaceOrThrow: vi.fn(() => importedWorkspace)
    };
    const butlerProjectService = {
      create: vi.fn()
    };
    const service = new AssistantSandboxService(
      new AssistantSandboxWorkspaceRepository(database.db),
      {
        getProfile: vi.fn(() => ({
          workspacePath: butlerWorkspacePath
        }))
      } as any,
      workspaceService as any,
      butlerProjectService as any
    );

    const sandbox = await service.createSandbox({
      userId: "user-1",
      title: "CodingNS 临时沙箱",
      purpose: "验证 sandbox 链路",
      source: {
        kind: "blank",
        directoryName: "codingns-sandbox"
      }
    });

    expect(sandbox.status).toBe("active");
    expect(service.resolveWorkspaceId(sandbox.id, "user-1")).toBe("workspace-sandbox-1");

    const promoted = service.promoteSandbox(sandbox.id, "user-1", {
      mode: "project",
      projectName: "CodingNS 沙箱项目",
      defaultProvider: "codex"
    });
    expect(promoted.visibility).toBe("pinned");
    expect(butlerProjectService.create).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-sandbox-1",
      name: "CodingNS 沙箱项目",
      defaultProvider: "codex"
    }));

    const removed = service.removeSandbox(sandbox.id, "user-1");
    expect(removed.status).toBe("deleted");
    expect(workspaceService.removeWorkspace).toHaveBeenCalledWith("workspace-sandbox-1");
  });

  it("删除会话后会把临时沙箱标记为孤立，并在到期后自动清理", async () => {
    const database = createDatabaseClient(":memory:");
    databases.push(database);
    const butlerWorkspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-orphan-"));
    tempDirs.push(butlerWorkspacePath);
    const sandboxPath = path.join(butlerWorkspacePath, "sandboxes", "sandbox-orphan-1");
    mkdirSync(sandboxPath, { recursive: true });
    database.db.exec(`
      INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
      VALUES ('user-1', 'admin', 'hash', 'admin', '2026-04-17T00:00:00.000Z', '2026-04-17T00:00:00.000Z');

      INSERT INTO workspaces (
        id,
        name,
        path,
        repo_root,
        favorite,
        sort_order,
        created_at,
        updated_at,
        removed_at
      ) VALUES (
        'workspace-sandbox-2',
        '孤立沙箱',
        '${sandboxPath}',
        '${sandboxPath}',
        0,
        0,
        '2026-04-17T00:00:00.000Z',
        '2026-04-17T00:00:00.000Z',
        NULL
      );
    `);
    const workspaceService = {
      importWorkspace: vi.fn(),
      cloneWorkspace: vi.fn(),
      removeWorkspace: vi.fn(() => ({
        id: "workspace-sandbox-2",
        name: "孤立沙箱",
        path: sandboxPath,
        repoRoot: sandboxPath,
        favorite: false,
        sortOrder: 0,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        removedAt: "2026-05-20T00:00:00.000Z"
      })),
      getWorkspaceOrThrow: vi.fn(() => ({
        id: "workspace-sandbox-2",
        name: "孤立沙箱",
        path: sandboxPath,
        repoRoot: sandboxPath,
        favorite: false,
        sortOrder: 0,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        removedAt: null
      }))
    };
    const service = new AssistantSandboxService(
      new AssistantSandboxWorkspaceRepository(database.db),
      {
        getProfile: vi.fn(() => ({
          workspacePath: butlerWorkspacePath
        }))
      } as any,
      workspaceService as any
    );

    database.db.exec(`
      INSERT INTO assistant_sandboxes (
        id,
        user_id,
        workspace_id,
        control_session_id,
        title,
        description,
        source_kind,
        source_ref,
        visibility,
        status,
        purpose,
        expires_at,
        promoted_at,
        created_at,
        updated_at
      ) VALUES (
        'sandbox-orphan-1',
        'user-1',
        'workspace-sandbox-2',
        NULL,
        '孤立沙箱',
        NULL,
        'blank',
        '${sandboxPath}',
        'assistant_only',
        'active',
        '等待会话删除',
        NULL,
        NULL,
        '2026-04-17T00:00:00.000Z',
        '2026-04-17T00:00:00.000Z'
      );
    `);

    const orphaned = service.markSandboxOrphanedByWorkspaceId("workspace-sandbox-2", "user-1");
    expect(orphaned?.status).toBe("orphaned");
    expect(orphaned?.controlSessionId).toBeNull();
    expect(orphaned?.expiresAt).not.toBeNull();
    expect(
      Math.round(
        (Date.parse(orphaned?.expiresAt ?? "") - Date.parse(orphaned?.updatedAt ?? "")) / (24 * 60 * 60 * 1000)
      )
    ).toBe(30);

    const cleanupResult = await service.runDueCleanup("2026-05-20T00:00:00.000Z");
    const cleaned = service.getSandbox("sandbox-orphan-1", "user-1");

    expect(cleanupResult.dueSandboxCount).toBe(1);
    expect(cleanupResult.cleanedSandboxCount).toBe(1);
    expect(cleaned.status).toBe("deleted");
    expect(workspaceService.removeWorkspace).toHaveBeenCalledWith("workspace-sandbox-2");
    expect(existsSync(sandboxPath)).toBe(false);
  });

  it("已晋升的沙箱在会话删除后不会进入自动删除队列", async () => {
    const database = createDatabaseClient(":memory:");
    databases.push(database);
    const butlerWorkspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-preserved-"));
    tempDirs.push(butlerWorkspacePath);
    const sandboxPath = path.join(butlerWorkspacePath, "sandboxes", "sandbox-orphan-2");
    mkdirSync(sandboxPath, { recursive: true });
    database.db.exec(`
      INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
      VALUES ('user-1', 'admin', 'hash', 'admin', '2026-04-17T00:00:00.000Z', '2026-04-17T00:00:00.000Z');

      INSERT INTO workspaces (
        id,
        name,
        path,
        repo_root,
        favorite,
        sort_order,
        created_at,
        updated_at,
        removed_at
      ) VALUES (
        'workspace-sandbox-3',
        '保留沙箱',
        '${sandboxPath}',
        '${sandboxPath}',
        0,
        0,
        '2026-04-17T00:00:00.000Z',
        '2026-04-17T00:00:00.000Z',
        NULL
      );
    `);
    const workspaceService = {
      importWorkspace: vi.fn(),
      cloneWorkspace: vi.fn(),
      removeWorkspace: vi.fn(),
      getWorkspaceOrThrow: vi.fn(() => ({
        id: "workspace-sandbox-3",
        name: "保留沙箱",
        path: sandboxPath,
        repoRoot: sandboxPath,
        favorite: false,
        sortOrder: 0,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        removedAt: null
      }))
    };
    const service = new AssistantSandboxService(
      new AssistantSandboxWorkspaceRepository(database.db),
      {
        getProfile: vi.fn(() => ({
          workspacePath: butlerWorkspacePath
        }))
      } as any,
      workspaceService as any
    );

    database.db.exec(`
      INSERT INTO assistant_sandboxes (
        id,
        user_id,
        workspace_id,
        control_session_id,
        title,
        description,
        source_kind,
        source_ref,
        visibility,
        status,
        purpose,
        expires_at,
        promoted_at,
        created_at,
        updated_at
      ) VALUES (
        'sandbox-orphan-2',
        'user-1',
        'workspace-sandbox-3',
        NULL,
        '保留沙箱',
        NULL,
        'blank',
        '${sandboxPath}',
        'pinned',
        'active',
        '已经晋升',
        NULL,
        '2026-04-18T00:00:00.000Z',
        '2026-04-17T00:00:00.000Z',
        '2026-04-17T00:00:00.000Z'
      );
    `);

    const preserved = service.markSandboxOrphanedByWorkspaceId("workspace-sandbox-3", "user-1");

    expect(preserved?.status).toBe("active");
    expect(preserved?.expiresAt).toBeNull();
    expect(workspaceService.removeWorkspace).not.toHaveBeenCalled();
    expect(existsSync(sandboxPath)).toBe(true);
  });
});

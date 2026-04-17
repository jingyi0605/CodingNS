import { mkdtempSync, rmSync } from "node:fs";
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
});

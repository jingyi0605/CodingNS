import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SessionCleanupService } from "../../src/modules/session-cleanup/session-cleanup-service.js";
import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../src/modules/tasks/task-types.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionCleanupRepository } from "../../src/storage/repositories/session-cleanup-repository.js";
import { SessionSourceIndexRepository } from "../../src/storage/repositories/session-source-index-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("SessionCleanupService", () => {
  it("会注册四类后台任务并记录最近扫描结果", async () => {
    const database = createDatabaseClient(":memory:");
    seedUser(database.db);
    seedWorkspace(database.db);
    const repository = new SessionCleanupRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionSourceIndexRepository = new SessionSourceIndexRepository(database.db);
    const workspaceRepository = new WorkspaceRepository(database.db);
    const taskManager = createTaskManager();
    const service = new SessionCleanupService(
      repository,
      sessionBindingRepository,
      sessionIndexRepository,
      sessionSourceIndexRepository,
      workspaceRepository,
      taskManager
    );

    sessionBindingRepository.upsert({
      sessionId: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/codex/session-1.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      sessionVisibility: "workspace",
      parentSessionId: null,
      sessionKind: "default",
      annotationSourceMessageId: null,
      annotationSourceText: null,
      isSubagent: false,
      subagentLabel: null,
      title: "测试会话",
      messageCount: 3,
      isArchived: false,
      lastMessageAt: "2026-06-15T10:00:00.000Z",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-15T10:00:00.000Z"
    });
    sessionSourceIndexRepository.upsert({
      sourceKey: "codex:/tmp/codex/session-1.jsonl",
      provider: "codex",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/codex/session-1.jsonl",
      workspacePath: "/tmp/workspace-1",
      fingerprintMtimeMs: 1718000000000,
      fingerprintSizeBytes: 4096,
      fingerprintInode: null,
      fingerprintVersion: null,
      title: "测试会话",
      messageCount: 3,
      lastMessageAt: "2026-06-15T10:00:00.000Z",
      isArchivedHint: false,
      lastParsedAt: "2026-06-15T10:00:00.000Z",
      lastVerifiedAt: "2026-06-15T10:00:00.000Z",
      sampleDueAt: null,
      deletedAt: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-15T10:00:00.000Z"
    });

    expect(taskManager.has(HOST_TASK_TYPES.sessionCleanupScan)).toBe(true);
    expect(taskManager.has(HOST_TASK_TYPES.sessionCleanupBackup)).toBe(true);
    expect(taskManager.has(HOST_TASK_TYPES.sessionCleanupRestore)).toBe(true);
    expect(taskManager.has(HOST_TASK_TYPES.sessionCleanupDelete)).toBe(true);

    const handle = service.requestScan({
      userId: "user-1",
      providers: ["opencode", "codex", "codex"],
      startAt: "2026-06-01T00:00:00.000Z",
      endAt: "2026-06-17T00:00:00.000Z",
      force: true
    });
    const result = await handle.promise;

    expect(result.summary).toEqual({
      providers: ["codex", "opencode"],
      forced: true,
      candidates: [
        expect.objectContaining({
          provider: "codex",
          sessionId: "session-1",
          title: "测试会话",
          sourceHealth: "healthy",
          estimatedBytes: 4096
        })
      ]
    });
    expect(service.readLatestScan("user-1")).toEqual(
      expect.objectContaining({
        id: result.operationId,
        userId: "user-1",
        providerFilterJson: "[\"codex\",\"opencode\"]",
        candidateCount: 1
      })
    );

    database.close();
  });

  it("可以生成备份包、检查清单并选择性恢复到可见链路", async () => {
    const database = createDatabaseClient(":memory:");
    seedUser(database.db);
    seedWorkspace(database.db);
    const repository = new SessionCleanupRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionSourceIndexRepository = new SessionSourceIndexRepository(database.db);
    const workspaceRepository = new WorkspaceRepository(database.db);
    const taskManager = createTaskManager();
    const service = new SessionCleanupService(
      repository,
      sessionBindingRepository,
      sessionIndexRepository,
      sessionSourceIndexRepository,
      workspaceRepository,
      taskManager
    );
    const workspacePath = "/tmp/workspace-1";
    const rawStoreRef = path.join(workspacePath, ".codex", "session-restore-1.jsonl");
    mkdirSync(path.dirname(rawStoreRef), { recursive: true });
    writeFileSync(rawStoreRef, "{\"hello\":\"world\"}\n", "utf8");

    sessionBindingRepository.upsert({
      sessionId: "session-restore-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-restore-1",
      rawStoreRef,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-restore-1",
      workspaceId: "workspace-1",
      provider: "codex",
      sessionVisibility: "workspace",
      parentSessionId: null,
      sessionKind: "default",
      annotationSourceMessageId: null,
      annotationSourceText: null,
      isSubagent: false,
      subagentLabel: null,
      title: "可恢复会话",
      messageCount: 2,
      isArchived: false,
      lastMessageAt: "2026-06-16T10:00:00.000Z",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-16T10:00:00.000Z"
    });
    sessionSourceIndexRepository.upsert({
      sourceKey: `codex:${rawStoreRef}`,
      provider: "codex",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "provider-session-restore-1",
      rawStoreRef,
      workspacePath,
      fingerprintMtimeMs: 1718000000000,
      fingerprintSizeBytes: 15,
      fingerprintInode: null,
      fingerprintVersion: null,
      title: "可恢复会话",
      messageCount: 2,
      lastMessageAt: "2026-06-16T10:00:00.000Z",
      isArchivedHint: false,
      lastParsedAt: "2026-06-16T10:00:00.000Z",
      lastVerifiedAt: "2026-06-16T10:00:00.000Z",
      sampleDueAt: null,
      deletedAt: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-16T10:00:00.000Z"
    });

    const scan = await service.requestScan({
      userId: "user-1",
      providers: ["codex"],
      force: true
    }).promise;
    const candidateId = scan.summary.candidates[0]?.candidateId;
    expect(candidateId).toBeTruthy();

    const archivePath = path.join(workspacePath, "backups", "cleanup-backup-1.cns-session-cleanup");
    const backup = await service.requestBackup({
      userId: "user-1",
      candidateIds: [candidateId!],
      archivePath
    }).promise;

    expect(backup.sessionCount).toBe(1);
    expect(existsSync(archivePath)).toBe(true);

    const inspection = await service.inspectArchive(archivePath);
    expect(inspection.manifest.summary.sessionCount).toBe(1);
    expect(inspection.restorableEntries).toHaveLength(1);
    expect(inspection.restorableEntries[0]).toMatchObject({
      title: "可恢复会话",
      restorable: false,
      conflict: {
        hasConflict: true
      }
    });

    database.db.prepare("DELETE FROM session_source_index").run();
    database.db.prepare("DELETE FROM session_indices").run();
    database.db.prepare("DELETE FROM session_bindings").run();

    const inspectionAfterDelete = await service.inspectArchive(archivePath);
    expect(inspectionAfterDelete.restorableEntries[0]).toMatchObject({
      restorable: true,
      conflict: {
        hasConflict: false
      }
    });

    const restore = await service.requestRestore({
      userId: "user-1",
      archivePath,
      entryIds: [inspectionAfterDelete.manifest.entries[0]!.entryId]
    }).promise;

    expect(restore.restoredCount).toBe(1);
    expect(sessionBindingRepository.findBySessionId("session-restore-1")).toMatchObject({
      provider: "codex",
      providerSessionId: "provider-session-restore-1"
    });
    expect(sessionIndexRepository.findIndexRecordBySessionId("session-restore-1")).toMatchObject({
      title: "可恢复会话"
    });
    expect(sessionSourceIndexRepository.listByWorkspaceId("workspace-1")).toHaveLength(1);

    database.close();
  });

  it("批量删除会复用单条删除执行器并返回逐条结果", async () => {
    const database = createDatabaseClient(":memory:");
    seedUser(database.db);
    seedWorkspace(database.db);
    const repository = new SessionCleanupRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionSourceIndexRepository = new SessionSourceIndexRepository(database.db);
    const workspaceRepository = new WorkspaceRepository(database.db);
    const taskManager = createTaskManager();
    const service = new SessionCleanupService(
      repository,
      sessionBindingRepository,
      sessionIndexRepository,
      sessionSourceIndexRepository,
      workspaceRepository,
      taskManager
    );

    sessionBindingRepository.upsert({
      sessionId: "session-delete-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-delete-1",
      rawStoreRef: "/tmp/codex/session-delete-1.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-delete-1",
      workspaceId: "workspace-1",
      provider: "codex",
      sessionVisibility: "workspace",
      parentSessionId: null,
      sessionKind: "default",
      annotationSourceMessageId: null,
      annotationSourceText: null,
      isSubagent: false,
      subagentLabel: null,
      title: "删除会话",
      messageCount: 1,
      isArchived: false,
      lastMessageAt: "2026-06-16T10:00:00.000Z",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-16T10:00:00.000Z"
    });

    const scan = await service.requestScan({
      userId: "user-1",
      providers: ["codex"],
      force: true
    }).promise;
    const candidateId = scan.summary.candidates[0]?.candidateId;
    expect(candidateId).toBeTruthy();

    service.configureDeleteExecutor(async (sessionId) => {
      database.db.prepare("DELETE FROM session_indices WHERE session_id = ?").run(sessionId);
      database.db.prepare("DELETE FROM session_bindings WHERE session_id = ?").run(sessionId);
    });

    const deletion = await service.requestDelete({
      userId: "user-1",
      candidateIds: [candidateId!]
    }).promise;

    expect(deletion.deletedCount).toBe(1);
    expect(sessionBindingRepository.findBySessionId("session-delete-1")).toBeNull();
    expect(sessionIndexRepository.findIndexRecordBySessionId("session-delete-1")).toBeNull();

    database.close();
  });

  it("删除后复核失败时会把结果标成 partial", async () => {
    const database = createDatabaseClient(":memory:");
    seedUser(database.db);
    seedWorkspace(database.db);
    const repository = new SessionCleanupRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionSourceIndexRepository = new SessionSourceIndexRepository(database.db);
    const workspaceRepository = new WorkspaceRepository(database.db);
    const taskManager = createTaskManager();
    const service = new SessionCleanupService(
      repository,
      sessionBindingRepository,
      sessionIndexRepository,
      sessionSourceIndexRepository,
      workspaceRepository,
      taskManager
    );

    sessionBindingRepository.upsert({
      sessionId: "session-delete-verify-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-delete-verify-1",
      rawStoreRef: "/tmp/codex/session-delete-verify-1.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-delete-verify-1",
      workspaceId: "workspace-1",
      provider: "codex",
      sessionVisibility: "workspace",
      parentSessionId: null,
      sessionKind: "default",
      annotationSourceMessageId: null,
      annotationSourceText: null,
      isSubagent: false,
      subagentLabel: null,
      title: "删除复核会话",
      messageCount: 1,
      isArchived: false,
      lastMessageAt: "2026-06-16T10:00:00.000Z",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-16T10:00:00.000Z"
    });

    const scan = await service.requestScan({
      userId: "user-1",
      providers: ["codex"],
      force: true
    }).promise;
    const candidateId = scan.summary.candidates[0]?.candidateId;
    expect(candidateId).toBeTruthy();

    service.configureDeleteExecutor(async (sessionId) => {
      database.db.prepare("DELETE FROM session_indices WHERE session_id = ?").run(sessionId);
      database.db.prepare("DELETE FROM session_bindings WHERE session_id = ?").run(sessionId);
    });
    service.configureDeleteVerificationExecutor(async () => {
      throw new Error("session_reappeared_after_delete_verification");
    });

    const deletion = await service.requestDelete({
      userId: "user-1",
      candidateIds: [candidateId!]
    }).promise;

    expect(deletion.deletedCount).toBe(1);
    expect(repository.listOperationItemsByOperationId(deletion.operationId)).toEqual([
      expect.objectContaining({
        status: "partial",
        detail: expect.stringContaining("删除后复核失败")
      })
    ]);

    database.close();
  });
});

function seedUser(db: ReturnType<typeof createDatabaseClient>["db"]): void {
  db.exec(`
    INSERT INTO auth_users (
      id,
      username,
      password_hash,
      role,
      status,
      created_at,
      updated_at
    ) VALUES (
      'user-1',
      'admin',
      'hash',
      'admin',
      'active',
      '2026-06-17T09:00:00.000Z',
      '2026-06-17T09:00:00.000Z'
    );
  `);
}

function seedWorkspace(db: ReturnType<typeof createDatabaseClient>["db"]): void {
  db.exec(`
    INSERT INTO workspaces (
      id,
      owner_user_id,
      name,
      path,
      repo_root,
      favorite,
      sort_order,
      created_at,
      updated_at,
      removed_at
    ) VALUES (
      'workspace-1',
      'user-1',
      '主工作区',
      '/tmp/workspace-1',
      '/tmp/workspace-1',
      0,
      0,
      '2026-06-10T09:00:00.000Z',
      '2026-06-10T09:00:00.000Z',
      NULL
    );
  `);
}

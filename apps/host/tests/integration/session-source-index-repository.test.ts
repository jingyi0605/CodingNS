import { describe, expect, it } from "vitest";

import { SessionDiscoveryDiagnosticsRepository } from "../../src/storage/repositories/session-discovery-diagnostics-repository.js";
import { SessionSourceIndexRepository } from "../../src/storage/repositories/session-source-index-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("SessionSourceIndexRepository", () => {
  it("可以持久化来源索引与 discovery diagnostics", () => {
    const database = createDatabaseClient(":memory:");
    seedWorkspace(database.db);

    const sourceRepository = new SessionSourceIndexRepository(database.db);
    const diagnosticsRepository = new SessionDiscoveryDiagnosticsRepository(database.db);

    sourceRepository.upsert({
      sourceKey: "codex:/tmp/workspace/session-1.jsonl",
      provider: "codex",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/workspace/session-1.jsonl",
      workspacePath: "/tmp/workspace",
      fingerprintMtimeMs: 1718000000000,
      fingerprintSizeBytes: 4096,
      fingerprintInode: "100:200",
      fingerprintVersion: null,
      title: "会话 1",
      messageCount: 12,
      lastMessageAt: "2026-06-10T10:00:00.000Z",
      isArchivedHint: false,
      lastParsedAt: "2026-06-10T10:01:00.000Z",
      lastVerifiedAt: "2026-06-10T10:02:00.000Z",
      sampleDueAt: "2026-06-11T10:00:00.000Z",
      deletedAt: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:02:00.000Z"
    });

    diagnosticsRepository.insert({
      id: "diag-1",
      workspaceId: "workspace-1",
      triggerSource: "session_history.request_workspace_discovery",
      provider: "codex",
      isComplete: true,
      status: "ok",
      durationMs: 320,
      sessionCount: 3,
      scannedFiles: 10,
      skippedByFingerprint: 8,
      parsedFiles: 2,
      bytesRead: 2048,
      createdAt: "2026-06-10T10:03:00.000Z"
    });

    expect(sourceRepository.findBySourceKey("codex:/tmp/workspace/session-1.jsonl")).toEqual({
      sourceKey: "codex:/tmp/workspace/session-1.jsonl",
      provider: "codex",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/workspace/session-1.jsonl",
      workspacePath: "/tmp/workspace",
      fingerprintMtimeMs: 1718000000000,
      fingerprintSizeBytes: 4096,
      fingerprintInode: "100:200",
      fingerprintVersion: null,
      title: "会话 1",
      messageCount: 12,
      lastMessageAt: "2026-06-10T10:00:00.000Z",
      isArchivedHint: false,
      lastParsedAt: "2026-06-10T10:01:00.000Z",
      lastVerifiedAt: "2026-06-10T10:02:00.000Z",
      sampleDueAt: "2026-06-11T10:00:00.000Z",
      deletedAt: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:02:00.000Z"
    });
    expect(sourceRepository.listByWorkspaceId("workspace-1")).toHaveLength(1);
    expect(diagnosticsRepository.listByWorkspaceId("workspace-1")).toEqual([
      {
        id: "diag-1",
        workspaceId: "workspace-1",
        triggerSource: "session_history.request_workspace_discovery",
        provider: "codex",
        isComplete: true,
        status: "ok",
        durationMs: 320,
        sessionCount: 3,
        scannedFiles: 10,
        skippedByFingerprint: 8,
        parsedFiles: 2,
        bytesRead: 2048,
        createdAt: "2026-06-10T10:03:00.000Z"
      }
    ]);

    database.close();
  });
});

function seedWorkspace(db: ReturnType<typeof createDatabaseClient>["db"]): void {
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
      '2026-06-10T09:00:00.000Z',
      '2026-06-10T09:00:00.000Z'
    );

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
      '/tmp/workspace',
      '/tmp/workspace',
      0,
      0,
      '2026-06-10T09:00:00.000Z',
      '2026-06-10T09:00:00.000Z',
      NULL
    );
  `);
}

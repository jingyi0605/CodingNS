import { describe, expect, it } from "vitest";

import { SessionCleanupRepository } from "../../src/storage/repositories/session-cleanup-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("SessionCleanupRepository", () => {
  it("可以持久化最近扫描、备份记录和逐条操作结果", () => {
    const database = createDatabaseClient(":memory:");
    seedUser(database.db);
    const repository = new SessionCleanupRepository(database.db);

    repository.insertScan({
      id: "scan-1",
      userId: "user-1",
      providerFilterJson: "[\"codex\",\"opencode\"]",
      timeRangeStart: "2026-06-01T00:00:00.000Z",
      timeRangeEnd: "2026-06-17T00:00:00.000Z",
      candidateCount: 5,
      summaryJson: "{\"providers\":[\"codex\",\"opencode\"]}",
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: "2026-06-17T10:00:00.000Z"
    });
    repository.insertArchive({
      id: "archive-1",
      userId: "user-1",
      archivePath: "/tmp/session-cleanup.zip",
      manifestVersion: "1",
      sessionCount: 2,
      summaryJson: "{\"providers\":{\"codex\":1,\"opencode\":1}}",
      createdAt: "2026-06-17T10:05:00.000Z",
      updatedAt: "2026-06-17T10:05:00.000Z"
    });
    repository.insertOperationItems([
      {
        id: "item-1",
        operationId: "operation-1",
        taskKind: "delete",
        candidateId: "candidate-1",
        provider: "codex",
        sessionId: "session-1",
        providerSessionId: "provider-session-1",
        rawStoreRef: "/tmp/codex/session-1.jsonl",
        status: "partial",
        backupStatus: "done",
        providerDeleteStatus: "failed",
        localDeleteStatus: "done",
        restoreStatus: null,
        detail: "provider 删除失败",
        createdAt: "2026-06-17T10:10:00.000Z",
        updatedAt: "2026-06-17T10:10:00.000Z"
      }
    ]);

    expect(repository.findLatestScanByUserId("user-1")).toEqual({
      id: "scan-1",
      userId: "user-1",
      providerFilterJson: "[\"codex\",\"opencode\"]",
      timeRangeStart: "2026-06-01T00:00:00.000Z",
      timeRangeEnd: "2026-06-17T00:00:00.000Z",
      candidateCount: 5,
      summaryJson: "{\"providers\":[\"codex\",\"opencode\"]}",
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: "2026-06-17T10:00:00.000Z"
    });
    expect(repository.listArchivesByUserId("user-1")).toHaveLength(1);
    expect(repository.listOperationItemsByOperationId("operation-1")).toEqual([
      {
        id: "item-1",
        operationId: "operation-1",
        taskKind: "delete",
        candidateId: "candidate-1",
        provider: "codex",
        sessionId: "session-1",
        providerSessionId: "provider-session-1",
        rawStoreRef: "/tmp/codex/session-1.jsonl",
        status: "partial",
        backupStatus: "done",
        providerDeleteStatus: "failed",
        localDeleteStatus: "done",
        restoreStatus: null,
        detail: "provider 删除失败",
        createdAt: "2026-06-17T10:10:00.000Z",
        updatedAt: "2026-06-17T10:10:00.000Z"
      }
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


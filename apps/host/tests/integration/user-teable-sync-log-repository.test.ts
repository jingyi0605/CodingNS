import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { UserTeableSyncLogRepository } from "../../src/storage/repositories/user-teable-sync-log-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("UserTeableSyncLogRepository", () => {
  it("可以保存、更新并查询 Teable 同步日志", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-teable-sync-log-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const database = createDatabaseClient(databasePath);

    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        "user-1",
        "admin",
        "hash",
        "admin",
        "2026-06-05T08:35:00.000Z",
        "2026-06-05T08:35:00.000Z"
      );

    const repository = new UserTeableSyncLogRepository(database.db);
    const created = repository.create({
      logId: "log-1",
      userId: "user-1",
      triggerType: "local_change",
      sourceTypesJson: JSON.stringify(["tags"]),
      taskId: null,
      state: "queued",
      summary: "本地标签变化，已准备同步到 Teable",
      countsJson: "{}",
      errorDetail: null,
      reason: "tag_definition_saved:tag-1",
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-06-05T08:36:00.000Z",
      updatedAt: "2026-06-05T08:36:00.000Z"
    });

    expect(created.state).toBe("queued");

    repository.update({
      ...created,
      taskId: "task-1",
      state: "succeeded",
      summary: "Teable 镜像同步完成",
      countsJson: JSON.stringify({ tags: { created: 1, updated: 0, deleted: 0, skipped: 2 } }),
      startedAt: "2026-06-05T08:36:01.000Z",
      finishedAt: "2026-06-05T08:36:02.000Z",
      updatedAt: "2026-06-05T08:36:02.000Z"
    });

    expect(repository.findById("user-1", "log-1")).toEqual({
      logId: "log-1",
      userId: "user-1",
      triggerType: "local_change",
      sourceTypesJson: JSON.stringify(["tags"]),
      taskId: "task-1",
      state: "succeeded",
      summary: "Teable 镜像同步完成",
      countsJson: JSON.stringify({ tags: { created: 1, updated: 0, deleted: 0, skipped: 2 } }),
      errorDetail: null,
      reason: "tag_definition_saved:tag-1",
      startedAt: "2026-06-05T08:36:01.000Z",
      finishedAt: "2026-06-05T08:36:02.000Z",
      createdAt: "2026-06-05T08:36:00.000Z",
      updatedAt: "2026-06-05T08:36:02.000Z"
    });
    expect(repository.listByUserId("user-1", { triggerType: "local_change", state: "succeeded" })).toHaveLength(1);

    database.close();
  });
});

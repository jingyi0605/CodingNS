import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { UserTeableGlobalSettingRepository } from "../../src/storage/repositories/user-teable-global-setting-repository.js";
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

describe("UserTeableGlobalSettingRepository", () => {
  it("可以持久化并读取全局 Teable 绑定", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-teable-global-setting-"));
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

    const repository = new UserTeableGlobalSettingRepository(database.db);
    repository.upsert({
      userId: "user-1",
      baseUrl: "http://192.168.1.20:3000",
      spaceId: "space-1",
      baseId: "base-1",
      authRef: "secret://teable/main",
      enabled: true,
      mirrorMode: "manual",
      createdAt: "2026-06-05T08:35:00.000Z",
      updatedAt: "2026-06-05T08:36:00.000Z"
    });

    expect(repository.findByUserId("user-1")).toEqual({
      userId: "user-1",
      baseUrl: "http://192.168.1.20:3000",
      spaceId: "space-1",
      baseId: "base-1",
      authRef: "secret://teable/main",
      enabled: true,
      mirrorMode: "manual",
      createdAt: "2026-06-05T08:35:00.000Z",
      updatedAt: "2026-06-05T08:36:00.000Z"
    });

    database.close();
  });
});

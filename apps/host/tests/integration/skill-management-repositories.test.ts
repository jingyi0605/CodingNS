import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ManagedSkillRepository } from "../../src/storage/repositories/managed-skill-repository.js";
import { SkillTargetBindingRepository } from "../../src/storage/repositories/skill-target-binding-repository.js";
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

describe("Skill 管理存储骨架", () => {
  it("会创建受管 skill 和目标绑定表", () => {
    const database = createDatabaseClient(":memory:");

    const managedColumns = database.db
      .prepare("PRAGMA table_info(managed_skills)")
      .all() as Array<{ name: string }>;
    const bindingColumns = database.db
      .prepare("PRAGMA table_info(skill_target_bindings)")
      .all() as Array<{ name: string }>;

    database.close();

    expect(managedColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "directory_name",
        "source_type",
        "source_path",
        "content_hash",
        "managed_state",
        "created_at",
        "updated_at"
      ])
    );
    expect(bindingColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "skill_id",
        "target_cli",
        "enabled",
        "sync_status",
        "last_synced_at",
        "last_error_code",
        "last_error_detail"
      ])
    );
  });

  it("仓储可以持久化受管 skill 和目标绑定", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-repository-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");

    const firstClient = createDatabaseClient(databasePath);
    const firstSkillRepository = new ManagedSkillRepository(firstClient.db);
    const firstBindingRepository = new SkillTargetBindingRepository(firstClient.db);

    firstSkillRepository.upsert({
      id: "skill-codingns-assistant",
      name: "codingns-assistant",
      directoryName: "codingns-assistant",
      sourceType: "builtin",
      sourcePath: null,
      contentHash: "hash-skill-v1",
      managedState: "active",
      createdAt: "2026-04-14T18:00:00.000Z",
      updatedAt: "2026-04-14T18:00:00.000Z"
    });
    firstBindingRepository.upsert({
      skillId: "skill-codingns-assistant",
      targetCli: "codex",
      enabled: true,
      syncStatus: "synced",
      lastSyncedAt: "2026-04-14T18:01:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null
    });
    firstBindingRepository.upsert({
      skillId: "skill-codingns-assistant",
      targetCli: "gemini",
      enabled: false,
      syncStatus: "pending",
      lastSyncedAt: null,
      lastErrorCode: null,
      lastErrorDetail: null
    });
    firstClient.close();

    const secondClient = createDatabaseClient(databasePath);
    const secondSkillRepository = new ManagedSkillRepository(secondClient.db);
    const secondBindingRepository = new SkillTargetBindingRepository(secondClient.db);

    expect(secondSkillRepository.findById("skill-codingns-assistant")).toEqual({
      id: "skill-codingns-assistant",
      name: "codingns-assistant",
      directoryName: "codingns-assistant",
      sourceType: "builtin",
      sourcePath: null,
      contentHash: "hash-skill-v1",
      managedState: "active",
      createdAt: "2026-04-14T18:00:00.000Z",
      updatedAt: "2026-04-14T18:00:00.000Z"
    });
    expect(secondBindingRepository.listBySkillId("skill-codingns-assistant")).toEqual([
      {
        skillId: "skill-codingns-assistant",
        targetCli: "codex",
        enabled: true,
        syncStatus: "synced",
        lastSyncedAt: "2026-04-14T18:01:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null
      },
      {
        skillId: "skill-codingns-assistant",
        targetCli: "gemini",
        enabled: false,
        syncStatus: "pending",
        lastSyncedAt: null,
        lastErrorCode: null,
        lastErrorDetail: null
      }
    ]);

    secondClient.close();
  });

  it("删除受管 skill 时会级联删除目标绑定", () => {
    const database = createDatabaseClient(":memory:");
    const skillRepository = new ManagedSkillRepository(database.db);
    const bindingRepository = new SkillTargetBindingRepository(database.db);

    skillRepository.upsert({
      id: "skill-1",
      name: "skill-1",
      directoryName: "skill-1",
      sourceType: "managed-copy",
      sourcePath: "/tmp/skill-1",
      contentHash: "hash-1",
      managedState: "active",
      createdAt: "2026-04-14T18:10:00.000Z",
      updatedAt: "2026-04-14T18:10:00.000Z"
    });
    bindingRepository.upsert({
      skillId: "skill-1",
      targetCli: "opencode",
      enabled: true,
      syncStatus: "failed",
      lastSyncedAt: null,
      lastErrorCode: "SKILL_SYNC_FAILED",
      lastErrorDetail: "permission denied"
    });

    expect(skillRepository.delete("skill-1")).toBe(true);
    expect(bindingRepository.listBySkillId("skill-1")).toEqual([]);

    database.close();
  });
});

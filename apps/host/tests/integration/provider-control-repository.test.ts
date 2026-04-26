import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProviderControlRepository } from "../../src/storage/repositories/provider-control-repository.js";
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

describe("ProviderControlRepository", () => {
  it("会创建 provider 启用态表", () => {
    const database = createDatabaseClient(":memory:");
    const columns = database.db
      .prepare("PRAGMA table_info(provider_control_profiles)")
      .all() as Array<{ name: string }>;

    database.close();

    expect(columns.map((column) => column.name)).toEqual([
      "provider_id",
      "enabled",
      "updated_at"
    ]);
  });

  it("默认把缺少记录的 provider 视为启用", () => {
    const database = createDatabaseClient(":memory:");
    const repository = new ProviderControlRepository(database.db);

    expect(repository.get("codex")).toEqual({
      providerId: "codex",
      enabled: true,
      updatedAt: ""
    });
    expect(repository.list()).toEqual([]);

    database.close();
  });

  it("可以持久化 provider 启用态", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-provider-control-repository-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");

    const firstClient = createDatabaseClient(databasePath);
    const firstRepository = new ProviderControlRepository(firstClient.db);

    firstRepository.upsert({
      providerId: "codex",
      enabled: false,
      updatedAt: "2026-04-26T11:20:00.000Z"
    });
    firstRepository.upsert({
      providerId: "gemini",
      enabled: true,
      updatedAt: "2026-04-26T11:21:00.000Z"
    });
    firstClient.close();

    const secondClient = createDatabaseClient(databasePath);
    const secondRepository = new ProviderControlRepository(secondClient.db);

    expect(secondRepository.get("codex")).toEqual({
      providerId: "codex",
      enabled: false,
      updatedAt: "2026-04-26T11:20:00.000Z"
    });
    expect(secondRepository.get("gemini")).toEqual({
      providerId: "gemini",
      enabled: true,
      updatedAt: "2026-04-26T11:21:00.000Z"
    });
    expect(secondRepository.list()).toEqual([
      {
        providerId: "codex",
        enabled: false,
        updatedAt: "2026-04-26T11:20:00.000Z"
      },
      {
        providerId: "gemini",
        enabled: true,
        updatedAt: "2026-04-26T11:21:00.000Z"
      }
    ]);

    secondClient.close();
  });
});

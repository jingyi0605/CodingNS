import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProviderRuntimeStateRepository } from "../../src/storage/repositories/provider-runtime-state-repository.js";
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

describe("ProviderRuntimeStateRepository", () => {
  it("会创建 provider 运行状态表", () => {
    const database = createDatabaseClient(":memory:");
    const columns = database.db
      .prepare("PRAGMA table_info(provider_runtime_states)")
      .all() as Array<{ name: string }>;

    database.close();

    expect(columns.map((column) => column.name)).toEqual([
      "provider_id",
      "install_state",
      "version",
      "updated_at"
    ]);
  });

  it("可以持久化 provider 可用性和版本", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-provider-runtime-state-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");

    const firstClient = createDatabaseClient(databasePath);
    const firstRepository = new ProviderRuntimeStateRepository(firstClient.db);

    firstRepository.upsert({
      providerId: "codex",
      installState: "ready",
      version: "1.8.0",
      updatedAt: "2026-04-30T10:00:00.000Z"
    });
    firstRepository.upsert({
      providerId: "gemini",
      installState: "missing",
      version: null,
      updatedAt: "2026-04-30T10:01:00.000Z"
    });
    firstClient.close();

    const secondClient = createDatabaseClient(databasePath);
    const secondRepository = new ProviderRuntimeStateRepository(secondClient.db);

    expect(secondRepository.get("codex")).toEqual({
      providerId: "codex",
      installState: "ready",
      version: "1.8.0",
      updatedAt: "2026-04-30T10:00:00.000Z"
    });
    expect(secondRepository.list()).toEqual([
      {
        providerId: "codex",
        installState: "ready",
        version: "1.8.0",
        updatedAt: "2026-04-30T10:00:00.000Z"
      },
      {
        providerId: "gemini",
        installState: "missing",
        version: null,
        updatedAt: "2026-04-30T10:01:00.000Z"
      }
    ]);

    secondClient.close();
  });
});

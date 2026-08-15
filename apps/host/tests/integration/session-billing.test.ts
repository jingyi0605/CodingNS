import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("会话费用绑定元数据", () => {
  it("新数据库和 repository 支持保存收费起点、profile 与价格表版本", () => {
    const client = createDatabaseClient(":memory:");
    const columns = client.db
      .prepare("PRAGMA table_info(session_bindings)")
      .all() as Array<{ name: string }>;
    const repository = new SessionBindingRepository(client.db);

    client.db.prepare(
      `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "user-1",
      "tester",
      "hash",
      "admin",
      "2026-08-16T00:00:00.000Z",
      "2026-08-16T00:00:00.000Z"
    );
    client.db.prepare(
      `INSERT INTO workspaces (
         id, owner_user_id, name, path, repo_root, favorite, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "workspace-1",
      "user-1",
      "测试工作区",
      "/tmp/workspace",
      "/tmp/workspace",
      0,
      "2026-08-16T00:00:00.000Z",
      "2026-08-16T00:00:00.000Z"
    );

    repository.upsert({
      sessionId: "session-new",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-new",
      rawStoreRef: "/tmp/workspace/session.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      selectedModel: "gpt-5.3-codex",
      billingStartedAt: "2026-08-16T00:00:01.000Z",
      pricingProfileId: "direct-api",
      priceBookVersion: "2026-08-16",
      createdAt: "2026-08-16T00:00:01.000Z",
      updatedAt: "2026-08-16T00:00:01.000Z"
    });

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["billing_started_at", "pricing_profile_id", "price_book_version"])
    );
    expect(repository.findBySessionId("session-new")).toMatchObject({
      billingStartedAt: "2026-08-16T00:00:01.000Z",
      pricingProfileId: "direct-api",
      priceBookVersion: "2026-08-16"
    });

    client.close();
  });

  it("旧数据库迁移后收费元数据保持为空，不回填旧会话", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "codingns-session-billing-legacy-"));
    tempDirs.push(directory);
    const databasePath = path.join(directory, "host.sqlite");
    const { default: Database } = await import("better-sqlite3");
    const seed = new Database(databasePath);

    seed.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE session_bindings (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('claude-code', 'codex')),
        provider_session_id TEXT NOT NULL,
        raw_store_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE session_indices (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('claude-code', 'codex')),
        title TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        last_message_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO workspaces (id) VALUES ('workspace-legacy');
      INSERT INTO session_bindings (
        session_id, workspace_id, provider, provider_session_id, raw_store_ref, created_at, updated_at
      ) VALUES (
        'session-legacy', 'workspace-legacy', 'codex', 'provider-legacy',
        '/tmp/legacy/session.jsonl', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO session_indices (
        session_id, workspace_id, provider, title, message_count, last_message_at, created_at, updated_at
      ) VALUES (
        'session-legacy', 'workspace-legacy', 'codex', '旧会话', 0, NULL,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);
    seed.close();

    const client = createDatabaseClient(databasePath);
    const row = client.db.prepare(
      `SELECT billing_started_at, pricing_profile_id, price_book_version
       FROM session_bindings WHERE session_id = ?`
    ).get("session-legacy") as {
      billing_started_at: string | null;
      pricing_profile_id: string | null;
      price_book_version: string | null;
    };

    expect(row).toEqual({
      billing_started_at: null,
      pricing_profile_id: null,
      price_book_version: null
    });

    client.close();
  });
});

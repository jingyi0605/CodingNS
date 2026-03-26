import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
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

describe("sqlite 启动引导", () => {
  it("可以把缺少 runtime 列的旧 terminal_instances 平滑升级到新结构", async () => {
    if (Number(process.versions.node.split(".")[0] ?? "0") < 22) {
      return;
    }

    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-sqlite-bootstrap-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const { default: Database } = await import("better-sqlite3");
    const seed = new Database(databasePath);

    seed.exec(`
      CREATE TABLE auth_users (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE terminal_instances (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        shell TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('creating', 'running', 'closed', 'error')),
        created_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        closed_at TEXT,
        exit_code INTEGER,
        status_detail TEXT,
        process_id INTEGER,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
        FOREIGN KEY (created_by_user_id) REFERENCES auth_users(id)
      );

      INSERT INTO auth_users (id) VALUES ('user-1');
      INSERT INTO workspaces (id) VALUES ('workspace-1');
      INSERT INTO terminal_instances (
        id,
        workspace_id,
        name,
        cwd,
        shell,
        status,
        created_by_user_id,
        created_at,
        last_active_at,
        process_id
      ) VALUES (
        'terminal-1',
        'workspace-1',
        'legacy terminal',
        '/tmp/workspace',
        '/bin/zsh',
        'running',
        'user-1',
        '2026-03-26T07:00:00.000Z',
        '2026-03-26T07:05:00.000Z',
        4321
      );
    `);
    seed.close();

    const client = createDatabaseClient(databasePath);
    const columns = client.db
      .prepare("PRAGMA table_info(terminal_instances)")
      .all() as Array<{ name: string }>;
    const runtimeSessionRow = client.db
      .prepare(
        "SELECT runtime_type, runtime_session_id, attach_target FROM terminal_instances WHERE id = ?"
      )
      .get("terminal-1") as
      | {
          runtime_type: string;
          runtime_session_id: string;
          attach_target: string;
        }
      | undefined;
    const runtimeSession = client.db
      .prepare("SELECT id, terminal_id, session_key, attach_target, shell_pid, state FROM terminal_runtime_sessions")
      .get() as
      | {
          id: string;
          terminal_id: string;
          session_key: string;
          attach_target: string;
          shell_pid: number | null;
          state: string;
        }
      | undefined;
    const runtimeIndex = client.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_terminal_instances_runtime_session_id'"
      )
      .get() as { name: string } | undefined;

    client.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["runtime_type", "runtime_session_id", "attach_target"])
    );
    expect(runtimeSessionRow).toEqual({
      runtime_type: "embedded-pty",
      runtime_session_id: "legacy-terminal-1",
      attach_target: "embedded:terminal-1"
    });
    expect(runtimeSession).toEqual({
      id: "legacy-terminal-1",
      terminal_id: "terminal-1",
      session_key: "legacy-terminal-1",
      attach_target: "embedded:terminal-1",
      shell_pid: 4321,
      state: "lost"
    });
    expect(runtimeIndex?.name).toBe("idx_terminal_instances_runtime_session_id");
  });

  it("默认数据库路径不依赖 process.cwd", () => {
    const originalCwd = process.cwd();
    const originalHookToken = process.env.CODINGNS_CLAUDE_HOOK_TOKEN;
    const appRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

    process.env.CODINGNS_CLAUDE_HOOK_TOKEN = "test-hook-token";
    process.chdir(path.resolve(originalCwd, "apps", "host"));

    try {
      const config = resolveHostConfig();

      expect(config.databasePath).toBe(
        path.join(appRootDir, "data", "host", "host.sqlite")
      );
      expect(config.releaseManifestRoot).toBe(
        path.join(appRootDir, "data", "releases")
      );
    } finally {
      process.chdir(originalCwd);

      if (originalHookToken === undefined) {
        delete process.env.CODINGNS_CLAUDE_HOOK_TOKEN;
      } else {
        process.env.CODINGNS_CLAUDE_HOOK_TOKEN = originalHookToken;
      }
    }
  });
});

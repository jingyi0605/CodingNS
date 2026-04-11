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

  it("可以给旧 session_indices 平滑补上子 Agent 关系列", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-session-index-bootstrap-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const { default: Database } = await import("better-sqlite3");
    const seed = new Database(databasePath);

    seed.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE session_bindings (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        raw_store_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE session_indices (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        title TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        last_message_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    seed.close();

    const client = createDatabaseClient(databasePath);
    const columns = client.db
      .prepare("PRAGMA table_info(session_indices)")
      .all() as Array<{ name: string }>;

    client.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["parent_session_id", "is_subagent", "subagent_label"])
    );
  });

  it("初始化数据库时会创建 session_forks 表", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-session-forks-bootstrap-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");

    const client = createDatabaseClient(databasePath);
    const columns = client.db
      .prepare("PRAGMA table_info(session_forks)")
      .all() as Array<{ name: string }>;

    client.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "session_id",
        "parent_session_id",
        "provider",
        "fork_source_type",
        "fork_source_session_id",
        "fork_source_message_id",
        "inherited_prefix_message_count",
        "provider_parent_session_id",
        "provider_source_message_id",
        "fork_method",
        "created_at"
      ])
    );
  });

  it("可以清理残留的 session_forks_next 并把旧 fork 表平滑升级到新结构", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-session-forks-migration-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const { default: Database } = await import("better-sqlite3");
    const seed = new Database(databasePath);

    seed.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE session_bindings (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        raw_store_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE session_forks (
        session_id TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        fork_source_type TEXT NOT NULL CHECK (fork_source_type IN ('session', 'message')),
        fork_source_message_id TEXT,
        fork_method TEXT NOT NULL CHECK (
          fork_method IN (
            'native_session_fork',
            'native_message_fork',
            'reconstructed_message_fork'
          )
        ),
        created_at TEXT NOT NULL
      );

      CREATE TABLE session_forks_next (
        session_id TEXT PRIMARY KEY
      );

      INSERT INTO workspaces (id) VALUES ('workspace-1');

      INSERT INTO session_bindings (
        session_id,
        workspace_id,
        provider,
        provider_session_id,
        raw_store_ref,
        created_at,
        updated_at
      ) VALUES (
        'session-child-1',
        'workspace-1',
        'codex',
        'provider-child-1',
        '/tmp/session-child-1.jsonl',
        '2026-04-11T10:00:00.000Z',
        '2026-04-11T10:00:00.000Z'
      );

      INSERT INTO session_forks (
        session_id,
        parent_session_id,
        provider,
        fork_source_type,
        fork_source_message_id,
        fork_method,
        created_at
      ) VALUES (
        'session-child-1',
        'session-parent-1',
        'codex',
        'message',
        'message-1',
        'native_message_fork',
        '2026-04-11T10:00:00.000Z'
      );
    `);
    seed.close();

    const client = createDatabaseClient(databasePath);
    const columns = client.db
      .prepare("PRAGMA table_info(session_forks)")
      .all() as Array<{ name: string }>;
    const nextTable = client.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_forks_next'")
      .get() as { name: string } | undefined;
    const forkRow = client.db
      .prepare(`
        SELECT
          session_id,
          parent_session_id,
          provider,
          fork_source_type,
          fork_source_session_id,
          fork_source_message_id,
          inherited_prefix_message_count,
          provider_parent_session_id,
          provider_source_message_id,
          fork_method,
          created_at
        FROM session_forks
        WHERE session_id = ?
      `)
      .get("session-child-1") as
      | {
          session_id: string;
          parent_session_id: string;
          provider: string;
          fork_source_type: string;
          fork_source_session_id: string;
          fork_source_message_id: string | null;
          inherited_prefix_message_count: number;
          provider_parent_session_id: string | null;
          provider_source_message_id: string | null;
          fork_method: string;
          created_at: string;
        }
      | undefined;

    client.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "fork_source_session_id",
        "inherited_prefix_message_count",
        "provider_parent_session_id",
        "provider_source_message_id"
      ])
    );
    expect(nextTable).toBeUndefined();
    expect(forkRow).toEqual({
      session_id: "session-child-1",
      parent_session_id: "session-parent-1",
      provider: "codex",
      fork_source_type: "message",
      fork_source_session_id: "session-parent-1",
      fork_source_message_id: "message-1",
      inherited_prefix_message_count: 0,
      provider_parent_session_id: null,
      provider_source_message_id: null,
      fork_method: "native_message_fork",
      created_at: "2026-04-11T10:00:00.000Z"
    });
  });

  it("可以在旧数据库上补齐终端日志索引表", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-terminal-log-bootstrap-"));
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
        runtime_type TEXT NOT NULL,
        runtime_session_id TEXT NOT NULL,
        attach_target TEXT NOT NULL,
        status TEXT NOT NULL,
        process_id INTEGER,
        created_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        closed_at TEXT,
        exit_code INTEGER,
        status_detail TEXT
      );

      CREATE TABLE terminal_runtime_sessions (
        id TEXT PRIMARY KEY,
        terminal_id TEXT NOT NULL,
        runtime_type TEXT NOT NULL,
        session_key TEXT NOT NULL,
        attach_target TEXT NOT NULL,
        host_instance_id TEXT,
        agent_pid INTEGER,
        shell_pid INTEGER,
        state TEXT NOT NULL,
        last_heartbeat_at TEXT,
        last_checked_at TEXT,
        last_error_detail TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    seed.close();

    const client = createDatabaseClient(databasePath);
    const logFileColumns = client.db
      .prepare("PRAGMA table_info(terminal_log_files)")
      .all() as Array<{ name: string }>;
    const logSegmentColumns = client.db
      .prepare("PRAGMA table_info(terminal_log_segments)")
      .all() as Array<{ name: string }>;
    const logFileIndex = client.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_terminal_log_files_terminal_id'"
      )
      .get() as { name: string } | undefined;
    const logSegmentIndex = client.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_terminal_log_segments_terminal_id_start_seq'"
      )
      .get() as { name: string } | undefined;

    client.close();

    expect(logFileColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "terminal_id",
        "relative_path",
        "status",
        "start_seq",
        "end_seq",
        "size_bytes",
        "created_at",
        "updated_at"
      ])
    );
    expect(logSegmentColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "terminal_id",
        "file_id",
        "start_seq",
        "end_seq",
        "start_offset",
        "end_offset",
        "byte_length",
        "created_at"
      ])
    );
    expect(logFileIndex?.name).toBe("idx_terminal_log_files_terminal_id");
    expect(logSegmentIndex?.name).toBe("idx_terminal_log_segments_terminal_id_start_seq");
  });
});

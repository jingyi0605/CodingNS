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

  it("可以给缺少 auth_tokens 设备列的旧数据库平滑补列并完成启动", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-auth-token-device-bootstrap-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const { default: Database } = await import("better-sqlite3");
    const seed = new Database(databasePath);

    seed.exec(`
      CREATE TABLE auth_users (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE auth_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_type TEXT NOT NULL CHECK (token_type IN ('access', 'refresh')),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES auth_users(id)
      );
    `);
    seed.close();

    const client = createDatabaseClient(databasePath);
    const columns = client.db
      .prepare("PRAGMA table_info(auth_tokens)")
      .all() as Array<{ name: string }>;
    const deviceSessionIndex = client.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_auth_tokens_device_session_id'"
      )
      .get() as { name: string } | undefined;

    client.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["device_session_id", "caller_kind"])
    );
    expect(deviceSessionIndex?.name).toBe("idx_auth_tokens_device_session_id");
  });

  it("可以给缺少 auth_devices user_agent 列的旧数据库平滑补列并完成启动", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-auth-device-bootstrap-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const { default: Database } = await import("better-sqlite3");
    const seed = new Database(databasePath);

    seed.exec(`
      CREATE TABLE auth_users (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE auth_devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_type TEXT NOT NULL CHECK (client_type IN ('desktop', 'web', 'ios', 'android', 'unknown')),
        client_instance_id TEXT,
        display_name TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
        last_source_address TEXT,
        last_seen_at TEXT NOT NULL,
        primary_set_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES auth_users(id)
      );
    `);
    seed.close();

    const client = createDatabaseClient(databasePath);
    const columns = client.db
      .prepare("PRAGMA table_info(auth_devices)")
      .all() as Array<{ name: string }>;

    client.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["user_agent"])
    );
  });

  it("可以把旧版 managed_skills 平滑升级为带 scope 的结构", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-managed-skill-scope-bootstrap-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");
    const { default: Database } = await import("better-sqlite3");
    const seed = new Database(databasePath);

    seed.exec(`
      CREATE TABLE managed_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        directory_name TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL CHECK (source_type IN ('builtin', 'local-import', 'managed-copy')),
        source_path TEXT,
        content_hash TEXT NOT NULL,
        managed_state TEXT NOT NULL CHECK (managed_state IN ('active', 'conflicted', 'missing')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO managed_skills (
        id,
        name,
        directory_name,
        source_type,
        source_path,
        content_hash,
        managed_state,
        created_at,
        updated_at
      ) VALUES (
        'skill-1',
        'Legacy Skill',
        'legacy-skill',
        'local-import',
        '/tmp/legacy-skill',
        'hash-1',
        'active',
        '2026-04-18T08:00:00.000Z',
        '2026-04-18T08:00:00.000Z'
      );
    `);
    seed.close();

    const client = createDatabaseClient(databasePath);
    const columns = client.db
      .prepare("PRAGMA table_info(managed_skills)")
      .all() as Array<{ name: string }>;
    const row = client.db
      .prepare("SELECT scope, directory_name FROM managed_skills WHERE id = ?")
      .get("skill-1") as { scope: string; directory_name: string } | undefined;
    const duplicateInsert = () =>
      client.db
        .prepare(
          `INSERT INTO managed_skills (
             id,
             name,
             scope,
             directory_name,
             source_type,
             source_path,
             content_hash,
             managed_state,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "skill-2",
          "Assistant Legacy Skill",
          "assistant",
          "legacy-skill",
          "local-import",
          null,
          "hash-2",
          "active",
          "2026-04-18T08:10:00.000Z",
          "2026-04-18T08:10:00.000Z"
        );

    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["scope", "directory_name"]));
    expect(row).toEqual({
      scope: "workspace",
      directory_name: "legacy-skill"
    });
    expect(duplicateInsert).not.toThrow();

    client.close();
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

  it("初始化数据库时会创建 workspace_worktrees 表", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-worktree-bootstrap-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");

    const client = createDatabaseClient(databasePath);
    const columns = client.db
      .prepare("PRAGMA table_info(workspace_worktrees)")
      .all() as Array<{ name: string }>;

    client.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "workspace_id",
        "root_workspace_id",
        "parent_workspace_id",
        "source_workspace_id",
        "merge_target_workspace_id",
        "branch_name",
        "base_ref",
        "base_commit",
        "head_commit",
        "display_name",
        "depth",
        "lifecycle_status",
        "merged_at",
        "removed_at",
        "created_at",
        "updated_at"
      ])
    );
  });

  it("初始化数据库时会创建 spec007.1 调试编排表，并补齐终端关联字段", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-debug-target-bootstrap-"));
    tempDirs.push(tempDir);
    const databasePath = path.join(tempDir, "host.sqlite");

    const client = createDatabaseClient(databasePath);
    const tableNames = client.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    const templateColumns = client.db
      .prepare("PRAGMA table_info(terminal_command_templates)")
      .all() as Array<{ name: string }>;
    const terminalColumns = client.db
      .prepare("PRAGMA table_info(terminal_instances)")
      .all() as Array<{ name: string }>;

    client.close();

    expect(tableNames).toEqual(
      expect.arrayContaining([
        "debug_targets",
        "debug_services",
        "framework_analysis_results",
        "debug_runtime_sessions",
        "port_leases",
        "runtime_bindings",
        "ai_fallback_edits"
      ])
    );
    expect(templateColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "source_type",
        "debug_target_id",
        "debug_service_id",
        "framework_analysis_id",
        "adapter_kind",
        "injection_mode",
        "generated_artifact_ref",
        "service_discovery_mode",
        "managed_by_system"
      ])
    );
    expect(terminalColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "debug_runtime_session_id",
        "debug_target_id",
        "debug_service_id",
        "framework_analysis_id",
        "launcher_source_type",
        "launch_stage",
        "failure_stage",
        "adapter_kind",
        "env_patch_summary_json",
        "artifact_ref"
      ])
    );
  });

  it("可以把缺少调试字段的旧终端表平滑升级到新结构", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-debug-terminal-bootstrap-"));
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

      CREATE TABLE terminal_command_templates (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        env_json TEXT NOT NULL,
        port INTEGER,
        proxy_enabled INTEGER NOT NULL DEFAULT 0 CHECK (proxy_enabled IN (0, 1)),
        proxy_slug TEXT,
        runtime_type TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, name)
      );
    `);
    seed.close();

    const client = createDatabaseClient(databasePath);
    const terminalColumns = client.db
      .prepare("PRAGMA table_info(terminal_instances)")
      .all() as Array<{ name: string }>;
    const templateColumns = client.db
      .prepare("PRAGMA table_info(terminal_command_templates)")
      .all() as Array<{ name: string }>;
    const debugRuntimeIndex = client.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_terminal_instances_debug_runtime_session_id'"
      )
      .get() as { name: string } | undefined;
    const debugTargetIndex = client.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_terminal_instances_debug_target_id'"
      )
      .get() as { name: string } | undefined;
    const templateDebugTargetIndex = client.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_terminal_templates_debug_target_id'"
      )
      .get() as { name: string } | undefined;

    client.close();

    expect(terminalColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "debug_runtime_session_id",
        "debug_target_id",
        "debug_service_id",
        "framework_analysis_id",
        "launcher_source_type",
        "launch_stage",
        "failure_stage",
        "adapter_kind",
        "env_patch_summary_json",
        "artifact_ref"
      ])
    );
    expect(templateColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "source_type",
        "debug_target_id",
        "debug_service_id",
        "framework_analysis_id",
        "adapter_kind",
        "injection_mode",
        "generated_artifact_ref",
        "service_discovery_mode",
        "managed_by_system"
      ])
    );
    expect(debugRuntimeIndex?.name).toBe("idx_terminal_instances_debug_runtime_session_id");
    expect(debugTargetIndex?.name).toBe("idx_terminal_instances_debug_target_id");
    expect(templateDebugTargetIndex?.name).toBe("idx_terminal_templates_debug_target_id");
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

  it("可以给旧 assistant_sandboxes 平滑补上控制会话列和索引", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-sandbox-bootstrap-"));
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

      CREATE TABLE assistant_sandboxes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('blank', 'clone')),
        source_ref TEXT,
        visibility TEXT NOT NULL CHECK (visibility IN ('assistant_only', 'pinned')),
        status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'expired', 'deleted')),
        purpose TEXT,
        expires_at TEXT,
        promoted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `);
    seed.close();

    const client = createDatabaseClient(databasePath);
    const columns = client.db
      .prepare("PRAGMA table_info(assistant_sandboxes)")
      .all() as Array<{ name: string }>;
    client.db.exec(`
      INSERT INTO auth_users (id) VALUES ('user-1');
      INSERT INTO workspaces (id) VALUES ('workspace-1');
    `);
    expect(() => {
      client.db
        .prepare(
          `INSERT INTO assistant_sandboxes (
             id,
             user_id,
             workspace_id,
             control_session_id,
             title,
             description,
             source_kind,
             source_ref,
             visibility,
             status,
             purpose,
             expires_at,
             promoted_at,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "sandbox-1",
          "user-1",
          "workspace-1",
          null,
          "孤立沙箱",
          null,
          "blank",
          null,
          "assistant_only",
          "orphaned",
          null,
          null,
          null,
          "2026-04-17T00:00:00.000Z",
          "2026-04-17T00:00:00.000Z"
        );
    }).not.toThrow();
    const controlSessionIndex = client.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_assistant_sandboxes_control_session'"
      )
      .get() as { name: string } | undefined;

    client.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["control_session_id"])
    );
    expect(controlSessionIndex?.name).toBe("idx_assistant_sandboxes_control_session");
  });
});

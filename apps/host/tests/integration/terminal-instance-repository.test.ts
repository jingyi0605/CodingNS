import { describe, expect, it } from "vitest";

import { TerminalInstanceRepository } from "../../src/storage/repositories/terminal-instance-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("TerminalInstanceRepository", () => {
  it("工作区终端列表按创建顺序稳定返回，不跟随最近活跃时间跳动", () => {
    const database = createDatabaseClient(":memory:");
    const repository = new TerminalInstanceRepository(database.db);

    seedTerminalDependencies(database.db);

    expect(repository.listByWorkspace("workspace-1").map((terminal) => terminal.name)).toEqual([
      "repo 1",
      "repo 2",
      "repo 3"
    ]);

    database.close();
  });
});

function seedTerminalDependencies(db: ReturnType<typeof createDatabaseClient>["db"]): void {
  db.exec(`
    INSERT INTO auth_users (
      id,
      username,
      password_hash,
      role,
      created_at,
      updated_at
    ) VALUES (
      'user-1',
      'admin',
      'hash',
      'admin',
      '2026-03-28T09:00:00.000Z',
      '2026-03-28T09:00:00.000Z'
    );

    INSERT INTO workspaces (
      id,
      name,
      path,
      repo_root,
      favorite,
      created_at,
      updated_at
    ) VALUES (
      'workspace-1',
      'workspace',
      '/tmp/workspace',
      '/tmp/workspace',
      0,
      '2026-03-28T09:00:00.000Z',
      '2026-03-28T09:00:00.000Z'
    );

    INSERT INTO terminal_instances (
      id,
      workspace_id,
      name,
      cwd,
      shell,
      runtime_type,
      runtime_session_id,
      attach_target,
      status,
      process_id,
      created_by_user_id,
      created_at,
      last_active_at,
      closed_at,
      exit_code,
      status_detail
    ) VALUES
    (
      'terminal-1',
      'workspace-1',
      'repo 1',
      '/tmp/workspace',
      '/bin/zsh',
      'embedded-pty',
      'runtime-terminal-1',
      'embedded:terminal-1',
      'running',
      101,
      'user-1',
      '2026-03-28T09:30:00.000Z',
      '2026-03-28T09:50:00.000Z',
      NULL,
      NULL,
      NULL
    ),
    (
      'terminal-2',
      'workspace-1',
      'repo 2',
      '/tmp/workspace',
      '/bin/zsh',
      'embedded-pty',
      'runtime-terminal-2',
      'embedded:terminal-2',
      'running',
      102,
      'user-1',
      '2026-03-28T09:31:00.000Z',
      '2026-03-28T09:40:00.000Z',
      NULL,
      NULL,
      NULL
    ),
    (
      'terminal-3',
      'workspace-1',
      'repo 3',
      '/tmp/workspace',
      '/bin/zsh',
      'embedded-pty',
      'runtime-terminal-3',
      'embedded:terminal-3',
      'running',
      103,
      'user-1',
      '2026-03-28T09:32:00.000Z',
      '2026-03-28T10:20:00.000Z',
      NULL,
      NULL,
      NULL
    );
  `);
}

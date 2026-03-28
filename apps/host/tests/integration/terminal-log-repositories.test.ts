import { describe, expect, it } from "vitest";

import { TerminalLogFileRepository } from "../../src/storage/repositories/terminal-log-file-repository.js";
import { TerminalLogSegmentRepository } from "../../src/storage/repositories/terminal-log-segment-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("终端日志索引仓储", () => {
  it("可以创建并读取活动日志文件", () => {
    const database = createDatabaseClient(":memory:");
    const fileRepository = new TerminalLogFileRepository(database.db);

    seedTerminalDependencies(database.db, "terminal-1");

    fileRepository.create({
      id: "file-1",
      terminalId: "terminal-1",
      relativePath: "terminal-1/active.log",
      status: "active",
      startSeq: 1,
      endSeq: null,
      sizeBytes: 0,
      createdAt: "2026-03-28T10:00:00.000Z",
      updatedAt: "2026-03-28T10:00:00.000Z"
    });

    expect(fileRepository.findActiveByTerminalId("terminal-1")).toEqual({
      id: "file-1",
      terminalId: "terminal-1",
      relativePath: "terminal-1/active.log",
      status: "active",
      startSeq: 1,
      endSeq: null,
      sizeBytes: 0,
      createdAt: "2026-03-28T10:00:00.000Z",
      updatedAt: "2026-03-28T10:00:00.000Z"
    });

    database.close();
  });

  it("可以按终端分页读取更早日志分段", () => {
    const database = createDatabaseClient(":memory:");
    const fileRepository = new TerminalLogFileRepository(database.db);
    const segmentRepository = new TerminalLogSegmentRepository(database.db);

    seedTerminalDependencies(database.db, "terminal-1");

    fileRepository.create({
      id: "file-1",
      terminalId: "terminal-1",
      relativePath: "terminal-1/000001.log",
      status: "sealed",
      startSeq: 1,
      endSeq: 9,
      sizeBytes: 180,
      createdAt: "2026-03-28T10:00:00.000Z",
      updatedAt: "2026-03-28T10:01:00.000Z"
    });

    segmentRepository.create({
      id: "segment-1",
      terminalId: "terminal-1",
      fileId: "file-1",
      startSeq: 1,
      endSeq: 3,
      startOffset: 0,
      endOffset: 60,
      byteLength: 60,
      createdAt: "2026-03-28T10:00:10.000Z"
    });
    segmentRepository.create({
      id: "segment-2",
      terminalId: "terminal-1",
      fileId: "file-1",
      startSeq: 4,
      endSeq: 6,
      startOffset: 60,
      endOffset: 120,
      byteLength: 60,
      createdAt: "2026-03-28T10:00:20.000Z"
    });
    segmentRepository.create({
      id: "segment-3",
      terminalId: "terminal-1",
      fileId: "file-1",
      startSeq: 7,
      endSeq: 9,
      startOffset: 120,
      endOffset: 180,
      byteLength: 60,
      createdAt: "2026-03-28T10:00:30.000Z"
    });

    expect(segmentRepository.findLatestByTerminalId("terminal-1")?.id).toBe("segment-3");
    expect(segmentRepository.listBeforeSeq("terminal-1", null, 2).map((segment) => segment.id)).toEqual([
      "segment-3",
      "segment-2"
    ]);
    expect(segmentRepository.listBeforeSeq("terminal-1", 7, 5).map((segment) => segment.id)).toEqual([
      "segment-2",
      "segment-1"
    ]);

    database.close();
  });
});

function seedTerminalDependencies(
  db: ReturnType<typeof createDatabaseClient>["db"],
  terminalId: string
): void {
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
    ) VALUES (
      '${terminalId}',
      'workspace-1',
      'terminal',
      '/tmp/workspace',
      '/bin/zsh',
      'embedded-pty',
      'runtime-${terminalId}',
      'embedded:${terminalId}',
      'running',
      123,
      'user-1',
      '2026-03-28T09:30:00.000Z',
      '2026-03-28T09:31:00.000Z',
      NULL,
      NULL,
      NULL
    );
  `);
}

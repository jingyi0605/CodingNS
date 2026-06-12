import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TerminalLogFileRepository } from "../../src/storage/repositories/terminal-log-file-repository.js";
import { TerminalLogSegmentRepository } from "../../src/storage/repositories/terminal-log-segment-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import { TerminalLogSpooler } from "../../src/modules/terminal/runtime/terminal-log-spooler.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("TerminalLogSpooler", () => {
  it("会把终端输出批量刷入日志文件并写入索引", async () => {
    const database = createDatabaseClient(":memory:");
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-terminal-log-spooler-"));
    tempDirs.push(tempDir);
    seedTerminalDependencies(database.db, "terminal-1");

    const fileRepository = new TerminalLogFileRepository(database.db);
    const segmentRepository = new TerminalLogSegmentRepository(database.db);
    const spooler = new TerminalLogSpooler({
      logRootDir: tempDir,
      fileRepository,
      segmentRepository,
      flushIntervalMs: 60_000,
      maxBatchBytes: 1024
    });

    spooler.appendChunks("terminal-1", [
      {
        terminalId: "terminal-1",
        cursor: "1",
        stream: "stdout",
        content: "hello\n",
        timestamp: "2026-03-28T11:00:00.000Z"
      },
      {
        terminalId: "terminal-1",
        cursor: "2",
        stream: "stdout",
        content: "world\n",
        timestamp: "2026-03-28T11:00:01.000Z"
      }
    ]);
    await spooler.flushTerminal("terminal-1");

    const fileRecord = fileRepository.findActiveByTerminalId("terminal-1");
    const latestSegment = segmentRepository.findLatestByTerminalId("terminal-1");

    expect(fileRecord).not.toBeNull();
    expect(fileRecord?.startSeq).toBe(1);
    expect(fileRecord?.endSeq).toBe(2);
    expect(fileRecord?.sizeBytes).toBe(Buffer.byteLength("hello\nworld\n", "utf8"));
    expect(latestSegment).not.toBeNull();
    expect(latestSegment?.startSeq).toBe(1);
    expect(latestSegment?.endSeq).toBe(2);
    expect(latestSegment?.byteLength).toBe(Buffer.byteLength("hello\nworld\n", "utf8"));
    expect(
      readFileSync(path.join(tempDir, "terminal-1", "active.log"), "utf8")
    ).toBe("hello\nworld\n");

    await spooler.dispose();
    database.close();
  });

  it("文件数据库模式下会通过后台写入进程落日志", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-terminal-log-worker-"));
    const databasePath = path.join(tempDir, "terminal.db");
    tempDirs.push(tempDir);
    const database = createDatabaseClient(databasePath);
    seedTerminalDependencies(database.db, "terminal-2");

    const fileRepository = new TerminalLogFileRepository(database.db);
    const segmentRepository = new TerminalLogSegmentRepository(database.db);
    const spooler = new TerminalLogSpooler({
      databasePath,
      logRootDir: tempDir,
      fileRepository,
      segmentRepository,
      flushIntervalMs: 60_000,
      maxBatchBytes: 1024
    });

    spooler.appendChunks("terminal-2", [
      {
        terminalId: "terminal-2",
        cursor: "1",
        stream: "stdout",
        content: "worker\n",
        timestamp: "2026-03-28T11:00:00.000Z"
      },
      {
        terminalId: "terminal-2",
        cursor: "2",
        stream: "stdout",
        content: "flush\n",
        timestamp: "2026-03-28T11:00:01.000Z"
      }
    ]);
    await spooler.flushTerminal("terminal-2");

    const fileRecord = fileRepository.findActiveByTerminalId("terminal-2");
    const latestSegment = segmentRepository.findLatestByTerminalId("terminal-2");

    expect(fileRecord).not.toBeNull();
    expect(fileRecord?.startSeq).toBe(1);
    expect(fileRecord?.endSeq).toBe(2);
    expect(latestSegment).not.toBeNull();
    expect(latestSegment?.startSeq).toBe(1);
    expect(latestSegment?.endSeq).toBe(2);
    expect(
      readFileSync(path.join(tempDir, "terminal-2", "active.log"), "utf8")
    ).toBe("worker\nflush\n");

    await spooler.dispose();
    database.close();
  });

  it("文件数据库模式下遇到短暂写锁会重试并最终写入成功", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-terminal-log-worker-busy-"));
    const databasePath = path.join(tempDir, "terminal.db");
    tempDirs.push(tempDir);
    const database = createDatabaseClient(databasePath);
    seedTerminalDependencies(database.db, "terminal-3");

    const fileRepository = new TerminalLogFileRepository(database.db);
    const segmentRepository = new TerminalLogSegmentRepository(database.db);
    const spooler = new TerminalLogSpooler({
      databasePath,
      logRootDir: tempDir,
      fileRepository,
      segmentRepository,
      flushIntervalMs: 60_000,
      maxBatchBytes: 1024
    });
    const blockingConnection = new Database(databasePath);

    blockingConnection.pragma("journal_mode = WAL");
    blockingConnection.pragma("busy_timeout = 5000");
    blockingConnection.exec("BEGIN IMMEDIATE");

    const releaseTimer = setTimeout(() => {
      blockingConnection.exec("COMMIT");
      blockingConnection.close();
    }, 600);

    try {
      spooler.appendChunks("terminal-3", [
        {
          terminalId: "terminal-3",
          cursor: "1",
          stream: "stdout",
          content: "busy\n",
          timestamp: "2026-03-28T11:00:00.000Z"
        },
        {
          terminalId: "terminal-3",
          cursor: "2",
          stream: "stdout",
          content: "retry\n",
          timestamp: "2026-03-28T11:00:01.000Z"
        }
      ]);
      await spooler.flushTerminal("terminal-3");
      const fileRecord = fileRepository.findActiveByTerminalId("terminal-3");
      const latestSegment = segmentRepository.findLatestByTerminalId("terminal-3");

      expect(fileRecord).not.toBeNull();
      expect(fileRecord?.endSeq).toBe(2);
      expect(latestSegment).not.toBeNull();
      expect(latestSegment?.endSeq).toBe(2);
      expect(
        readFileSync(path.join(tempDir, "terminal-3", "active.log"), "utf8")
      ).toBe("busy\nretry\n");
    } finally {
      clearTimeout(releaseTimer);

      if (blockingConnection.open) {
        blockingConnection.exec("ROLLBACK");
        blockingConnection.close();
      }

      await spooler.dispose();
      database.close();
    }
  });

  it("日志写入进程关闭后不会继续安排重复 flush", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-terminal-log-worker-closed-"));
    const databasePath = path.join(tempDir, "terminal.db");
    tempDirs.push(tempDir);
    const database = createDatabaseClient(databasePath);
    seedTerminalDependencies(database.db, "terminal-4");

    const fileRepository = new TerminalLogFileRepository(database.db);
    const segmentRepository = new TerminalLogSegmentRepository(database.db);
    const spooler = new TerminalLogSpooler({
      databasePath,
      logRootDir: tempDir,
      fileRepository,
      segmentRepository,
      flushIntervalMs: 20,
      maxBatchBytes: 1024
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await closeWriterClientForTest(spooler);
      spooler.appendChunks("terminal-4", [
        {
          terminalId: "terminal-4",
          cursor: "1",
          stream: "stdout",
          content: "closed\n",
          timestamp: "2026-03-28T11:00:00.000Z"
        }
      ]);

      await spooler.flushTerminal("terminal-4");
      await delay(80);
      spooler.appendChunks("terminal-4", [
        {
          terminalId: "terminal-4",
          cursor: "2",
          stream: "stdout",
          content: "ignored\n",
          timestamp: "2026-03-28T11:00:01.000Z"
        }
      ]);
      await delay(80);

      const flushFailedWarnings = warnSpy.mock.calls.filter(
        ([scope]) => scope === "[terminal-log-flush-failed]"
      );

      expect(flushFailedWarnings).toHaveLength(1);
      expect(fileRepository.findActiveByTerminalId("terminal-4")).toBeNull();
      expect(segmentRepository.findLatestByTerminalId("terminal-4")).toBeNull();
    } finally {
      warnSpy.mockRestore();
      await spooler.dispose();
      database.close();
    }
  });
});

async function closeWriterClientForTest(spooler: TerminalLogSpooler): Promise<void> {
  const writerClient = (
    spooler as unknown as {
      writerClient: {
        close(): Promise<void>;
      };
    }
  ).writerClient;

  await writerClient.close();
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function seedTerminalDependencies(db: ReturnType<typeof createDatabaseClient>["db"], terminalId: string): void {
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

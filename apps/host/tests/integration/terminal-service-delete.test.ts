import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { TerminalService } from "../../src/modules/terminal/terminal-service.js";
import { TerminalLogFileRepository } from "../../src/storage/repositories/terminal-log-file-repository.js";
import { TerminalLogSegmentRepository } from "../../src/storage/repositories/terminal-log-segment-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import type {
  TerminalInstance,
  TerminalRuntimeSession,
  TerminalRuntimeType
} from "../../src/types/domain.js";

const tempDirs: string[] = [];

describe("TerminalService.deleteTerminal", () => {
  afterEach(() => {
    vi.restoreAllMocks();

    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();

      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it("删库后 runtime 清理失败时仍然返回成功并清理挂起删除标记", async () => {
    const terminal: TerminalInstance = {
      id: "terminal-1",
      workspaceId: "workspace-1",
      name: "测试终端",
      cwd: "/tmp",
      shell: "/bin/zsh",
      runtimeType: "tmux",
      runtimeSessionId: "session-1",
      attachTarget: "session-1",
      status: "running",
      processId: 123,
      createdByUserId: "user-1",
      createdAt: "2026-03-27T08:00:00.000Z",
      lastActiveAt: "2026-03-27T08:00:00.000Z",
      closedAt: null,
      exitCode: null,
      statusDetail: null
    };
    const session: TerminalRuntimeSession = {
      id: "session-1",
      terminalId: "terminal-1",
      runtimeType: "tmux",
      sessionKey: "session-1",
      attachTarget: "session-1",
      hostInstanceId: null,
      agentPid: null,
      shellPid: 123,
      state: "running",
      lastHeartbeatAt: null,
      lastCheckedAt: "2026-03-27T08:00:00.000Z",
      lastErrorDetail: null,
      createdAt: "2026-03-27T08:00:00.000Z",
      updatedAt: "2026-03-27T08:00:00.000Z"
    };

    const deleteByTerminalId = vi.fn();
    const deleteTerminalRecord = vi.fn();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const service = new TerminalService(
      {
        transaction: (callback: () => void) => callback
      } as never,
      {
        findById: vi.fn((id: string) => (id === terminal.id ? terminal : null)),
        delete: deleteTerminalRecord,
        listRecoverable: vi.fn(() => [])
      } as never,
      {
        findById: vi.fn((id: string) => (id === session.id ? session : null)),
        deleteByTerminalId,
        updateState: vi.fn()
      } as never,
      {} as never,
      900
    );

    (service as any).runtimeManager = {
      terminateSession: vi.fn(() => {
        throw new AppError({
          statusCode: 502,
          errorCode: "RUNTIME_TERMINATE_FAILED",
          detail: "permission denied"
        });
      })
    };

    await expect(service.deleteTerminal(terminal.id)).resolves.toEqual({ success: true });
    expect(deleteByTerminalId).toHaveBeenCalledWith(terminal.id);
    expect(deleteTerminalRecord).toHaveBeenCalledWith(terminal.id);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[terminal-delete-runtime-cleanup-failed]",
      expect.objectContaining({
        terminalId: terminal.id,
        runtimeSessionId: session.id,
        runtimeType: session.runtimeType,
        error: "permission denied"
      })
    );
    expect((service as any).pendingDeletedTerminalIds.size).toBe(0);
  });

  it("关闭终端时会先 flush 再清理日志索引和文件", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-terminal-close-log-cleanup-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const fileRepository = new TerminalLogFileRepository(database.db);
    const segmentRepository = new TerminalLogSegmentRepository(database.db);

    seedTerminalLogDependencies(database.db, "terminal-2");

    const terminal = createTerminalFixture("terminal-2", "session-2");
    const session = createSessionFixture("terminal-2", "session-2");
    const terminalRepo = createMutableTerminalRepository(terminal);
    const runtimeRepo = createMutableRuntimeRepository(session);
    const service = new TerminalService(
      database.db,
      terminalRepo as never,
      runtimeRepo as never,
      {} as never,
      900,
      {
        terminalLogRootDir: tempDir,
        terminalLogFileRepository: fileRepository,
        terminalLogSegmentRepository: segmentRepository
      }
    );

    (service as any).runtimeManager = {
      terminateSession: vi.fn(() => false)
    };

    (service as any).handleRuntimeOutput("terminal-2", "before-close\n");

    await expect(service.closeTerminal("terminal-2")).resolves.toEqual({ success: true });
    expect(fileRepository.listByTerminalId("terminal-2")).toEqual([]);
    expect(segmentRepository.listByTerminalId("terminal-2")).toEqual([]);
    expect(existsSync(path.join(tempDir, "terminal-2"))).toBe(false);

    database.close();
  });

  it("删除终端且没有 exit 回调时也会清理日志索引和文件", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-terminal-delete-log-cleanup-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const fileRepository = new TerminalLogFileRepository(database.db);
    const segmentRepository = new TerminalLogSegmentRepository(database.db);

    seedTerminalLogDependencies(database.db, "terminal-3");

    const terminal = createTerminalFixture("terminal-3", "session-3");
    const session = createSessionFixture("terminal-3", "session-3");
    const terminalRepo = createMutableTerminalRepository(terminal);
    const runtimeRepo = createMutableRuntimeRepository(session);
    const service = new TerminalService(
      database.db,
      terminalRepo as never,
      runtimeRepo as never,
      {} as never,
      900,
      {
        terminalLogRootDir: tempDir,
        terminalLogFileRepository: fileRepository,
        terminalLogSegmentRepository: segmentRepository
      }
    );

    (service as any).runtimeManager = {
      terminateSession: vi.fn(() => false)
    };

    (service as any).handleRuntimeOutput("terminal-3", "before-delete\n");

    await expect(service.deleteTerminal("terminal-3")).resolves.toEqual({ success: true });
    expect(fileRepository.listByTerminalId("terminal-3")).toEqual([]);
    expect(segmentRepository.listByTerminalId("terminal-3")).toEqual([]);
    expect(existsSync(path.join(tempDir, "terminal-3"))).toBe(false);

    database.close();
  });

  it("已绑定 attachment 的运行中终端在输入时不会重复做持久会话检查", async () => {
    const terminal = createTerminalFixture("terminal-fast-input", "session-fast-input");
    const terminalRepo = createMutableTerminalRepository(terminal);
    const runtimeRepo = createMutableRuntimeRepository(
      createSessionFixture("terminal-fast-input", "session-fast-input")
    );
    const service = new TerminalService(
      {
        transaction: (callback: () => void) => callback
      } as never,
      terminalRepo as never,
      runtimeRepo as never,
      {} as never,
      900
    );

    const runtimeWrite = vi.fn();

    (service as any).runtimeManager = {
      isAttached: vi.fn(() => true),
      write: runtimeWrite
    };

    await expect(service.writeInput("terminal-fast-input", "pwd\r")).resolves.toEqual({ accepted: true });
    expect(runtimeWrite).toHaveBeenCalledWith("terminal-fast-input", "pwd\r");
    expect(runtimeRepo.findById).not.toHaveBeenCalled();
  });

  it("给工作台侧边栏提供终端快照时不会触发运行时探测", () => {
    const terminal = createTerminalFixture("terminal-snapshot", "session-snapshot");
    const terminalRepo = createMutableTerminalRepository(terminal);
    const runtimeRepo = createMutableRuntimeRepository(
      createSessionFixture("terminal-snapshot", "session-snapshot")
    );
    const workspaceService = {
      getWorkspaceOrThrow: vi.fn(() => ({
        id: "workspace-1",
        path: "C:/Code/CodingNS"
      }))
    };
    const service = new TerminalService(
      {
        transaction: (callback: () => void) => callback
      } as never,
      terminalRepo as never,
      runtimeRepo as never,
      workspaceService as never,
      900
    );

    const items = service.listTerminalSnapshotItems("workspace-1");

    expect(items).toEqual([terminal]);
    expect(workspaceService.getWorkspaceOrThrow).toHaveBeenCalledWith("workspace-1");
    expect(runtimeRepo.findById).not.toHaveBeenCalled();
  });

  it("读取历史前会先刷新待落盘输出，避免活跃终端只能等周期性 flush 才能看到最新历史", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-terminal-history-flush-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const fileRepository = new TerminalLogFileRepository(database.db);
    const segmentRepository = new TerminalLogSegmentRepository(database.db);

    seedTerminalLogDependencies(database.db, "terminal-4");

    const terminal = createTerminalFixture("terminal-4", "session-4", "embedded-pty");
    const session = createSessionFixture("terminal-4", "session-4", "embedded-pty");
    const service = new TerminalService(
      database.db,
      createMutableTerminalRepository(terminal) as never,
      createMutableRuntimeRepository(session) as never,
      {} as never,
      900,
      {
        terminalLogRootDir: tempDir,
        terminalLogFileRepository: fileRepository,
        terminalLogSegmentRepository: segmentRepository
      }
    );

    (service as any).handleRuntimeOutput("terminal-4", "live-");
    (service as any).handleRuntimeOutput("terminal-4", "history\n");

    const history = await service.readTerminalHistory("terminal-4", null, 10);

    expect(history.content).toContain("live-history");
    expect(segmentRepository.listByTerminalId("terminal-4")).toHaveLength(1);

    database.close();
  });
});

function createTerminalFixture(
  terminalId: string,
  sessionId = `session-for-${terminalId}`,
  runtimeType: TerminalRuntimeType = "tmux"
): TerminalInstance {
  return {
    id: terminalId,
    workspaceId: "workspace-1",
    name: "测试终端",
    cwd: "/tmp",
    shell: "/bin/zsh",
    runtimeType,
    runtimeSessionId: sessionId,
    attachTarget: sessionId,
    status: "running",
    processId: 123,
    createdByUserId: "user-1",
    createdAt: "2026-03-27T08:00:00.000Z",
    lastActiveAt: "2026-03-27T08:00:00.000Z",
    closedAt: null,
    exitCode: null,
    statusDetail: null
  };
}

function createSessionFixture(
  terminalId: string,
  sessionId: string,
  runtimeType: TerminalRuntimeType = "tmux"
): TerminalRuntimeSession {
  return {
    id: sessionId,
    terminalId,
    runtimeType,
    sessionKey: sessionId,
    attachTarget: sessionId,
    hostInstanceId: null,
    agentPid: null,
    shellPid: 123,
    state: "running",
    lastHeartbeatAt: null,
    lastCheckedAt: "2026-03-27T08:00:00.000Z",
    lastErrorDetail: null,
    createdAt: "2026-03-27T08:00:00.000Z",
    updatedAt: "2026-03-27T08:00:00.000Z"
  };
}

function createMutableTerminalRepository(terminal: TerminalInstance) {
  let current: TerminalInstance | null = terminal;

  return {
    findById: vi.fn((id: string) => (current?.id === id ? current : null)),
    listByWorkspace: vi.fn((workspaceId: string) => {
      if (!current || current.workspaceId !== workspaceId) {
        return [];
      }

      return [current];
    }),
    delete: vi.fn((id: string) => {
      if (current?.id === id) {
        current = null;
      }
    }),
    listRecoverable: vi.fn(() => []),
    updateLifecycle: vi.fn((input: Partial<TerminalInstance> & { id: string }) => {
      if (!current || current.id !== input.id) {
        return;
      }

      current = {
        ...current,
        ...input
      };
    }),
    touchLastActiveAt: vi.fn()
  };
}

function createMutableRuntimeRepository(session: TerminalRuntimeSession) {
  let current: TerminalRuntimeSession | null = session;

  return {
    findById: vi.fn((id: string) => (current?.id === id ? current : null)),
    deleteByTerminalId: vi.fn((terminalId: string) => {
      if (current?.terminalId === terminalId) {
        current = null;
      }
    }),
    updateState: vi.fn((input: Partial<TerminalRuntimeSession> & { id: string }) => {
      if (!current || current.id !== input.id) {
        return;
      }

      current = {
        ...current,
        ...input
      };
    })
  };
}

function seedTerminalLogDependencies(
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

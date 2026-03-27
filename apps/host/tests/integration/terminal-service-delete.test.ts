import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { TerminalService } from "../../src/modules/terminal/terminal-service.js";
import type {
  TerminalInstance,
  TerminalRuntimeSession
} from "../../src/types/domain.js";

describe("TerminalService.deleteTerminal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("删库后 runtime 清理失败时仍然返回成功并清理挂起删除标记", () => {
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

    expect(service.deleteTerminal(terminal.id)).toEqual({ success: true });
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
});

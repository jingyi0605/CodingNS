import { describe, expect, it, vi } from "vitest";

import { registerWorkbenchRuntimeTerminalSync } from "../../src/server/workbench-runtime-terminal-sync.js";

describe("registerWorkbenchRuntimeTerminalSync", () => {
  it("终态事件会先刷新用户会话状态，再广播工作台快照", async () => {
    let listener: ((event: { sessionId: string }) => Promise<void>) | null = null;
    const runtimeService = {
      registerTerminalStateListener: vi.fn((nextListener) => {
        listener = nextListener;
        return {
          close: vi.fn()
        };
      })
    };
    const refreshRuntimeFallbackSession = vi.fn(async () => undefined);
    const broadcastSnapshot = vi.fn(async () => undefined);

    registerWorkbenchRuntimeTerminalSync({
      authUserRepository: {
        listIds: vi.fn(() => ["user-1", "user-2"])
      },
      sessionHistoryService: {
        refreshRuntimeFallbackSession
      },
      workbenchWsHub: {
        broadcastSnapshot
      },
      runtimeServices: [runtimeService as never]
    });

    await listener?.({
      sessionId: "session-1"
    });

    expect(refreshRuntimeFallbackSession).toHaveBeenCalledTimes(2);
    expect(refreshRuntimeFallbackSession).toHaveBeenCalledWith("session-1", "user-1");
    expect(refreshRuntimeFallbackSession).toHaveBeenCalledWith("session-1", "user-2");
    expect(broadcastSnapshot).toHaveBeenCalledTimes(2);
    expect(refreshRuntimeFallbackSession.mock.invocationCallOrder[0]).toBeLessThan(
      broadcastSnapshot.mock.invocationCallOrder[0]
    );
    expect(refreshRuntimeFallbackSession.mock.invocationCallOrder[1]).toBeLessThan(
      broadcastSnapshot.mock.invocationCallOrder[1]
    );
  });

  it("单个用户刷新失败时，不会阻塞其他用户广播", async () => {
    let listener: ((event: { sessionId: string }) => Promise<void>) | null = null;
    const runtimeService = {
      registerTerminalStateListener: vi.fn((nextListener) => {
        listener = nextListener;
        return {
          close: vi.fn()
        };
      })
    };
    const refreshRuntimeFallbackSession = vi.fn(async (_sessionId: string, userId: string) => {
      if (userId === "user-1") {
        throw new Error("refresh failed");
      }
    });
    const broadcastSnapshot = vi.fn(async () => undefined);

    registerWorkbenchRuntimeTerminalSync({
      authUserRepository: {
        listIds: vi.fn(() => ["user-1", "user-2"])
      },
      sessionHistoryService: {
        refreshRuntimeFallbackSession
      },
      workbenchWsHub: {
        broadcastSnapshot
      },
      runtimeServices: [runtimeService as never]
    });

    await listener?.({
      sessionId: "session-1"
    });

    expect(broadcastSnapshot).toHaveBeenCalledTimes(1);
    expect(broadcastSnapshot).toHaveBeenCalledWith("user-2");
  });
});

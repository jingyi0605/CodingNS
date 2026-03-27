import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock
}));

import { AppError } from "../../src/shared/errors/app-error.js";
import { TmuxRuntimeAdapter } from "../../src/modules/terminal/runtime/adapters/tmux-runtime-adapter.js";

describe("TmuxRuntimeAdapter", () => {
  afterEach(() => {
    spawnSyncMock.mockReset();
  });

  it("tmux server 已不存在时，结束持久会话保持幂等成功", () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "no server running on /private/tmp/tmux-501/default\n",
      error: undefined
    });

    const adapter = new TmuxRuntimeAdapter();

    expect(() =>
      adapter.terminatePersistentSession({
        terminal: {
          id: "terminal-1"
        } as never,
        session: {
          sessionKey: "session-1"
        } as never
      })
    ).not.toThrow();

    expect(spawnSyncMock).toHaveBeenCalledWith("tmux", ["kill-session", "-t", "session-1"], {
      encoding: "utf8"
    });
  });

  it("真正的 tmux 结束失败仍然抛出错误", () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "permission denied\n",
      error: undefined
    });

    const adapter = new TmuxRuntimeAdapter();

    expect(() =>
      adapter.terminatePersistentSession({
        terminal: {
          id: "terminal-1"
        } as never,
        session: {
          sessionKey: "session-1"
        } as never
      })
    ).toThrowError(AppError);
  });
});

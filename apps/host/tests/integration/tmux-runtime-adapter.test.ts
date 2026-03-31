import { afterEach, describe, expect, it, vi } from "vitest";

const { helperRunMock } = vi.hoisted(() => ({
  helperRunMock: vi.fn()
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();

  return {
    ...actual,
    spawn: helperRunMock
  };
});

import { AppError } from "../../src/shared/errors/app-error.js";
import { TmuxRuntimeAdapter } from "../../src/modules/terminal/runtime/adapters/tmux-runtime-adapter.js";

describe("TmuxRuntimeAdapter", () => {
  afterEach(() => {
    helperRunMock.mockReset();
  });

  it("tmux server 已不存在时，结束持久会话保持幂等成功", async () => {
    if (process.platform === "win32") {
      return;
    }

    helperRunMock.mockImplementation(() => {
      return {
        stdout: {
          on: vi.fn()
        },
        stderr: {
          on: (event: string, handler: (chunk: string) => void) => {
            if (event === "data") {
              queueMicrotask(() => {
                handler("no server running on /private/tmp/tmux-501/default\n");
              });
            }
          }
        },
        on: (event: string, handler: (value?: number | Error) => void) => {
          if (event === "close") {
            queueMicrotask(() => {
              handler(1);
            });
          }
          return undefined;
        }
      };
    });

    const adapter = new TmuxRuntimeAdapter();

    await expect(
      adapter.terminatePersistentSession({
        terminal: {
          id: "terminal-1"
        } as never,
        session: {
          sessionKey: "session-1"
        } as never
      })
    ).resolves.toBeUndefined();

    expect(helperRunMock).toHaveBeenCalledWith("tmux", ["kill-session", "-t", "session-1"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
  });

  it("真正的 tmux 结束失败仍然抛出错误", async () => {
    if (process.platform === "win32") {
      return;
    }

    helperRunMock.mockImplementation(() => {
      return {
        stdout: {
          on: vi.fn()
        },
        stderr: {
          on: (event: string, handler: (chunk: string) => void) => {
            if (event === "data") {
              queueMicrotask(() => {
                handler("permission denied\n");
              });
            }
          }
        },
        on: (event: string, handler: (value?: number | Error) => void) => {
          if (event === "close") {
            queueMicrotask(() => {
              handler(1);
            });
          }
          return undefined;
        }
      };
    });

    const adapter = new TmuxRuntimeAdapter();

    await expect(
      adapter.terminatePersistentSession({
        terminal: {
          id: "terminal-1"
        } as never,
        session: {
          sessionKey: "session-1"
        } as never
      })
    ).rejects.toThrowError(AppError);
  });
});

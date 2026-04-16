import { afterEach, describe, expect, it, vi } from "vitest";

describe("OpenCodeSystemProbeHelperProcess", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("会解析 Linux ss 输出并只保留目标 pid 的监听端口", async () => {
    const { __internal__ } = await import("../../src/config/opencode-system-probe-helper-process.js");

    expect(
      __internal__.parseListeningSocketsFromSsOutput(
        [
          "LISTEN 0 511 127.0.0.1:41827 0.0.0.0:* users:((\"node\",pid=79133,fd=23))",
          "LISTEN 0 511 *:4098 *:* users:((\"node\",pid=79333,fd=24))",
          "LISTEN 0 511 [::1]:41827 [::]:* users:((\"node\",pid=79133,fd=25))"
        ].join("\n"),
        79133
      )
    ).toEqual([
      { hostname: "::1", port: 41827 },
      { hostname: "127.0.0.1", port: 41827 }
    ]);
  });

  it("lsof 缺失时会安静返回空监听结果", async () => {
    vi.doMock("node:child_process", () => ({
      spawn: () => {
        let errorHandler: ((error: Error & { code?: string }) => void) | null = null;
        let closeHandler: ((status: number | null) => void) | null = null;

        queueMicrotask(() => {
          const error = Object.assign(new Error("spawn lsof ENOENT"), {
            code: "ENOENT"
          });
          errorHandler?.(error);
          closeHandler?.(null);
        });

        return {
          stdout: {
            on: vi.fn()
          },
          stderr: {
            on: vi.fn()
          },
          on: (event: string, handler: (value: never) => void) => {
            if (event === "error") {
              errorHandler = handler as typeof errorHandler;
            }

            if (event === "close") {
              closeHandler = handler as typeof closeHandler;
            }
          }
        };
      }
    }));

    const { __internal__ } = await import("../../src/config/opencode-system-probe-helper-process.js");

    await expect(__internal__.readListeningSocketsViaLsof(79133)).resolves.toEqual([]);
  });

  it("底层系统命令超时后会主动终止子进程", async () => {
    const kill = vi.fn();

    vi.doMock("node:child_process", () => ({
      spawn: () => {
        return {
          killed: false,
          kill,
          stdout: {
            on: vi.fn()
          },
          stderr: {
            on: vi.fn()
          },
          on: vi.fn()
        };
      }
    }));

    const { __internal__ } = await import("../../src/config/opencode-system-probe-helper-process.js");

    await expect(
      __internal__.runCommand("ps", ["-ax"], {
        timeoutMs: 10
      })
    ).rejects.toThrow("COMMAND_TIMEOUT:ps");
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });
});

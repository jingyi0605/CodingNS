import { afterEach, describe, expect, it, vi } from "vitest";

describe("GitCommandHelperClient", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:readline");
    vi.resetModules();
  });

  it("AbortSignal 触发后会向 git helper 发送 cancel 消息", async () => {
    const writes: string[] = [];
    const stdin = {
      destroyed: false,
      write: vi.fn((content: string, callback?: (error?: Error | null) => void) => {
        writes.push(content.trim());
        callback?.(null);
        return true;
      })
    };
    const child = {
      stdout: {},
      stderr: {
        on: vi.fn()
      },
      stdin,
      killed: false,
      kill: vi.fn(),
      on: vi.fn()
    };
    const stdoutReader = {
      on: vi.fn(),
      close: vi.fn()
    };

    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => child)
    }));
    vi.doMock("node:readline", () => ({
      default: {
        createInterface: vi.fn(() => stdoutReader)
      }
    }));

    const { GitCommandHelperClient } = await import("../../src/modules/git/git-command-helper-client.js");
    const client = new GitCommandHelperClient();
    const controller = new AbortController();
    const promise = client.run(
      "/tmp/repo",
      ["status", "--porcelain=1"],
      {
        signal: controller.signal
      }
    );

    controller.abort(new Error("manual abort"));

    await expect(promise).rejects.toThrow("manual abort");
    expect(JSON.parse(writes[0])).toMatchObject({
      type: "run",
      id: "1",
      repoRoot: "/tmp/repo",
      args: ["status", "--porcelain=1"]
    });
    expect(JSON.parse(writes[1])).toMatchObject({
      type: "cancel",
      id: "cancel:1",
      targetId: "1"
    });
  });
});

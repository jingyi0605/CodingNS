import { afterEach, describe, expect, it, vi } from "vitest";

describe("TailscaleHelperClient lifecycle", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:readline");
    vi.resetModules();
  });

  it("dispose 会拒绝所有未完成请求，且后续请求直接失败", async () => {
    const stdin = {
      write: vi.fn((_: string, callback?: (error?: Error | null) => void) => {
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
      kill: vi.fn(() => {
        child.killed = true;
      }),
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

    const { TailscaleHelperClient } = await import("../../src/modules/tailscale/tailscale-helper-client.js");
    const client = new TailscaleHelperClient();
    const pendingPromise = client.inspectStatus({
      commandPath: "/tmp/fake-tailscale"
    });

    client.dispose();

    await expect(pendingPromise).rejects.toThrow("tailscale helper 已关闭");
    await expect(
      client.inspectStatus({
        commandPath: "/tmp/fake-tailscale"
      })
    ).rejects.toThrow("tailscale helper 已关闭");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

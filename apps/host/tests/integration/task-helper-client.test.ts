import { afterEach, describe, expect, it, vi } from "vitest";

describe("TaskHelperProcessClient", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:readline");
    vi.resetModules();
  });

  it("AbortSignal 触发后会向 helper 发送 cancel 消息", async () => {
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

    const { TaskHelperProcessClient } = await import("../../src/modules/tasks/task-helper-client.js");
    const client = new TaskHelperProcessClient();
    const controller = new AbortController();
    const promise = client.execute(
      "workspace.code_composition_scan",
      {
        workspacePath: "/tmp/demo"
      },
      controller.signal
    );

    controller.abort(new Error("manual abort"));

    await expect(promise).rejects.toThrow("manual abort");

    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[0])).toMatchObject({
      id: "1",
      type: "run",
      handler: "workspace.code_composition_scan",
      input: {
        workspacePath: "/tmp/demo"
      }
    });
    expect(JSON.parse(writes[1])).toMatchObject({
      id: "cancel:1",
      type: "cancel",
      targetId: "1"
    });
  });
});

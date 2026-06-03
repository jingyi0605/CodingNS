import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type * as readline from "node:readline";

import { describe, expect, it, vi } from "vitest";

import { TaskHelperProcessClient } from "../../../src/modules/tasks/task-helper-client.js";
import { TaskQueueWaitTimeoutError, TaskTimeoutError } from "../../../src/modules/tasks/task-types.js";

describe("TaskHelperProcessClient", () => {
  it("helper recycle 导致 stdout 关闭时会自动重试一次", async () => {
    let attempt = 0;
    const client = Object.create(TaskHelperProcessClient.prototype) as TaskHelperProcessClient & {
      disposed: boolean;
      executeOnce: ReturnType<typeof vi.fn>;
      handleChildTermination: ReturnType<typeof vi.fn>;
    };

    client.disposed = false;
    client.executeOnce = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("task helper stdout 已关闭");
      }
      return "ok";
    });
    client.handleChildTermination = vi.fn();

    const result = await TaskHelperProcessClient.prototype.execute.call(
      client,
      "affairs.library_index",
      { rootDir: "/tmp/demo" },
      undefined
    );

    expect(result).toBe("ok");
    expect(client.executeOnce).toHaveBeenCalledTimes(2);
    expect(client.handleChildTermination).not.toHaveBeenCalled();
  });

  it("重试时只回收失败的旧 child，不误杀已替换的新 child", async () => {
    const oldChild = { stdin: { destroyed: false }, stdout: { destroyed: false }, killed: false } as ChildProcessWithoutNullStreams;
    const newChild = { stdin: { destroyed: false }, stdout: { destroyed: false }, killed: false } as ChildProcessWithoutNullStreams;
    const firstError = Object.assign(new Error("task helper stdout 已关闭"), {
      __codingnsFailedHelperChild: oldChild
    });
    const client = Object.create(TaskHelperProcessClient.prototype) as TaskHelperProcessClient & {
      disposed: boolean;
      child: ChildProcessWithoutNullStreams | null;
      executeOnce: ReturnType<typeof vi.fn>;
      handleChildTermination: ReturnType<typeof vi.fn>;
    };

    client.disposed = false;
    client.child = oldChild;
    let attempt = 0;
    client.executeOnce = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        client.child = newChild;
        throw firstError;
      }
      return "ok";
    });
    client.handleChildTermination = vi.fn();

    const result = await TaskHelperProcessClient.prototype.execute.call(
      client,
      "affairs.library_index",
      { rootDir: "/tmp/demo" },
      undefined
    );

    expect(result).toBe("ok");
    expect(client.handleChildTermination).toHaveBeenCalledTimes(1);
    expect(client.handleChildTermination).toHaveBeenCalledWith(oldChild, firstError);
  });

  it("处理旧 child 退出时不会关闭新 child 的 stdout reader", () => {
    const oldChild = {
      stdin: { destroyed: false },
      stdout: { destroyed: false },
      killed: false,
      kill: vi.fn()
    } as unknown as ChildProcessWithoutNullStreams;
    const newChild = {
      stdin: { destroyed: false },
      stdout: { destroyed: false },
      killed: false,
      kill: vi.fn()
    } as unknown as ChildProcessWithoutNullStreams;
    const close = vi.fn();
    const client = Object.create(TaskHelperProcessClient.prototype) as TaskHelperProcessClient & {
      child: ChildProcessWithoutNullStreams | null;
      stdoutReader: readline.Interface | null;
      stdoutReaderChild: ChildProcessWithoutNullStreams | null;
      rejectPendingForChild: ReturnType<typeof vi.fn>;
    };

    client.child = newChild;
    client.stdoutReader = { close } as unknown as readline.Interface;
    client.stdoutReaderChild = newChild;
    client.rejectPendingForChild = vi.fn();

    (TaskHelperProcessClient.prototype as any).handleChildTermination.call(
      client,
      oldChild,
      new Error("task helper 已退出：code=0 signal=null")
    );

    expect(close).not.toHaveBeenCalled();
    expect(client.child).toBe(newChild);
    expect(client.rejectPendingForChild).toHaveBeenCalledTimes(1);
  });

  it("helper 请求超时时不再强制回收当前 child，并停止自动重试", async () => {
    const kill = vi.fn();
    const close = vi.fn();
    const rejectPendingForChild = vi.fn();
    const child = {
      stdin: { destroyed: false },
      stdout: { destroyed: false },
      killed: false,
      kill
    } as unknown as ChildProcessWithoutNullStreams;
    const timeoutError = new TaskTimeoutError("affairs.library_index:workspace-1 超过 1000ms 未完成");
    const client = Object.create(TaskHelperProcessClient.prototype) as TaskHelperProcessClient & {
      disposed: boolean;
      child: ChildProcessWithoutNullStreams | null;
      stdoutReader: readline.Interface | null;
      stdoutReaderChild: ChildProcessWithoutNullStreams | null;
      executeOnce: ReturnType<typeof vi.fn>;
      rejectPendingForChild: ReturnType<typeof vi.fn>;
    };

    client.disposed = false;
    client.child = child;
    client.stdoutReader = { close } as unknown as readline.Interface;
    client.stdoutReaderChild = child;
    client.executeOnce = vi.fn(async () => {
      throw timeoutError;
    });
    client.rejectPendingForChild = rejectPendingForChild;

    await expect(TaskHelperProcessClient.prototype.execute.call(
      client,
      "affairs.library_index",
      { rootDir: "/tmp/demo" },
      undefined
    )).rejects.toBe(timeoutError);

    expect(client.executeOnce).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(client.child).toBe(child);
    expect(client.stdoutReader).not.toBeNull();
    expect(client.stdoutReaderChild).toBe(child);
    expect(rejectPendingForChild).not.toHaveBeenCalled();
  });

  it("helper 返回 queue timeout 错误码时，会映射成 TaskQueueWaitTimeoutError", () => {
    const reject = vi.fn();
    const client = Object.create(TaskHelperProcessClient.prototype) as TaskHelperProcessClient & {
      pendingRequests: Map<string, { reject: (reason?: unknown) => void }>;
      inflightRemoteRequestIds: Set<string>;
      lastHeartbeatAtMs: number | null;
    };

    client.pendingRequests = new Map([
      ["1", { reject }]
    ]);
    client.inflightRemoteRequestIds = new Set(["1"]);
    client.lastHeartbeatAtMs = null;

    (TaskHelperProcessClient.prototype as any).handleResponseLine.call(
      client,
      JSON.stringify({
        type: "result",
        id: "1",
        ok: false,
        error: "affairs.library_index:1 helper 内部排队等待超过 15000ms 仍未开始执行",
        errorCode: "TASK_QUEUE_WAIT_TIMEOUT"
      })
    );

    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0]?.[0]).toBeInstanceOf(TaskQueueWaitTimeoutError);
  });
});

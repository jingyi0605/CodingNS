import { describe, expect, it, vi } from "vitest";

import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { createHostTaskLaneExecutors } from "../../src/modules/tasks/task-lane-executors.js";
import { TaskCancelledError, TaskQueueWaitTimeoutError, TaskTimeoutError } from "../../src/modules/tasks/task-types.js";

describe("TaskManager", () => {
  it("会按 taskType + key 去重，并记录最小指标", async () => {
    const manager = createTaskManager();
    const deferred = createDeferred<string>();
    const run = vi.fn(async () => deferred.promise);

    manager.register({
      taskType: "test.dedupe",
      executionLane: "host_background",
      run
    });

    const first = manager.enqueue<{ value: string }, string>("test.dedupe", {
      key: "workspace-1",
      input: { value: "first" },
      source: "test.first"
    });
    const second = manager.enqueue<{ value: string }, string>("test.dedupe", {
      key: "workspace-1",
      input: { value: "second" },
      source: "test.second"
    });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    deferred.resolve("done");

    await expect(first.promise).resolves.toBe("done");
    await expect(second.promise).resolves.toBe("done");

    const metrics = manager.observe();
    expect(metrics.totals.enqueue).toBe(2);
    expect(metrics.totals.dedupe).toBe(1);
    expect(metrics.totals.started).toBe(1);
    expect(metrics.totals.finished).toBe(1);
    expect(metrics.totals.failed).toBe(0);
    expect(metrics.taskTypes["test.dedupe"]?.waitMs.count).toBe(1);
    expect(metrics.taskTypes["test.dedupe"]?.runMs.count).toBe(1);
  });

  it("并发受限时会排队，取消排队任务不会误启动", async () => {
    const manager = createTaskManager();
    const firstDeferred = createDeferred<string>();
    const run = vi.fn(async ({ value }: { value: string }) => {
      if (value === "first") {
        return firstDeferred.promise;
      }

      return value;
    });

    manager.register({
      taskType: "test.queue",
      executionLane: "host_background",
      concurrency: 1,
      run
    });

    const first = manager.enqueue<{ value: string }, string>("test.queue", {
      key: "first",
      input: { value: "first" }
    });
    const second = manager.enqueue<{ value: string }, string>("test.queue", {
      key: "second",
      input: { value: "second" }
    });

    expect(run).toHaveBeenCalledTimes(1);

    second.cancel("queue no longer needed");
    firstDeferred.resolve("first");

    await expect(first.promise).resolves.toBe("first");
    await expect(second.promise).rejects.toBeInstanceOf(TaskCancelledError);
    expect(run).toHaveBeenCalledTimes(1);

    const metrics = manager.observe();
    expect(metrics.totals.enqueue).toBe(2);
    expect(metrics.totals.cancelled).toBe(1);
    expect(metrics.totals.finished).toBe(1);
  });

  it("超时任务会中止并记录 timeout 指标", async () => {
    const manager = createTaskManager();

    manager.register({
      taskType: "test.timeout",
      executionLane: "external_process",
      timeoutMs: 20,
      run: async () => new Promise<string>(() => undefined)
    });

    const handle = manager.enqueue<undefined, string>("test.timeout", {
      key: "provider-1",
      input: undefined
    });

    await expect(handle.promise).rejects.toBeInstanceOf(TaskTimeoutError);

    const metrics = manager.observe();
    expect(metrics.totals.timeout).toBe(1);
    expect(metrics.totals.finished).toBe(0);
    expect(manager.peek("test.timeout", "provider-1")?.status).toBe("timeout");
  });

  it("并发受限且排队过久时，会进入 queue_timeout 并清理陈旧 queued 快照", async () => {
    vi.useFakeTimers();
    const manager = createTaskManager();
    const firstDeferred = createDeferred<string>();
    const run = vi.fn(async ({ value }: { value: string }) => {
      if (value === "first") {
        return firstDeferred.promise;
      }
      return value;
    });

    manager.register({
      taskType: "test.queue_wait_timeout",
      executionLane: "host_background",
      concurrency: 1,
      queueWaitTimeoutMs: 20,
      run
    });

    const first = manager.enqueue<{ value: string }, string>("test.queue_wait_timeout", {
      key: "first",
      input: { value: "first" }
    });
    const second = manager.enqueue<{ value: string }, string>("test.queue_wait_timeout", {
      key: "second",
      input: { value: "second" }
    });
    const secondResult = second.promise.catch((error) => error);

    await vi.advanceTimersByTimeAsync(25);

    await expect(secondResult).resolves.toBeInstanceOf(TaskQueueWaitTimeoutError);
    expect(manager.peek("test.queue_wait_timeout", "second")).toMatchObject({
      status: "queue_timeout",
      errorCode: "TASK_QUEUE_WAIT_TIMEOUT"
    });

    firstDeferred.resolve("first");
    await expect(first.promise).resolves.toBe("first");
    expect(run).toHaveBeenCalledTimes(1);

    const third = manager.enqueue<{ value: string }, string>("test.queue_wait_timeout", {
      key: "third",
      input: { value: "third" }
    });
    await expect(third.promise).resolves.toBe("third");
    expect(run).toHaveBeenCalledTimes(2);

    const metrics = manager.observe();
    expect(metrics.totals.timeout).toBe(1);
    vi.useRealTimers();
  });

  it("helper 内部排队超时上抛后，Host 任务快照也会收口成 queue_timeout", async () => {
    const manager = createTaskManager(null, {
      helper_process: {
        execute: async () => {
          throw new TaskQueueWaitTimeoutError("affairs.library_index:1 helper 内部排队等待超过 15000ms 仍未开始执行");
        }
      }
    });

    manager.register({
      taskType: "test.helper_queue_wait_timeout",
      executionLane: "helper_process",
      helperProcessHandler: "affairs.library_index",
      queueWaitTimeoutMs: 15_000,
      run: async () => "unexpected"
    });

    const handle = manager.enqueue("test.helper_queue_wait_timeout", {
      key: "workspace-1",
      input: {
        rootDir: "/tmp/demo"
      }
    });

    await expect(handle.promise).rejects.toBeInstanceOf(TaskQueueWaitTimeoutError);
    expect(manager.peek("test.helper_queue_wait_timeout", "workspace-1")).toMatchObject({
      status: "queue_timeout",
      errorCode: "TASK_QUEUE_WAIT_TIMEOUT"
    });
  });

  it("helper_process lane 会优先走统一 helper executor，而不是回落到主线程 run", async () => {
    const manager = createTaskManager(null, createHostTaskLaneExecutors());
    const run = vi.fn(async () => ({
      scannedFileCount: 999,
      truncated: false,
      items: [],
      error: null
    }));

    manager.register({
      taskType: "test.helper_process",
      executionLane: "helper_process",
      helperProcessHandler: "workspace.code_composition_scan",
      run
    });

    const result = await manager.enqueue<{ workspacePath: string }, {
      scannedFileCount: number;
      truncated: boolean;
      items: unknown[];
      error: string | null;
    }>("test.helper_process", {
      key: "workspace-1",
      input: {
        workspacePath: "/definitely/not/exist"
      }
    }).promise;

    expect(result.scannedFileCount).toBe(0);
    expect(result.error).toBe("工作区路径不存在，无法统计代码类型");
    expect(run).not.toHaveBeenCalled();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

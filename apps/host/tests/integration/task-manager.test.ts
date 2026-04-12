import { describe, expect, it, vi } from "vitest";

import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { TaskCancelledError, TaskTimeoutError } from "../../src/modules/tasks/task-types.js";

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

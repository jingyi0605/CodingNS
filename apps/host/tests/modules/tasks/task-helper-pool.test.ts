import { describe, expect, it, vi } from "vitest";

import { TaskHelperPool } from "../../../src/modules/tasks/task-helper-pool.js";

function createFakeClient() {
  return {
    execute: vi.fn(async (_handler: string, _input: unknown, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw signal.reason ?? new Error("aborted");
      }
      return "ok";
    }),
    dispose: vi.fn(),
    hasInflightRemoteWork: vi.fn(() => false),
    terminateCurrentChild: vi.fn(),
    getHealthSnapshot: vi.fn(() => ({
      pid: 123,
      alive: true,
      inflightRemoteRequestCount: 0,
      startedAt: "2026-06-03T00:00:00.000Z",
      lastHeartbeatAt: "2026-06-03T00:00:01.000Z",
      lastExitAt: null,
      lastTerminationReason: null
    }))
  };
}

describe("TaskHelperPool", () => {
  it("同一个 rootDir 会复用同一个 worker，不同 rootDir 会隔离到不同 worker", async () => {
    const clients: ReturnType<typeof createFakeClient>[] = [];
    const pool = new TaskHelperPool(() => {
      const client = createFakeClient();
      clients.push(client);
      return client;
    });

    await pool.execute("affairs.library_index", { rootDir: "/tmp/a" });
    await pool.execute("affairs.library_export", { rootDir: "/tmp/a" });
    await pool.execute("affairs.library_index", { rootDir: "/tmp/b" });

    expect(clients).toHaveLength(2);
    expect(clients[0]?.execute).toHaveBeenCalledTimes(2);
    expect(clients[1]?.execute).toHaveBeenCalledTimes(1);
    expect(pool.getWorkerHealth("/tmp/a")?.workerKey).toBe("rootDir:/tmp/a");
    expect(pool.getWorkerHealth("/tmp/b")?.workerKey).toBe("rootDir:/tmp/b");
  });

  it("软取消超时后只会终止当前 rootDir 的 worker", async () => {
    vi.useFakeTimers();
    const clients: ReturnType<typeof createFakeClient>[] = [];
    const deferred = createDeferred<string>();
    const pool = new TaskHelperPool(() => {
      const client = createFakeClient();
      client.execute = vi.fn(async (_handler: string, _input: unknown, signal?: AbortSignal) => {
        signal?.addEventListener("abort", () => {
          // 模拟 helper 忽略软取消，promise 不立即结束。
        });
        return await deferred.promise;
      });
      client.hasInflightRemoteWork = vi.fn(() => true);
      client.terminateCurrentChild = vi.fn(() => {
        deferred.reject(new Error("forced kill"));
      });
      clients.push(client);
      return client;
    });

    const controller = new AbortController();
    const promise = pool.execute("affairs.library_index", { rootDir: "/tmp/a" }, controller.signal);
    const caught = promise.catch((error) => error);

    controller.abort(new Error("manual abort"));
    await vi.advanceTimersByTimeAsync(3_100);

    expect(clients).toHaveLength(1);
    expect(clients[0]?.terminateCurrentChild).toHaveBeenCalledTimes(1);
    expect(clients[0]?.terminateCurrentChild).toHaveBeenCalledWith(
      expect.stringContaining("helper_soft_cancel_timeout:affairs.library_index:/tmp/a")
    );
    expect(await caught).toBeInstanceOf(Error);

    deferred.resolve("done");
    vi.useRealTimers();
  });

  it("worker 健康信息会带上 pid、心跳和最近完成时间", async () => {
    const client = createFakeClient();
    const pool = new TaskHelperPool(() => client);

    await pool.execute("affairs.library_index", { rootDir: "/tmp/a" });

    const health = pool.getWorkerHealth("/tmp/a");
    expect(health).toMatchObject({
      pid: 123,
      lastHeartbeatAt: "2026-06-03T00:00:01.000Z"
    });
    expect(health?.lastCompletedAt).not.toBeNull();
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

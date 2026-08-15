import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionHistorySourceCoordinator } from "../../src/modules/sessions/session-history-source-coordinator.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionHistorySourceCoordinator", () => {
  it("同一来源共享 watcher，并把连续文件事件合并成一次刷新", () => {
    vi.useFakeTimers();
    const onRefreshRequested = vi.fn();
    const watchCallbacks: Array<(eventType: string) => void> = [];
    const watcherClose = vi.fn();
    const coordinator = new SessionHistorySourceCoordinator({
      onRefreshRequested,
      quietWindowMs: 120,
      fallbackIntervalMs: 5_000,
      readVersion: () => "v1",
      watchFile: (_filePath, onEvent) => {
        watchCallbacks.push(onEvent);
        return { close: watcherClose };
      }
    });

    const first = coordinator.subscribe({
      sourceKey: "codex:raw:/tmp/session.jsonl",
      rawStoreRef: "/tmp/session.jsonl"
    });
    const second = coordinator.subscribe({
      sourceKey: "codex:raw:/tmp/session.jsonl",
      rawStoreRef: "/tmp/session.jsonl"
    });

    expect(watchCallbacks).toHaveLength(1);
    watchCallbacks[0]?.("change");
    watchCallbacks[0]?.("change");
    vi.advanceTimersByTime(119);
    expect(onRefreshRequested).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRefreshRequested).toHaveBeenCalledTimes(1);

    first.close();
    expect(watcherClose).not.toHaveBeenCalled();
    second.close();
    expect(watcherClose).toHaveBeenCalledTimes(1);
    expect(coordinator.getSourceCount()).toBe(0);
  });

  it("watcher 漏事件时由低频版本检查补发刷新", async () => {
    vi.useFakeTimers();
    const onRefreshRequested = vi.fn();
    let version = "v1";
    const coordinator = new SessionHistorySourceCoordinator({
      onRefreshRequested,
      quietWindowMs: 100,
      fallbackIntervalMs: 1_000,
      readVersion: () => version,
      watchFile: () => ({ close() {} })
    });

    const subscription = coordinator.subscribe({
      sourceKey: "codex:raw:/tmp/session.jsonl",
      rawStoreRef: "/tmp/session.jsonl"
    });
    version = "v2";
    await vi.advanceTimersByTimeAsync(1_100);

    expect(onRefreshRequested).toHaveBeenCalledTimes(1);
    coordinator.markClean("codex:raw:/tmp/session.jsonl");
    await vi.advanceTimersByTimeAsync(1_100);
    expect(onRefreshRequested).toHaveBeenCalledTimes(1);

    subscription.close();
  });
});

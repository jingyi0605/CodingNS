import { describe, expect, it, vi, afterEach } from "vitest";

import {
  SessionActivityAuthorityService
} from "../../src/modules/sessions/session-activity-authority-service.js";

describe("SessionActivityAuthorityService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("权威 runtime 终态不会被同轮次 inferred running 覆盖", () => {
    const service = new SessionActivityAuthorityService();

    service.observe({
      sessionId: "session-1",
      runId: "runtime:session-1:1",
      runningState: "completed",
      source: "authoritative_runtime",
      confidence: "strong",
      detail: "run completed",
      errorCode: null,
      observedAt: "2026-03-31T00:00:10.000Z"
    });

    const resolution = service.observe({
      sessionId: "session-1",
      runId: null,
      runningState: "running",
      source: "inferred_log",
      confidence: "weak",
      detail: "jsonl still changed",
      errorCode: null,
      observedAt: "2026-03-31T00:00:11.000Z"
    });

    expect(resolution.runningState).toBe("completed");
    expect(resolution.activityResolutionSource).toBe("authoritative_runtime");
    expect(resolution.activityConfidence).toBe("strong");
  });

  it("watchdog 会把长时间无事件的 authoritative runtime 先降级为 stale 再降级为 unknown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T00:00:00.000Z"));
    const service = new SessionActivityAuthorityService({
      staleAfterMs: 1_000,
      unknownAfterMs: 2_000
    });

    service.observe({
      sessionId: "session-1",
      runId: "runtime:session-1:1",
      runningState: "running",
      source: "authoritative_runtime",
      confidence: "authoritative",
      detail: "still running",
      errorCode: null,
      observedAt: "2026-03-31T00:00:00.000Z"
    });

    vi.advanceTimersByTime(1_000);
    expect(service.getResolution("session-1")).toMatchObject({
      runningState: "stale",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "strong"
    });

    vi.advanceTimersByTime(1_000);
    expect(service.getResolution("session-1")).toMatchObject({
      runningState: "unknown",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "weak"
    });
  });

  it("watchdog 降级后的 stale 不会被同一条旧 runtime 快照立刻抬回 running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T00:00:00.000Z"));
    const service = new SessionActivityAuthorityService({
      staleAfterMs: 1_000,
      unknownAfterMs: 5_000
    });

    service.observe({
      sessionId: "session-1",
      runId: "runtime:session-1:1",
      runningState: "running",
      source: "authoritative_runtime",
      confidence: "authoritative",
      detail: "still running",
      errorCode: null,
      observedAt: "2026-03-31T00:00:00.000Z"
    });

    vi.advanceTimersByTime(1_000);
    expect(service.getResolution("session-1")?.runningState).toBe("stale");

    const resolution = service.observe({
      sessionId: "session-1",
      runId: "runtime:session-1:1",
      runningState: "running",
      source: "authoritative_runtime",
      confidence: "authoritative",
      detail: "still running",
      errorCode: null,
      observedAt: "2026-03-31T00:00:00.000Z"
    });

    expect(resolution.runningState).toBe("stale");
    expect(resolution.watchdogTriggeredAt).toBe("2026-03-31T00:00:01.000Z");
  });
});

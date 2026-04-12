import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerFollowUpService } from "../../src/modules/butler/butler-follow-up-service.js";
import { ButlerFollowUpScheduler } from "../../src/modules/butler/butler-follow-up-scheduler.js";
import { SchedulerMetrics } from "../../src/modules/tasks/scheduler-metrics.js";

describe("ButlerFollowUpScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("默认每 10 秒触发一次跟进扫描", async () => {
    vi.useFakeTimers();

    const schedulerMetrics = new SchedulerMetrics();
    const followUpService = {
      runDueTasks: vi.fn(async () => ({
        activeTaskCount: 0,
        dueTaskCount: 0,
        processedTaskCount: 0,
        idle: true
      }))
    } satisfies Pick<ButlerFollowUpService, "runDueTasks">;
    const scheduler = new ButlerFollowUpScheduler(followUpService, {
      intervalMs: 10_000,
      maxIntervalMs: 40_000,
      now: () => "2026-04-07T10:00:00.000Z",
      schedulerMetrics
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(followUpService.runDueTasks).toHaveBeenCalledTimes(1);
    expect(schedulerMetrics.observe().schedulers.butler_follow_up?.nextDelayMs).toBe(10_000);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(followUpService.runDueTasks).toHaveBeenCalledTimes(2);
    expect(schedulerMetrics.observe().schedulers.butler_follow_up?.nextDelayMs).toBe(20_000);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(followUpService.runDueTasks).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(followUpService.runDueTasks).toHaveBeenCalledTimes(3);
    expect(schedulerMetrics.observe().schedulers.butler_follow_up?.idleTickTotal).toBe(3);

    await scheduler.dispose();
  });
});

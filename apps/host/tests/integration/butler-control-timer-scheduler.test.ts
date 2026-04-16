import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerControlTimerService } from "../../src/modules/butler/butler-control-timer-service.js";
import { ButlerControlTimerScheduler } from "../../src/modules/butler/butler-control-timer-scheduler.js";
import { SchedulerMetrics } from "../../src/modules/tasks/scheduler-metrics.js";

describe("ButlerControlTimerScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("默认每 10 秒触发一次控制会话计时器扫描", async () => {
    vi.useFakeTimers();

    const schedulerMetrics = new SchedulerMetrics();
    const timerService = {
      runDueTimers: vi.fn(async () => ({
        activeTimerCount: 0,
        dueTimerCount: 0,
        processedTimerCount: 0,
        idle: true
      }))
    } satisfies Pick<ButlerControlTimerService, "runDueTimers">;
    const scheduler = new ButlerControlTimerScheduler(timerService, {
      intervalMs: 10_000,
      maxIntervalMs: 40_000,
      now: () => "2026-04-16T12:00:00.000Z",
      schedulerMetrics
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(timerService.runDueTimers).toHaveBeenCalledTimes(1);
    expect(schedulerMetrics.observe().schedulers.butler_control_timer?.nextDelayMs).toBe(10_000);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(timerService.runDueTimers).toHaveBeenCalledTimes(2);
    expect(schedulerMetrics.observe().schedulers.butler_control_timer?.nextDelayMs).toBe(20_000);

    await scheduler.dispose();
  });
});

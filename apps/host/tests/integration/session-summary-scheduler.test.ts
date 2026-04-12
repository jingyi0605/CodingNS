import { describe, expect, it, vi } from "vitest";

import { SessionSummaryScheduler } from "../../src/modules/butler/session-summary-scheduler.js";
import type { ButlerSessionSummaryService } from "../../src/modules/butler/butler-session-summary-service.js";
import { SchedulerMetrics } from "../../src/modules/tasks/scheduler-metrics.js";

describe("SessionSummaryScheduler", () => {
  it("会定时触发代码助手会话摘要扫描", async () => {
    const schedulerMetrics = new SchedulerMetrics();
    const summaryService = {
      runOnce: vi.fn(async () => ({
        projectCount: 1,
        sessionCount: 2,
        scheduledCount: 1,
        summarizedCount: 1,
        idle: false
      }))
    } satisfies Pick<ButlerSessionSummaryService, "runOnce">;
    const scheduler = new SessionSummaryScheduler(summaryService, {
      intervalMs: 15_000,
      now: () => "2026-04-06T10:00:00.000Z",
      schedulerMetrics
    });

    await scheduler.runOnce();

    expect(summaryService.runOnce).toHaveBeenCalledTimes(1);
    expect(schedulerMetrics.observe().schedulers.session_summary?.taskCountTotal).toBe(2);
    expect(schedulerMetrics.observe().schedulers.session_summary?.idleTickTotal).toBe(0);

    await scheduler.dispose();
  });
});

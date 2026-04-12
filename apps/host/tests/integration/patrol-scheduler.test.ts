import { describe, expect, it, vi } from "vitest";

import type { PatrolPlanView } from "../../src/modules/butler/patrol-plan-service.js";
import type { PatrolExecutionService } from "../../src/modules/butler/patrol-execution-service.js";
import type { PatrolPlanService } from "../../src/modules/butler/patrol-plan-service.js";
import type { PatrolRunService } from "../../src/modules/butler/patrol-run-service.js";
import { PatrolScheduler } from "../../src/modules/butler/patrol-scheduler.js";
import { SchedulerMetrics } from "../../src/modules/tasks/scheduler-metrics.js";

describe("PatrolScheduler", () => {
  it("会扫描到期计划并触发巡视运行", async () => {
    const duePlan: PatrolPlanView = {
      id: "plan-1",
      projectId: "project-1",
      name: "daily",
      triggerType: "interval",
      triggerConfig: {
        minutes: 30
      },
      executionMode: "readonly",
      patrolScope: {},
      enabled: true,
      lastScheduledAt: null,
      nextRunAt: "2026-04-02T00:00:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };

    const patrolPlanService = {
      listDuePlans: vi.fn(() => [duePlan]),
      markPlanScheduled: vi.fn(() => duePlan)
    } satisfies Pick<PatrolPlanService, "listDuePlans" | "markPlanScheduled">;
    const patrolRunService = {
      expireStaleRunningRuns: vi.fn(() => []),
      hasRunningRun: vi.fn(() => false),
      startRun: vi.fn(() => ({
        id: "run-1"
      }))
    } satisfies Pick<PatrolRunService, "expireStaleRunningRuns" | "hasRunningRun" | "startRun">;
    const patrolExecutionService = {
      executeQueuedRun: vi.fn(async () => ({
        id: "run-1"
      }))
    } satisfies Pick<PatrolExecutionService, "executeQueuedRun">;

    const scheduler = new PatrolScheduler(
      patrolPlanService as unknown as PatrolPlanService,
      patrolRunService as unknown as PatrolRunService,
      patrolExecutionService as unknown as PatrolExecutionService,
      {
        intervalMs: 10_000,
        now: () => "2026-04-02T01:00:00.000Z"
      }
    );

    await scheduler.runOnce();

    expect(patrolPlanService.listDuePlans).toHaveBeenCalledWith("2026-04-02T01:00:00.000Z", 50);
    expect(patrolRunService.expireStaleRunningRuns).toHaveBeenCalledWith("project-1", {
      referenceAt: "2026-04-02T01:00:00.000Z",
      staleTimeoutMs: 1_200_000,
      summary: "巡视执行超过调度容忍时长，系统已自动终止并标记失败"
    });
    expect(patrolRunService.startRun).toHaveBeenCalledWith("project-1", {
      planId: "plan-1",
      triggeredBy: "scheduler",
      triggerRef: "patrol-scheduler:2026-04-02T01:00:00.000Z"
    });
    expect(patrolExecutionService.executeQueuedRun).toHaveBeenCalledWith("run-1");
    expect(patrolPlanService.markPlanScheduled).toHaveBeenCalledWith(
      "project-1",
      "plan-1",
      "2026-04-02T01:00:00.000Z"
    );

    await scheduler.dispose();
  });

  it("空转时会记录 idle 指标并逐步退让", async () => {
    vi.useFakeTimers();

    const schedulerMetrics = new SchedulerMetrics();
    const patrolPlanService = {
      listDuePlans: vi.fn(() => []),
      markPlanScheduled: vi.fn()
    } satisfies Pick<PatrolPlanService, "listDuePlans" | "markPlanScheduled">;
    const patrolRunService = {
      expireStaleRunningRuns: vi.fn(() => []),
      hasRunningRun: vi.fn(() => false),
      startRun: vi.fn()
    } satisfies Pick<PatrolRunService, "expireStaleRunningRuns" | "hasRunningRun" | "startRun">;
    const patrolExecutionService = {
      executeQueuedRun: vi.fn()
    } satisfies Pick<PatrolExecutionService, "executeQueuedRun">;

    const scheduler = new PatrolScheduler(
      patrolPlanService as unknown as PatrolPlanService,
      patrolRunService as unknown as PatrolRunService,
      patrolExecutionService as unknown as PatrolExecutionService,
      {
        intervalMs: 1_000,
        maxIntervalMs: 4_000,
        now: () => "2026-04-02T02:00:00.000Z",
        schedulerMetrics
      }
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(patrolPlanService.listDuePlans).toHaveBeenCalledTimes(1);
    expect(schedulerMetrics.observe().schedulers.patrol?.nextDelayMs).toBe(1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(patrolPlanService.listDuePlans).toHaveBeenCalledTimes(2);
    expect(schedulerMetrics.observe().schedulers.patrol?.nextDelayMs).toBe(2_000);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(patrolPlanService.listDuePlans).toHaveBeenCalledTimes(3);
    expect(schedulerMetrics.observe().schedulers.patrol?.nextDelayMs).toBe(4_000);
    expect(schedulerMetrics.observe().schedulers.patrol?.idleTickTotal).toBe(3);

    await scheduler.dispose();
    vi.useRealTimers();
  });
});

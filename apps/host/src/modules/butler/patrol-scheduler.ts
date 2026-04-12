import { nowIso } from "../../shared/utils/time.js";
import {
  resolveAdaptiveSchedulerDelayMs,
  type SchedulerMetrics
} from "../tasks/scheduler-metrics.js";
import type { PatrolPlanService } from "./patrol-plan-service.js";
import type { PatrolExecutionService } from "./patrol-execution-service.js";
import type { PatrolRunService } from "./patrol-run-service.js";

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_STALE_TIMEOUT_MS = 20 * 60_000;
const MAX_PLANS_PER_TICK = 50;

interface PatrolSchedulerLogger {
  error(message: string, detail?: unknown): void;
}

interface PatrolSchedulerOptions {
  intervalMs?: number;
  maxIntervalMs?: number;
  staleTimeoutMs?: number;
  logger?: PatrolSchedulerLogger;
  now?: () => string;
  schedulerMetrics?: SchedulerMetrics;
}

interface PatrolTickResult {
  referenceAt: string;
  taskCount: number;
  idle: boolean;
  errorCount: number;
}

/**
 * 巡视计划后台调度器。
 *
 * 第一版只做两件事：
 * 1. 周期扫描已到期的计划
 * 2. 为到期计划登记一条巡视运行记录，并推进下一次触发时间
 */
export class PatrolScheduler {
  private readonly intervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly staleTimeoutMs: number;
  private readonly logger: PatrolSchedulerLogger;
  private readonly now: () => string;
  private readonly schedulerMetrics: SchedulerMetrics | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private started = false;
  private disposed = false;
  private idleStreak = 0;

  constructor(
    private readonly patrolPlanService: PatrolPlanService,
    private readonly patrolRunService: PatrolRunService,
    private readonly patrolExecutionService: PatrolExecutionService,
    options: PatrolSchedulerOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxIntervalMs = Math.max(this.intervalMs, options.maxIntervalMs ?? this.intervalMs * 8);
    this.staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
    this.logger = options.logger ?? console;
    this.now = options.now ?? nowIso;
    this.schedulerMetrics = options.schedulerMetrics ?? null;
  }

  start(): void {
    if (this.timer || this.disposed) {
      return;
    }

    this.started = true;
    this.scheduleNext(0);
  }

  async dispose(): Promise<void> {
    this.started = false;
    this.disposed = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    while (this.ticking) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async runOnce(): Promise<void> {
    await this.tick(false);
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(shouldScheduleNext = true): Promise<void> {
    if (this.ticking) {
      return;
    }

    this.ticking = true;
    const tickStartedAt = Date.now();
    let result: PatrolTickResult | null = null;

    try {
      const referenceAt = this.now();
      const plans = this.patrolPlanService.listDuePlans(referenceAt, MAX_PLANS_PER_TICK);
      let errorCount = 0;

      for (const plan of plans) {
        try {
          const expiredRuns = this.patrolRunService.expireStaleRunningRuns(plan.projectId, {
            referenceAt,
            staleTimeoutMs: this.staleTimeoutMs,
            summary: "巡视执行超过调度容忍时长，系统已自动终止并标记失败"
          });

          if (expiredRuns.length > 0) {
            this.logger.error("[patrol-scheduler] stale runs reclaimed", {
              projectId: plan.projectId,
              runIds: expiredRuns.map((run) => run.id)
            });
          }

          if (this.patrolRunService.hasRunningRun(plan.projectId)) {
            continue;
          }

          const run = this.patrolRunService.startRun(plan.projectId, {
            planId: plan.id,
            triggeredBy: "scheduler",
            triggerRef: `patrol-scheduler:${referenceAt}`
          });
          await this.patrolExecutionService.executeQueuedRun(run.id);
          this.patrolPlanService.markPlanScheduled(plan.projectId, plan.id, referenceAt);
        } catch (error) {
          this.logger.error("[patrol-scheduler] tick plan failed", {
            planId: plan.id,
            projectId: plan.projectId,
            error: error instanceof Error ? error.message : String(error)
          });
          errorCount += 1;
        }
      }

      result = {
        referenceAt,
        taskCount: plans.length,
        idle: plans.length === 0,
        errorCount
      };
    } catch (error) {
      const referenceAt = this.now();
      this.logger.error("[patrol-scheduler] tick failed", {
        referenceAt,
        error: error instanceof Error ? error.message : String(error)
      });
      result = {
        referenceAt,
        taskCount: 0,
        idle: true,
        errorCount: 1
      };
    } finally {
      this.ticking = false;

      if (result) {
        this.idleStreak = result.idle ? this.idleStreak + 1 : 0;
        const nextDelayMs = resolveAdaptiveSchedulerDelayMs(
          this.intervalMs,
          this.maxIntervalMs,
          this.idleStreak
        );
        this.schedulerMetrics?.recordTick({
          schedulerName: "patrol",
          referenceAt: result.referenceAt,
          durationMs: Date.now() - tickStartedAt,
          taskCount: result.taskCount,
          idle: result.idle,
          errorCount: result.errorCount,
          nextDelayMs,
          idleStreak: this.idleStreak
        });

        if (shouldScheduleNext && this.started && !this.disposed && this.timer === null) {
          this.scheduleNext(nextDelayMs);
        }
      }
    }
  }
}

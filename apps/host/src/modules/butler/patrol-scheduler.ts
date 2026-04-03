import { nowIso } from "../../shared/utils/time.js";
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
  staleTimeoutMs?: number;
  logger?: PatrolSchedulerLogger;
  now?: () => string;
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
  private readonly staleTimeoutMs: number;
  private readonly logger: PatrolSchedulerLogger;
  private readonly now: () => string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly patrolPlanService: PatrolPlanService,
    private readonly patrolRunService: PatrolRunService,
    private readonly patrolExecutionService: PatrolExecutionService,
    options: PatrolSchedulerOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
    this.logger = options.logger ?? console;
    this.now = options.now ?? nowIso;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async dispose(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    while (this.ticking) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async runOnce(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }

    this.ticking = true;

    try {
      const referenceAt = this.now();
      const plans = this.patrolPlanService.listDuePlans(referenceAt, MAX_PLANS_PER_TICK);

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
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}

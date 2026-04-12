import { nowIso } from "../../shared/utils/time.js";
import type { ButlerFollowUpRunDueTasksResult } from "./butler-follow-up-service.js";
import {
  resolveAdaptiveSchedulerDelayMs,
  type SchedulerMetrics
} from "../tasks/scheduler-metrics.js";
import type { ButlerFollowUpService } from "./butler-follow-up-service.js";

const DEFAULT_INTERVAL_MS = 10_000;

interface ButlerFollowUpSchedulerLogger {
  error(message: string, detail?: unknown): void;
}

interface ButlerFollowUpSchedulerOptions {
  intervalMs?: number;
  maxIntervalMs?: number;
  now?: () => string;
  logger?: ButlerFollowUpSchedulerLogger;
  schedulerMetrics?: SchedulerMetrics;
}

export class ButlerFollowUpScheduler {
  private readonly intervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly now: () => string;
  private readonly logger: ButlerFollowUpSchedulerLogger;
  private readonly schedulerMetrics: SchedulerMetrics | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private started = false;
  private disposed = false;
  private idleStreak = 0;

  constructor(
    private readonly butlerFollowUpService: Pick<ButlerFollowUpService, "runDueTasks">,
    options: ButlerFollowUpSchedulerOptions = {}
  ) {
    this.intervalMs = Math.max(5_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.maxIntervalMs = Math.max(this.intervalMs, options.maxIntervalMs ?? this.intervalMs * 8);
    this.now = options.now ?? nowIso;
    this.logger = options.logger ?? console;
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
    const referenceAt = this.now();
    let result: ButlerFollowUpRunDueTasksResult | null = null;
    let errorCount = 0;

    try {
      result = await this.butlerFollowUpService.runDueTasks(referenceAt);
    } catch (error) {
      errorCount = 1;
      this.logger.error("[butler-follow-up-scheduler] tick failed", {
        error: error instanceof Error ? error.message : String(error),
        referenceAt
      });
    } finally {
      this.ticking = false;

      const idle = result?.idle ?? true;
      const taskCount = result?.dueTaskCount ?? 0;
      this.idleStreak = idle ? this.idleStreak + 1 : 0;
      const nextDelayMs = resolveAdaptiveSchedulerDelayMs(
        this.intervalMs,
        this.maxIntervalMs,
        this.idleStreak
      );
      this.schedulerMetrics?.recordTick({
        schedulerName: "butler_follow_up",
        referenceAt,
        durationMs: Date.now() - tickStartedAt,
        taskCount,
        idle,
        errorCount,
        nextDelayMs,
        idleStreak: this.idleStreak
      });

      if (shouldScheduleNext && this.started && !this.disposed && this.timer === null) {
        this.scheduleNext(nextDelayMs);
      }
    }
  }
}

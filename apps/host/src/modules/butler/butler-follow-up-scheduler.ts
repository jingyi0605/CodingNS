import { nowIso } from "../../shared/utils/time.js";
import type { ButlerFollowUpService } from "./butler-follow-up-service.js";

const DEFAULT_INTERVAL_MS = 10_000;

interface ButlerFollowUpSchedulerLogger {
  error(message: string, detail?: unknown): void;
}

interface ButlerFollowUpSchedulerOptions {
  intervalMs?: number;
  now?: () => string;
  logger?: ButlerFollowUpSchedulerLogger;
}

export class ButlerFollowUpScheduler {
  private readonly intervalMs: number;
  private readonly now: () => string;
  private readonly logger: ButlerFollowUpSchedulerLogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly butlerFollowUpService: Pick<ButlerFollowUpService, "runDueTasks">,
    options: ButlerFollowUpSchedulerOptions = {}
  ) {
    this.intervalMs = Math.max(5_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.now = options.now ?? nowIso;
    this.logger = options.logger ?? console;
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
      await this.butlerFollowUpService.runDueTasks(this.now());
    } catch (error) {
      this.logger.error("[butler-follow-up-scheduler] tick failed", {
        error: error instanceof Error ? error.message : String(error),
        referenceAt: this.now()
      });
    } finally {
      this.ticking = false;
    }
  }
}

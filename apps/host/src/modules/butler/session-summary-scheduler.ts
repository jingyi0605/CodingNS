import { nowIso } from "../../shared/utils/time.js";
import type { ButlerSessionSummaryService } from "./butler-session-summary-service.js";

const DEFAULT_INTERVAL_MS = 15_000;

interface SessionSummarySchedulerLogger {
  error(message: string, detail?: unknown): void;
}

interface SessionSummarySchedulerOptions {
  intervalMs?: number;
  now?: () => string;
  logger?: SessionSummarySchedulerLogger;
}

export class SessionSummaryScheduler {
  private readonly intervalMs: number;
  private readonly now: () => string;
  private readonly logger: SessionSummarySchedulerLogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly butlerSessionSummaryService: Pick<ButlerSessionSummaryService, "runOnce">,
    options: SessionSummarySchedulerOptions = {}
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
      await this.butlerSessionSummaryService.runOnce();
    } catch (error) {
      this.logger.error("[butler-session-summary-scheduler] tick failed", {
        error: error instanceof Error ? error.message : String(error),
        referenceAt: this.now()
      });
    } finally {
      this.ticking = false;
    }
  }
}

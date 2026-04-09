import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerFollowUpService } from "../../src/modules/butler/butler-follow-up-service.js";
import { ButlerFollowUpScheduler } from "../../src/modules/butler/butler-follow-up-scheduler.js";

describe("ButlerFollowUpScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("默认每 10 秒触发一次跟进扫描", async () => {
    vi.useFakeTimers();

    const followUpService = {
      runDueTasks: vi.fn(async () => {})
    } satisfies Pick<ButlerFollowUpService, "runDueTasks">;
    const scheduler = new ButlerFollowUpScheduler(followUpService, {
      now: () => "2026-04-07T10:00:00.000Z"
    });

    scheduler.start();
    await Promise.resolve();

    expect(followUpService.runDueTasks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(followUpService.runDueTasks).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(followUpService.runDueTasks).toHaveBeenCalledTimes(3);

    await scheduler.dispose();
  });
});

import { describe, expect, it, vi } from "vitest";

import { SessionSummaryScheduler } from "../../src/modules/butler/session-summary-scheduler.js";
import type { ButlerSessionSummaryService } from "../../src/modules/butler/butler-session-summary-service.js";

describe("SessionSummaryScheduler", () => {
  it("会定时触发代码助手会话摘要扫描", async () => {
    const summaryService = {
      runOnce: vi.fn(async () => {})
    } satisfies Pick<ButlerSessionSummaryService, "runOnce">;
    const scheduler = new SessionSummaryScheduler(summaryService, {
      intervalMs: 15_000,
      now: () => "2026-04-06T10:00:00.000Z"
    });

    await scheduler.runOnce();

    expect(summaryService.runOnce).toHaveBeenCalledTimes(1);

    await scheduler.dispose();
  });
});

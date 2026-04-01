import { describe, expect, it } from "vitest";

import { resolveSessionIndicatorClassName } from "./session-activity-display";

describe("resolveSessionIndicatorClassName", () => {
  it("多 agent 会话在运行中时仍然使用统一的旋转指示器", () => {
    expect(
      resolveSessionIndicatorClassName(
        "session-state-indicator",
        {
          activityState: "running",
          activitySource: "runtime",
          runningState: "running"
        },
        {
          hasSubagents: true
        }
      )
    ).toBe("session-state-indicator is-running");
  });

  it("多 agent 会话完成未读时显示实心点", () => {
    expect(
      resolveSessionIndicatorClassName(
        "session-state-indicator",
        {
          activityState: "completed_unread",
          runningState: "completed"
        },
        {
          hasSubagents: true
        }
      )
    ).toBe("session-state-indicator is-unread");
  });

  it("多 agent 会话完成已读时显示空心点，即使当前处于激活态", () => {
    expect(
      resolveSessionIndicatorClassName(
        "session-state-indicator",
        {
          activityState: "idle",
          runningState: "completed"
        },
        {
          hasSubagents: true,
          isActive: true
        }
      )
    ).toBe("session-state-indicator is-idle");
  });

  it("多 agent 会话的推断运行态继续显示黄色旋转指示器", () => {
    expect(
      resolveSessionIndicatorClassName(
        "session-state-indicator",
        {
          activityState: "running",
          activitySource: "inferred",
          runningState: "running"
        },
        {
          hasSubagents: true
        }
      )
    ).toBe("session-state-indicator is-running-inferred");
  });
});

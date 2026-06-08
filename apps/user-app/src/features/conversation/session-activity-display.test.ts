import { describe, expect, it } from "vitest";

import {
  resolveSessionActivityBadgeClassName,
  resolveSessionActivityBadgeLabel,
  resolveSessionIndicatorClassName
} from "./session-activity-display";
import { t } from "../../shared/i18n";

describe("resolveSessionIndicatorClassName", () => {
  it("多 agent 会话在运行中时显示子 Agent 旋转指示器", () => {
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
    ).toBe("session-state-indicator is-subagent-running");
  });

  it("多 agent 会话完成未读时显示子 Agent 未读点", () => {
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
    ).toBe("session-state-indicator is-subagent-unread");
  });

  it("多 agent 会话完成已读时显示子 Agent 点，即使当前处于激活态", () => {
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
    ).toBe("session-state-indicator is-subagent");
  });

  it("多 agent 会话的推断运行态显示子 Agent 旋转指示器", () => {
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
    ).toBe("session-state-indicator is-subagent-running");
  });
});

describe("resolveSessionActivityBadgeLabel", () => {
  it("子 Agent 显示运行中的生命周期文案", () => {
    expect(
      resolveSessionActivityBadgeLabel({
        activityState: "running",
        activitySource: "runtime",
        isSubagent: true,
        runningState: "running"
      })
    ).toBe(t("conversation.runtimeRunning"));
  });

  it("子 Agent 显示已完成的生命周期文案", () => {
    expect(
      resolveSessionActivityBadgeLabel({
        activityState: "completed_unread",
        isSubagent: true,
        runningState: "completed"
      })
    ).toBe(t("conversation.runtimeCompleted"));
  });

  it("普通会话完成时不显示生命周期文案", () => {
    expect(
      resolveSessionActivityBadgeLabel({
        activityState: "completed_unread",
        runningState: "completed"
      })
    ).toBeNull();
  });

  it("子 Agent 显示已中断的生命周期文案", () => {
    expect(
      resolveSessionActivityBadgeLabel({
        activityState: "idle",
        isSubagent: true,
        runningState: "interrupted"
      })
    ).toBe(t("conversation.runtimeInterrupted"));
  });

  it("子 Agent 显示失败的生命周期文案", () => {
    expect(
      resolveSessionActivityBadgeLabel({
        activityState: "idle",
        isSubagent: true,
        lastErrorCode: "RUNTIME_EXITED",
        runningState: "idle"
      })
    ).toBe(t("conversation.runtimeFailed"));
  });

  it("空闲且无异常时不显示生命周期文案", () => {
    expect(
      resolveSessionActivityBadgeLabel({
        activityState: "idle",
        runningState: "idle"
      })
    ).toBeNull();
  });

  it("普通会话运行中时不显示生命周期文案", () => {
    expect(
      resolveSessionActivityBadgeLabel({
        activityState: "running",
        runningState: "running"
      })
    ).toBeNull();
  });

  it("普通会话状态待确认时不显示生命周期文案", () => {
    expect(
      resolveSessionActivityBadgeLabel({
        activityState: "idle",
        runningState: "unknown"
      })
    ).toBeNull();
  });

  it("普通会话失败时不显示生命周期文案", () => {
    expect(
      resolveSessionActivityBadgeLabel({
        activityState: "idle",
        lastErrorCode: "RUNTIME_EXITED",
        runningState: "idle"
      })
    ).toBeNull();
  });
});

describe("resolveSessionActivityBadgeClassName", () => {
  it("为已完成状态返回可着色的 class", () => {
    expect(
      resolveSessionActivityBadgeClassName("session-activity-badge", {
        activityState: "completed_unread",
        isSubagent: true,
        runningState: "completed"
      })
    ).toBe("session-activity-badge is-completed");
  });

  it("普通会话完成时不返回 class", () => {
    expect(
      resolveSessionActivityBadgeClassName("session-activity-badge", {
        activityState: "completed_unread",
        runningState: "completed"
      })
    ).toBeNull();
  });

  it("普通会话运行中时不返回 class", () => {
    expect(
      resolveSessionActivityBadgeClassName("session-activity-badge", {
        activityState: "running",
        runningState: "running"
      })
    ).toBeNull();
  });

  it("空闲且无异常时不返回 class", () => {
    expect(
      resolveSessionActivityBadgeClassName("session-activity-badge", {
        activityState: "idle",
        runningState: "idle"
      })
    ).toBeNull();
  });
});

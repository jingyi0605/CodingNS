import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { SessionTaskProgressButton } from "./SessionTaskProgressButton";

describe("SessionTaskProgressButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("有任务记录时会显示按钮并打开悬浮进度", async () => {
    const user = userEvent.setup();

    render(
      <SessionTaskProgressButton
        provider="codex"
        variant="composer"
        messages={[
          createToolMessage({
            callId: "plan-1",
            name: "update_plan",
            input: JSON.stringify({
              explanation: "先做数据归一化，再补 UI。",
              plan: [
                { step: "做数据归一化", status: "completed" },
                { step: "补任务按钮", status: "in_progress" }
              ]
            })
          })
        ]}
      />
    );

    const button = screen.getByRole("button", {
      name: t("conversation.taskProgressButton", { count: 2 })
    });

    expect(button).toHaveClass("composer-task-progress-button");

    await user.click(button);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: t("conversation.taskProgressModalTitle") })
    ).toBeInTheDocument();
    expect(screen.getByText("做数据归一化")).toBeInTheDocument();
    expect(screen.getByText("补任务按钮")).toBeInTheDocument();
  });

  it("悬浮进度会以任务按钮为横向中心", async () => {
    const user = userEvent.setup();
    setViewportSize({ width: 1000, height: 700 });

    renderTaskButton();

    const button = screen.getByRole("button", {
      name: t("conversation.taskProgressButton", { count: 2 })
    });
    const entry = button.closest(".conversation-task-progress-entry");

    vi.spyOn(entry!, "getBoundingClientRect").mockReturnValue({
      left: 500,
      right: 532,
      top: 620,
      bottom: 652,
      width: 32,
      height: 32,
      x: 500,
      y: 620,
      toJSON: () => ({})
    });

    await user.click(button);

    const popover = screen.getByRole("region", {
      name: t("conversation.taskProgressModalTitle")
    });

    expect(popover).toHaveStyle({
      left: "196px",
      width: "640px"
    });
  });

  it("任务按钮靠近屏幕右侧时悬浮进度不会超出屏幕", async () => {
    const user = userEvent.setup();
    setViewportSize({ width: 1000, height: 700 });

    renderTaskButton();

    const button = screen.getByRole("button", {
      name: t("conversation.taskProgressButton", { count: 2 })
    });
    const entry = button.closest(".conversation-task-progress-entry");

    vi.spyOn(entry!, "getBoundingClientRect").mockReturnValue({
      left: 970,
      right: 998,
      top: 620,
      bottom: 648,
      width: 28,
      height: 28,
      x: 970,
      y: 620,
      toJSON: () => ({})
    });

    await user.click(button);

    const popover = screen.getByRole("region", {
      name: t("conversation.taskProgressModalTitle")
    });

    expect(popover).toHaveStyle({
      left: "344px",
      width: "640px"
    });
  });
});

function renderTaskButton() {
  render(
    <SessionTaskProgressButton
      provider="codex"
      variant="composer"
      messages={[
        createToolMessage({
          callId: "plan-1",
          name: "update_plan",
          input: JSON.stringify({
            plan: [
              { step: "做数据归一化", status: "completed" },
              { step: "补任务按钮", status: "in_progress" }
            ]
          })
        })
      ]}
    />
  );
}

function setViewportSize(size: { width: number; height: number }) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: size.width
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: size.height
  });
}

function createToolMessage(input: {
  callId: string;
  name: string;
  input: string;
}) {
  return {
    id: input.callId,
    sessionId: "session-1",
    role: "tool" as const,
    kind: "tool_call" as const,
    content: input.input,
    toolCall: {
      callId: input.callId,
      name: input.name,
      input: input.input,
      output: null,
      error: null,
      status: "completed" as const
    },
    attachments: [],
    attachmentPayloads: null,
    origin: null,
    originRef: null,
    timestamp: "2026-04-13T10:00:00.000Z",
    sequence: 1,
    rawRef: `raw://${input.callId}`,
    deliveryState: "sent" as const,
    clientRequestId: null
  };
}

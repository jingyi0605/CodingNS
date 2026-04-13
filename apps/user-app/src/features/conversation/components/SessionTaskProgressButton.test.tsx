import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { t } from "../../../shared/i18n";
import { SessionTaskProgressButton } from "./SessionTaskProgressButton";

describe("SessionTaskProgressButton", () => {
  it("有任务记录时会显示按钮并打开进度模态框", async () => {
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

    expect(
      screen.getByRole("dialog", { name: t("conversation.taskProgressModalTitle") })
    ).toBeInTheDocument();
    expect(screen.getByText("做数据归一化")).toBeInTheDocument();
    expect(screen.getByText("补任务按钮")).toBeInTheDocument();
    expect(screen.getByText("先做数据归一化，再补 UI。")).toBeInTheDocument();
  });
});

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

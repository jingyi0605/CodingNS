import { describe, expect, it } from "vitest";

import { decideCapability } from "./capability-gate";

describe("capability gate", () => {
  it("统一收口发送能力限制", () => {
    const denied = decideCapability(
      {
        provider: "codex",
        canStartSession: true,
        canResumeSession: true,
        canSendMessage: false,
        inRunInputMode: "none",
        supportsSubagents: false,
        supportsInterrupt: true,
        supportsStructuredToolCalls: true,
        supportsTokenUsage: false,
        supportsAttachments: false,
        supportsPermissionPrompt: true,
        supportsCheckpoint: false,
        limitations: ["发送能力关闭"]
      },
      "send_message"
    );

    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain("发送");
  });

  it("不靠 provider 名字猜测中断能力", () => {
    const decision = decideCapability(
      {
        provider: "claude-code",
        canStartSession: true,
        canResumeSession: true,
        canSendMessage: true,
        inRunInputMode: "streaming_guidance",
        supportsSubagents: true,
        supportsInterrupt: false,
        supportsStructuredToolCalls: true,
        supportsTokenUsage: true,
        supportsAttachments: false,
        supportsPermissionPrompt: true,
        supportsCheckpoint: false,
        limitations: []
      },
      "interrupt"
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("中断");
  });
});

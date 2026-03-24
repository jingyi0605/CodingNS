import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ComposerPanel } from "./ComposerPanel";

function createDeferred() {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return {
    promise,
    resolve: resolve!
  };
}

describe("ComposerPanel", () => {
  it("不再渲染 Host 同步提示文案", () => {
    render(
      <ComposerPanel
        capabilities={{
          provider: "codex",
          canStartSession: true,
          canResumeSession: true,
          canSendMessage: true,
          supportsSubagents: false,
          supportsInterrupt: true,
          supportsStructuredToolCalls: true,
          supportsTokenUsage: false,
          supportsAttachments: false,
          supportsPermissionPrompt: true,
          supportsCheckpoint: false,
          limitations: []
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByText("消息真相来自 Host，同步成功后会自动并入正式消息流。")).not.toBeInTheDocument();
    expect(screen.queryByText("正在把消息交给 Host。")).not.toBeInTheDocument();
  });

  it("连续触发两次提交时只发送一次消息", async () => {
    const deferred = createDeferred();
    const onSend = vi.fn(() => deferred.promise);

    render(
      <ComposerPanel
        capabilities={{
          provider: "codex",
          canStartSession: true,
          canResumeSession: true,
          canSendMessage: true,
          supportsSubagents: false,
          supportsInterrupt: true,
          supportsStructuredToolCalls: true,
          supportsTokenUsage: false,
          supportsAttachments: false,
          supportsPermissionPrompt: true,
          supportsCheckpoint: false,
          limitations: []
        }}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "请将本次会话变更的代码提交到git暂存区，然后总结一条中文的提交信息"
      }
    });

    const form = document.querySelector(".composer-form");

    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(onSend).toHaveBeenCalledTimes(1);

    deferred.resolve();
    await deferred.promise;
  });
});

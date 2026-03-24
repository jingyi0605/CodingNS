import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
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

function createCapabilities() {
  return {
    provider: "codex" as const,
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
  };
}

describe("ComposerPanel", () => {
  it("不再展示旧的 Host 同步提示文案", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(
      screen.queryByText("消息真相来自 Host，同步成功后会自动并入正式消息流。")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("正在把消息交给 Host。")).not.toBeInTheDocument();
  });

  it("连续触发两次提交时只发送一条消息", async () => {
    const deferred = createDeferred();
    const onSend = vi.fn(() => deferred.promise);

    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "请将本次会话变更的代码提交到 git 暂存区，然后总结一条中文的提交信息"
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

  it("提交后会立即清空输入框，并切到发送中按钮", () => {
    const deferred = createDeferred();

    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={vi.fn(() => deferred.promise)}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: "继续整理这条会话的下一步"
      }
    });

    fireEvent.submit(document.querySelector(".composer-form")!);

    expect(textarea.value).toBe("");
    expect(screen.queryByLabelText(t("conversation.sendButton"))).not.toBeInTheDocument();
    expect(screen.getByLabelText(t("conversation.sendingState"))).toBeInTheDocument();
    expect(screen.queryByText(t("conversation.sendingState"))).not.toBeInTheDocument();

    deferred.resolve();
  });

  it("运行中时只显示中断按钮，不再显示状态标签文字", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        isRunning
        onInterrupt={vi.fn()}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByLabelText(t("conversation.sendButton"))).not.toBeInTheDocument();
    expect(screen.getByLabelText(t("conversation.capabilityInterrupt"))).toBeInTheDocument();
    expect(screen.queryByText(t("conversation.runtimeRunning"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("conversation.capabilityInterrupt"))).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import type { ProviderCapabilitiesDto } from "../api/conversation-api";
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

function createCapabilities(options?: {
  supportsAttachments?: boolean;
  supportsInterrupt?: boolean;
  provider?: "codex" | "claude-code";
  modelOptions?: Array<{
    id: string;
    name: string;
    usesProviderDefault?: boolean;
    supportedReasoningEfforts?: string[];
  }>;
  defaultReasoningLevel?: string | null;
}): ProviderCapabilitiesDto {
  const provider = options?.provider ?? ("codex" as const);

  return {
    provider,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode:
      provider === "claude-code" ? "streaming_guidance" : "none",
    supportsSubagents: false,
    supportsInterrupt: options?.supportsInterrupt ?? true,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: false,
    supportsAttachments: options?.supportsAttachments ?? false,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    modelOptions:
      options?.modelOptions ??
      (provider === "codex"
        ? [
            {
              id: "provider-default",
              name: "跟随当前 Codex 配置（当前：gpt-5.4）",
              usesProviderDefault: true,
              supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
            },
            {
              id: "gpt-5.4",
              name: "gpt-5.4",
              supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
            },
            {
              id: "gpt-5.1-codex-mini",
              name: "gpt-5.1-codex-mini",
              supportedReasoningEfforts: ["medium", "high"]
            }
          ]
        : undefined),
    defaultReasoningLevel: options?.defaultReasoningLevel ?? (provider === "codex" ? "high" : undefined),
    limitations: []
  };
}

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  readAsDataURL() {
    this.result = "data:image/png;base64,ZmFrZQ==";
    this.onload?.();
  }
}

describe("ComposerPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: vi.fn(() => "blob:preview")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: vi.fn(() => {})
    });
    vi.stubGlobal("FileReader", MockFileReader);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("连续提交两次时只会发送一次", async () => {
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
        value: "请整理这次修改，并输出一条中文提交信息"
      }
    });

    const form = document.querySelector(".composer-form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    deferred.resolve();
    await deferred.promise;
  });

  it("提交后会立刻清空输入框，并切换到发送中按钮", () => {
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
        value: "继续整理这一轮会话的下一步。"
      }
    });

    fireEvent.submit(document.querySelector(".composer-form")!);

    expect(textarea.value).toBe("");
    expect(screen.queryByLabelText(t("conversation.sendButton"))).not.toBeInTheDocument();
    expect(screen.getByLabelText(t("conversation.sendingState"))).toBeInTheDocument();

    deferred.resolve();
  });

  it("运行中时只显示中断按钮", () => {
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
  });

  it("运行时动态可中断时，点击停止会真正调用 onInterrupt", async () => {
    const onInterrupt = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "claude-code", supportsInterrupt: false })}
        hasActiveRun
        canInterrupt
        isSubmitting={false}
        isRunning
        onInterrupt={onInterrupt}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByLabelText(t("conversation.capabilityInterrupt")));

    await waitFor(() => {
      expect(onInterrupt).toHaveBeenCalledTimes(1);
    });
  });

  it("Codex 运行中且不支持直发时，Enter 会改走项目队列", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onQueueSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        isSubmitting={false}
        isRunning
        onInterrupt={vi.fn()}
        onQueueSend={onQueueSend}
        onSend={onSend}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "这条消息不该被送出去"
      }
    });

    expect(screen.getByLabelText(t("conversation.queueGuidanceButton"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.capabilityInterrupt"))).not.toBeInTheDocument();

    fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter"
    });

    expect(textarea).not.toHaveAttribute("readonly");
    expect(onSend).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onQueueSend).toHaveBeenCalledTimes(1);
    });
  });

  it("Claude 运行中且没有草稿时只显示中断按钮", () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onQueueSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "claude-code" })}
        isSubmitting={false}
        isRunning
        onInterrupt={vi.fn()}
        onQueueSend={onQueueSend}
        onSend={onSend}
      />
    );

    expect(screen.getByLabelText(t("conversation.capabilityInterrupt"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.queueGuidanceButton"))).not.toBeInTheDocument();
  });

  it("运行中但当前不可中断时显示运行中忙碌按钮，而不是空闲发送按钮", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "claude-code", supportsInterrupt: false })}
        hasActiveRun={false}
        canInterrupt={false}
        isSubmitting={false}
        isRunning
        onInterrupt={vi.fn()}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByLabelText(t("conversation.runtimeRunning"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.sendButton"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.queueGuidanceButton"))).not.toBeInTheDocument();
  });

  it("Claude 运行中输入草稿后会切到追加引导按钮", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onQueueSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "claude-code" })}
        isSubmitting={false}
        isRunning
        onInterrupt={vi.fn()}
        onQueueSend={onQueueSend}
        onSend={onSend}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "这条默认应该排队"
      }
    });

    expect(screen.getByLabelText(t("conversation.sendGuidanceButton"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.capabilityInterrupt"))).not.toBeInTheDocument();

    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onQueueSend).not.toHaveBeenCalled();
  });

  it("未托管的 Claude 运行中输入草稿后会退回加入队列", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onQueueSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "claude-code", supportsInterrupt: false })}
        hasActiveRun={false}
        canInterrupt={false}
        isSubmitting={false}
        isRunning
        onInterrupt={vi.fn()}
        onQueueSend={onQueueSend}
        onSend={onSend}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "这条应该先排队"
      }
    });

    expect(screen.getByLabelText(t("conversation.queueGuidanceButton"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.sendGuidanceButton"))).not.toBeInTheDocument();

    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onQueueSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("空闲但队列还有待发消息时，不显示未发送态按钮", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        hasPendingQueuedMessages
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByLabelText(t("conversation.sendingState"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.sendButton"))).not.toBeInTheDocument();
  });

  it("会在发送按钮旁显示当前上下文占用圆环", () => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        contextUsage={{
          provider: "codex",
          promptTokens: 64000,
          uncachedInputTokens: 40000,
          cachedInputTokens: 24000,
          contextWindow: 200000,
          usageRatio: 0.32,
          source: "provider-log",
          contextWindowSource: "provider-log",
          modelId: "gpt-5.3-codex",
          capturedAt: "2026-03-26T10:00:00.000Z",
          isEstimated: false
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const ring = container.querySelector(".composer-context-ring");
    const tooltip = container.querySelector(".composer-context-tooltip");

    expect(ring).not.toBeNull();
    expect(tooltip).not.toBeNull();
    expect(ring).toHaveAttribute("aria-label", `${t("conversation.contextUsageTitle")} 32%`);
    expect(tooltip?.textContent).toContain(t("conversation.contextUsageTitle"));
    expect(tooltip?.textContent).toContain("32%");
    expect(tooltip?.textContent).toContain("64,000 / 200,000 tokens");
  });

  it("粘贴图片后会显示预览卡片", async () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const textarea = screen.getByRole("textbox");
    const file = new File(["demo"], "demo.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file
          }
        ]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("demo.png")).toBeInTheDocument();
    });
    expect(screen.getByAltText(t("conversation.attachmentPreviewAlt"))).toBeInTheDocument();
  });

  it("Codex 默认会跟随当前配置发送，并把附件一起传出去", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["demo"], "demo.png", { type: "image/png" });

    fireEvent.change(input, {
      target: {
        files: [file]
      }
    });
    fireEvent.submit(container.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith("", {
      model: undefined,
      reasoningLevel: "high",
      attachments: [
        {
          fileName: "demo.png",
          mimeType: "image/png",
          fileSize: 4,
          contentBase64: "ZmFrZQ=="
        }
      ],
      attachmentMeta: [
        expect.objectContaining({
          kind: "image",
          fileName: "demo.png",
          mimeType: "image/png",
          fileSize: 4
        })
      ]
    });
  });

  it("Codex 显式切换模型后会透传实际 model", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    fireEvent.change(screen.getByLabelText(t("conversation.modelSelectorLabel")), {
      target: {
        value: "gpt-5.4"
      }
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "请输出当前模型"
      }
    });
    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith("请输出当前模型", {
      model: "gpt-5.4",
      reasoningLevel: "high",
      attachments: [],
      attachmentMeta: []
    });
  });

  it("Claude Code 选择 CLI 默认模型时不会强行覆盖 model", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({
          provider: "claude-code",
          modelOptions: [
            {
              id: "provider-default",
              name: "跟随 CLI 默认模型",
              usesProviderDefault: true
            },
            {
              id: "sonnet",
              name: "Sonnet"
            }
          ]
        })}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "请回复OK"
      }
    });
    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith("请回复OK", {
      model: undefined,
      reasoningLevel: undefined,
      attachments: [],
      attachmentMeta: []
    });
  });
});

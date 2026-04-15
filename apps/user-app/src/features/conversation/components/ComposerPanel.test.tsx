import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import type { ProviderCapabilitiesDto } from "../api/conversation-api";
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";
import { ComposerPanel } from "./ComposerPanel";

const platformMock = vi.hoisted(() => ({
  platform: "web",
  isDesktop: false,
  isWeb: true,
  isMobile: false,
  isNativeMobile: false,
  viewportClass: "expanded",
  ui: {
    osFamily: "unknown",
    windowControlsStyle: "none",
    prefersDesktopChrome: false,
    prefersOverlayTitlebar: false,
    prefersSystemFontStack: true
  },
  bridge: {
    supported: false,
    openExternal: vi.fn(),
    showNotification: vi.fn(),
    writeClipboardText: vi.fn(),
    setWindowState: vi.fn(),
    readDesktopConfig: vi.fn(),
    writeDesktopConfig: vi.fn(),
    getRuntimeInfo: vi.fn(),
    checkForUpdate: vi.fn(),
    installUpdate: vi.fn(),
    rollbackToPreviousVersion: vi.fn(),
    pickDirectory: vi.fn()
  },
  haptics: {
    supported: false,
    trigger: vi.fn()
  }
}));
const preferenceStoreMock = vi.hoisted(() => ({
  updatePreferences: vi.fn().mockResolvedValue(undefined),
  userPreferenceStore: {
    getState: vi.fn(() => ({
      profile: {
        language: "zh-CN",
        providers: {
          codex: {
            defaultModel: null,
            defaultReasoningLevel: null
          },
          "claude-code": {
            defaultModel: null,
            defaultReasoningLevel: null
          },
          opencode: {
            defaultModel: null,
            defaultReasoningLevel: null
          },
          gemini: {
            defaultModel: null,
            defaultReasoningLevel: null
          },
          kimi: {
            defaultModel: null,
            defaultReasoningLevel: null
          }
        }
      }
    })),
    resetToLocalFallback: vi.fn(),
    subscribe: vi.fn(() => () => undefined)
  },
  usePreferencesSelector: vi.fn((selector: (state: {
    profile: {
      providers: Record<string, {
        defaultModel: string | null;
        defaultReasoningLevel: "low" | "medium" | "high" | "xhigh" | null;
      }>;
    };
  }) => unknown) =>
    selector({
      profile: {
        providers: {
          codex: {
            defaultModel: null,
            defaultReasoningLevel: null
          },
          "claude-code": {
            defaultModel: null,
            defaultReasoningLevel: null
          },
          opencode: {
            defaultModel: null,
            defaultReasoningLevel: null
          },
          gemini: {
            defaultModel: null,
            defaultReasoningLevel: null
          },
          kimi: {
            defaultModel: null,
            defaultReasoningLevel: null
          }
        }
      }
    })
  ),
  isPreferenceProviderId: vi.fn((provider: string) =>
    provider === "codex"
    || provider === "claude-code"
    || provider === "opencode"
    || provider === "gemini"
    || provider === "kimi"
  )
}));
const mockListQuickPhrases = vi.fn();
const mockReplaceQuickPhrases = vi.fn();
const mockGetProviderCapabilities = vi.fn();

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args),
    listQuickPhrases: (...args: unknown[]) => mockListQuickPhrases(...args),
    replaceQuickPhrases: (...args: unknown[]) => mockReplaceQuickPhrases(...args)
  };
});

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => platformMock
}));

vi.mock("../../../preferences/preferences-store", () => ({
  updatePreferences: preferenceStoreMock.updatePreferences,
  usePreferencesSelector: preferenceStoreMock.usePreferencesSelector
}));

vi.mock("../../../preferences/user-preference-store", () => ({
  isPreferenceProviderId: (provider: string) => preferenceStoreMock.isPreferenceProviderId(provider),
  userPreferenceStore: preferenceStoreMock.userPreferenceStore
}));

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
  provider?: "codex" | "claude-code" | "opencode";
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
              name: "跟随 CLI 默认模型",
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
        : provider === "opencode"
          ? [
              {
                id: "provider-default",
                name: "跟随 OpenCode 默认模型",
                usesProviderDefault: true
              },
              {
                id: "opencode/gpt-5-nano",
                name: "opencode/gpt-5-nano"
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

function chooseOption(triggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByLabelText(triggerLabel));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

function createForkDraft(options?: {
  sourceProvider?: "codex" | "claude-code" | "opencode";
  targetProvider?: "codex" | "claude-code" | "opencode";
  targetModel?: string | null;
}) {
  return {
    sourceMessageId: "assistant-message-1",
    sourceMessageSnapshot: {
      role: "assistant" as const,
      kind: "text" as const,
      content: "从这个历史点继续分叉"
    },
    content: "从这个历史点继续分叉",
    sourceProvider: options?.sourceProvider ?? ("codex" as const),
    workspaceId: "workspace-1",
    targetProvider: options?.targetProvider ?? (options?.sourceProvider ?? ("codex" as const)),
    targetModel: options?.targetModel ?? null
  };
}

describe("ComposerPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    platformMock.platform = "web";
    platformMock.isDesktop = false;
    platformMock.isWeb = true;
    platformMock.isMobile = false;
    platformMock.isNativeMobile = false;
    platformMock.viewportClass = "expanded";
    platformMock.ui.osFamily = "unknown";
    platformMock.haptics.trigger.mockReset();
    preferenceStoreMock.userPreferenceStore.getState.mockClear();
    preferenceStoreMock.userPreferenceStore.resetToLocalFallback.mockClear();
    preferenceStoreMock.updatePreferences.mockReset();
    preferenceStoreMock.updatePreferences.mockResolvedValue(undefined);
    preferenceStoreMock.usePreferencesSelector.mockClear();
    preferenceStoreMock.isPreferenceProviderId.mockClear();
    mockListQuickPhrases.mockReset();
    mockReplaceQuickPhrases.mockReset();
    mockGetProviderCapabilities.mockReset();
    mockListQuickPhrases.mockResolvedValue({
      items: [
        {
          id: "builtin-stage-and-summarize",
          text: "请将本次会话变更的所有代码提交到git暂存区，然后总结一条中文的提交信息"
        },
        {
          id: "builtin-review-module",
          text: "分析本项目  模块的代码实现，并分析存在的问题"
        },
        {
          id: "builtin-group-commits",
          text: "分析当前项目中的未提交文件，按照功能模块进行分类提交，提交信息格式请参考我最近的提交记录"
        }
      ]
    });
    mockReplaceQuickPhrases.mockImplementation(async (items: Array<{ id?: string; text: string }>) => ({
      items: items.map((item, index) => ({
        id: item.id ?? `generated-${index}`,
        text: item.text
      }))
    }));
    mockGetProviderCapabilities.mockResolvedValue(createCapabilities());
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

    expect(ring).not.toBeNull();
    expect(ring).toHaveAttribute("aria-label", `${t("conversation.contextUsageTitle")} 32%`);
    fireEvent.click(ring!);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip?.textContent).toContain(t("conversation.contextUsageTitle"));
    expect(tooltip?.textContent).toContain("32%");
    expect(tooltip?.textContent).toContain("64,000 / 200,000 tokens");
  });

  it("有任务记录时会在上下文占用按钮右侧显示任务按钮", () => {
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
        taskProvider="codex"
        taskMessages={[
          createToolMessage({
            callId: "plan-1",
            name: "update_plan",
            input: JSON.stringify({
              plan: [
                { step: "收口任务入口", status: "completed" },
                { step: "压缩时间线卡片", status: "in_progress" }
              ]
            })
          })
        ]}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const leftControls = container.querySelector(".composer-controls-left");
    const ring = container.querySelector(".composer-context-ring");
    const taskButton = screen.getByRole("button", {
      name: t("conversation.taskProgressButton", { count: 2 })
    });

    expect(taskButton).toHaveClass("composer-task-progress-button");
    expect(leftControls?.lastElementChild).toBe(taskButton);
    expect(ring?.nextElementSibling).toBe(taskButton);
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

  it("支持附件时会显示附件按钮，并能通过按钮选图后显示预览", async () => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const file = new File(["demo"], "demo.png", { type: "image/png" });
    const attachButton = screen.getByLabelText(t("conversation.attachFiles"));
    const libraryInput = container.querySelector('input[type="file"]:not([capture])');

    expect(attachButton).toBeInTheDocument();
    expect(libraryInput).not.toBeNull();

    fireEvent.click(attachButton);
    fireEvent.change(libraryInput!, {
      target: {
        files: [file]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("demo.png")).toBeInTheDocument();
    });
  });

  it("桌面端拖拽任意文件后会加入附件列表", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    const dropTarget = container.querySelector(".composer-input-container") as HTMLDivElement;
    const file = new File(["demo"], "notes.md", { type: "text/markdown" });

    fireEvent.dragOver(dropTarget, {
      dataTransfer: {
        files: [file],
        items: [
          {
            kind: "file",
            type: "text/markdown",
            getAsFile: () => file
          }
        ]
      }
    });

    expect(dropTarget).toHaveAttribute("data-drag-active", "true");

    fireEvent.drop(dropTarget, {
      dataTransfer: {
        files: [file],
        items: [
          {
            kind: "file",
            type: "text/markdown",
            getAsFile: () => file
          }
        ]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeInTheDocument();
    });

    fireEvent.submit(container.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("", {
        model: undefined,
        reasoningLevel: "high",
        attachments: [
          {
            kind: "file",
            fileName: "notes.md",
            mimeType: "text/markdown",
            fileSize: 4,
            contentBase64: "ZmFrZQ=="
          }
        ],
        attachmentMeta: [
          expect.objectContaining({
            kind: "file",
            fileName: "notes.md",
            mimeType: "text/markdown",
            fileSize: 4
          })
        ]
      });
    });
  });

  it("移动端点击附件按钮会弹出拍照面板，并触发相机输入", async () => {
    platformMock.platform = "ios";
    platformMock.isWeb = false;
    platformMock.isMobile = true;
    platformMock.isNativeMobile = true;
    platformMock.viewportClass = "compact";
    platformMock.ui.osFamily = "ios";

    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const cameraInput = container.querySelector('input[type="file"][capture="environment"]') as HTMLInputElement;
    const cameraClickSpy = vi.fn();
    cameraInput.addEventListener("click", cameraClickSpy);

    fireEvent.click(screen.getByLabelText(t("conversation.attachFiles")));

    expect(
      screen.getByRole("dialog", { name: t("conversation.attachmentSourceSheetTitle") })
    ).toBeInTheDocument();

    const takePhotoOption = screen.getByRole("button", {
      name: t("conversation.attachmentTakePhoto")
    });
    fireEvent.click(takePhotoOption);

    await waitFor(() => {
      expect(cameraClickSpy).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByRole("dialog", { name: t("conversation.attachmentSourceSheetTitle") })
    ).not.toBeInTheDocument();
  });

  it("H5 移动端附件按钮会直接关联到相册输入，而不是弹原生来源面板", () => {
    platformMock.platform = "web";
    platformMock.isWeb = true;
    platformMock.isMobile = true;
    platformMock.isNativeMobile = false;
    platformMock.viewportClass = "compact";

    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const attachTrigger = screen.getByLabelText(t("conversation.attachFiles"));
    const libraryInput = container.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    const libraryClickSpy = vi.fn();
    libraryInput.addEventListener("click", libraryClickSpy);

    expect(attachTrigger.tagName).toBe("LABEL");
    expect(attachTrigger).toHaveAttribute("for", libraryInput.id);

    fireEvent.click(attachTrigger);

    expect(libraryClickSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", { name: t("conversation.attachmentSourceSheetTitle") })
    ).not.toBeInTheDocument();
  });

  it("原生移动端点击从相册选择会直接触发相册输入", async () => {
    platformMock.platform = "android";
    platformMock.isWeb = false;
    platformMock.isMobile = true;
    platformMock.isNativeMobile = true;
    platformMock.viewportClass = "compact";
    platformMock.ui.osFamily = "android";

    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const libraryInput = container.querySelector(
      'input[type="file"]:not([capture])'
    ) as HTMLInputElement;
    const libraryClickSpy = vi.fn();
    libraryInput.addEventListener("click", libraryClickSpy);

    fireEvent.click(screen.getByLabelText(t("conversation.attachFiles")));

    expect(
      screen.getByRole("dialog", { name: t("conversation.attachmentSourceSheetTitle") })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: t("conversation.attachmentChooseFromLibrary")
      })
    );

    await waitFor(() => {
      expect(libraryClickSpy).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByRole("dialog", { name: t("conversation.attachmentSourceSheetTitle") })
    ).not.toBeInTheDocument();
  });

  it("移动端文件选择支持一次添加多个文件", async () => {
    platformMock.platform = "android";
    platformMock.isWeb = false;
    platformMock.isMobile = true;
    platformMock.isNativeMobile = true;
    platformMock.viewportClass = "compact";
    platformMock.ui.osFamily = "android";

    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const libraryInput = container.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;

    fireEvent.click(screen.getByLabelText(t("conversation.attachFiles")));
    fireEvent.click(
      screen.getByRole("button", {
        name: t("conversation.attachmentChooseFromLibrary")
      })
    );

    fireEvent.change(libraryInput, {
      target: {
        files: [
          new File(["one"], "first.txt", { type: "text/plain" }),
          new File(["two"], "second.json", { type: "application/json" })
        ]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("first.txt")).toBeInTheDocument();
      expect(screen.getByText("second.json")).toBeInTheDocument();
    });
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

    const file = new File(["demo"], "demo.png", { type: "image/png" });
    const libraryInput = container.querySelector('input[type="file"]:not([capture])');

    expect(container.querySelector(".composer-attach-btn")).not.toBeNull();

    fireEvent.click(screen.getByLabelText(t("conversation.attachFiles")));
    fireEvent.change(libraryInput!, {
      target: {
        files: [file]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("demo.png")).toBeInTheDocument();
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
          kind: "image",
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

    chooseOption(t("conversation.modelSelectorLabel"), "gpt-5.4");
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

  it("provider-default 在工具栏和下拉里都显示为默认短标签", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities({
          provider: "claude-code",
          modelOptions: [
            {
              id: "provider-default",
              name: "跟随 CLI 默认模型（当前：kimi-k2.5）",
              usesProviderDefault: true
            },
            {
              id: "sonnet",
              name: "Sonnet"
            }
          ]
        })}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByRole("button", { name: t("conversation.modelSelectorLabel") })).toHaveTextContent("默认");
    expect(screen.queryByText("跟随 CLI 默认模型（当前：kimi-k2.5）")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("conversation.modelSelectorLabel") }));

    expect(screen.getByRole("option", { name: "默认" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "跟随 CLI 默认模型（当前：kimi-k2.5）" })).not.toBeInTheDocument();
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

  it("OpenCode 显式切换模型后会透传 provider/model", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({
          provider: "opencode"
        })}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    chooseOption(t("conversation.modelSelectorLabel"), "opencode/gpt-5-nano");
    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "请返回当前模型标识"
      }
    });
    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith("请返回当前模型标识", {
      model: "opencode/gpt-5-nano",
      reasoningLevel: undefined,
      attachments: [],
      attachmentMeta: []
    });
  });

  it("fork 引用态默认显示源 CLI 和默认模型，发送时不额外透传工具栏模型与推理等级", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        forkDraft={createForkDraft()}
        onForkDraftChange={vi.fn()}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    expect(screen.getByRole("button", { name: t("conversation.forkTargetProviderLabel") })).toHaveTextContent("Codex");
    expect(screen.getByRole("button", { name: t("conversation.forkTargetModelLabel") })).toHaveTextContent("默认");

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "继续这一条分支"
      }
    });
    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith("继续这一条分支", {
      model: undefined,
      reasoningLevel: undefined,
      attachments: [],
      attachmentMeta: []
    });
  });

  it("fork 引用态只显示当前支持的目标 CLI，不展示不可用 provider", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        forkDraft={createForkDraft()}
        onForkDraftChange={vi.fn()}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: t("conversation.forkTargetProviderLabel") }));

    expect(screen.getByRole("option", { name: /Codex/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Claude Code/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /OpenCode/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Gemini/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Kimi/i })).not.toBeInTheDocument();
  });

  it("切换到其他 CLI 时会先弹确认框，选择保持原生不会改动当前 fork 配置", async () => {
    function Wrapper() {
      const [forkDraft, setForkDraft] = useState(createForkDraft());

      return (
        <div>
          <div data-testid="fork-target-provider">{forkDraft.targetProvider}</div>
          <ComposerPanel
            capabilities={createCapabilities()}
            forkDraft={forkDraft}
            onForkDraftChange={(nextDraft) => {
              if (nextDraft) {
                setForkDraft(nextDraft as ReturnType<typeof createForkDraft>);
              }
            }}
            isSubmitting={false}
            onSend={vi.fn().mockResolvedValue(undefined)}
          />
        </div>
      );
    }

    render(<Wrapper />);

    chooseOption(t("conversation.forkTargetProviderLabel"), "OpenCode");

    expect(screen.getByRole("dialog", { name: t("conversation.forkSwitchConfirmTitle") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("conversation.forkSwitchKeepNative") }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("conversation.forkSwitchConfirmTitle") })).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("fork-target-provider")).toHaveTextContent("codex");
  });

  it("确认切换其他 CLI 后会应用目标 provider，并切换到对应模型列表", async () => {
    mockGetProviderCapabilities.mockResolvedValue(
      createCapabilities({
        provider: "opencode",
        modelOptions: [
          {
            id: "provider-default",
            name: "跟随 OpenCode 默认模型",
            usesProviderDefault: true
          },
          {
            id: "opencode/gpt-5-nano",
            name: "opencode/gpt-5-nano"
          }
        ]
      })
    );

    function Wrapper() {
      const [forkDraft, setForkDraft] = useState(createForkDraft());

      return (
        <div>
          <div data-testid="fork-target-provider">{forkDraft.targetProvider}</div>
          <div data-testid="fork-target-model">{forkDraft.targetModel ?? ""}</div>
          <ComposerPanel
            capabilities={createCapabilities()}
            forkDraft={forkDraft}
            onForkDraftChange={(nextDraft) => {
              if (nextDraft) {
                setForkDraft(nextDraft as ReturnType<typeof createForkDraft>);
              }
            }}
            isSubmitting={false}
            onSend={vi.fn().mockResolvedValue(undefined)}
          />
        </div>
      );
    }

    render(<Wrapper />);

    chooseOption(t("conversation.forkTargetProviderLabel"), "OpenCode");
    fireEvent.click(screen.getByRole("button", { name: t("conversation.forkSwitchConfirmAction") }));

    await waitFor(() => {
      expect(screen.getByTestId("fork-target-provider")).toHaveTextContent("opencode");
    });
    expect(screen.getByTestId("fork-target-model")).toHaveTextContent("");
    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith("opencode", "workspace-1");
    });

    fireEvent.click(screen.getByRole("button", { name: t("conversation.forkTargetModelLabel") }));

    expect(screen.getByRole("option", { name: "默认" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "opencode/gpt-5-nano" })).toBeInTheDocument();
  });

  it("没有输入时显示快捷短语按钮，选择短语后会直接填充输入框", async () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByLabelText(t("conversation.quickPhraseTrigger"))).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(t("conversation.quickPhraseTrigger")));
    fireEvent.click(
      screen.getByRole("button", {
        name: /请将本次会话变更的所有代码提交到git暂存区/
      })
    );

    expect(screen.getByRole("textbox")).toHaveValue(
      "请将本次会话变更的所有代码提交到git暂存区，然后总结一条中文的提交信息"
    );
    expect(screen.queryByLabelText(t("conversation.quickPhraseTrigger"))).not.toBeInTheDocument();
  });

  it("快捷短语支持新增、调整顺序和删除", async () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByLabelText(t("conversation.quickPhraseTrigger")));
    expect(screen.queryByPlaceholderText(t("conversation.quickPhraseCreatePlaceholder"))).not.toBeInTheDocument();

    const quickPhraseDialog = screen.getByRole("dialog", {
      name: t("conversation.quickPhraseModalTitle")
    });

    fireEvent.click(
      within(quickPhraseDialog).getByRole("button", {
        name: t("conversation.quickPhraseOpenCreateAction")
      })
    );

    const createDialog = screen.getByRole("dialog", {
      name: t("conversation.quickPhraseCreateModalTitle")
    });

    fireEvent.change(within(createDialog).getByPlaceholderText(t("conversation.quickPhraseCreatePlaceholder")), {
      target: {
        value: "新增的快捷短语"
      }
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: t("conversation.quickPhraseCreateAction") }));

    await waitFor(() => {
      expect(screen.getByText("新增的快捷短语")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("conversation.quickPhraseCreateModalTitle") })).not.toBeInTheDocument();
    });

    const readPhraseOrder = () =>
      Array.from(document.querySelectorAll(".composer-quick-phrase-item .composer-quick-phrase-text"))
        .map((element) => element.textContent?.trim() ?? "");

    expect(readPhraseOrder().at(-1)).toBe("新增的快捷短语");

    const createdItem = screen.getByText("新增的快捷短语").closest(".composer-quick-phrase-item");
    expect(createdItem).not.toBeNull();

    fireEvent.click(within(createdItem as HTMLElement).getByLabelText(t("conversation.quickPhraseMoveUp")));

    await waitFor(() => {
      expect(readPhraseOrder().at(-2)).toBe("新增的快捷短语");
    });

    const movedItem = screen.getByText("新增的快捷短语").closest(".composer-quick-phrase-item");
    expect(movedItem).not.toBeNull();
    fireEvent.click(within(movedItem as HTMLElement).getByLabelText(t("conversation.quickPhraseDelete")));

    await waitFor(() => {
      expect(screen.queryByText("新增的快捷短语")).not.toBeInTheDocument();
    });
  });

  it("会按会话维度恢复文本和图片草稿，并在发送后清空本地草稿", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const draftStorageKey = "codingns.conversation.composer-draft:session-1";
    const firstView = render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        draftStorageId="session-1"
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const textarea = screen.getByRole("textbox");
    const file = new File(["demo"], "draft.png", { type: "image/png", lastModified: 123 });

    fireEvent.change(textarea, {
      target: {
        value: "这是跨会话草稿"
      }
    });
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
      expect(localStorage.getItem(draftStorageKey)).toContain("这是跨会话草稿");
    });

    firstView.unmount();

    render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        draftStorageId="session-1"
        isSubmitting={false}
        onSend={onSend}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("这是跨会话草稿");
    });
    expect(screen.getByText("draft.png")).toBeInTheDocument();

    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(localStorage.getItem(draftStorageKey)).toBeNull();
    });
  });
});

function createToolMessage(input: {
  callId: string;
  name: string;
  input: string;
}): SessionMessageViewModel {
  return {
    id: input.callId,
    sessionId: "session-1",
    role: "tool",
    kind: "tool_call",
    content: input.input,
    toolCall: {
      callId: input.callId,
      name: input.name,
      input: input.input,
      output: null,
      error: null,
      status: "completed"
    },
    attachments: [],
    attachmentPayloads: null,
    origin: null,
    originRef: null,
    timestamp: "2026-04-13T10:00:00.000Z",
    sequence: 1,
    rawRef: `raw://${input.callId}`,
    deliveryState: "sent",
    clientRequestId: null
  };
}

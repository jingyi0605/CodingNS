import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import type { ProviderCapabilitiesDto } from "../api/conversation-api";
import { clearProviderCatalogStore } from "../capability/provider-catalog-store";
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";
import { ComposerPanel, resolveComposerMacSelectPopoverWidth } from "./ComposerPanel";

const mockSearchComposerMentionItems = vi.fn();
const mockRevealWorkspaceFile = vi.fn();
const mockFetchModelManagementSnapshot = vi.fn();
const workbenchShellMock = vi.hoisted(() => ({
  currentTargetHostId: null as string | null
}));
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
          },
          "deepseek-harness": {
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
        defaultReasoningLevel: "off" | "low" | "medium" | "high" | "xhigh" | null;
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
          },
          "deepseek-harness": {
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
    || provider === "deepseek-harness"
  )
}));
const mockListQuickPhrases = vi.fn();
const mockReplaceQuickPhrases = vi.fn();
const mockGetProviderCapabilities = vi.fn();
const mockListProviderCatalog = vi.fn();

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args),
    listProviderCatalog: (...args: unknown[]) => mockListProviderCatalog(...args),
    listQuickPhrases: (...args: unknown[]) => mockListQuickPhrases(...args),
    replaceQuickPhrases: (...args: unknown[]) => mockReplaceQuickPhrases(...args)
  };
});

vi.mock("../api/composer-mention-api", () => ({
  searchComposerMentionItems: (...args: unknown[]) => mockSearchComposerMentionItems(...args)
}));

vi.mock("../../settings/api/model-switch-api", async () => {
  const actual = await vi.importActual<typeof import("../../settings/api/model-switch-api")>(
    "../../settings/api/model-switch-api"
  );

  return {
    ...actual,
    fetchModelManagementSnapshot: (...args: unknown[]) =>
      mockFetchModelManagementSnapshot(...args)
  };
});

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => platformMock
}));

vi.mock("./WorkbenchLayout", () => ({
  useWorkbenchShell: () => ({
    revealWorkspaceFile: (...args: unknown[]) => mockRevealWorkspaceFile(...args),
    currentTargetHostId: workbenchShellMock.currentTargetHostId
  })
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
  provider?: "codex" | "claude-code" | "opencode" | "deepseek-harness";
  modelOptions?: Array<{
    id: string;
    name: string;
    usesProviderDefault?: boolean;
    supportedReasoningEfforts?: string[];
    defaultReasoningEffort?: string | null;
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
      provider === "opencode" ? "none" : "streaming_guidance",
    supportsSubagents: false,
    supportsInterrupt: options?.supportsInterrupt ?? true,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: false,
    supportsAttachments: options?.supportsAttachments ?? false,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    supportsRunSteering: provider !== "opencode",
    supportsQueueWhileRunning: provider === "codex" ? true : undefined,
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
    defaultReasoningLevel:
      options && Object.prototype.hasOwnProperty.call(options, "defaultReasoningLevel")
        ? options.defaultReasoningLevel
        : provider === "codex"
          ? "high"
          : undefined,
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
    clearProviderCatalogStore();
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
    mockListProviderCatalog.mockReset();
    mockSearchComposerMentionItems.mockReset();
    mockRevealWorkspaceFile.mockReset();
    mockFetchModelManagementSnapshot.mockReset();
    workbenchShellMock.currentTargetHostId = null;
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
    mockListProviderCatalog.mockResolvedValue([
      { provider: "codex", displayName: "Codex", enabled: true },
      { provider: "claude-code", displayName: "Claude Code", enabled: true },
      { provider: "opencode", displayName: "OpenCode", enabled: true },
      { provider: "gemini", displayName: "Gemini", enabled: false },
      { provider: "kimi", displayName: "Kimi", enabled: false }
    ]);
    mockGetProviderCapabilities.mockResolvedValue(createCapabilities());
    mockFetchModelManagementSnapshot.mockResolvedValue({
      scannedAt: "2026-06-11T00:00:00.000Z",
      items: [
        {
          app: "codex",
          displayName: "Codex",
          cliAvailable: true,
          status: "ready",
          statusText: null,
          currentPresetId: "default",
          currentPresetName: "默认",
          currentModel: "gpt-5.4",
          options: []
        }
      ]
    });
    mockSearchComposerMentionItems.mockResolvedValue({
      skills: [],
      files: []
    });
    mockRevealWorkspaceFile.mockReturnValue(true);
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("模型下拉弹层会按最长选项文本自动扩宽", () => {
    expect(
      resolveComposerMacSelectPopoverWidth({
        labels: ["默认", "x".repeat(30)],
        triggerWidth: 72,
        maxWidth: 480,
        preferredWidth: 220,
        measureText: (text) => text.length * 8
      })
    ).toBe(312);
  });


  it("PeerHOST 下 Composer 会从目标 HOST 读取模型配置", async () => {
    workbenchShellMock.currentTargetHostId = "peer-host-1";

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        isSubmitting={false}
        onSend={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockFetchModelManagementSnapshot).toHaveBeenCalledWith({
        targetHostId: "peer-host-1"
      });
    });
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

  it("提交后会立刻清空输入框，并切换到活动态按钮", () => {
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
    expect(screen.getByLabelText(t("conversation.runtimeRunning"))).toBeInTheDocument();

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

  it("session 运行态短暂掉边界但 active run 还在时，继续显示停止按钮", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        hasActiveRun
        canInterrupt={false}
        isSubmitting={false}
        isRunning={false}
        onInterrupt={vi.fn()}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByLabelText(t("conversation.capabilityInterrupt"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.sendButton"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.runtimeRunning"))).not.toBeInTheDocument();
  });

  it("页面只剩陈旧 running 标记但没有 active run 时，不应继续显示停止按钮", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "claude-code", supportsInterrupt: true })}
        hasActiveRun={false}
        canInterrupt={false}
        isSubmitting={false}
        isRunning
        onInterrupt={vi.fn()}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByLabelText(t("conversation.capabilityInterrupt"))).not.toBeInTheDocument();
    expect(screen.getByLabelText(t("conversation.runtimeRunning"))).toBeInTheDocument();
  });

  it("发送请求还没落回空闲时，只要运行已经开始也优先显示停止按钮", async () => {
    const deferred = createDeferred();
    const onSend = vi.fn(() => deferred.promise);
    const onInterrupt = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        isRunning={false}
        onInterrupt={onInterrupt}
        onSend={onSend}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "继续执行当前任务"
      }
    });
    fireEvent.submit(document.querySelector(".composer-form")!);

    expect(screen.getByLabelText(t("conversation.runtimeRunning"))).toBeInTheDocument();

    rerender(
      <ComposerPanel
        capabilities={createCapabilities()}
        hasActiveRun
        canInterrupt
        isSubmitting
        isRunning
        onInterrupt={onInterrupt}
        onSend={onSend}
      />
    );

    expect(screen.queryByLabelText(t("conversation.runtimeRunning"))).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(t("conversation.capabilityInterrupt")));

    await waitFor(() => {
      expect(onInterrupt).toHaveBeenCalledTimes(1);
    });

    deferred.resolve();
    await deferred.promise;
  });

  it("Codex 运行中输入草稿后会默认先进入队列", async () => {
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
        value: "这条消息应该先进入队列，等我手动点引导"
      }
    });

    expect(screen.getByLabelText(t("conversation.queueGuidanceButton"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.sendGuidanceButton"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("conversation.capabilityInterrupt"))).not.toBeInTheDocument();

    fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter"
    });

    expect(textarea).not.toHaveAttribute("readonly");
    await waitFor(() => {
      expect(onQueueSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("输入法组合输入时按 Enter 不发送消息", () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        isSubmitting={false}
        onInterrupt={vi.fn()}
        onSend={onSend}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "nihao"
      }
    });
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter"
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("输入法刚结束组合输入时按 Enter 不发送消息", () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        isSubmitting={false}
        onInterrupt={vi.fn()}
        onSend={onSend}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "你好"
      }
    });
    fireEvent.compositionStart(textarea);
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter"
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("输入法提交锁释放后按 Enter 会发送消息", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        isSubmitting={false}
        onInterrupt={vi.fn()}
        onSend={onSend}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "你好"
      }
    });
    fireEvent.compositionStart(textarea);
    fireEvent.compositionEnd(textarea);

    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));

    fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter"
    });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
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

  it("空闲但队列还有待发消息时，也统一显示活动态按钮", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        hasPendingQueuedMessages
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByLabelText(t("conversation.runtimeRunning"))).toBeInTheDocument();
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
    expect(tooltip?.textContent).toContain(
      t("conversation.contextUsageUsedTokens", { count: "64,000" })
    );
    expect(tooltip?.textContent).toContain(
      t("conversation.contextUsageLimitTokens", { count: "200,000" })
    );
  });

  it("上下文没有原生缓存桶时仍显示占用，但不渲染来源或估算标签", () => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        contextUsage={{
          provider: "deepseek-harness",
          promptTokens: 9818,
          contextWindow: 1_000_000,
          usageRatio: 0.009818,
          source: "provider-runtime",
          contextWindowSource: "provider-runtime",
          modelId: null,
          capturedAt: "2026-08-15T10:00:00.000Z",
          isEstimated: true
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const ring = container.querySelector(".composer-context-ring");
    expect(ring).toHaveAttribute("aria-label", `${t("conversation.contextUsageTitle")} 1%`);

    fireEvent.click(ring!);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(
      t("conversation.contextUsageUsedTokens", { count: "9,818" })
    );
    expect(tooltip).toHaveTextContent(
      t("conversation.contextUsageLimitTokens", { count: "1,000,000" })
    );
    expect(tooltip.querySelector(".composer-context-usage-details")).toBeNull();
  });

  it("将会话统计详情合并到上下文占用圆环，并移除独立统计按钮", () => {
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
        sessionStats={{
          provider: "codex",
          capturedAt: "2026-08-15T10:00:00.000Z",
          metrics: {
            inputTokens: {
              value: 4_949_000,
              source: "provider-history-log",
              semantic: "latest-snapshot",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            },
            outputTokens: {
              value: 23_000,
              source: "provider-history-log",
              semantic: "latest-snapshot",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            },
            turns: {
              value: 5,
              source: "provider-history-log",
              semantic: "latest-snapshot",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            },
            llmMs: {
              value: 1_900,
              source: "provider-history-log",
              semantic: "latest-snapshot",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            },
            cacheHitRate: {
              value: 93.7,
              source: "derived-provider-metrics",
              semantic: "derived-ratio",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const ring = container.querySelector(".composer-context-ring");
    const cacheRing = container.querySelector(".composer-cache-hit-ring");
    const statsControl = container.querySelector(".composer-session-stats-control");
    const summary = container.querySelector(".composer-session-stats-summary");

    expect(container.querySelector(".composer-session-stats-trigger")).toBeNull();
    expect(statsControl?.firstElementChild).toBe(ring);
    expect(ring?.nextElementSibling).toBe(cacheRing);
    expect(cacheRing?.nextElementSibling).toBe(summary);
    expect(ring?.contains(cacheRing)).toBe(false);
    fireEvent.click(ring!);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(t("conversation.contextUsageTitle"));
    expect(tooltip).toHaveTextContent(t("conversation.sessionStatsTitle"));
    expect(tooltip).toHaveTextContent(t("conversation.sessionStatsInputTokens"));
    expect(tooltip).toHaveTextContent(t("conversation.sessionStatsOutputTokens"));
    expect(tooltip).toHaveTextContent(t("conversation.sessionStatsTurns"));
    expect(tooltip).toHaveTextContent(t("conversation.sessionStatsLlmDuration"));
    expect(screen.getByRole("progressbar", {
      name: `${t("conversation.contextUsageTitle")} 32%`
    })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", {
      name: t("conversation.sessionStatsSummaryCacheHitRate", { value: "93.7%" })
    })).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("40");
    expect(tooltip).toHaveTextContent("80");
    expect(tooltip).toHaveTextContent("90");
    expect(tooltip.querySelector(".composer-session-stats-provenance")).toBeNull();
    expect(tooltip.querySelector(".composer-session-stats-group-title")).toBeNull();
    expect(tooltip.querySelectorAll(".composer-session-stats-row")).toHaveLength(4);
    expect(container.querySelector(".composer-session-stats-summary")).not.toHaveTextContent("tok");
  });

  it("会话统计弹层会在上方可用空间内向上展开", async () => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        sessionStats={{
          provider: "deepseek-harness",
          capturedAt: "2026-08-15T10:00:00.000Z",
          metrics: {
            inputTokens: {
              value: 800,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "12" }
            },
            outputTokens: {
              value: 300,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "12" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const trigger = container.querySelector(".composer-context-ring");
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    vi.spyOn(trigger!, "getBoundingClientRect").mockReturnValue({
      x: 200,
      y: 700,
      top: 700,
      right: 228,
      bottom: 728,
      left: 200,
      width: 28,
      height: 28,
      toJSON: () => ({})
    } as DOMRect);

    fireEvent.click(trigger!);

    const tooltip = await screen.findByRole("tooltip");
    await waitFor(() => {
      expect(tooltip).toHaveStyle({ bottom: "210px", maxHeight: "678px" });
    });
  });

  it("按计费输入总量、未缓存输入和平均首 token 展示 DeepSeek 统计", () => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        sessionStats={{
          provider: "deepseek-harness",
          capturedAt: "2026-08-15T10:00:00.000Z",
          metrics: {
            inputTokens: {
              value: 5_887_173,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "88" }
            },
            uncachedInputTokens: {
              value: 63_429,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "88" }
            },
            outputTokens: {
              value: 76_908,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "88" }
            },
            llmMs: {
              value: 620_925,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "88" }
            },
            toolMs: {
              value: 116_585,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "88" }
            },
            ttftMs: {
              value: 68_748,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "88" }
            },
            ttftSteps: {
              value: 76,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "88" }
            },
            decodeMs: {
              value: 552_177,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "88" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(container.querySelector(".composer-context-ring")!);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.querySelector('[data-metric="inputTokens"] strong')).toHaveTextContent(
      "5,887,173"
    );
    expect(tooltip).toHaveTextContent("5.9M");
    expect(tooltip.querySelector('[data-metric="uncachedInputTokens"] strong')).toHaveTextContent(
      "63,429"
    );
    expect(tooltip).toHaveTextContent("10 分 21 秒");
    expect(tooltip).toHaveTextContent("1 分 57 秒");
    expect(tooltip).toHaveTextContent("0.9 秒");
    expect(tooltip).toHaveTextContent("9 分 12 秒");
  });

  it("只显示 Provider 真实提供的会话统计字段，并保留明确的零值", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        sessionStats={{
          provider: "opencode",
          capturedAt: "2026-08-15T10:00:00.000Z",
          metrics: {
            inputTokens: {
              value: 0,
              source: "provider-session-store",
              semantic: "cumulative",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            },
            steps: {
              value: 3,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "21" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const trigger = screen.getByLabelText(t("conversation.sessionStatsTitle"));
    fireEvent.click(trigger);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(t("conversation.sessionStatsInputTokens"));
    expect(tooltip).toHaveTextContent("0");
    expect(tooltip).toHaveTextContent(t("conversation.sessionStatsSteps"));
    expect(tooltip).toHaveTextContent("3");
    expect(tooltip).not.toHaveTextContent(t("conversation.sessionStatsOutputTokens"));
    expect(tooltip).not.toHaveTextContent(t("conversation.sessionStatsCost"));
  });

  it.each([
    ["原生费用", "provider-session-store", "cumulative", "provider-native"] as const,
    ["目录估算", "derived-provider-metrics", "priced-final-events", "catalog-estimate"] as const
  ])("会在既有统计详情中显示%s", (_label, source, semantic, kind) => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        sessionStats={{
          provider: "opencode",
          capturedAt: "2026-08-16T00:00:02.000Z",
          metrics: {
            costUsd: {
              value: 0.125,
              source,
              semantic,
              pricing: {
                kind,
                coverage: "complete",
                ...(kind === "catalog-estimate"
                  ? { pricingProfileId: "direct-api", priceBookVersion: "2026-08-16" }
                  : {})
              },
              watermark: { kind: "source-timestamp", value: "2026-08-16T00:00:02.000Z" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(container.querySelector(".composer-context-ring")!);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(t("conversation.sessionStatsCost"));
    expect(tooltip.querySelector('[data-metric="costUsd"] strong')).toHaveTextContent("$0.125");
  });

  it("费用信息按钮会打开模型明细、人民币换算和价格表", () => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        sessionStats={{
          provider: "codex",
          capturedAt: "2026-08-16T00:00:02.000Z",
          metrics: {
            costUsd: {
              value: 0.125,
              source: "derived-provider-metrics",
              semantic: "priced-final-events",
              pricing: {
                kind: "catalog-estimate",
                coverage: "complete",
                pricingProfileId: "direct-api",
                priceBookVersion: "2026-08-16",
                breakdown: [{
                  provider: "codex",
                  model: "gpt-5.3-codex",
                  inputTokens: 1000,
                  outputTokens: 200,
                  reasoningTokens: 0,
                  cacheReadTokens: 100,
                  cacheWriteTokens: 0,
                  costUsd: 0.125
                }],
                priceBook: [{
                  provider: "codex",
                  model: "gpt-5.3-codex",
                  inputUsdPerToken: 1.75e-6,
                  outputUsdPerToken: 14e-6
                }],
                exchangeRate: {
                  from: "USD",
                  to: "CNY",
                  rate: 7.2,
                  version: "2026-08-16",
                  source: "application-fixed"
                }
              },
              watermark: { kind: "source-timestamp", value: "2026-08-16T00:00:02.000Z" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(container.querySelector(".composer-context-ring")!);
    fireEvent.click(screen.getByRole("button", { name: t("conversation.sessionStatsCostDetailsAction") }));

    expect(screen.getByRole("dialog")).toHaveTextContent("gpt-5.3-codex");
    expect(screen.getByRole("dialog")).toHaveTextContent("¥0.9");

    fireEvent.click(screen.getByRole("button", { name: t("conversation.sessionStatsCostViewPriceBook") }));

    expect(screen.getByRole("dialog")).toHaveTextContent(t("conversation.sessionStatsCostPriceBookTitle"));
    expect(screen.getByRole("dialog")).toHaveTextContent("$1.75");
  });

  it("桌面摘要只显示核心指标，缓存命中率由独立圆环和详情显示", () => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        sessionStats={{
          provider: "deepseek-harness",
          capturedAt: "2026-08-15T10:00:00.000Z",
          metrics: {
            turns: {
              value: 4,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "12" }
            },
            inputTokens: {
              value: 800,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "12" }
            },
            outputTokens: {
              value: 300,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "12" }
            },
            cacheReadTokens: {
              value: 200,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "12" }
            },
            cacheWriteTokens: {
              value: 0,
              source: "provider-projection",
              semantic: "cumulative",
              watermark: { kind: "source-sequence", value: "12" }
            },
            cacheHitRate: {
              value: 20,
              source: "derived-provider-metrics",
              semantic: "derived-ratio",
              watermark: { kind: "source-sequence", value: "12" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const summary = container.querySelector(".composer-session-stats-summary");
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent(t("conversation.sessionStatsSummaryTurns", { value: "4" }));
    expect(summary).toHaveTextContent(t("conversation.sessionStatsInputTokens"));
    expect(summary).toHaveTextContent(t("conversation.sessionStatsOutputTokens"));
    expect(summary).not.toHaveTextContent(t("conversation.sessionStatsSummaryCacheHitRate", { value: "20%" }));
    expect(summary).not.toHaveTextContent("tok");

    const contextTrigger = container.querySelector(".composer-context-ring");
    const cacheTrigger = container.querySelector(".composer-cache-hit-ring");
    expect(contextTrigger).toHaveAttribute("aria-label", t("conversation.sessionStatsTitle"));
    expect(cacheTrigger).toHaveClass("is-cache-critical");
    expect(cacheTrigger).toHaveAttribute(
      "aria-label",
      t("conversation.sessionStatsSummaryCacheHitRate", { value: "20%" })
    );
    fireEvent.mouseEnter(cacheTrigger!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(cacheTrigger!);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(t("conversation.sessionStatsCacheHitRate"));
    expect(tooltip).toHaveTextContent("20%");
    expect(tooltip.querySelector(".composer-cache-hit-rate-pointer")).toHaveStyle({ left: "20%" });
    expect(contextTrigger).toHaveAttribute("aria-expanded", "false");
    expect(cacheTrigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.mouseLeave(cacheTrigger!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.click(cacheTrigger!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("移动端同时显示上下文占用和缓存命中率两个圆环", () => {
    platformMock.platform = "ios";
    platformMock.isWeb = false;
    platformMock.isMobile = true;
    platformMock.isNativeMobile = true;
    platformMock.viewportClass = "compact";
    platformMock.ui.osFamily = "ios";

    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        contextUsage={{
          provider: "codex",
          promptTokens: 49_000,
          uncachedInputTokens: 30_000,
          cachedInputTokens: 19_000,
          contextWindow: 100_000,
          usageRatio: 0.49,
          source: "provider-log",
          contextWindowSource: "provider-log",
          modelId: "gpt-5.3-codex",
          capturedAt: "2026-08-15T10:00:00.000Z",
          isEstimated: false
        }}
        sessionStats={{
          provider: "codex",
          capturedAt: "2026-08-15T10:00:00.000Z",
          metrics: {
            cacheHitRate: {
              value: 80,
              source: "derived-provider-metrics",
              semantic: "derived-ratio",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const statsControl = container.querySelector(".composer-session-stats-control");
    const contextRing = container.querySelector(".composer-context-ring");
    const cacheRing = container.querySelector(".composer-cache-hit-ring");

    expect(statsControl).toHaveClass("is-mobile");
    expect(contextRing).toBeInTheDocument();
    expect(cacheRing).toBeInTheDocument();
    expect(contextRing?.nextElementSibling).toBe(cacheRing);
  });

  it("使用 Provider 已核验的缓存命中率，不再把 Codex 缓存读取重复加入分母", () => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        sessionStats={{
          provider: "codex",
          capturedAt: "2026-08-15T10:00:00.000Z",
          metrics: {
            inputTokens: {
              value: 1000,
              source: "provider-history-log",
              semantic: "latest-snapshot",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            },
            cacheReadTokens: {
              value: 800,
              source: "provider-history-log",
              semantic: "latest-snapshot",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            },
            cacheHitRate: {
              value: 80,
              source: "derived-provider-metrics",
              semantic: "derived-ratio",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(container.querySelector(".composer-session-stats-summary")).not.toHaveTextContent(
      t("conversation.sessionStatsSummaryCacheHitRate", { value: "80%" })
    );
    expect(container.querySelector(".composer-cache-hit-ring")).toHaveClass("is-cache-medium");
  });

  it.each([
    [39.9, "is-cache-critical"],
    [40, "is-cache-low"],
    [79.9, "is-cache-low"],
    [80, "is-cache-medium"],
    [89.9, "is-cache-medium"],
    [90, "is-cache-high"]
  ])("缓存命中率为 %s%% 时使用 %s 圆环", (cacheHitRate, expectedClassName) => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        sessionStats={{
          provider: "codex",
          capturedAt: "2026-08-15T10:00:00.000Z",
          metrics: {
            inputTokens: {
              value: 1000,
              source: "provider-history-log",
              semantic: "latest-snapshot",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            },
            cacheHitRate: {
              value: cacheHitRate,
              source: "derived-provider-metrics",
              semantic: "derived-ratio",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const ring = container.querySelector(".composer-cache-hit-ring");

    expect(ring).toHaveClass(expectedClassName);
  });

  it("Provider 未给出核验后的缓存命中率时保持隐藏", () => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        sessionStats={{
          provider: "gemini",
          capturedAt: "2026-08-15T10:00:00.000Z",
          metrics: {
            inputTokens: {
              value: 800,
              source: "provider-history-log",
              semantic: "sum-of-final-events",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            },
            cacheReadTokens: {
              value: 200,
              source: "provider-history-log",
              semantic: "sum-of-final-events",
              watermark: { kind: "source-timestamp", value: "2026-08-15T10:00:00.000Z" }
            }
          }
        }}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(container.querySelector(".composer-session-stats-summary")).not.toHaveTextContent(
      t("conversation.sessionStatsSummaryCacheHitRate", { value: "20%" })
    );
    expect(container.querySelector(".composer-cache-hit-ring")).toBeNull();
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

    const taskEntry = taskButton.closest(".conversation-task-progress-entry");
    const statsControl = ring?.closest(".composer-session-stats-control");

    expect(taskButton).toHaveClass("composer-task-progress-button");
    expect(leftControls?.lastElementChild).toBe(taskEntry);
    expect(statsControl?.nextElementSibling).toBe(taskEntry);
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
      expect(onSend).toHaveBeenCalledWith("", expect.objectContaining({
        model: undefined,
        reasoningLevel: "high",
        providerConfigMode: "global-default",
        providerPresetId: null,
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
      }));
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
    expect(onSend).toHaveBeenCalledWith("", expect.objectContaining({
      model: undefined,
      reasoningLevel: "high",
      providerConfigMode: "global-default",
      providerPresetId: null,
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
    }));
  });

  it("未设置账户或 Codex 配置时会使用当前模型声明的默认思考级别", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({
          defaultReasoningLevel: null,
          modelOptions: [
            {
              id: "provider-default",
              name: "跟随 CLI 默认模型",
              usesProviderDefault: true,
              supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
              defaultReasoningEffort: "low"
            }
          ]
        })}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "使用模型默认思考级别" }
    });
    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith("使用模型默认思考级别", expect.objectContaining({
      model: undefined,
      reasoningLevel: "low"
    }));
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
    expect(onSend).toHaveBeenCalledWith("请输出当前模型", expect.objectContaining({
      model: "gpt-5.4",
      reasoningLevel: "high",
      providerConfigMode: "global-default",
      providerPresetId: null,
      attachments: [],
      attachmentMeta: []
    }));
  });

  it("切换模型时只上报当前会话选择，不改账号默认模型", async () => {
    const onSessionSelectionChange = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
        onSessionSelectionChange={onSessionSelectionChange}
      />
    );

    chooseOption(t("conversation.modelSelectorLabel"), "gpt-5.4");

    await waitFor(() => {
      expect(onSessionSelectionChange).toHaveBeenCalledWith({
        selectedModel: "gpt-5.4",
        providerConfigMode: "global-default",
        providerPresetId: null
      });
    });
    expect(preferenceStoreMock.updatePreferences).not.toHaveBeenCalled();
  });

  it("切换模型后立即发送时，会先等待会话选择写入完成", async () => {
    let resolveSelection: (() => void) | null = null;
    const onSessionSelectionChange = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveSelection = resolve;
      })
    );
    const onSend = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={onSend}
        onSessionSelectionChange={onSessionSelectionChange}
      />
    );

    chooseOption(t("conversation.modelSelectorLabel"), "gpt-5.4");
    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "等待会话模型保存"
      }
    });
    fireEvent.submit(container.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSessionSelectionChange).toHaveBeenCalledWith({
        selectedModel: "gpt-5.4",
        providerConfigMode: "global-default",
        providerPresetId: null
      });
    });
    expect(onSend).not.toHaveBeenCalled();

    resolveSelection?.();

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("等待会话模型保存", expect.objectContaining({
        model: "gpt-5.4"
      }));
    });
  });

  it("同一会话里手动选择模型后，不会被迟到的旧初始模型覆盖", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const capabilities = createCapabilities({
      modelOptions: [
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
          id: "gpt-5.5",
          name: "gpt-5.5",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
        }
      ]
    });

    const { rerender, container } = render(
      <ComposerPanel
        capabilities={capabilities}
        draftStorageId="session-1"
        initialModel="gpt-5.4"
        isSubmitting={false}
        onSend={onSend}
      />
    );

    chooseOption(t("conversation.modelSelectorLabel"), "gpt-5.5");

    rerender(
      <ComposerPanel
        capabilities={capabilities}
        draftStorageId="session-1"
        initialModel="gpt-5.4"
        isSubmitting={false}
        onSend={onSend}
      />
    );

    expect(screen.getByLabelText(t("conversation.modelSelectorLabel"))).toHaveTextContent("gpt-5.5");

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "使用刚选择的模型"
      }
    });
    fireEvent.submit(container.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("使用刚选择的模型", expect.objectContaining({
        model: "gpt-5.5"
      }));
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

    expect(
      within(screen.getByRole("listbox", { name: t("conversation.deploymentModelColumn") }))
        .getByRole("option", { name: "默认" })
    ).toBeInTheDocument();
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
    expect(onSend).toHaveBeenCalledWith("请回复OK", expect.objectContaining({
      model: undefined,
      reasoningLevel: undefined,
      providerConfigMode: "global-default",
      providerPresetId: null,
      attachments: [],
      attachmentMeta: []
    }));
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
    expect(onSend).toHaveBeenCalledWith("请返回当前模型标识", expect.objectContaining({
      model: "opencode/gpt-5-nano",
      reasoningLevel: undefined,
      providerConfigMode: "global-default",
      providerPresetId: null,
      attachments: [],
      attachmentMeta: []
    }));
  });

  it("传入初始模型时会作为当前会话默认模型发送", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        initialModel="gpt-5.1-codex-mini"
        isSubmitting={false}
        onSend={onSend}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "沿用并行创建时选择的模型"
      }
    });
    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith("沿用并行创建时选择的模型", {
      model: "gpt-5.1-codex-mini",
      reasoningLevel: "high",
      providerConfigMode: "global-default",
      providerPresetId: null,
      attachments: [],
      attachmentMeta: []
    });
  });

  it("初始模型晚于能力列表加载时，仍会在模型可用后自动应用", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ComposerPanel
        capabilities={createCapabilities({
          modelOptions: [
            {
              id: "provider-default",
              name: "跟随 CLI 默认模型",
              usesProviderDefault: true
            }
          ]
        })}
        initialModel="gpt-5.1-codex-mini"
        isSubmitting={false}
        onSend={onSend}
      />
    );

    rerender(
      <ComposerPanel
        capabilities={createCapabilities()}
        initialModel="gpt-5.1-codex-mini"
        isSubmitting={false}
        onSend={onSend}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "模型列表加载完成后发送"
      }
    });
    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith("模型列表加载完成后发送", {
      model: "gpt-5.1-codex-mini",
      reasoningLevel: "high",
      providerConfigMode: "global-default",
      providerPresetId: null,
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
      providerConfigMode: "global-default",
      providerPresetId: null,
      attachments: [],
      attachmentMeta: []
    });
  });

  it("fork 引用态只显示当前支持的目标 CLI，不展示不可用 provider", async () => {
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

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Codex/i })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Claude Code/i })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /OpenCode/i })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /Gemini/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /Kimi/i })).not.toBeInTheDocument();
    });
  });

  it("fork 目标 provider 列表会继续过滤 catalog 中已禁用的项", async () => {
    mockListProviderCatalog.mockResolvedValueOnce([
      { provider: "codex", displayName: "Codex", enabled: true },
      { provider: "claude-code", displayName: "Claude Code", enabled: true },
      { provider: "opencode", displayName: "OpenCode", enabled: false },
      { provider: "gemini", displayName: "Gemini", enabled: false },
      { provider: "kimi", displayName: "Kimi", enabled: false }
    ]);

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

    await waitFor(() => {
      expect(mockListProviderCatalog).toHaveBeenCalled();
      expect(screen.getByRole("option", { name: /Codex/i })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Claude Code/i })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /OpenCode/i })).not.toBeInTheDocument();
    });
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

    fireEvent.click(screen.getByLabelText(t("conversation.forkTargetProviderLabel")));
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "OpenCode" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("option", { name: "OpenCode" }));

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

    fireEvent.click(screen.getByLabelText(t("conversation.forkTargetProviderLabel")));
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "OpenCode" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("option", { name: "OpenCode" }));
    fireEvent.click(screen.getByRole("button", { name: t("conversation.forkSwitchConfirmAction") }));

    await waitFor(() => {
      expect(screen.getByTestId("fork-target-provider")).toHaveTextContent("opencode");
    });
    expect(screen.getByTestId("fork-target-model")).toHaveTextContent("");
    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith("opencode", "workspace-1", {
        providerConfigMode: "global-default",
        providerPresetId: null
      }, expect.objectContaining({ targetHostId: null }));
    });

    fireEvent.click(screen.getByRole("button", { name: t("conversation.forkTargetModelLabel") }));

    expect(screen.getByRole("option", { name: "默认" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "opencode/gpt-5-nano" })).toBeInTheDocument();
  });

  it("快速切换 fork 目标 provider 时会忽略旧能力请求回写的模型列表", async () => {
    const opencodeDeferred = createDeferred();
    mockGetProviderCapabilities.mockImplementation(async (provider) => {
      if (provider === "opencode") {
        await opencodeDeferred.promise;
        return createCapabilities({
          provider: "opencode",
          modelOptions: [
            {
              id: "opencode/gpt-5-nano",
              name: "opencode/gpt-5-nano"
            }
          ]
        });
      }

      return createCapabilities({
        provider: "claude-code",
        modelOptions: [
          {
            id: "sonnet",
            name: "Sonnet"
          }
        ]
      });
    });

    function Wrapper() {
      const [forkDraft, setForkDraft] = useState(createForkDraft());

      return (
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
      );
    }

    render(<Wrapper />);

    fireEvent.click(screen.getByLabelText(t("conversation.forkTargetProviderLabel")));
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "OpenCode" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("option", { name: "OpenCode" }));
    fireEvent.click(screen.getByRole("button", { name: t("conversation.forkSwitchConfirmAction") }));

    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith("opencode", "workspace-1", {
        providerConfigMode: "global-default",
        providerPresetId: null
      }, expect.objectContaining({ targetHostId: null }));
    });

    fireEvent.click(screen.getByLabelText(t("conversation.forkTargetProviderLabel")));
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Claude Code" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("option", { name: "Claude Code" }));

    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith("claude-code", "workspace-1", {
        providerConfigMode: "global-default",
        providerPresetId: null
      }, expect.objectContaining({ targetHostId: null }));
    });

    opencodeDeferred.resolve();

    fireEvent.click(screen.getByRole("button", { name: t("conversation.forkTargetModelLabel") }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Sonnet" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("option", { name: "opencode/gpt-5-nano" })).toBeNull();
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

  it("默认把发送按钮放在输入框右侧，把快捷短语单独放到底部右侧", () => {
    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const sendButton = screen.getByLabelText(t("conversation.sendButton"));
    const quickPhraseButton = screen.getByLabelText(t("conversation.quickPhraseTrigger"));
    const inputWrapper = container.querySelector(".composer-input-wrapper");
    const controls = container.querySelector(".composer-controls");
    const controlsLeft = container.querySelector(".composer-controls-left");

    expect(inputWrapper?.contains(sendButton)).toBe(true);
    expect(inputWrapper?.contains(quickPhraseButton)).toBe(false);
    expect(controls?.contains(quickPhraseButton)).toBe(true);
    expect(controlsLeft?.contains(quickPhraseButton)).toBe(false);
    expect(sendButton).toBeDisabled();
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

  it("点击 skill chip 会把名称回显到输入框", async () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        workspaceId="workspace-1"
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "@skill:demo-skill"
      }
    });

    const chipButton = await screen.findByRole("button", { name: "回显 skill：demo-skill" });
    fireEvent.click(chipButton);

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("demo-skill");
    });
  });

  it("点击 file chip 会触发文件面板定位", async () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        workspaceId="workspace-1"
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "@file:docs/spec.md"
      }
    });

    const chipButton = await screen.findByRole("button", { name: "定位文件：docs/spec.md" });
    fireEvent.click(chipButton);

    await waitFor(() => {
      expect(mockRevealWorkspaceFile).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        filePath: "docs/spec.md",
        openViewer: false
      });
    });
  });

  it("DeepSeek Harness 可以选择模型和关闭思考，并将强度保存为偏好", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({
          provider: "deepseek-harness",
          modelOptions: [
            {
              id: "deepseek-official:deepseek-v4-flash",
              name: "DeepSeek-V4-Flash",
              supportedReasoningEfforts: ["off", "high", "max"],
              defaultReasoningEffort: "high"
            },
            {
              id: "deepseek-official:deepseek-v4-pro",
              name: "DeepSeek-V4-Pro",
              supportedReasoningEfforts: ["off", "high", "max"],
              defaultReasoningEffort: "high"
            }
          ]
        })}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText(t("conversation.modelSelectorLabel"))).toBeInTheDocument();
      expect(screen.getByLabelText(t("conversation.reasoningSelectorLabel"))).toBeInTheDocument();
    });
    chooseOption(t("conversation.modelSelectorLabel"), "DeepSeek-V4-Pro");
    chooseOption(t("conversation.reasoningSelectorLabel"), t("conversation.reasoningOff"));

    expect(preferenceStoreMock.updatePreferences).toHaveBeenCalledWith({
      providers: {
        "deepseek-harness": {
          defaultReasoningLevel: "off"
        }
      }
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "使用指定模型回答" } });
    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("使用指定模型回答", expect.objectContaining({
        model: "deepseek-official:deepseek-v4-pro",
        reasoningLevel: "off"
      }));
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

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import type { ProviderCapabilitiesDto } from "../api/conversation-api";
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";
import { ComposerPanel, resolveComposerMacSelectPopoverWidth } from "./ComposerPanel";

const mockSearchComposerMentionItems = vi.fn();
const mockRevealWorkspaceFile = vi.fn();
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

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => platformMock
}));

vi.mock("./WorkbenchLayout", () => ({
  useWorkbenchShell: () => ({
    revealWorkspaceFile: (...args: unknown[]) => mockRevealWorkspaceFile(...args)
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

function createDeferred<T>() {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((res) => {
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



describe("ComposerPanel mentions", () => {
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
    mockListProviderCatalog.mockReset();
    mockSearchComposerMentionItems.mockReset();
    mockRevealWorkspaceFile.mockReset();
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

  it("@ 时会显示技能和最近修改文件，并支持点击插入", async () => {
    mockSearchComposerMentionItems.mockResolvedValue({
      skills: [
        {
          id: "skill-1",
          name: "workspace-helper-skill",
          source: "managed",
          targetCli: ["codex", "claude-code"],
          description: "适用于 codex、claude-code"
        }
      ],
      files: [
        {
          path: "apps/user-app/src/features/conversation/components/ComposerPanel.tsx",
          name: "ComposerPanel.tsx",
          updatedAt: "2026-05-27T12:00:00.000Z",
          size: 1234
        }
      ]
    });

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        workspaceId="workspace-1"
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: "@"
      }
    });

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: t("conversation.mentionMenuTitle") })).toBeInTheDocument();
    });

    expect(screen.getByText("workspace-helper-skill")).toBeInTheDocument();
    expect(screen.getByText("apps/user-app/src/features/conversation/components/ComposerPanel.tsx")).toBeInTheDocument();

    fireEvent.click(screen.getByText("workspace-helper-skill"));

    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
    expect(screen.getByLabelText(t("conversation.mentionSelectedListLabel"))).toBeInTheDocument();
    expect(screen.getByText("workspace-helper-skill").closest(".composer-selected-mention-chip")).not.toBeNull();
  });

  it("输入 @ 后会立刻打开面板并显示加载中", async () => {
    const deferred = createDeferred<{
      skills: [];
      files: [];
    }>();
    mockSearchComposerMentionItems.mockReturnValue(deferred.promise);

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
        value: "@"
      }
    });

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: t("conversation.mentionMenuTitle") })).toBeInTheDocument();
      expect(screen.getByText(t("conversation.mentionLoading"))).toBeInTheDocument();
    });

    deferred.resolve({
      skills: [],
      files: []
    });

    await waitFor(() => {
      expect(screen.getByText(t("conversation.mentionEmpty"))).toBeInTheDocument();
    });
  });

  it("@ 过滤结果为空时会显示空态", async () => {
    mockSearchComposerMentionItems.mockResolvedValue({
      skills: [],
      files: []
    });

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "claude-code" })}
        workspaceId="workspace-1"
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "@not-found"
      }
    });

    await waitFor(() => {
      expect(screen.getByText(t("conversation.mentionEmpty"))).toBeInTheDocument();
    });
  });

  it("@ 候选支持上下键切换，并用回车应用当前高亮项", async () => {
    mockSearchComposerMentionItems.mockResolvedValue({
      skills: [
        {
          id: "skill-1",
          name: "first-skill",
          source: "managed",
          targetCli: ["codex"],
          description: "适用于 codex"
        },
        {
          id: "skill-2",
          name: "second-skill",
          source: "managed",
          targetCli: ["codex"],
          description: "适用于 codex"
        }
      ],
      files: []
    });

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        workspaceId="workspace-1"
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: "@"
      }
    });

    await waitFor(() => {
      expect(screen.getByText("first-skill")).toBeInTheDocument();
    });

    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    await waitFor(() => {
      expect(screen.getByText("second-skill").closest(".composer-mention-item")).toHaveClass("is-active");
      expect(screen.getByText("second-skill").closest(".composer-mention-item")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("first-skill").closest(".composer-mention-item")).toHaveAttribute("aria-selected", "false");
    });

    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
    expect(screen.getByText("second-skill").closest(".composer-selected-mention-chip")).not.toBeNull();
  });

  it("@ 候选用键盘切换到可视区外项目时，会自动滚动到当前高亮项", async () => {
    mockSearchComposerMentionItems.mockResolvedValue({
      skills: Array.from({ length: 6 }, (_, index) => ({
        id: `skill-${index + 1}`,
        name: `skill-${index + 1}`,
        source: "managed",
        targetCli: ["codex"],
        description: "适用于 codex"
      })),
      files: []
    });

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        workspaceId="workspace-1"
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "@"
      }
    });

    const menu = await screen.findByRole("listbox", { name: t("conversation.mentionMenuTitle") });
    Object.defineProperty(menu, "clientHeight", {
      configurable: true,
      value: 120
    });

    const items = await screen.findAllByRole("button");
    const mentionItems = items.filter((item) => item.className.includes("composer-mention-item"));

    mentionItems.forEach((item, index) => {
      Object.defineProperty(item, "offsetTop", {
        configurable: true,
        value: index * 44
      });
      Object.defineProperty(item, "offsetHeight", {
        configurable: true,
        value: 44
      });
    });

    for (let index = 0; index < 4; index += 1) {
      fireEvent.keyDown(textarea, { key: "ArrowDown" });
    }

    await waitFor(() => {
      expect((menu as HTMLDivElement).scrollTop).toBeGreaterThan(0);
      expect(screen.getByText("skill-5").closest(".composer-mention-item")).toHaveClass("is-active");
    });
  });

  it("文件 mention 应该渲染成文件元素，而不是裸文本", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        workspaceId="workspace-1"
        isSubmitting={false}
        onSend={onSend}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "@file:docs/spec.md"
      }
    });

    await waitFor(() => {
      const chip = screen.getByText("docs/spec.md").closest(".composer-selected-mention-chip");
      expect(chip).not.toBeNull();
      expect(chip).toHaveAttribute("data-kind", "file");
    });
  });

  it("删除 chip 时会同步删掉底层 token，并通过关闭按钮操作", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(
      <ComposerPanel
        capabilities={createCapabilities({ provider: "codex" })}
        workspaceId="workspace-1"
        isSubmitting={false}
        onSend={onSend}
      />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "@file:docs/spec.md"
      }
    });

    const removeButton = await screen.findByLabelText("删除文件：docs/spec.md");
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(screen.queryByText("docs/spec.md")).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("textbox"), {
      target: {
        value: "继续处理"
      }
    });
    fireEvent.submit(document.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend.mock.calls[0]?.[0]).toBe("继续处理");
    });
  });
});

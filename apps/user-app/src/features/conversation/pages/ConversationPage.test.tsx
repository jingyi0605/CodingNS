import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { ConversationPage } from "./ConversationPage";

const mockGetProviderCapabilities = vi.fn();
const mockUseWorkbenchShell = vi.fn();

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args)
  };
});

vi.mock("../components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../components/ConnectionBanner", () => ({
  ConnectionBanner: () => null
}));

vi.mock("../components/MessageTimeline", () => ({
  MessageTimeline: () => null
}));

vi.mock("../components/SessionHeader", () => ({
  SessionHeader: () => null
}));

vi.mock("../components/ComposerPanel", () => ({
  ComposerPanel: ({ capabilities }: { capabilities: { modelOptions?: Array<{ id: string }> } | null }) => (
    <div data-testid="composer-model-options">
      {capabilities?.modelOptions?.map((item) => item.id).join(",") ?? ""}
    </div>
  )
}));

describe("ConversationPage", () => {
  beforeEach(() => {
    mockGetProviderCapabilities.mockReset();
    mockUseWorkbenchShell.mockReset();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });
    window.localStorage.clear();
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [],
      requestNavigationRefresh: vi.fn(),
      setSessionWorkspace: vi.fn(),
      upsertNavigationSession: vi.fn(),
      favoriteSessions: []
    });
  });

  it("草稿会话会按 provider 和 workspace 拉取真实能力，并替换默认模型列表", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [
        {
          id: "provider-default",
          name: "跟随 CLI 默认模型",
          usesProviderDefault: true
        },
        {
          id: "gpt-5.4",
          name: "gpt-5.4"
        }
      ],
      limitations: []
    });

    render(
      <MemoryRouter
        initialEntries={["/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1"]}
      >
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    // 首屏先用草稿兜底能力，避免界面空白。
    expect(screen.getByTestId("composer-model-options")).toHaveTextContent("provider-default");

    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith("codex", "workspace-1");
    });

    await waitFor(() => {
      expect(screen.getByTestId("composer-model-options")).toHaveTextContent(
        "provider-default,gpt-5.4"
      );
    });
  });

  it("移动端点击项目名称仍然按三分之一屏宽打开快捷会话菜单", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    });
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;

    expect(screen.queryByText("历史会话 Alpha")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("shell.showSessionSidebar") }));

    expect(screen.getByText("历史会话 Alpha")).toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(130, 0);
  });

  it("移动端右滑超过阈值后，会一次性打开到三分之一屏宽", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    });
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 20, clientY: 120 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 420, clientY: 126 }]
    });
    fireEvent.touchEnd(stage);

    expect(screen.getByText("历史会话 Alpha")).toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(130, 0);
  });

  it("移动端滑出侧边会话栏时，不会在 touchmove 里调用 preventDefault", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    });
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 20, clientY: 120 }]
    });

    const touchMoveEvent = createEvent.touchMove(stage, {
      touches: [{ clientX: 420, clientY: 126 }]
    });
    const preventDefaultSpy = vi.spyOn(touchMoveEvent, "preventDefault");

    fireEvent(stage, touchMoveEvent);
    fireEvent.touchEnd(stage);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(screen.getByText("历史会话 Alpha")).toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(130, 0);
  });

  it("移动端快速右滑时，会读取抬手位置来稳定触发打开", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    });
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 24, clientY: 120 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 52, clientY: 123 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 92, clientY: 124 }]
    });

    expect(screen.getByText("历史会话 Alpha")).toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(130, 0);
  });

  it("移动端小幅右滑不会误触打开快捷会话菜单", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    });
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 18, clientY: 120 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 60, clientY: 124 }]
    });
    fireEvent.touchEnd(stage);

    expect(screen.queryByText("历史会话 Alpha")).not.toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(0, 0);
  });

  it("快捷会话菜单打开后，额外右滑可以直接扩展到六成屏宽", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    });
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const rail = view.container.querySelector(".mobile-conversation-preview-rail") as HTMLElement;

    fireEvent.touchStart(rail, {
      touches: [{ clientX: 40, clientY: 160 }]
    });
    fireEvent.touchMove(rail, {
      touches: [{ clientX: 110, clientY: 164 }]
    });
    fireEvent.touchEnd(rail);

    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(234, 0);
  });

  it("快捷会话菜单打开后，一次左滑会直接全部收起", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    });
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());

    const view = renderDraftConversationPage();
    const page = view.container.querySelector(".mobile-conversation-page") as HTMLElement;
    const rail = view.container.querySelector(".mobile-conversation-preview-rail") as HTMLElement;

    fireEvent.touchStart(rail, {
      touches: [{ clientX: 100, clientY: 160 }]
    });
    fireEvent.touchMove(rail, {
      touches: [{ clientX: 20, clientY: 164 }]
    });
    fireEvent.touchEnd(rail);

    expect(screen.queryByText("历史会话 Alpha")).not.toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(0, 0);
  });

  it("快捷会话菜单打开后，会话列表区域会被标记为滚动优先", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    });
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());

    const view = renderDraftConversationPage();
    const sessionList = view.container.querySelector(
      ".mobile-conversation-preview-group-workspace .mobile-conversation-preview-list"
    ) as HTMLElement;

    expect(sessionList).toHaveAttribute("data-preview-gesture", "ignore");
  });
});

function renderDraftConversationPage() {
  return render(
    <MemoryRouter
      initialEntries={["/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1"]}
    >
      <Routes>
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={<ConversationPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function createMobileWorkbenchShellValue() {
  const timestamp = "2026-03-28T08:00:00.000Z";

  return {
    shellMode: "mobile",
    navigationGroups: [
      {
        workspace: {
          id: "workspace-1",
          name: "工作区一",
          path: "/Users/jackson/workspace-1"
        },
        sessions: [
          {
            sessionId: "session-1",
            workspaceId: "workspace-1",
            provider: "codex",
            providerSessionId: "provider-session-1",
            rawStoreRef: "codex://session-1",
            parentSessionId: null,
            isSubagent: false,
            subagentLabel: null,
            isArchived: false,
            title: "历史会话 Alpha",
            messageCount: 3,
            lastMessageAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
            syncStatus: "idle",
            syncCursor: null,
            lastSyncAt: null,
            lastErrorCode: null,
            lastErrorDetail: null,
            resumedAt: null,
            runningState: "idle",
            activitySource: "none",
            lastEventAt: null,
            completedAt: null,
            lastSeenAt: null,
            activityState: "idle"
          }
        ]
      }
    ],
    requestNavigationRefresh: vi.fn(),
    setSessionWorkspace: vi.fn(),
    upsertNavigationSession: vi.fn(),
    favoriteSessions: [],
    selectWorkspace: vi.fn()
  };
}

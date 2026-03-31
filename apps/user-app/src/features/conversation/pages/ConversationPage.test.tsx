import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { ConversationPage } from "./ConversationPage";

const mockGetProviderCapabilities = vi.fn();
const mockStartLiveSession = vi.fn();
const mockUseWorkbenchShell = vi.fn();

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args),
    startLiveSession: (...args: unknown[]) => mockStartLiveSession(...args)
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
  ComposerPanel: ({
    capabilities,
    onSend
  }: {
    capabilities: { modelOptions?: Array<{ id: string }> } | null;
    onSend?: (content: string, options?: { attachments?: unknown[]; attachmentMeta?: unknown[] }) => Promise<void>;
  }) => (
    <div>
      <div data-testid="composer-model-options">
        {capabilities?.modelOptions?.map((item) => item.id).join(",") ?? ""}
      </div>
      <button
        type="button"
        data-testid="composer-send"
        onClick={() => {
          void onSend?.("测试消息");
        }}
      >
        send
      </button>
    </div>
  )
}));

describe("ConversationPage", () => {
  beforeEach(() => {
    mockGetProviderCapabilities.mockReset();
    mockStartLiveSession.mockReset();
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

  it("草稿会话创建成功后会以后端返回的真实 workspaceId 作为跳转目标", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "opencode",
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
    mockStartLiveSession.mockResolvedValue({
      sessionId: "session-created-1",
      acceptedAt: "2026-03-30T00:00:00.000Z",
      clientRequestId: "client-request-1",
      provider: "opencode",
      providerSessionId: "provider-session-1",
      message: {
        messageId: "message-1",
        provider: "opencode",
        providerSessionId: "provider-session-1",
        role: "user",
        content: "测试消息",
        timestamp: "2026-03-30T00:00:00.000Z",
        sequence: 1,
        rawRef: "opencode://session/provider-session-1/message/message-1"
      },
      session: {
        sessionId: "session-created-1",
        workspaceId: "workspace-2",
        provider: "opencode",
        providerSessionId: "provider-session-1",
        rawStoreRef: "opencode://session/provider-session-1",
        parentSessionId: null,
        isSubagent: false,
        subagentLabel: null,
        title: "真实会话",
        messageCount: 1,
        lastMessageAt: "2026-03-30T00:00:00.000Z",
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "running",
        activitySource: "runtime",
        lastEventAt: "2026-03-30T00:00:00.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "running"
      }
    });
    const setSessionWorkspace = vi.fn();
    const upsertNavigationSession = vi.fn();
    const requestNavigationRefresh = vi.fn();

    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [],
      requestNavigationRefresh,
      setSessionWorkspace,
      upsertNavigationSession,
      favoriteSessions: []
    });

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/draft-opencode-1?provider=opencode"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={
              <>
                <ConversationPage />
                <RouteProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() => {
      expect(mockStartLiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          provider: "opencode",
          content: "测试消息"
        })
      );
    });

    await waitFor(() => {
      expect(setSessionWorkspace).toHaveBeenCalledWith("session-created-1", "workspace-2");
      expect(upsertNavigationSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-created-1",
          workspaceId: "workspace-2"
        })
      );
      expect(requestNavigationRefresh).toHaveBeenCalled();
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-2/sessions/session-created-1"
      );
    });
  });

  it("移动端点击项目名称会直接按六成屏宽打开快捷会话菜单", async () => {
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

    const initialHideButton = screen.queryByRole("button", {
      name: t("shell.hideSessionSidebar")
    });

    if (initialHideButton) {
      fireEvent.click(initialHideButton);
    }

    expect(screen.queryByText("历史会话 Alpha")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("shell.showSessionSidebar") }));

    expect(screen.getByText("历史会话 Alpha")).toBeInTheDocument();
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(234, 0);
  });

  it("移动端右滑超过阈值后，会一次性打开到六成屏宽", async () => {
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
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(234, 0);
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
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(234, 0);
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
    expect(parseFloat(page.style.getPropertyValue("--mobile-conversation-preview-width"))).toBeCloseTo(234, 0);
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

  it("快捷会话菜单打开后，额外右滑不会再保留额外宽度档位", async () => {
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

  it("移动端快捷会话菜单会显示后端统一裁决后的 stale 状态", async () => {
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
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        runningState: "stale",
        activitySource: "runtime",
        activityResolutionSource: "authoritative_runtime",
        activityState: "idle"
      })
    );

    renderDraftConversationPage();

    expect(screen.getByRole("button", { name: t("shell.hideSessionSidebar") })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: new RegExp(t("conversation.runtimeStale"))
      })
    ).toBeInTheDocument();
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

function createMobileWorkbenchShellValue(sessionOverrides: Record<string, unknown> = {}) {
  const timestamp = "2026-03-28T08:00:00.000Z";
  const session = {
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
    activityState: "idle",
    ...sessionOverrides
  };

  return {
    shellMode: "mobile",
    navigationGroups: [
      {
        workspace: {
          id: "workspace-1",
          name: "工作区一",
          path: "/Users/jackson/workspace-1"
        },
        sessions: [session]
      }
    ],
    requestNavigationRefresh: vi.fn(),
    setSessionWorkspace: vi.fn(),
    upsertNavigationSession: vi.fn(),
    favoriteSessions: [],
    selectWorkspace: vi.fn()
  };
}

function RouteProbe() {
  const location = useLocation();

  return <div data-testid="route-probe">{location.pathname + location.search}</div>;
}

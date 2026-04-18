import type { ReactNode } from "react";

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MobileButlerPage } from "./MobileButlerPage";

const mockUseWorkbenchShell = vi.fn();
const mockShowToast = vi.fn();
const mockGetButlerProfile = vi.fn();
const mockGetButlerOverview = vi.fn();
const mockListButlerFollowUpTasks = vi.fn();
const mockListButlerInboxItems = vi.fn();
const mockListButlerPatrolPlans = vi.fn();
const mockListButlerControlSessions = vi.fn();
const mockListButlerControlTimers = vi.fn();
const mockListAssistantAutomations = vi.fn();
const mockListRecentAssistantAutomationRuns = vi.fn();
const mockRuntimeSendMessage = vi.fn();

const runtimeStateRef: {
  current: ReturnType<typeof createRuntimeState>;
} = {
  current: createRuntimeState("butler-session-1", [
    createAssistantMessage("butler-session-1", "我正在继续推进移动端改造。", "butler-message-1"),
    createAssistantMessage("butler-session-1", "先把滚动恢复问题收口。", "butler-message-2", 2)
  ])
};

vi.mock("../../../shared/toast", () => ({
  useToast: () => ({
    showToast: mockShowToast
  })
}));

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../../mobile-shell/components/MobileWorkspaceSwitcherHeader", () => ({
  MobileWorkspaceSwitcherHeader: ({
    currentWorkspace,
    trailing
  }: {
    currentWorkspace: { name: string; path: string } | null;
    trailing?: ReactNode;
  }) => (
    <div>
      <h1>{currentWorkspace?.name}</h1>
      <p>{currentWorkspace?.path}</p>
      {trailing}
    </div>
  )
}));

vi.mock("../../conversation/components/ComposerPanel", () => ({
  ComposerPanel: () => null
}));

vi.mock("../runtime/butler-runtime-store", () => ({
  ButlerRuntimeStore: class {
    initialize = vi.fn();
    openControlSession = vi.fn();
    startFreshSession = vi.fn();
    sendMessage = mockRuntimeSendMessage;
    retryMessage = vi.fn();
    interrupt = vi.fn();
    loadOlderMessages = vi.fn();
  },
  useButlerRuntimeStore: (
    _store: unknown,
    selector: (state: ReturnType<typeof createRuntimeState>) => unknown
  ) => selector(runtimeStateRef.current)
}));

vi.mock("../api/butler-api", () => ({
  cancelAssistantAutomation: vi.fn(),
  updateAssistantAutomation: vi.fn(),
  cancelButlerControlTimer: vi.fn(),
  cancelButlerFollowUpTask: vi.fn(),
  cancelButlerVerificationRun: vi.fn(),
  getButlerProfile: (...args: unknown[]) => mockGetButlerProfile(...args),
  getButlerOverview: (...args: unknown[]) => mockGetButlerOverview(...args),
  listAssistantAutomations: (...args: unknown[]) => mockListAssistantAutomations(...args),
  listRecentAssistantAutomationRuns: (...args: unknown[]) => mockListRecentAssistantAutomationRuns(...args),
  listButlerFollowUpTasks: (...args: unknown[]) => mockListButlerFollowUpTasks(...args),
  listButlerInboxItems: (...args: unknown[]) => mockListButlerInboxItems(...args),
  listButlerPatrolPlans: (...args: unknown[]) => mockListButlerPatrolPlans(...args),
  listButlerControlSessions: (...args: unknown[]) => mockListButlerControlSessions(...args),
  listButlerControlTimers: (...args: unknown[]) => mockListButlerControlTimers(...args)
}));

vi.mock("../runtime/butler-records-events", () => ({
  subscribeButlerRecordsUpdated: () => () => undefined
}));

describe("MobileButlerPage mobile scroll integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    runtimeStateRef.current = createRuntimeState("butler-session-1", [
      createAssistantMessage("butler-session-1", "我正在继续推进移动端改造。", "butler-message-1"),
      createAssistantMessage("butler-session-1", "先把滚动恢复问题收口。", "butler-message-2", 2)
    ]);

    mockUseWorkbenchShell.mockReturnValue({
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "项目一",
            path: "/repo/project-one"
          },
          sessions: [
            {
              sessionId: "session-1",
              workspaceId: "workspace-1",
              title: "登录页改造"
            }
          ]
        }
      ],
      currentWorkspaceId: "workspace-1",
      revealWorkspaceFile: vi.fn(() => false),
      requestNavigationRefresh: vi.fn(),
      selectWorkspace: vi.fn()
    });

    mockGetButlerProfile.mockResolvedValue({
      initialized: true,
      profile: runtimeStateRef.current.profile
    });
    mockGetButlerOverview.mockResolvedValue({
      overview: {
        version: "overview-1",
        generatedAt: "2026-04-09T10:00:00.000Z",
        global: {
          projectCount: 1,
          activeProjectCount: 1,
          blockedProjectCount: 0,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [
          {
            id: "project-1",
            workspaceId: "workspace-1",
            name: "项目一",
            repoRoot: "/repo/project-one",
            lifecycleStatus: "active",
            riskLevel: "low",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: null,
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-04-09T10:00:00.000Z",
            updatedAt: "2026-04-09T10:00:00.000Z"
          }
        ],
        sessions: [],
        inboxItems: [],
        patrols: [],
        verifications: []
      }
    });
    mockListButlerFollowUpTasks.mockResolvedValue({ items: [] });
    mockListButlerInboxItems.mockResolvedValue({ items: [] });
    mockListButlerPatrolPlans.mockResolvedValue({ items: [] });
    mockListButlerControlSessions.mockResolvedValue({ items: [] });
    mockListButlerControlTimers.mockResolvedValue({ items: [] });
    mockListAssistantAutomations.mockResolvedValue({ payload: { items: [] } });
    mockListRecentAssistantAutomationRuns.mockResolvedValue({ payload: { items: [] } });
  });

  it("移动助手壳层切换真实会话后，恢复的时间线不会再被 3.5 秒强制锁定", async () => {
    const restoreMessageListMetrics = installMessageListMetrics();
    seedConversationScrollState("butler-session-1", 420);
    const view = render(createPageElement());

    try {
      await waitFor(() => {
        expect(view.container.querySelector(".message-list")).not.toBeNull();
      });

      const messageList = view.container.querySelector(".message-list") as HTMLDivElement;

      await waitFor(() => {
        expect(messageList.scrollTop).toBe(420);
      });

      vi.useFakeTimers();

      fireEvent.scroll(messageList, {
        target: {
          scrollTop: 560
        }
      });
      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(messageList.scrollTop).toBe(560);
    } finally {
      vi.useRealTimers();
      restoreMessageListMetrics();
    }
  });
});

function createPageElement() {
  return (
    <MemoryRouter initialEntries={["/workspaces/workspace-1/butler?tab=info"]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/butler"
          element={<MobileButlerPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function seedConversationScrollState(sessionId: string, scrollTop: number) {
  window.localStorage.setItem(
    "codingns.user-app.conversation-scroll",
    JSON.stringify({
      schemaVersion: 1,
      bySessionId: {
        [sessionId]: {
          scrollTop,
          stickToBottom: false,
          lastMessageSignature: null,
          updatedAt: Date.now()
        }
      }
    })
  );
}

function installMessageListMetrics() {
  const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const scrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
  const scrollTopByElement = new WeakMap<HTMLElement, number>();

  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      if (this.classList?.contains("message-list")) {
        return 2000;
      }

      return scrollHeightDescriptor?.get?.call(this) ?? 0;
    }
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      if (this.classList?.contains("message-list")) {
        return 600;
      }

      return clientHeightDescriptor?.get?.call(this) ?? 0;
    }
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get() {
      if (this.classList?.contains("message-list")) {
        return scrollTopByElement.get(this) ?? 0;
      }

      return scrollTopDescriptor?.get?.call(this) ?? 0;
    },
    set(value: number) {
      if (this.classList?.contains("message-list")) {
        scrollTopByElement.set(this, Number.isFinite(value) ? value : 0);
        return;
      }

      scrollTopDescriptor?.set?.call(this, value);
    }
  });

  return () => {
    restorePropertyDescriptor(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
    restorePropertyDescriptor(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
    restorePropertyDescriptor(HTMLElement.prototype, "scrollTop", scrollTopDescriptor);
  };
}

function restorePropertyDescriptor(
  target: typeof HTMLElement.prototype,
  key: "scrollHeight" | "clientHeight" | "scrollTop",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  delete target[key];
}

function createRuntimeState(
  sessionId: string,
  messages: Array<ReturnType<typeof createAssistantMessage>>
) {
  return {
    loading: false,
    initialized: true,
    profile: {
      id: "default",
      displayName: "助手一号",
      providerId: "codex",
      workspacePath: "/repo/project-one",
      agentsMode: "inline",
      agentsFilePath: null,
      agentsContent: "",
      persona: {
        tone: "direct",
        language: "zh-CN",
        summaryStyle: "brief"
      },
      focus: {
        projectIds: [],
        riskPreference: "balanced",
        reportPriority: [],
        summaryDebounceSeconds: 300
      },
      initializedAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:00.000Z"
    },
    activeProvider: "codex",
    controlSession: {
      id: sessionId === "butler-session-1" ? "control-1" : "control-2",
      sessionId,
      title: sessionId === "butler-session-1" ? "继续改移动端" : "另一条助手会话",
      purpose: "chat",
      status: "running",
      updatedAt: "2026-04-09T10:00:00.000Z",
      lastSummary: "继续推进布局调整",
      session: {
        sessionId,
        title: sessionId === "butler-session-1" ? "继续改移动端" : "另一条助手会话",
        workspaceId: "workspace-1",
        runningState: "running",
        activityState: "running"
      }
    },
    capabilities: {
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: false,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [],
      limitations: []
    },
    messages,
    permissionRequests: [],
    historyState: "ready",
    loadingOlderMessages: false,
    hasOlderMessages: false,
    sending: false,
    runtimeHasActiveRun: true,
    runtimeCanInterrupt: true,
    contextUsage: null
  };
}

function createAssistantMessage(
  sessionId: string,
  content: string,
  id: string,
  sequence = 1
) {
  return {
    id,
    sessionId,
    role: "assistant" as const,
    kind: "text" as const,
    content,
    toolCall: null,
    attachments: [],
    attachmentPayloads: null,
    origin: "assistant" as const,
    originRef: null,
    timestamp: `2026-04-09T10:00:0${sequence}.000Z`,
    sequence,
    rawRef: `raw://${id}`,
    deliveryState: "sent" as const,
    clientRequestId: null
  };
}

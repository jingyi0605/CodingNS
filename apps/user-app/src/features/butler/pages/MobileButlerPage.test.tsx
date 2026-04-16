import type { ReactNode } from "react";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
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
const mockCancelButlerControlTimer = vi.fn();
const mockRuntimeState: any = {
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
    id: "control-1",
    sessionId: "butler-session-1",
    title: "继续改移动端",
    purpose: "chat",
    status: "running",
    updatedAt: "2026-04-09T10:00:00.000Z",
    lastSummary: "继续推进布局调整",
    session: {
      sessionId: "butler-session-1",
      title: "继续改移动端",
      runningState: "running"
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
  messages: [
    {
      id: "message-1",
      sessionId: "butler-session-1",
      role: "assistant",
      kind: "text",
      content: "我正在继续推进移动端改造。",
      toolCall: null,
      attachments: [],
      attachmentPayloads: null,
      origin: "assistant",
      originRef: null,
      timestamp: "2026-04-09T10:00:00.000Z",
      sequence: 1,
      rawRef: "raw://message-1",
      deliveryState: "sent",
      clientRequestId: null
    }
  ],
  historyState: "ready",
  runtimeHasActiveRun: true,
  runtimeCanInterrupt: true,
  contextUsage: null
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

vi.mock("../../conversation/components/MessageTimeline", () => ({
  MessageTimeline: ({ messages }: { messages: Array<{ content: string }> }) => (
    <div data-testid="butler-timeline">{messages.map((item) => item.content).join("|")}</div>
  )
}));

vi.mock("../../conversation/components/ComposerPanel", () => ({
  ComposerPanel: () => <div data-testid="butler-composer">composer</div>
}));

vi.mock("../runtime/butler-runtime-store", () => ({
  ButlerRuntimeStore: class {
    initialize = vi.fn();
    openControlSession = vi.fn();
    startFreshSession = vi.fn();
    sendMessage = vi.fn();
    retryMessage = vi.fn();
    interrupt = vi.fn();
  },
  useButlerRuntimeStore: (_store: unknown, selector: (state: typeof mockRuntimeState) => unknown) =>
    selector(mockRuntimeState)
}));

vi.mock("../api/butler-api", () => ({
  cancelButlerControlTimer: (...args: unknown[]) => mockCancelButlerControlTimer(...args),
  getButlerProfile: (...args: unknown[]) => mockGetButlerProfile(...args),
  getButlerOverview: (...args: unknown[]) => mockGetButlerOverview(...args),
  listButlerFollowUpTasks: (...args: unknown[]) => mockListButlerFollowUpTasks(...args),
  listButlerInboxItems: (...args: unknown[]) => mockListButlerInboxItems(...args),
  listButlerPatrolPlans: (...args: unknown[]) => mockListButlerPatrolPlans(...args),
  listButlerControlSessions: (...args: unknown[]) => mockListButlerControlSessions(...args),
  listButlerControlTimers: (...args: unknown[]) => mockListButlerControlTimers(...args)
}));

vi.mock("../runtime/butler-records-events", () => ({
  subscribeButlerRecordsUpdated: () => () => undefined
}));

describe("MobileButlerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeState.runtimeHasActiveRun = true;
    mockRuntimeState.runtimeCanInterrupt = true;

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
              id: "session-follow-1",
              projectId: "project-1",
              sessionId: "session-1",
              provider: "codex",
              title: "登录页改造",
              role: "execution",
              ownershipMode: "managed",
              status: "running",
              runningState: "running",
              lastSummary: null,
              lastCheckpointAt: null,
              lastContextTokenCount: null,
              createdAt: "2026-04-09T10:00:00.000Z",
              updatedAt: "2026-04-09T10:00:00.000Z",
              parentSessionId: null,
              forkedFromSessionId: null,
              forkedAt: null,
              branchLabel: null,
              branchOrder: null,
              workspaceId: "workspace-1",
              workspaceName: "项目一",
              workspacePath: "/repo/project-one"
            }
          ]
        }
      ],
      requestNavigationRefresh: vi.fn(),
      selectWorkspace: vi.fn()
    });
    mockGetButlerProfile.mockResolvedValue({
      initialized: true,
      profile: mockRuntimeState.profile
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
        patrols: [
          {
            id: "patrol-run-history-1",
            projectId: "project-1",
            planId: "plan-2",
            triggeredBy: "scheduler",
            status: "completed",
            riskLevel: "low",
            summary: "旧巡检计划已经完成。",
            suggestions: [],
            startedAt: "2026-04-09T08:00:00.000Z",
            finishedAt: "2026-04-09T08:10:00.000Z",
            createdAt: "2026-04-09T08:00:00.000Z"
          }
        ],
        verifications: [
          {
            id: "verification-1",
            projectId: "project-1",
            verificationType: "test",
            status: "queued",
            targetRef: "pnpm test",
            summary: null,
            startedAt: null,
            finishedAt: null,
            createdAt: "2026-04-09T10:00:00.000Z"
          },
          {
            id: "verification-2",
            projectId: "project-1",
            verificationType: "health",
            status: "running",
            targetRef: "healthcheck",
            summary: null,
            startedAt: "2026-04-09T10:01:00.000Z",
            finishedAt: null,
            createdAt: "2026-04-09T10:01:00.000Z"
          },
          {
            id: "verification-3",
            projectId: "project-1",
            verificationType: "browser",
            status: "completed",
            targetRef: "支付回归",
            summary: "支付回归验证已经完成。",
            startedAt: "2026-04-09T09:40:00.000Z",
            finishedAt: "2026-04-09T09:45:00.000Z",
            createdAt: "2026-04-09T09:40:00.000Z"
          }
        ]
      }
    });
    mockListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目一",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-1",
          sessionTitle: "修复首页布局",
          objective: "补齐移动端摘要",
          completionCriteria: "计数规则统一",
          maxAutoContinueCount: 5,
          status: "active",
          checkIntervalSeconds: 300,
          lastCheckedAt: null,
          nextCheckAt: null,
          lastObservedRunningState: "running",
          lastObservedMessageAt: "2026-04-09T10:00:00.000Z",
          lastObservedMessageCount: 10,
          lastAutomationSummary: "继续推进",
          lastAutomationAt: "2026-04-09T10:00:00.000Z",
          autoContinueCount: 1,
          waitingReason: null,
          rounds: [],
          createdAt: "2026-04-09T09:50:00.000Z",
          updatedAt: "2026-04-09T10:00:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-2",
          projectId: "project-1",
          projectName: "项目一",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-2",
          sessionId: "session-2",
          sessionTitle: "等待你确认",
          objective: "等你回复",
          completionCriteria: "收到确认",
          maxAutoContinueCount: 5,
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: null,
          nextCheckAt: null,
          lastObservedRunningState: "idle",
          lastObservedMessageAt: "2026-04-09T10:00:00.000Z",
          lastObservedMessageCount: 10,
          lastAutomationSummary: "等待输入",
          lastAutomationAt: "2026-04-09T10:00:00.000Z",
          autoContinueCount: 1,
          waitingReason: "等你确认",
          rounds: [],
          createdAt: "2026-04-09T09:40:00.000Z",
          updatedAt: "2026-04-09T10:00:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-3",
          projectId: "project-1",
          projectName: "项目一",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-3",
          sessionId: "session-3",
          sessionTitle: "历史收尾任务",
          objective: "只该在历史里显示",
          completionCriteria: "历史任务完成",
          maxAutoContinueCount: 3,
          status: "completed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-09T09:20:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-09T09:20:00.000Z",
          lastObservedMessageCount: 6,
          lastAutomationSummary: "历史任务已完成。",
          lastAutomationAt: "2026-04-09T09:20:00.000Z",
          autoContinueCount: 1,
          waitingReason: null,
          rounds: [
            {
              roundNumber: 1,
              kind: "completed",
              status: "completed",
              summary: "历史任务已完成。",
              waitingReason: null,
              continuePrompt: null,
              observedRunningState: "completed",
              autoContinueCount: 1,
              createdAt: "2026-04-09T09:20:00.000Z"
            }
          ],
          createdAt: "2026-04-09T09:00:00.000Z",
          updatedAt: "2026-04-09T09:20:00.000Z",
          completedAt: "2026-04-09T09:20:00.000Z"
        }
      ]
    });
    mockListButlerInboxItems.mockResolvedValue({
      items: [
        {
          id: "inbox-1",
          projectId: "project-1",
          workspaceId: "workspace-1",
          projectName: "项目一",
          projectLifecycleStatus: "active",
          itemType: "task",
          title: "确认验证结果",
          content: "看下运行输出",
          priority: "medium",
          status: "pending",
          assistantState: {
            lifecycleStage: "pending",
            analysisSummary: null,
            generatedPrompt: null,
            analysisControlSessionId: null,
            analysisSessionId: null,
            linkedButlerSessionId: null,
            linkedSessionId: null,
            linkedFollowUpTaskId: null,
            lastError: null,
            lastAnalyzedAt: null,
            lastSessionCreatedAt: null,
            lastFollowUpAt: null
          },
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:00.000Z",
          closedAt: null
        }
      ]
    });
    mockListButlerPatrolPlans.mockResolvedValue({
      items: [
        {
          id: "plan-1",
          projectId: "project-1",
          name: "夜间巡视",
          enabled: true,
          triggerType: "interval",
          intervalMinutes: 30,
          cronExpression: null,
          nextRunAt: "2026-04-10T00:00:00.000Z",
          lastScheduledAt: "2026-04-09T23:30:00.000Z",
          createdAt: "2026-04-09T09:00:00.000Z",
          updatedAt: "2026-04-09T09:00:00.000Z"
        },
        {
          id: "plan-2",
          projectId: "project-1",
          name: "旧巡检计划",
          enabled: false,
          triggerType: "interval",
          intervalMinutes: 60,
          cronExpression: null,
          nextRunAt: null,
          lastScheduledAt: "2026-04-09T08:00:00.000Z",
          createdAt: "2026-04-09T08:00:00.000Z",
          updatedAt: "2026-04-09T08:00:00.000Z"
        }
      ]
    });
    mockListButlerControlSessions.mockResolvedValue({
      items: [
        {
          id: "control-1",
          sessionId: "butler-session-1",
          title: "继续改移动端",
          purpose: "chat",
          status: "running",
          updatedAt: "2026-04-09T10:00:00.000Z",
          lastSummary: "继续推进布局调整",
          session: {
            sessionId: "butler-session-1",
            title: "继续改移动端",
            runningState: "running"
          }
        }
      ]
    });
    mockListButlerControlTimers.mockResolvedValue({
      items: [
        {
          id: "timer-1",
          controlSessionId: "control-1",
          sessionId: "butler-session-1",
          userId: "user-1",
          projectId: "project-1",
          targetSessionId: "session-1",
          title: "4 分钟后继续看结果",
          content: "请在 4 分钟后重新检查移动端布局，然后继续这个真实会话。",
          dueAt: "2099-04-09T10:05:00.000Z",
          status: "active",
          triggeredAt: null,
          lastError: null,
          createdAt: "2099-04-09T10:00:00.000Z",
          updatedAt: "2099-04-09T10:00:00.000Z",
          cancelledAt: null,
          controlSession: {
            id: "control-1",
            sessionId: "butler-session-1",
            title: "继续改移动端",
            purpose: "chat",
            status: "running",
            updatedAt: "2099-04-09T10:00:00.000Z",
            lastSummary: "继续推进布局调整",
            session: {
              sessionId: "butler-session-1",
              title: "继续改移动端",
              workspaceId: "workspace-1",
              runningState: "running"
            }
          }
        }
      ]
    });
    mockCancelButlerControlTimer.mockResolvedValue({
      timer: {
        id: "timer-1",
        controlSessionId: "control-1",
        sessionId: "butler-session-1",
        userId: "user-1",
        projectId: "project-1",
        targetSessionId: "session-1",
        title: "4 分钟后继续看结果",
        content: "请在 4 分钟后重新检查移动端布局，然后继续这个真实会话。",
        dueAt: "2099-04-09T10:05:00.000Z",
        status: "cancelled",
        triggeredAt: null,
        lastError: null,
        createdAt: "2099-04-09T10:00:00.000Z",
        updatedAt: "2099-04-09T10:01:00.000Z",
        cancelledAt: "2099-04-09T10:01:00.000Z",
        controlSession: {
          id: "control-1",
          sessionId: "butler-session-1",
          title: "继续改移动端",
          purpose: "chat",
          status: "running",
          updatedAt: "2099-04-09T10:00:00.000Z",
          lastSummary: "继续推进布局调整",
          session: {
            sessionId: "butler-session-1",
            title: "继续改移动端",
            workspaceId: "workspace-1",
            runningState: "running"
          }
        }
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("首次渲染时先显示助手加载动画，不提前显示未准备好文案", () => {
    renderPage();

    expect(screen.getByText(t("shell.butlerLoadingTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.butlerLoadingDescription"))).toBeInTheDocument();
    expect(screen.queryByText(t("shell.mobileButlerEmptyTitle"))).not.toBeInTheDocument();
  });

  it("右滑主内容会打开助手会话列表", async () => {
    const view = renderPage();
    const stage = view.container.querySelector(".mobile-butler-main-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 48, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 156, clientY: 186 }]
    });

    expect(await screen.findByText("继续改移动端")).toBeInTheDocument();
    expect(screen.getByText("继续推进布局调整")).toBeInTheDocument();
    expect(screen.queryByTestId("butler-composer")).not.toBeInTheDocument();
  });

  it("左滑主内容会打开右侧信息栏，并只保留记录类内容", async () => {
    const view = renderPage();
    const stage = view.container.querySelector(".mobile-butler-main-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 300, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 168, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.getByText(t("shell.butlerInfoFollowUpRecordsTitle"))).toBeInTheDocument();
      expect(screen.getByText(t("shell.butlerInfoVerificationRecordsTitle"))).toBeInTheDocument();
      expect(screen.getByText(t("shell.butlerInfoTodoRecordsTitle"))).toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: t("shell.butlerFollowUpHistoryAction") }).length
      ).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText(t("shell.mobileButlerSummaryTitle"))).not.toBeInTheDocument();
      expect(screen.queryByText(t("shell.mobileButlerAssistantWorkspaceLabel"))).not.toBeInTheDocument();
      expect(screen.getByText("确认验证结果")).toBeInTheDocument();
      expect(screen.getByText(`${"项目一"} · ${t("shell.butlerInfoTodoPending")}`)).toBeInTheDocument();
    });
  });

  it("信息栏的会话验证主列表只显示进行中记录，历史通过查看历史打开", async () => {
    const view = renderPage();
    const stage = view.container.querySelector(".mobile-butler-main-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 300, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 168, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.getByText("pnpm test")).toBeInTheDocument();
      expect(screen.queryByText("支付回归")).not.toBeInTheDocument();
    });

    const verificationSection = screen
      .getByText(t("shell.butlerInfoVerificationRecordsTitle"))
      .closest("section") as HTMLElement;

    fireEvent.click(within(verificationSection).getByRole("button", {
      name: t("shell.butlerFollowUpHistoryAction")
    }));

    await waitFor(() => {
      expect(screen.getByText(t("shell.butlerVerificationHistoryTitle"))).toBeInTheDocument();
      expect(screen.getByText("支付回归")).toBeInTheDocument();
      expect(screen.getByText("支付回归验证已经完成。")).toBeInTheDocument();
    });
  });

  it("右侧信息栏内继续左滑会在信息、自动化、设置之间切换", async () => {
    const view = renderPage({ withRouteProbe: true });
    const stage = view.container.querySelector(".mobile-butler-main-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 300, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 168, clientY: 186 }]
    });

    const sidebar = await waitFor(() =>
      view.container.querySelector(".mobile-butler-drawer-sidebar") as HTMLElement
    );

    fireEvent.touchStart(sidebar, {
      changedTouches: [{ clientX: 300, clientY: 180 }]
    });
    fireEvent.touchEnd(sidebar, {
      changedTouches: [{ clientX: 168, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Automation" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("route-probe")).toHaveTextContent("?tab=automation");
    });

    fireEvent.touchStart(sidebar, {
      changedTouches: [{ clientX: 300, clientY: 180 }]
    });
    fireEvent.touchEnd(sidebar, {
      changedTouches: [{ clientX: 168, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("route-probe")).toHaveTextContent("?tab=settings");
    });
  });

  it("助手聊天区不再保留额外标头和外层卡片，打开抽屉时会隐藏输入框", async () => {
    const view = renderPage();

    expect(view.container.querySelector(".mobile-butler-chat-card")).toBeNull();
    expect(view.container.querySelector(".mobile-butler-chat-header")).toBeNull();
    expect(screen.getByText("助手一号")).toBeInTheDocument();
    expect(await screen.findByTestId("butler-composer")).toBeInTheDocument();

    const stage = view.container.querySelector(".mobile-butler-main-stage") as HTMLElement;
    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 300, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 168, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.queryByTestId("butler-composer")).not.toBeInTheDocument();
    });
  });

  it("聊天区底部会显示等待中的计时器，并且自动化页可以取消", async () => {
    mockRuntimeState.runtimeHasActiveRun = false;
    const view = renderPage();

    await waitFor(() => {
      expect(view.container.querySelector(".mobile-butler-timer-countdown")?.textContent).toMatch(/\S/);
    });
    expect(screen.getByText(t("shell.butlerControlTimerWorkspaceLabel"))).toBeInTheDocument();
    expect(screen.getAllByText("项目一").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(t("shell.butlerControlTimerSessionLabel"))).toBeInTheDocument();
    expect(screen.getByText("登录页改造")).toBeInTheDocument();
    expect(
      screen.queryByText("请在 4 分钟后重新检查移动端布局，然后继续这个真实会话。")
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: t("shell.butlerControlTimerDetailAction") })
    );

    expect(screen.getByText(t("shell.butlerControlTimerPromptTitle"))).toBeInTheDocument();
    expect(
      screen.getByText("请在 4 分钟后重新检查移动端布局，然后继续这个真实会话。")
    ).toBeInTheDocument();

    const stage = view.container.querySelector(".mobile-butler-main-stage") as HTMLElement;
    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 300, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 168, clientY: 186 }]
    });

    const automationTab = await screen.findByRole("tab", { name: "Automation" });
    fireEvent.click(automationTab);

    const cancelButtons = await screen.findAllByRole("button", {
      name: t("shell.butlerControlTimerCancelAction")
    });
    fireEvent.click(cancelButtons[0]!);

    await waitFor(() => {
      expect(mockCancelButlerControlTimer).toHaveBeenCalledWith("timer-1");
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t("shell.butlerControlTimerCancelSucceeded"),
          tone: "success"
        })
      );
    });
  });

  it("自动化页主列表只显示进行中的自动化，历史通过查看历史打开", async () => {
    const view = renderPage();
    const stage = view.container.querySelector(".mobile-butler-main-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 300, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 168, clientY: 186 }]
    });

    const automationTab = await screen.findByRole("tab", { name: "Automation" });
    fireEvent.click(automationTab);

    await waitFor(() => {
      expect(screen.getByText("夜间巡视")).toBeInTheDocument();
      expect(screen.getByText("修复首页布局")).toBeInTheDocument();
      expect(screen.queryByText("历史收尾任务")).not.toBeInTheDocument();
      expect(screen.queryByText("旧巡检计划已经完成。")).not.toBeInTheDocument();
    });

    const automationSection = screen
      .getByText(t("shell.butlerAutomationTasksTitle"))
      .closest("section") as HTMLElement;

    fireEvent.click(within(automationSection).getByRole("button", {
      name: t("shell.butlerFollowUpHistoryAction")
    }));

    await waitFor(() => {
      expect(screen.getByText(t("shell.butlerAutomationHistoryTitle"))).toBeInTheDocument();
      expect(screen.getAllByText(/历史收尾任务/).length).toBeGreaterThan(0);
      expect(screen.getByText(/历史任务已完成。/)).toBeInTheDocument();
      expect(screen.getByText(/旧巡检计划已经完成。/)).toBeInTheDocument();
    });
  });
});

function renderPage(options?: { withRouteProbe?: boolean }) {
  return render(
    <MemoryRouter initialEntries={["/workspaces/workspace-1/butler?tab=info"]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/butler"
          element={
            <>
              <MobileButlerPage />
              {options?.withRouteProbe ? <RouteProbe /> : null}
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route-probe">{location.pathname + location.search}</div>;
}

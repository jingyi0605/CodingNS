import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";

const setAuxiliaryPanelMock = vi.hoisted(() => vi.fn());

vi.mock("../../conversation/components/ComposerPanel", () => ({
  ComposerPanel: ({
    isSubmitting,
    onSend,
    placeholder
  }: {
    isSubmitting?: boolean;
    onSend?: (content: string) => Promise<void>;
    placeholder?: string;
  }) => (
    <div>
      <div data-testid="butler-composer-placeholder">{placeholder}</div>
      <button
        type="button"
        data-testid="butler-composer-send"
        disabled={isSubmitting}
        onClick={() => {
          void onSend?.("测试输入");
        }}
      >
        发送
      </button>
    </div>
  )
}));

vi.mock("../../conversation/components/MessageTimeline", () => ({
  MessageTimeline: ({
    assistantAvatar,
    hasOlderMessages,
    loadingOlderMessages,
    onLoadOlderMessages
  }: {
    assistantAvatar?: unknown;
    hasOlderMessages?: boolean;
    loadingOlderMessages?: boolean;
    onLoadOlderMessages?: () => void;
  }) => (
    <div>
      <div data-testid="butler-message-timeline">{assistantAvatar as never}</div>
      <div data-testid="butler-message-has-older">{String(Boolean(hasOlderMessages))}</div>
      <div data-testid="butler-message-loading-older">{String(Boolean(loadingOlderMessages))}</div>
      <button type="button" data-testid="butler-load-older" onClick={() => onLoadOlderMessages?.()}>
        加载更早消息
      </button>
    </div>
  )
}));

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => ({
    requestNavigationRefresh: vi.fn(),
    setAuxiliaryPanel: setAuxiliaryPanelMock
  })
}));

vi.mock("../../../shared/toast", () => ({
  useToast: vi.fn()
}));

vi.mock("../../conversation/api/conversation-api", () => ({
  getProviderCapabilities: vi.fn(),
  getSessionCapabilities: vi.fn(),
  getSessionRuntime: vi.fn()
}));

vi.mock("../api/butler-api", () => ({
  getButlerProfile: vi.fn(),
  initButlerProfile: vi.fn(),
  updateButlerProfile: vi.fn(),
  getButlerOverview: vi.fn(),
  cancelButlerFollowUpTask: vi.fn(),
  getButlerFollowUpTask: vi.fn(),
  listButlerPatrolPlans: vi.fn(),
  listButlerFollowUpTasks: vi.fn(),
  listButlerInboxItems: vi.fn(),
  listButlerControlEvents: vi.fn(),
  getCurrentButlerControlSession: vi.fn(),
  resetButlerControlSession: vi.fn(),
  startButlerControlSession: vi.fn(),
  sendButlerControlMessage: vi.fn()
}));

import { useToast } from "../../../shared/toast";
import { ButlerPage } from "./ButlerPage";
import {
  getButlerProfile,
  initButlerProfile,
  updateButlerProfile,
  getButlerOverview,
  cancelButlerFollowUpTask,
  getButlerFollowUpTask,
  listButlerPatrolPlans,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerControlEvents,
  getCurrentButlerControlSession,
  resetButlerControlSession,
  startButlerControlSession
} from "../api/butler-api";
import {
  getProviderCapabilities,
  getSessionCapabilities,
  getSessionRuntime
} from "../../conversation/api/conversation-api";

const mockedUseToast = vi.mocked(useToast);
const mockedGetButlerProfile = vi.mocked(getButlerProfile);
const mockedInitButlerProfile = vi.mocked(initButlerProfile);
const mockedUpdateButlerProfile = vi.mocked(updateButlerProfile);
const mockedGetButlerOverview = vi.mocked(getButlerOverview);
const mockedCancelButlerFollowUpTask = vi.mocked(cancelButlerFollowUpTask);
const mockedGetButlerFollowUpTask = vi.mocked(getButlerFollowUpTask);
const mockedListButlerPatrolPlans = vi.mocked(listButlerPatrolPlans);
const mockedListButlerFollowUpTasks = vi.mocked(listButlerFollowUpTasks);
const mockedListButlerInboxItems = vi.mocked(listButlerInboxItems);
const mockedListButlerControlEvents = vi.mocked(listButlerControlEvents);
const mockedGetCurrentButlerControlSession = vi.mocked(getCurrentButlerControlSession);
const mockedResetButlerControlSession = vi.mocked(resetButlerControlSession);
const mockedStartButlerControlSession = vi.mocked(startButlerControlSession);
const mockedGetProviderCapabilities = vi.mocked(getProviderCapabilities);
const mockedGetSessionCapabilities = vi.mocked(getSessionCapabilities);
const mockedGetSessionRuntime = vi.mocked(getSessionRuntime);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("ButlerPage", () => {
  const showToastMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setAuxiliaryPanelMock.mockReset();
    mockedUseToast.mockReturnValue({
      showToast: showToastMock,
      dismissToast: vi.fn()
    } as never);

    mockedGetButlerProfile.mockResolvedValue({
      initialized: false,
      profile: null
    });
    mockedInitButlerProfile.mockResolvedValue({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedUpdateButlerProfile.mockResolvedValue({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "file",
        agentsFilePath: "/tmp/butler/AGENTS.md",
        agentsContent: "# AGENTS.md\n初始规则",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedGetButlerOverview.mockResolvedValue({
      overview: {
        version: "v1",
        generatedAt: "2026-04-05T00:00:00.000Z",
        global: {
          projectCount: 3,
          activeProjectCount: 2,
          blockedProjectCount: 1,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [],
        sessions: [],
        patrols: [],
        verifications: []
      }
    });
    mockedCancelButlerFollowUpTask.mockResolvedValue({
      task: {} as never
    });
    mockedGetButlerFollowUpTask.mockResolvedValue({
      task: {
        id: "follow-up-1",
        projectId: "project-1",
        projectName: "项目甲",
        workspaceId: "workspace-1",
        butlerSessionId: "butler-session-1",
        sessionId: "session-1",
        sessionTitle: "登录页开发",
        objective: "把验证码功能真正做完",
        completionCriteria: "当验证码流程和回归验证都完成后停止。",
        maxAutoContinueCount: 5,
        status: "waiting_user",
        checkIntervalSeconds: 300,
        lastCheckedAt: "2026-04-07T01:00:00.000Z",
        nextCheckAt: null,
        lastObservedRunningState: "completed",
        lastObservedMessageAt: "2026-04-07T01:00:00.000Z",
        lastObservedMessageCount: 12,
        lastAutomationSummary: "当前需要你确认验证码失败策略。",
        lastAutomationAt: "2026-04-07T01:02:00.000Z",
        autoContinueCount: 1,
        waitingReason: "需要你确认失败策略。",
        rounds: [
          {
            roundNumber: 1,
            kind: "started",
            status: "active",
            summary: "已开始跟进，准备由后台评估助手检查当前进展。默认最多自动推进 5 轮。",
            waitingReason: null,
            continuePrompt: null,
            observedRunningState: "completed",
            autoContinueCount: 0,
            createdAt: "2026-04-07T00:50:00.000Z"
          },
          {
            roundNumber: 2,
            kind: "waiting_user",
            status: "waiting_user",
            summary: "当前需要你确认验证码失败策略。",
            waitingReason: "需要你确认失败策略。",
            continuePrompt: null,
            observedRunningState: "completed",
            autoContinueCount: 1,
            createdAt: "2026-04-07T01:02:00.000Z"
          }
        ],
        createdAt: "2026-04-07T00:50:00.000Z",
        updatedAt: "2026-04-07T01:02:00.000Z",
        completedAt: null
      }
    });
    mockedListButlerPatrolPlans.mockResolvedValue({
      items: []
    });
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: []
    });
    mockedListButlerInboxItems.mockResolvedValue({
      items: []
    });
    mockedListButlerControlEvents.mockResolvedValue({ items: [] });
    mockedGetCurrentButlerControlSession.mockResolvedValue({ controlSession: null });
    mockedResetButlerControlSession.mockResolvedValue({ controlSession: null } as never);
    mockedStartButlerControlSession.mockResolvedValue({
      controlSession: {
        id: "ctrl-start",
        providerId: "codex",
        sessionId: "session-control-1",
        status: "running",
        lastContextVersion: null,
        lastSummary: null,
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        session: {
          sessionId: "session-control-1"
        }
      }
    } as never);
    mockedGetProviderCapabilities.mockResolvedValue({
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
      supportsQueueWhileRunning: false,
      supportsRunSteering: false,
      supportsSlashMenu: false,
      supportsReasoningSelector: true,
      modelOptions: [{ id: "provider-default", name: "provider-default", usesProviderDefault: true }],
      defaultReasoningLevel: null,
      limitations: []
    });
    mockedGetSessionCapabilities.mockResolvedValue({
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
      supportsQueueWhileRunning: false,
      supportsRunSteering: false,
      supportsSlashMenu: false,
      supportsReasoningSelector: true,
      modelOptions: [{ id: "provider-default", name: "provider-default", usesProviderDefault: true }],
      defaultReasoningLevel: null,
      limitations: []
    });
    mockedGetSessionRuntime.mockResolvedValue({
      sessionId: "session-control-1",
      runningState: "idle",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: true,
      inRunInputMode: "none",
      provider: "codex",
      providerSessionId: "provider-control-1",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      detail: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-04-05T00:00:00.000Z",
      watchdogTriggeredAt: null,
      contextUsage: null
    } as never);
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/butler"]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/butler" element={<ButlerPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  function getLatestSidePanel() {
    const latestSidePanel = setAuxiliaryPanelMock.mock.calls.at(-1)?.[0];
    expect(latestSidePanel).toBeTruthy();
    return latestSidePanel;
  }

  it("首次加载时先显示动态加载态，不提前闪初始化表单", async () => {
    const profileDeferred = createDeferred<Awaited<ReturnType<typeof getButlerProfile>>>();
    mockedGetButlerProfile.mockReturnValueOnce(profileDeferred.promise);

    renderPage();

    expect(screen.getByText(t("shell.butlerLoadingTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.butlerLoadingDescription"))).toBeInTheDocument();
    expect(screen.queryByText(t("shell.butlerInitTitle"))).not.toBeInTheDocument();

    await act(async () => {
      profileDeferred.resolve({
        initialized: false,
        profile: null
      });
      await profileDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByText(t("shell.butlerInitTitle"))).toBeInTheDocument();
    });
  });

  it("未初始化时展示表单并校验必填字段", async () => {
    renderPage();

    await waitFor(() => {
      expect(mockedGetButlerProfile).toHaveBeenCalled();
    });

    expect(screen.getByText(t("shell.butlerInitTitle"))).toBeInTheDocument();
    expect(screen.getByPlaceholderText(t("shell.butlerDisplayNamePlaceholder"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.butlerAgentsModeLabel"))).toBeInTheDocument();
    expect(screen.queryByText(t("shell.butlerWorkspacePathLabel"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.butlerAgentsFilePathLabel"))).not.toBeInTheDocument();
    expect(screen.queryByText("AGENTS 规则内容")).not.toBeInTheDocument();

    const submitButton = screen.getByRole("button", { name: t("shell.butlerInitSubmit") });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t("shell.butlerInitNameRequired"),
          tone: "warning"
        })
      );
    });

    fireEvent.change(screen.getByPlaceholderText(t("shell.butlerDisplayNamePlaceholder")), {
      target: {
        value: "阿尔文"
      }
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockedInitButlerProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "阿尔文"
        })
      );
    });
  });

  it("初始化后展示聚合概览和控制事件", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });

    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v2",
        generatedAt: "2026-04-05T00:00:00.000Z",
        global: {
          projectCount: 5,
          activeProjectCount: 3,
          blockedProjectCount: 2,
          highRiskProjectCount: 1,
          topRisks: ["风险 A"],
          nextActions: ["跟进 B"]
        },
        projects: [],
        sessions: [],
        patrols: [],
        verifications: []
      }
    });

    mockedListButlerControlEvents.mockResolvedValueOnce({
      items: [
        {
          id: "event-1",
          controlSessionId: "ctrl-1",
          kind: "action",
          actionType: "open-project",
          status: "succeeded",
          title: "打开项目：Alpha",
          content: "内容",
          relatedRefs: [],
          createdAt: "2026-04-05T00:00:00.000Z"
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      expect(setAuxiliaryPanelMock).toHaveBeenCalled();
      expect(
        screen.getByText(t("shell.butlerComposerPlaceholder", { displayName: "阿尔文" }))
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("在这里与助手对话，并查看聚合上下文和动作事件。")).not.toBeInTheDocument();
    expect(screen.queryByText("当前助手称呼：阿尔文")).not.toBeInTheDocument();
    expect(screen.queryByText("按需上下文")).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.butlerOverviewTitle"))).not.toBeInTheDocument();
  });

  it("工作台会显示助手头像并支持新建控制会话", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("shell.butlerNewSessionAction") })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: t("shell.butlerProviderLabel") })).toBeInTheDocument();
    });

    expect(screen.getByTestId("butler-message-timeline")).toHaveTextContent(/\S/);

    fireEvent.click(screen.getByRole("button", { name: t("shell.butlerNewSessionAction") }));

    await waitFor(() => {
      expect(mockedResetButlerControlSession).toHaveBeenCalledTimes(1);
      expect(mockedStartButlerControlSession).not.toHaveBeenCalled();
      expect(showToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t("shell.butlerNewSessionStarted"),
          tone: "success"
        })
      );
    });
  });

  it("悬浮助手名称时会显示最近的助手分析", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目甲",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-1",
          sessionTitle: "登录页开发",
          objective: "完成当前 spec 的必做项",
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: null,
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: null,
          lastObservedMessageCount: 10,
          lastAutomationSummary: "当前需要你确认验证码失败策略。",
          lastAutomationAt: null,
          autoContinueCount: 1,
          waitingReason: "需要你确认失败策略。",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:05:00.000Z",
          completedAt: null
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "阿尔文" })).toBeInTheDocument();
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          followUpTasks?: unknown[];
        };
      };
      expect(latestSidePanel.props.followUpTasks).toHaveLength(1);
    });

    fireEvent.mouseEnter(screen.getByRole("heading", { name: "阿尔文" }));

    await waitFor(() => {
      expect(screen.getByText(t("conversation.butlerAnalysisTitle"))).toBeInTheDocument();
      expect(screen.getByText(/完成当前 spec 的必做项/)).toBeInTheDocument();
    });
  });

  it("信息页展示全局的会话跟进、会话验证和代办进度记录", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v4",
        generatedAt: "2026-04-05T00:00:00.000Z",
        global: {
          projectCount: 3,
          activeProjectCount: 3,
          blockedProjectCount: 1,
          highRiskProjectCount: 1,
          topRisks: [],
          nextActions: ["补齐验证码流程", "跟进登录异常"]
        },
        projects: [
          {
            id: "project-normal",
            workspaceId: "workspace-1",
            name: "普通项目",
            repoRoot: "/repo/project-normal",
            lifecycleStatus: "active",
            riskLevel: "low",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: "普通摘要",
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: [],
            nextActions: [],
            lastActivityAt: "2026-04-05T08:00:00.000Z",
            updatedAt: "2026-04-05T08:00:00.000Z"
          },
          {
            id: "project-risk",
            workspaceId: "workspace-1",
            name: "高风险项目",
            repoRoot: "/repo/project-risk",
            lifecycleStatus: "active",
            riskLevel: "high",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: "高风险摘要",
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: ["高风险"],
            nextActions: [],
            lastActivityAt: "2026-04-05T07:00:00.000Z",
            updatedAt: "2026-04-05T07:00:00.000Z"
          },
          {
            id: "project-blocked",
            workspaceId: "workspace-1",
            name: "阻塞项目",
            repoRoot: "/repo/project-blocked",
            lifecycleStatus: "active",
            riskLevel: "medium",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 0,
            failedPatrolCount: 1,
            failedVerificationCount: 0,
            latestSessionSummary: "阻塞摘要",
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: ["有阻塞"],
            nextActions: [],
            lastActivityAt: "2026-04-05T06:00:00.000Z",
            updatedAt: "2026-04-05T06:00:00.000Z"
          }
        ],
        sessions: [
          {
            id: "session-follow-1",
            projectId: "project-normal",
            sessionId: "session-1",
            provider: "codex",
            title: "登录页改造",
            role: "execution",
            ownershipMode: "managed",
            status: "running",
            runningState: "running",
            lastSummary: "验证码流程还在收尾。",
            lastCheckpointAt: null,
            progressState: "working",
            riskFlags: [],
            nextActions: [],
            updatedAt: "2026-04-05T09:00:00.000Z",
            createdAt: "2026-04-05T08:30:00.000Z"
          }
        ],
        patrols: [],
        verifications: [
          {
            id: "verification-1",
            projectId: "project-normal",
            verificationType: "browser",
            status: "running",
            targetRef: "登录验证码",
            summary: "正在从用户视角复测登录流程。",
            startedAt: "2026-04-05T09:10:00.000Z",
            finishedAt: null,
            createdAt: "2026-04-05T09:10:00.000Z"
          }
        ]
      }
    });
    mockedListButlerInboxItems.mockResolvedValue({
      items: [
        {
          id: "todo-1",
          projectId: "project-normal",
          projectName: "普通项目",
          workspaceId: "workspace-1",
          projectLifecycleStatus: "active",
          itemType: "task",
          title: "补齐验证码流程",
          content: "继续把登录页验证码流程收尾。",
          priority: "medium",
          status: "in_progress",
          createdAt: "2026-04-05T08:40:00.000Z",
          updatedAt: "2026-04-05T09:20:00.000Z",
          closedAt: null
        }
      ]
    });
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-info-1",
          projectId: "project-normal",
          projectName: "普通项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-1",
          sessionId: "session-1",
          sessionTitle: "登录页改造",
          objective: "继续把登录页收尾",
          completionCriteria: "登录页功能完成且验证通过。",
          maxAutoContinueCount: 5,
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T09:05:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-05T09:05:00.000Z",
          lastObservedMessageCount: 16,
          lastAutomationSummary: "验证码流程还在收尾。",
          lastAutomationAt: "2026-04-05T09:05:00.000Z",
          autoContinueCount: 1,
          waitingReason: "需要确认验证码失败策略。",
          createdAt: "2026-04-05T08:30:00.000Z",
          updatedAt: "2026-04-05T09:05:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-info-2",
          projectId: "project-normal",
          projectName: "普通项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-2",
          sessionId: "session-2",
          sessionTitle: "注册页改造",
          objective: "继续把注册页收尾",
          completionCriteria: "注册页功能完成且验证通过。",
          maxAutoContinueCount: 5,
          status: "active",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T08:55:00.000Z",
          nextCheckAt: "2026-04-05T09:10:00.000Z",
          lastObservedRunningState: "running",
          lastObservedMessageAt: "2026-04-05T08:55:00.000Z",
          lastObservedMessageCount: 9,
          lastAutomationSummary: "正在继续观察注册页收尾进度。",
          lastAutomationAt: "2026-04-05T08:55:00.000Z",
          autoContinueCount: 1,
          waitingReason: null,
          createdAt: "2026-04-05T08:20:00.000Z",
          updatedAt: "2026-04-05T08:55:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-info-3",
          projectId: "project-blocked",
          projectName: "阻塞项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-3",
          sessionId: "session-3",
          sessionTitle: "支付流程修复",
          objective: "排查支付流程阻塞",
          completionCriteria: "支付流程恢复可用。",
          maxAutoContinueCount: 5,
          status: "failed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T08:45:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "failed",
          lastObservedMessageAt: "2026-04-05T08:45:00.000Z",
          lastObservedMessageCount: 11,
          lastAutomationSummary: "支付流程仍然卡在第三方回调。",
          lastAutomationAt: "2026-04-05T08:45:00.000Z",
          autoContinueCount: 2,
          waitingReason: null,
          createdAt: "2026-04-05T08:00:00.000Z",
          updatedAt: "2026-04-05T08:45:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-info-4",
          projectId: "project-normal",
          projectName: "普通项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-4",
          sessionId: "session-4",
          sessionTitle: "设置页收尾",
          objective: "补齐设置页边角问题",
          completionCriteria: "设置页问题全部关闭。",
          maxAutoContinueCount: 5,
          status: "completed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T08:35:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-05T08:35:00.000Z",
          lastObservedMessageCount: 8,
          lastAutomationSummary: "设置页收尾已完成。",
          lastAutomationAt: "2026-04-05T08:35:00.000Z",
          autoContinueCount: 2,
          waitingReason: null,
          createdAt: "2026-04-05T07:50:00.000Z",
          updatedAt: "2026-04-05T08:35:00.000Z",
          completedAt: "2026-04-05T08:35:00.000Z"
        },
        {
          id: "follow-up-info-5",
          projectId: "project-risk",
          projectName: "高风险项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-5",
          sessionId: "session-5",
          sessionTitle: "监控告警治理",
          objective: "梳理告警噪音",
          completionCriteria: "告警规则恢复稳定。",
          maxAutoContinueCount: 5,
          status: "cancelled",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T08:20:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-05T08:20:00.000Z",
          lastObservedMessageCount: 6,
          lastAutomationSummary: "该跟进已被手动停止。",
          lastAutomationAt: "2026-04-05T08:20:00.000Z",
          autoContinueCount: 1,
          waitingReason: null,
          createdAt: "2026-04-05T07:40:00.000Z",
          updatedAt: "2026-04-05T08:20:00.000Z",
          completedAt: "2026-04-05T08:20:00.000Z"
        },
        {
          id: "follow-up-info-6",
          projectId: "project-risk",
          projectName: "高风险项目",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-info-6",
          sessionId: "session-6",
          sessionTitle: "旧历史任务",
          objective: "这个任务只该出现在历史里",
          completionCriteria: "旧历史任务完成。",
          maxAutoContinueCount: 5,
          status: "completed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-05T08:10:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-05T08:10:00.000Z",
          lastObservedMessageCount: 5,
          lastAutomationSummary: "旧历史任务已完成。",
          lastAutomationAt: "2026-04-05T08:10:00.000Z",
          autoContinueCount: 1,
          waitingReason: null,
          createdAt: "2026-04-05T07:20:00.000Z",
          updatedAt: "2026-04-05T08:10:00.000Z",
          completedAt: "2026-04-05T08:10:00.000Z"
        }
      ]
    });
    mockedListButlerControlEvents.mockResolvedValueOnce({
      items: [
        {
          id: "event-follow-up-1",
          controlSessionId: "ctrl-1",
          kind: "action",
          actionType: "resume-session",
          status: "succeeded",
          title: "登录页改造",
          content: "验证码流程还在收尾。",
          relatedRefs: [],
          createdAt: "2026-04-05T09:05:00.000Z"
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          followUpTasks?: unknown[];
          inboxItems?: unknown[];
        };
      };
      expect(latestSidePanel.props.followUpTasks).toHaveLength(6);
      expect(latestSidePanel.props.inboxItems).toHaveLength(1);
    });

    const latestSidePanel = getLatestSidePanel();
    const renderedPanel = render(latestSidePanel);

    expect(renderedPanel.getByText(t("shell.butlerInfoFollowUpRecordsTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByRole("button", { name: t("shell.butlerFollowUpHistoryAction") })).toBeInTheDocument();
    expect(renderedPanel.getByText("登录页改造")).toBeInTheDocument();
    expect(renderedPanel.getByText("需要确认验证码失败策略。")).toBeInTheDocument();
    expect(renderedPanel.queryByText("旧历史任务")).not.toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerInfoVerificationRecordsTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByText("登录验证码")).toBeInTheDocument();
    expect(renderedPanel.getByText("正在从用户视角复测登录流程。")).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerInfoTodoRecordsTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByText("补齐验证码流程")).toBeInTheDocument();
    expect(renderedPanel.getByText("普通项目 · 进行中")).toBeInTheDocument();

    fireEvent.click(renderedPanel.getByRole("button", { name: t("shell.butlerFollowUpHistoryAction") }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: t("shell.butlerFollowUpHistoryTitle") })).toBeInTheDocument();
    });

    const historyDialog = screen.getByRole("dialog", { name: t("shell.butlerFollowUpHistoryTitle") });
    expect(within(historyDialog).getByText("旧历史任务")).toBeInTheDocument();
  });

  it("自动化页只展示自动化任务和最近运行记录", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v5",
        generatedAt: "2026-04-07T01:12:00.000Z",
        global: {
          projectCount: 2,
          activeProjectCount: 2,
          blockedProjectCount: 0,
          highRiskProjectCount: 0,
          topRisks: [],
          nextActions: []
        },
        projects: [
          {
            id: "project-1",
            workspaceId: "workspace-1",
            name: "项目甲",
            repoRoot: "/repo/project-1",
            lifecycleStatus: "active",
            riskLevel: "medium",
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
            lastActivityAt: "2026-04-07T01:00:00.000Z",
            updatedAt: "2026-04-07T01:00:00.000Z"
          },
          {
            id: "project-2",
            workspaceId: "workspace-1",
            name: "项目乙",
            repoRoot: "/repo/project-2",
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
            lastActivityAt: "2026-04-07T01:00:00.000Z",
            updatedAt: "2026-04-07T01:00:00.000Z"
          }
        ],
        sessions: [],
        patrols: [
          {
            id: "patrol-run-1",
            projectId: "project-1",
            planId: "plan-1",
            triggeredBy: "scheduler",
            status: "completed",
            riskLevel: "low",
            summary: "本轮巡检未发现新的高风险问题。",
            suggestions: [],
            startedAt: "2026-04-07T00:40:00.000Z",
            finishedAt: "2026-04-07T00:45:00.000Z",
            createdAt: "2026-04-07T00:40:00.000Z"
          }
        ],
        verifications: []
      }
    });
    mockedListButlerPatrolPlans.mockImplementation(async (projectId: string) => ({
      items:
        projectId === "project-1"
          ? [
              {
                id: "plan-1",
                projectId: "project-1",
                name: "每日项目巡检",
                triggerType: "interval",
                triggerConfig: {},
                executionMode: "readonly",
                patrolScope: {},
                enabled: true,
                lastScheduledAt: "2026-04-07T00:30:00.000Z",
                nextRunAt: "2026-04-07T02:00:00.000Z",
                createdAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-07T00:30:00.000Z"
              }
            ]
          : []
    }));
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目甲",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-1",
          sessionTitle: "登录页开发",
          objective: "把验证码功能真正做完",
          status: "active",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-07T01:00:00.000Z",
          nextCheckAt: "2026-04-07T01:05:00.000Z",
          lastObservedRunningState: "running",
          lastObservedMessageAt: "2026-04-07T01:00:00.000Z",
          lastObservedMessageCount: 12,
          lastAutomationSummary: "会话仍在运行，助手继续观察当前进度。",
          lastAutomationAt: null,
          autoContinueCount: 0,
          waitingReason: null,
          createdAt: "2026-04-07T00:50:00.000Z",
          updatedAt: "2026-04-07T01:00:00.000Z",
          completedAt: null
        },
        {
          id: "follow-up-2",
          projectId: "project-2",
          projectName: "项目乙",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-2",
          sessionId: "session-2",
          sessionTitle: "注册流程收尾",
          objective: "补完注册流程收尾",
          status: "completed",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-07T01:10:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-07T01:10:00.000Z",
          lastObservedMessageCount: 18,
          lastAutomationSummary: "当前目标已经完成，跟进任务已收尾。",
          lastAutomationAt: "2026-04-07T01:08:00.000Z",
          autoContinueCount: 2,
          waitingReason: null,
          createdAt: "2026-04-07T00:30:00.000Z",
          updatedAt: "2026-04-07T01:10:00.000Z",
          completedAt: "2026-04-07T01:10:00.000Z",
          rounds: [
            {
              roundNumber: 1,
              kind: "completed",
              status: "completed",
              summary: "当前目标已经完成，跟进任务已收尾。",
              waitingReason: null,
              continuePrompt: null,
              observedRunningState: "completed",
              autoContinueCount: 2,
              createdAt: "2026-04-07T01:08:00.000Z"
            }
          ]
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          followUpTasks?: unknown[];
          patrolPlans?: unknown[];
        };
      };
      expect(latestSidePanel.props.followUpTasks).toHaveLength(2);
      expect(latestSidePanel.props.patrolPlans).toHaveLength(1);
    });

    const latestSidePanel = getLatestSidePanel();
    const renderedPanel = render(latestSidePanel);

    fireEvent.click(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarAutomationTab") }));

    expect(renderedPanel.getByText(t("shell.butlerAutomationTasksTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByText("登录页开发")).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerAutomationStatusActive"))).toBeInTheDocument();
    expect(renderedPanel.getByText("每日项目巡检")).toBeInTheDocument();
    expect(renderedPanel.getAllByText(t("shell.butlerAutomationTaskTypeFollowUp")).length).toBeGreaterThan(0);
    expect(renderedPanel.getByText(t("shell.butlerAutomationTaskTypeInterval"))).toBeInTheDocument();
    expect(renderedPanel.getAllByText(t("shell.butlerAutomationTaskNextRunLabel")).length).toBeGreaterThan(0);
    expect(renderedPanel.getByText(t("shell.butlerAutomationRunsTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByText("注册流程收尾")).toBeInTheDocument();
    expect(renderedPanel.getAllByText(t("shell.butlerAutomationStatusCompleted")).length).toBeGreaterThan(0);
    expect(renderedPanel.getByText(t("shell.butlerAutomationRunSourceFollowUp"))).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerAutomationRunSourcePatrol"))).toBeInTheDocument();
    expect(renderedPanel.getByText("当前目标已经完成，跟进任务已收尾。")).toBeInTheDocument();
    expect(renderedPanel.getByText("本轮巡检未发现新的高风险问题。")).toBeInTheDocument();
    expect(renderedPanel.queryByRole("button", { name: t("shell.butlerAutomationViewRoundsAction") })).not.toBeInTheDocument();
  });

  it("会话跟进历史和状态卡都可以查看轮次详情", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedListButlerFollowUpTasks.mockResolvedValue({
      items: [
        {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目甲",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-1",
          sessionTitle: "登录页开发",
          objective: "把验证码功能真正做完",
          completionCriteria: "完成验证码开发并确认失败策略。",
          maxAutoContinueCount: 5,
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: "2026-04-07T01:00:00.000Z",
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-07T01:00:00.000Z",
          lastObservedMessageCount: 12,
          lastAutomationSummary: "当前需要你确认验证码失败策略。",
          lastAutomationAt: "2026-04-07T01:02:00.000Z",
          autoContinueCount: 1,
          waitingReason: "需要你确认失败策略。",
          createdAt: "2026-04-07T00:50:00.000Z",
          updatedAt: "2026-04-07T01:02:00.000Z",
          completedAt: null
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      const latestSidePanel = getLatestSidePanel() as {
        props: {
          followUpTasks?: unknown[];
        };
      };
      expect(latestSidePanel.props.followUpTasks).toHaveLength(1);
    });

    const latestSidePanel = getLatestSidePanel();
    const renderedPanel = render(latestSidePanel);

    fireEvent.click(renderedPanel.getByRole("button", { name: t("shell.butlerAutomationViewRoundsAction") }));

    await waitFor(() => {
      expect(mockedGetButlerFollowUpTask).toHaveBeenCalledWith("follow-up-1");
      expect(screen.getByText(t("shell.butlerAutomationRoundDetailsTitle"))).toBeInTheDocument();
      expect(screen.getByText(t("shell.butlerAutomationRoundLabel", { round: 2 }))).toBeInTheDocument();
      expect(screen.getByText(/当前需要你确认验证码失败策略/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole("button", { name: t("common.close") }).at(-1) as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.butlerAutomationRoundDetailsTitle") })).toBeNull();
    });

    fireEvent.click(renderedPanel.getByRole("button", { name: t("shell.butlerFollowUpHistoryAction") }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: t("shell.butlerFollowUpHistoryTitle") })).toBeInTheDocument();
    });

    const historyDialog = screen.getByRole("dialog", { name: t("shell.butlerFollowUpHistoryTitle") });
    fireEvent.click(within(historyDialog).getByRole("button", { name: t("shell.butlerAutomationViewRoundsAction") }));

    await waitFor(() => {
      expect(mockedGetButlerFollowUpTask).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("dialog", { name: t("shell.butlerAutomationRoundDetailsTitle") })).toBeInTheDocument();
    });
  });

  it("右侧信息栏只保留信息和自动化，不再展示旧的 Butler 页面残留入口", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedGetButlerOverview.mockResolvedValueOnce({
      overview: {
        version: "v3",
        generatedAt: "2026-04-05T00:00:00.000Z",
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
            name: "项目甲",
            repoRoot: "/repo/project-1",
            lifecycleStatus: "active",
            riskLevel: "medium",
            activeSessionCount: 1,
            sessionCount: 1,
            memoryCount: 1,
            failedPatrolCount: 0,
            failedVerificationCount: 0,
            latestSessionSummary: "最近进展",
            latestPatrolSummary: null,
            latestVerificationSummary: null,
            topRisks: ["接口波动"],
            nextActions: ["补跑验证"],
            lastActivityAt: "2026-04-05T00:00:00.000Z",
            updatedAt: "2026-04-05T00:00:00.000Z"
          }
        ],
        sessions: [],
        patrols: [],
        verifications: []
      }
    });

    renderPage();

    await waitFor(() => {
      expect(setAuxiliaryPanelMock).toHaveBeenCalled();
    });

    const latestSidePanel = setAuxiliaryPanelMock.mock.calls.at(-1)?.[0];
    const renderedPanel = render(latestSidePanel);

    expect(renderedPanel.queryByText("摘要检索")).not.toBeInTheDocument();
    expect(renderedPanel.queryByText("当前项目")).not.toBeInTheDocument();
    expect(renderedPanel.queryByText("助手会帮你做什么")).not.toBeInTheDocument();
    expect(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarInfoTab") })).toHaveClass("workbench-info-tab");
    expect(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarAutomationTab") })).toBeInTheDocument();
    expect(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarSettingsTab") })).toBeInTheDocument();
    expect(renderedPanel.queryByText("技能")).not.toBeInTheDocument();
    expect(renderedPanel.queryByText(t("shell.butlerInfoFollowUpRecordsDescription"))).not.toBeInTheDocument();
    expect(renderedPanel.queryByText(t("shell.butlerInfoVerificationRecordsDescription"))).not.toBeInTheDocument();
    expect(renderedPanel.queryByText(t("shell.butlerInfoTodoRecordsDescription"))).not.toBeInTheDocument();

    fireEvent.click(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarAutomationTab") }));
    expect(renderedPanel.queryByText(t("shell.butlerAutomationTasksDescription"))).not.toBeInTheDocument();
    expect(renderedPanel.queryByText(t("shell.butlerAutomationRunsDescription"))).not.toBeInTheDocument();

    fireEvent.click(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarSettingsTab") }));
    expect(renderedPanel.getByText(t("shell.butlerSettingsTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByRole("button", { name: t("shell.butlerSettingsSaveAction") })).toBeInTheDocument();
  });

  it("设置标签可以保存助手配置", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "file",
        agentsFilePath: "/tmp/butler/AGENTS.md",
        agentsContent: "# AGENTS.md\n初始规则",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });

    renderPage();

    await waitFor(() => {
      const latestSidePanel = setAuxiliaryPanelMock.mock.calls.at(-1)?.[0] as
        | { props?: { settingsForm?: { agentsMode?: string } } }
        | undefined;
      expect(latestSidePanel?.props?.settingsForm?.agentsMode).toBe("file");
    });

    const latestSidePanel = setAuxiliaryPanelMock.mock.calls.at(-1)?.[0];
    const renderedPanel = render(latestSidePanel);

    fireEvent.click(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarSettingsTab") }));
    expect(renderedPanel.getByRole("textbox", { name: t("shell.butlerAgentsFilePathLabel") })).toHaveValue(
      "/tmp/butler/AGENTS.md"
    );
    /* expect(renderedPanel.getByRole("textbox", { name: t("shell.butlerAgentsContentLabel") })).toHaveValue(
      "# AGENTS.md\n初始规则"
        value: "# AGENTS.md\n更新后的规则"
      }
    });
    */
    expect(renderedPanel.getByRole("textbox", { name: t("shell.butlerAgentsContentLabel") })).toHaveValue(
      "# AGENTS.md\n初始规则"
    );
    fireEvent.click(renderedPanel.getByRole("button", { name: t("shell.butlerSettingsSaveAction") }));

    await waitFor(() => {
      /* expect(mockedUpdateButlerProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "阿尔文",
          agentsMode: "file",
          agentsFilePath: "/tmp/butler/AGENTS.md",
          agentsContent: "# AGENTS.md\n更新后的规则",
          persona: {
            tone: "direct",
            language: "zh-CN",
            summaryStyle: "brief"
          },
          focus: expect.objectContaining({
            riskPreference: "conservative",
            summaryDebounceSeconds: 300
          })
        })
      );
      */
      const payload = mockedUpdateButlerProfile.mock.calls.at(-1)?.[0];
      expect(payload).toEqual(
        expect.objectContaining({
          agentsMode: "file",
          agentsFilePath: "/tmp/butler/AGENTS.md",
          agentsContent: "# AGENTS.md\n初始规则",
          persona: {
            tone: "direct",
            language: "zh-CN",
            summaryStyle: "brief"
          }
        })
      );
      expect(payload?.focus).toEqual(
        expect.objectContaining({
          riskPreference: "conservative",
          summaryDebounceSeconds: 300
        })
      );
      expect(showToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t("shell.butlerSettingsSaved"),
          tone: "success"
        })
      );
    });
  });

  it("助手实时会话仍会保留时间线的更早消息入口", async () => {
    mockedGetButlerProfile.mockResolvedValueOnce({
      initialized: true,
      profile: {
        id: "default",
        displayName: "阿尔文",
        providerId: "codex",
        workspacePath: "/tmp/butler",
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [], summaryDebounceSeconds: 300 },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });
    mockedGetCurrentButlerControlSession.mockResolvedValue({
      controlSession: {
        id: "ctrl-1",
        providerId: "codex",
        sessionId: "session-control-1",
        status: "running",
        lastContextVersion: "v1",
        lastSummary: "最近在跟进",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        session: {
          sessionId: "session-control-1"
        }
      }
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("butler-load-older")).toBeInTheDocument();
      expect(mockedGetCurrentButlerControlSession).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId("butler-load-older"));
  });
});

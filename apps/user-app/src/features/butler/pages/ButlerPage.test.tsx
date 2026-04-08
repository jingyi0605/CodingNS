import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  getButlerOverview: vi.fn(),
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
  getButlerOverview,
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
const mockedGetButlerOverview = vi.mocked(getButlerOverview);
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

    expect(screen.getAllByText("📚").length).toBeGreaterThan(0);

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
    mockedListButlerFollowUpTasks.mockResolvedValueOnce({
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
    mockedListButlerInboxItems.mockResolvedValueOnce({
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
      expect(setAuxiliaryPanelMock).toHaveBeenCalled();
    });

    const latestSidePanel = setAuxiliaryPanelMock.mock.calls.at(-1)?.[0];
    const renderedPanel = render(latestSidePanel);

    expect(renderedPanel.getByText(t("shell.butlerInfoFollowUpRecordsTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByText("登录页改造")).toBeInTheDocument();
    expect(renderedPanel.getByText("验证码流程还在收尾。")).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerInfoVerificationRecordsTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByText("登录验证码")).toBeInTheDocument();
    expect(renderedPanel.getByText("正在从用户视角复测登录流程。")).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerInfoTodoRecordsTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByText("补齐验证码流程")).toBeInTheDocument();
    expect(renderedPanel.getByText("普通项目 · 进行中")).toBeInTheDocument();
  });

  it("自动化页会展示进行中和已完成的跟进任务", async () => {
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
    mockedListButlerFollowUpTasks.mockResolvedValueOnce({
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
          completedAt: "2026-04-07T01:10:00.000Z"
        }
      ]
    });

    renderPage();

    await waitFor(() => {
      expect(setAuxiliaryPanelMock).toHaveBeenCalled();
    });

    const latestSidePanel = setAuxiliaryPanelMock.mock.calls.at(-1)?.[0];
    const renderedPanel = render(latestSidePanel);

    fireEvent.click(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarAutomationTab") }));

    expect(renderedPanel.getByText(t("shell.butlerAutomationActiveTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByText("登录页开发")).toBeInTheDocument();
    expect(renderedPanel.getByText("项目甲")).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerAutomationStatusActive"))).toBeInTheDocument();
    expect(renderedPanel.getAllByText(t("shell.butlerAutomationObjectiveLabel"))).toHaveLength(2);
    expect(renderedPanel.getByText("把验证码功能真正做完")).toBeInTheDocument();
    expect(renderedPanel.getAllByText(t("shell.butlerAutomationLatestAssessmentLabel"))).toHaveLength(2);
    expect(renderedPanel.getByText("会话仍在运行，助手继续观察当前进度。")).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerAutomationNextCheckLabel"))).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerAutomationCompletedTitle"))).toBeInTheDocument();
    expect(renderedPanel.getByText("注册流程收尾")).toBeInTheDocument();
    expect(renderedPanel.getByText("项目乙")).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerAutomationStatusCompleted"))).toBeInTheDocument();
    expect(renderedPanel.getByText("当前目标已经完成，跟进任务已收尾。")).toBeInTheDocument();
    expect(renderedPanel.getByText(t("shell.butlerAutomationFinishedAtLabel"))).toBeInTheDocument();
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
    expect(renderedPanel.getByRole("tab", { name: t("shell.butlerSidebarAutomationTab") })).toBeInTheDocument();
    expect(renderedPanel.queryByText("技能")).not.toBeInTheDocument();
    expect(renderedPanel.queryByText("配置")).not.toBeInTheDocument();
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

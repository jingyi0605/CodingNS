import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  MessageTimeline: ({ assistantAvatar }: { assistantAvatar?: unknown }) => (
    <div data-testid="butler-message-timeline">{assistantAvatar as never}</div>
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
  getSessionMessages: vi.fn(),
  getSessionRuntime: vi.fn()
}));

vi.mock("../api/butler-api", () => ({
  getButlerProfile: vi.fn(),
  initButlerProfile: vi.fn(),
  updateButlerProfile: vi.fn(),
  getButlerOverview: vi.fn(),
  listButlerControlEvents: vi.fn(),
  getCurrentButlerControlSession: vi.fn(),
  startButlerControlSession: vi.fn(),
  sendButlerControlMessage: vi.fn(),
  getButlerProjectContext: vi.fn(),
  openButlerProjectAction: vi.fn(),
  resumeButlerProjectSessionAction: vi.fn(),
  startButlerPatrolAction: vi.fn(),
  startButlerVerificationAction: vi.fn()
}));

import { useToast } from "../../../shared/toast";
import { ButlerPage } from "./ButlerPage";
import {
  getButlerProfile,
  initButlerProfile,
  updateButlerProfile,
  getButlerOverview,
  listButlerControlEvents,
  getCurrentButlerControlSession,
  getButlerProjectContext,
  startButlerControlSession
} from "../api/butler-api";
import { getProviderCapabilities, getSessionMessages, getSessionRuntime } from "../../conversation/api/conversation-api";

const mockedUseToast = vi.mocked(useToast);
const mockedGetButlerProfile = vi.mocked(getButlerProfile);
const mockedInitButlerProfile = vi.mocked(initButlerProfile);
const mockedUpdateButlerProfile = vi.mocked(updateButlerProfile);
const mockedGetButlerOverview = vi.mocked(getButlerOverview);
const mockedListButlerControlEvents = vi.mocked(listButlerControlEvents);
const mockedGetCurrentButlerControlSession = vi.mocked(getCurrentButlerControlSession);
const mockedGetButlerProjectContext = vi.mocked(getButlerProjectContext);
const mockedStartButlerControlSession = vi.mocked(startButlerControlSession);
const mockedGetProviderCapabilities = vi.mocked(getProviderCapabilities);
const mockedGetSessionMessages = vi.mocked(getSessionMessages);
const mockedGetSessionRuntime = vi.mocked(getSessionRuntime);

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
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [] },
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
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "测试",
        persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [] },
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
    mockedListButlerControlEvents.mockResolvedValue({ items: [] });
    mockedGetCurrentButlerControlSession.mockResolvedValue({ controlSession: null });
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
    mockedGetButlerProjectContext.mockResolvedValue({
      context: {
        version: "ctx-1",
        generatedAt: "2026-04-05T00:00:00.000Z",
        project: {
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
        },
        sessions: [
          {
            id: "butler-session-1",
            projectId: "project-1",
            sessionId: "session-1",
            provider: "codex",
            title: "项目甲执行会话",
            role: "execution",
            ownershipMode: "managed",
            status: "running",
            runningState: "running",
            lastSummary: "正在收敛问题",
            lastCheckpointAt: "2026-04-05T00:00:00.000Z",
            progressState: "working",
            riskFlags: [],
            nextActions: [],
            updatedAt: "2026-04-05T00:00:00.000Z",
            createdAt: "2026-04-05T00:00:00.000Z"
          }
        ],
        memories: [
          {
            id: "memory-1",
            projectId: "project-1",
            title: "上线约束",
            memoryType: "rule",
            status: "active",
            scopePath: null,
            tags: [],
            confidence: 0.8,
            updatedAt: "2026-04-05T00:00:00.000Z",
            createdAt: "2026-04-05T00:00:00.000Z"
          }
        ],
        patrols: [],
        verifications: [],
        topRisks: ["接口波动"],
        nextActions: ["补跑验证"]
      }
    });
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
    mockedGetSessionMessages.mockResolvedValue({
      messages: [],
      cursor: null,
      nextCursor: null,
      total: 0
    } as never);
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

  function renderPageWithEntry(entry: string) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/butler" element={<ButlerPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

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
    expect(screen.queryByText(t("shell.butlerAgentsContentLabel"))).not.toBeInTheDocument();

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
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [] },
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

    expect(screen.queryByText("在这里与管家对话，并查看聚合上下文和动作事件。")).not.toBeInTheDocument();
    expect(screen.queryByText("当前管家称呼：阿尔文")).not.toBeInTheDocument();
    expect(screen.queryByText("按需上下文")).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.butlerOverviewTitle"))).not.toBeInTheDocument();
  });

  it("工作台会显示管家头像并支持新建控制会话", async () => {
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
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [] },
        initializedAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z"
      }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("shell.butlerNewSessionAction") })).toBeInTheDocument();
    });

    expect(screen.getAllByText("📚").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: t("shell.butlerNewSessionAction") }));

    await waitFor(() => {
      expect(mockedStartButlerControlSession).toHaveBeenCalledWith({});
      expect(showToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t("shell.butlerNewSessionStarted"),
          tone: "success"
        })
      );
    });
  });

  it("选中项目后会拉取项目关联视图并展示真实会话入口", async () => {
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
        focus: { projectIds: [], riskPreference: "conservative", reportPriority: [] },
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

    renderPageWithEntry("/workspaces/workspace-1/butler?projectId=project-1");

    await waitFor(() => {
      expect(mockedGetButlerProjectContext).toHaveBeenCalledWith("project-1");
      expect(setAuxiliaryPanelMock).toHaveBeenCalled();
    });
  });
});

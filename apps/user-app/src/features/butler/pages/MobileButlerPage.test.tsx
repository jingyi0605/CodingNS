import type { ReactNode } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
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
    content
  }: {
    currentWorkspace: { name: string; path: string } | null;
    content?: ReactNode;
  }) => (
    <div>
      <h1>{currentWorkspace?.name}</h1>
      <p>{currentWorkspace?.path}</p>
      {content}
    </div>
  )
}));

vi.mock("../api/butler-api", () => ({
  getButlerProfile: (...args: unknown[]) => mockGetButlerProfile(...args),
  getButlerOverview: (...args: unknown[]) => mockGetButlerOverview(...args),
  listButlerFollowUpTasks: (...args: unknown[]) => mockListButlerFollowUpTasks(...args),
  listButlerInboxItems: (...args: unknown[]) => mockListButlerInboxItems(...args),
  listButlerPatrolPlans: (...args: unknown[]) => mockListButlerPatrolPlans(...args)
}));

vi.mock("../runtime/butler-records-events", () => ({
  subscribeButlerRecordsUpdated: () => () => undefined
}));

describe("MobileButlerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseWorkbenchShell.mockReturnValue({
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "项目一",
            path: "/repo/project-one"
          },
          sessions: []
        },
        {
          workspace: {
            id: "workspace-2",
            name: "项目二",
            path: "/repo/project-two"
          },
          sessions: []
        }
      ],
      selectWorkspace: vi.fn()
    });
    mockGetButlerProfile.mockResolvedValue({
      initialized: true,
      profile: {
        id: "default",
        displayName: "代码助手",
        providerId: "codex",
        workspacePath: "/tmp/butler",
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
      }
    });
    mockGetButlerOverview.mockResolvedValue({
      overview: {
        version: "overview-1",
        generatedAt: "2026-04-09T10:00:00.000Z",
        global: {
          projectCount: 2,
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
          },
          {
            id: "project-2",
            workspaceId: "workspace-2",
            name: "项目二",
            repoRoot: "/repo/project-two",
            lifecycleStatus: "active",
            riskLevel: "low",
            activeSessionCount: 0,
            sessionCount: 0,
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
            status: "passed",
            targetRef: "smoke",
            summary: null,
            startedAt: "2026-04-09T09:40:00.000Z",
            finishedAt: "2026-04-09T09:45:00.000Z",
            createdAt: "2026-04-09T09:40:00.000Z"
          },
          {
            id: "verification-4",
            projectId: "project-2",
            verificationType: "test",
            status: "running",
            targetRef: "pnpm lint",
            summary: null,
            startedAt: "2026-04-09T10:02:00.000Z",
            finishedAt: null,
            createdAt: "2026-04-09T10:02:00.000Z"
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
          sessionTitle: "历史任务",
          objective: "旧任务",
          completionCriteria: "完成",
          maxAutoContinueCount: 5,
          status: "completed",
          checkIntervalSeconds: 300,
          lastCheckedAt: null,
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: "2026-04-09T09:00:00.000Z",
          lastObservedMessageCount: 10,
          lastAutomationSummary: "已完成",
          lastAutomationAt: "2026-04-09T09:00:00.000Z",
          autoContinueCount: 2,
          waitingReason: null,
          rounds: [],
          createdAt: "2026-04-09T08:50:00.000Z",
          updatedAt: "2026-04-09T09:00:00.000Z",
          completedAt: "2026-04-09T09:00:00.000Z"
        },
        {
          id: "follow-up-4",
          projectId: "project-2",
          projectName: "项目二",
          workspaceId: "workspace-2",
          butlerSessionId: "butler-session-4",
          sessionId: "session-4",
          sessionTitle: "别的工作区",
          objective: "不该算进来",
          completionCriteria: "忽略",
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
          createdAt: "2026-04-09T10:00:00.000Z",
          updatedAt: "2026-04-09T10:00:00.000Z",
          closedAt: null
        }
      ]
    });
    mockListButlerPatrolPlans.mockResolvedValue({
      items: []
    });
  });

  it("摘要计数只统计 active 跟进和 queued/running 验证", async () => {
    renderPage();

    const inProgressPill = await screen.findByText("进行中任务");
    const waitingUserPill = screen.getByText("待你处理");

    await waitFor(() => {
      expect(within(inProgressPill.parentElement as HTMLElement).getByText("3")).toBeInTheDocument();
      expect(within(waitingUserPill.parentElement as HTMLElement).getByText("1")).toBeInTheDocument();
    });
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/workspaces/workspace-1/butler?tab=info"]}>
      <Routes>
        <Route path="/workspaces/:workspaceId/butler" element={<MobileButlerPage />} />
      </Routes>
    </MemoryRouter>
  );
}

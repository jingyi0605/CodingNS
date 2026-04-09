import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";

vi.mock("../../../shared/toast", () => ({
  useToast: vi.fn()
}));

vi.mock("./WorkbenchLayout", () => ({
  useWorkbenchShell: () => ({
    requestNavigationRefresh: vi.fn()
  })
}));

vi.mock("../../butler/api/butler-api", () => ({
  cancelButlerFollowUpTask: vi.fn(),
  createButlerFollowUpTask: vi.fn(),
  getButlerSessionActionContext: vi.fn(),
  startButlerVerificationAction: vi.fn()
}));

import { useToast } from "../../../shared/toast";
import { SessionButlerActionButton } from "./SessionButlerActionButton";
import {
  cancelButlerFollowUpTask,
  createButlerFollowUpTask,
  getButlerSessionActionContext,
  startButlerVerificationAction
} from "../../butler/api/butler-api";
import type { SessionSummaryDto } from "../api/conversation-api";

const mockedUseToast = vi.mocked(useToast);
const mockedGetButlerSessionActionContext = vi.mocked(getButlerSessionActionContext);
const mockedCancelButlerFollowUpTask = vi.mocked(cancelButlerFollowUpTask);
const mockedCreateButlerFollowUpTask = vi.mocked(createButlerFollowUpTask);
const mockedStartButlerVerificationAction = vi.mocked(startButlerVerificationAction);

function createSessionSummary(): SessionSummaryDto {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    provider: "codex",
    providerSessionId: "provider-session-1",
    rawStoreRef: "raw-session-1",
    title: "登录页开发",
    messageCount: 8,
    lastMessageAt: "2026-04-07T00:05:00.000Z",
    isArchived: false,
    isFavorite: false,
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
    syncStatus: null,
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "running",
    activitySource: "runtime",
    lastEventAt: null,
    completedAt: null,
    lastSeenAt: null,
    activityState: "running"
  };
}

describe("SessionButlerActionButton", () => {
  const showToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseToast.mockReturnValue({
      showToast,
      dismissToast: vi.fn()
    } as never);
    mockedGetButlerSessionActionContext.mockResolvedValue({
      context: {
        workspaceId: "workspace-1",
        project: {
          id: "project-1",
          workspaceId: "workspace-1",
          name: "项目甲",
          repoRoot: "/tmp/project-a",
          lifecycleStatus: "active",
          riskLevel: "low"
        },
        session: {
          id: "butler-session-1",
          projectId: "project-1",
          sessionId: "session-1",
          provider: "codex",
          title: "登录页开发",
          role: "adhoc",
          ownershipMode: "observed",
          status: "running",
          runningState: "running",
          lastSummary: "正在推进",
          lastCheckpointAt: "2026-04-07T00:05:00.000Z",
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:05:00.000Z"
        },
        latestFollowUpTask: {
          id: "follow-up-1",
          projectId: "project-1",
          projectName: "项目甲",
          workspaceId: "workspace-1",
          butlerSessionId: "butler-session-1",
          sessionId: "session-1",
          sessionTitle: "登录页开发",
          objective: "帮我把这个会话的功能真正做完",
          completionCriteria: "只有当当前功能按既定需求完成后，才停止自动跟进。",
          maxAutoContinueCount: 5,
          status: "waiting_user",
          checkIntervalSeconds: 300,
          lastCheckedAt: null,
          nextCheckAt: null,
          lastObservedRunningState: "completed",
          lastObservedMessageAt: null,
          lastObservedMessageCount: 12,
          lastAutomationSummary: "当前需要你确认验证码失败策略。",
          lastAutomationAt: null,
          autoContinueCount: 1,
          waitingReason: "需要你确认失败策略。",
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:05:00.000Z",
          completedAt: null
        }
      }
    });
    mockedCreateButlerFollowUpTask.mockResolvedValue({
      task: {
        id: "follow-up-2"
      } as never
    });
    mockedCancelButlerFollowUpTask.mockResolvedValue({
      task: {
        id: "follow-up-1",
        status: "cancelled"
      } as never
    });
    mockedStartButlerVerificationAction.mockResolvedValue({
      result: {}
    });
  });

  it("进入会话后会预加载助手动作上下文", async () => {
    render(
      <SessionButlerActionButton
        session={createSessionSummary()}
      />
    );

    await waitFor(() => {
      expect(mockedGetButlerSessionActionContext).toHaveBeenCalledWith("session-1");
    });
  });

  it("可以为当前会话发起助手跟进", async () => {
    render(
      <SessionButlerActionButton
        session={createSessionSummary()}
      />
    );

    await waitFor(() => {
      expect(mockedGetButlerSessionActionContext).toHaveBeenCalledWith("session-1");
    });

    fireEvent.click(screen.getByRole("button", { name: t("conversation.butlerActionButton") }));

    await waitFor(() => {
      expect(screen.getByText("项目甲")).toBeInTheDocument();
    });

    fireEvent.change(
      screen.getByRole("textbox", { name: t("conversation.butlerFollowUpObjectiveLabel") }),
      {
        target: {
          value: "帮我把这个会话的功能真正做完"
        }
      }
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: t("conversation.butlerFollowUpCompletionCriteriaLabel") }),
      {
        target: {
          value: "只有当当前功能按既定需求完成后，才停止自动跟进。"
        }
      }
    );
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: new RegExp(t("conversation.butlerFollowUpRoundLimitLabel"))
      }),
      {
        target: {
          value: "4"
        }
      }
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("conversation.butlerFollowUpAction")} ${t("conversation.butlerFollowUpActionDescription")}`
      })
    );

    await waitFor(() => {
      expect(mockedCreateButlerFollowUpTask).toHaveBeenCalledWith({
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "帮我把这个会话的功能真正做完",
        completionCriteria: "只有当当前功能按既定需求完成后，才停止自动跟进。",
        maxAutoContinueCount: 4
      });
    });
  });

  it("可以为当前会话发起开发验证", async () => {
    render(
      <SessionButlerActionButton
        session={createSessionSummary()}
      />
    );

    await waitFor(() => {
      expect(mockedGetButlerSessionActionContext).toHaveBeenCalledWith("session-1");
    });

    fireEvent.click(screen.getByRole("button", { name: t("conversation.butlerActionButton") }));

    await waitFor(() => {
      expect(screen.getByText("项目甲")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("conversation.butlerVerificationAction")} ${t("conversation.butlerVerificationActionDescription")}`
      })
    );

    await waitFor(() => {
      expect(mockedStartButlerVerificationAction).toHaveBeenCalledWith({
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        verificationType: "browser",
        targetRef: "登录页开发"
      });
    });
  });

  it("新建跟进时默认最多自动跟进 5 轮", async () => {
    render(
      <SessionButlerActionButton
        session={createSessionSummary()}
      />
    );

    await waitFor(() => {
      expect(mockedGetButlerSessionActionContext).toHaveBeenCalledWith("session-1");
    });

    fireEvent.click(screen.getByRole("button", { name: t("conversation.butlerActionButton") }));

    await waitFor(() => {
      expect(screen.getByText("项目甲")).toBeInTheDocument();
    });

    fireEvent.change(
      screen.getByRole("textbox", { name: t("conversation.butlerFollowUpObjectiveLabel") }),
      {
        target: {
          value: "帮我把这个会话的功能真正做完"
        }
      }
    );

    expect(
      screen.getByRole("spinbutton", {
        name: new RegExp(t("conversation.butlerFollowUpRoundLimitLabel"))
      })
    ).toHaveValue(5);

    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("conversation.butlerFollowUpAction")} ${t("conversation.butlerFollowUpActionDescription")}`
      })
    );

    await waitFor(() => {
      expect(mockedCreateButlerFollowUpTask).toHaveBeenCalledWith(
        expect.objectContaining({
          maxAutoContinueCount: 5
        })
      );
    });
  });

  it("悬浮 AI 按钮时会显示当前会话的助手分析", async () => {
    render(
      <SessionButlerActionButton
        session={createSessionSummary()}
      />
    );

    await waitFor(() => {
      expect(mockedGetButlerSessionActionContext).toHaveBeenCalledTimes(1);
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: t("conversation.butlerActionButton") }));

    await waitFor(() => {
      expect(screen.getByText(t("conversation.butlerAnalysisTitle"))).toBeInTheDocument();
      expect(screen.getByText(/需要你确认验证码失败策略/)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(t("shell.butlerAutomationStatusWaitingUser")))).toBeInTheDocument();
    });

    expect(mockedGetButlerSessionActionContext).toHaveBeenCalledTimes(1);
  });

  it("可以手动停止当前会话的助手跟进", async () => {
    render(
      <SessionButlerActionButton
        session={createSessionSummary()}
      />
    );

    await waitFor(() => {
      expect(mockedGetButlerSessionActionContext).toHaveBeenCalledWith("session-1");
    });

    fireEvent.click(screen.getByRole("button", { name: t("conversation.butlerActionButton") }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("conversation.butlerStopFollowUpAction") })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: t("conversation.butlerStopFollowUpAction") }));

    await waitFor(() => {
      expect(mockedCancelButlerFollowUpTask).toHaveBeenCalledWith("follow-up-1");
    });
  });
});

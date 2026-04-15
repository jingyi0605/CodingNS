import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";

vi.mock("../../../shared/toast", () => ({
  useToast: vi.fn()
}));

vi.mock("../../butler/api/butler-api", () => ({
  listButlerProjects: vi.fn(),
  listButlerInboxItems: vi.fn(),
  createButlerInboxItem: vi.fn(),
  updateButlerInboxItem: vi.fn(),
  deleteButlerInboxItem: vi.fn(),
  getButlerSessionTarget: vi.fn()
}));

import { useToast } from "../../../shared/toast";
import {
  createButlerInboxItem,
  deleteButlerInboxItem,
  getButlerSessionTarget,
  listButlerInboxItems,
  listButlerProjects,
  updateButlerInboxItem
} from "../../butler/api/butler-api";
import { WorkspaceInboxModal } from "./WorkspaceInboxModal";

const mockedUseToast = vi.mocked(useToast);
const mockedListButlerProjects = vi.mocked(listButlerProjects);
const mockedListButlerInboxItems = vi.mocked(listButlerInboxItems);
const mockedCreateButlerInboxItem = vi.mocked(createButlerInboxItem);
const mockedUpdateButlerInboxItem = vi.mocked(updateButlerInboxItem);
const mockedDeleteButlerInboxItem = vi.mocked(deleteButlerInboxItem);
const mockedGetButlerSessionTarget = vi.mocked(getButlerSessionTarget);

describe("WorkspaceInboxModal", () => {
  const showToast = vi.fn();
  const defaultAssistantState = {
    lifecycleStage: "pending" as const,
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseToast.mockReturnValue({
      showToast,
      dismissToast: vi.fn()
    } as never);
    mockedListButlerProjects.mockResolvedValue({
      items: [
        {
          id: "project-1",
          workspaceId: "workspace-1",
          name: "项目甲",
          repoRoot: "/repo/project-1",
          defaultProvider: "codex",
          instructionProfileId: null,
          approvalMode: "controlled",
          lifecycleStatus: "active",
          riskLevel: "medium",
          config: {},
          lastPatrolAt: null,
          lastVerificationAt: null,
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:00:00.000Z",
          archivedAt: null
        },
        {
          id: "project-2",
          workspaceId: "workspace-2",
          name: "项目乙",
          repoRoot: "/repo/project-2",
          defaultProvider: "codex",
          instructionProfileId: null,
          approvalMode: "controlled",
          lifecycleStatus: "active",
          riskLevel: "low",
          config: {},
          lastPatrolAt: null,
          lastVerificationAt: null,
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:00:00.000Z",
          archivedAt: null
        }
      ]
    });
    mockedListButlerInboxItems.mockResolvedValue({
      items: [
        {
          id: "todo-1",
          projectId: "project-1",
          projectName: "项目甲",
          workspaceId: "workspace-1",
          projectLifecycleStatus: "active",
          itemType: "task",
          title: "跟进登录验证码",
          content: "继续推动登录页验证码收尾。",
          priority: "medium",
          status: "pending",
          assistantState: defaultAssistantState,
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:10:00.000Z",
          closedAt: null
        }
      ]
    });
    mockedGetButlerSessionTarget.mockResolvedValue({
      target: {
        workspaceId: "workspace-1",
        project: {
          id: "project-1",
          workspaceId: "workspace-1",
          name: "项目甲",
          repoRoot: "/repo/project-1",
          lifecycleStatus: "active",
          riskLevel: "medium"
        },
        session: {
          id: "butler-session-1",
          projectId: "project-1",
          sessionId: "session-1",
          provider: "codex",
          title: "当前会话",
          role: "execution",
          ownershipMode: "managed",
          status: "running",
          runningState: "running",
          lastSummary: null,
          lastCheckpointAt: null,
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:00:00.000Z"
        }
      }
    });
    mockedCreateButlerInboxItem.mockResolvedValue({
      item: {
        id: "todo-2",
        projectId: "project-1",
        projectName: "项目甲",
        workspaceId: "workspace-1",
        projectLifecycleStatus: "active",
        itemType: "task",
        title: "新增代办",
        content: "补齐登录验证码。",
        priority: "medium",
        status: "pending",
        assistantState: defaultAssistantState,
        createdAt: "2026-04-07T00:11:00.000Z",
        updatedAt: "2026-04-07T00:11:00.000Z",
        closedAt: null
      }
    });
    mockedUpdateButlerInboxItem.mockResolvedValue({
      item: {
        id: "todo-1",
        projectId: "project-1",
        projectName: "项目甲",
        workspaceId: "workspace-1",
        projectLifecycleStatus: "active",
        itemType: "task",
        title: "跟进登录验证码",
        content: "继续推动登录页验证码收尾。",
        priority: "medium",
        status: "closed",
        assistantState: {
          ...defaultAssistantState,
          lifecycleStage: "completed"
        },
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:12:00.000Z",
        closedAt: "2026-04-07T00:12:00.000Z"
      }
    });
    mockedDeleteButlerInboxItem.mockResolvedValue(undefined);
  });

  it("默认选中当前项目，并允许切换到其他管理项目新增代办", async () => {
    render(
      <WorkspaceInboxModal
        open
        preferredWorkspaceId="workspace-1"
        preferredSessionId="session-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: t("shell.butlerInboxModalTitle") })).toBeInTheDocument();
    });

    const projectSelect = await screen.findByRole("combobox", { name: t("shell.butlerInboxProjectLabel") });
    expect(screen.getByRole("option", { name: "项目甲" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "项目乙" })).toBeInTheDocument();
    expect((projectSelect as HTMLSelectElement).value).toBe("project-1");
    expect(mockedGetButlerSessionTarget).toHaveBeenCalledWith("session-1");

    fireEvent.change(projectSelect, {
      target: { value: "project-2" }
    });

    fireEvent.change(screen.getByRole("textbox", { name: t("shell.butlerInboxTitleLabel") }), {
      target: { value: "新增代办" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: t("shell.butlerInboxContentLabel") }), {
      target: { value: "补齐登录验证码。" }
    });
    fireEvent.click(screen.getByRole("button", { name: t("shell.butlerInboxCreateAction") }));

    await waitFor(() => {
      expect(mockedCreateButlerInboxItem).toHaveBeenCalledWith({
        projectId: "project-2",
        itemType: "task",
        title: "新增代办",
        content: "补齐登录验证码。",
        status: "pending",
        priority: "medium"
      });
    });
  });

  it("可以编辑和删除已有代办", async () => {
    render(
      <WorkspaceInboxModal
        open
        preferredWorkspaceId="workspace-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("跟进登录验证码")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: t("shell.butlerInboxEditAction") }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("shell.butlerInboxUpdateAction") })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox", { name: t("shell.butlerInboxStatusLabel") }), {
      target: { value: "closed" }
    });
    fireEvent.click(screen.getByRole("button", { name: t("shell.butlerInboxUpdateAction") }));

    await waitFor(() => {
      expect(mockedUpdateButlerInboxItem).toHaveBeenCalledWith("todo-1", {
        projectId: "project-1",
        itemType: "task",
        title: "跟进登录验证码",
        content: "继续推动登录页验证码收尾。",
        status: "closed",
        priority: "medium"
      });
    });

    fireEvent.click(screen.getByRole("button", { name: t("shell.butlerInboxDeleteAction") }));

    await waitFor(() => {
      expect(mockedDeleteButlerInboxItem).toHaveBeenCalledWith("todo-1");
    });
  });

  it("移动端新增代办使用独立选择面板选择字段", async () => {
    render(
      <WorkspaceInboxModal
        open
        preferredWorkspaceId="workspace-1"
        compactComposer
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: t("shell.butlerInboxModalTitle") })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: t("shell.butlerInboxCreateAction") }));

    const composerDialog = await screen.findByRole("dialog", { name: t("shell.butlerInboxCreateTitle") });
    const composerScope = within(composerDialog);

    fireEvent.click(composerScope.getByRole("button", { name: t("shell.butlerInboxStatusLabel") }));

    const pickerDialog = await screen.findByRole("dialog", { name: t("shell.butlerInboxStatusLabel") });
    fireEvent.click(within(pickerDialog).getByRole("option", { name: t("shell.butlerInboxStatusClosed") }));

    fireEvent.change(composerScope.getByRole("textbox", { name: t("shell.butlerInboxTitleLabel") }), {
      target: { value: "移动端新增代办" }
    });
    fireEvent.change(composerScope.getByRole("textbox", { name: t("shell.butlerInboxContentLabel") }), {
      target: { value: "使用新的移动端选择面板。" }
    });
    fireEvent.click(composerScope.getByRole("button", { name: t("shell.butlerInboxCreateAction") }));

    await waitFor(() => {
      expect(mockedCreateButlerInboxItem).toHaveBeenCalledWith({
        projectId: "project-1",
        itemType: "task",
        title: "移动端新增代办",
        content: "使用新的移动端选择面板。",
        status: "closed",
        priority: "medium"
      });
    });
  });

  it("支持带初始内容打开新增代办编辑器", async () => {
    render(
      <WorkspaceInboxModal
        open
        preferredWorkspaceId="workspace-1"
        creationRequestId={1}
        initialDraft={{
          title: "",
          content: "把这段选中文本塞进代办内容里。"
        }}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: t("shell.butlerInboxContentLabel") })
      ).toHaveValue("把这段选中文本塞进代办内容里。");
    });
    expect(
      screen.getByRole("textbox", { name: t("shell.butlerInboxTitleLabel") })
    ).toHaveValue("");
  });
});

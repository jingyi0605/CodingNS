import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { getSessionMessages } from "../api/conversation-api";
import {
  buildSessionBranchTreeModel,
  resolveMobileBranchTreeFitScale,
  hasSessionBranchRelations,
  resolveBranchTreeStageScale,
  SessionBranchTreeExplorer,
  SessionBranchTreePanel
} from "./SessionBranchTreePanel";

import type { SessionSummaryDto, WorkspaceDto } from "../api/conversation-api";
import type { WorkspaceSessionGroup } from "./WorkbenchLayout";

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual("../api/conversation-api");
  return {
    ...actual,
    getSessionMessages: vi.fn()
  };
});

const mockedGetSessionMessages = vi.mocked(getSessionMessages);

describe("SessionBranchTreePanel", () => {
  beforeEach(() => {
    mockedGetSessionMessages.mockReset();
  });

  it("会按当前会话算出完整关联树和当前路径", () => {
    const model = buildSessionBranchTreeModel(
      [createWorkspaceGroup()],
      "workspace-1",
      "child-session"
    );

    expect(model?.root.session.sessionId).toBe("root-session");
    expect([...Array.from(model?.relatedSessionIds ?? [])].sort()).toEqual([
      "branch-session",
      "child-session",
      "leaf-session",
      "mid-session",
      "root-session"
    ]);
    expect(Array.from(model?.currentPathIds ?? [])).toEqual([
      "child-session",
      "mid-session",
      "root-session"
    ]);
    expect(hasSessionBranchRelations(model)).toBe(true);
  });

  it("下游分支过多时会继续缩小画布，优先保证完整显示", () => {
    expect(resolveBranchTreeStageScale(640, 1280)).toBe(0.5);
    expect(resolveBranchTreeStageScale(640, 320)).toBe(1);
  });

  it("移动端会同时参考宽高来计算默认适配缩放", () => {
    expect(resolveMobileBranchTreeFitScale(390, 640, 1200, 400)).toBeLessThan(0.4);
    expect(resolveMobileBranchTreeFitScale(390, 640, 240, 1200)).toBeLessThan(0.6);
  });

  it("会显示完整分支树，点击节点后加载预览并允许切换", async () => {
    mockedGetSessionMessages.mockResolvedValue({
      messages: [
        createHistoryMessage("leaf-1", "assistant", "这是叶子分支的最近回复。", 2),
        createHistoryMessage("leaf-0", "user", "继续处理叶子分支。", 1)
      ],
      cursor: null,
      nextCursor: null,
      total: 2
    });

    const onOpenSession = vi.fn();
    const model = buildSessionBranchTreeModel(
      [createWorkspaceGroup()],
      "workspace-1",
      "child-session"
    );

    render(
      <SessionBranchTreeExplorer
        model={model!}
        onOpenSession={onOpenSession}
      />
    );

    expect(screen.getByText("Root Session")).toBeInTheDocument();
    expect(screen.getByText("Branch Session")).toBeInTheDocument();
    expect(screen.getByText("Leaf Session")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Leaf Session/i }));

    await waitFor(() => {
      expect(mockedGetSessionMessages).toHaveBeenCalledWith("leaf-session", null, 6, "backward");
    });

    expect(screen.getByRole("dialog", { name: /Leaf Session/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("继续处理叶子分支。")).toBeInTheDocument();
    });
    expect(screen.getByText("这是叶子分支的最近回复。")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Leaf Session/i }).closest(".conversation-branch-canvas-viewport")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: t("conversation.branchTreeSwitchAction") }));

    expect(onOpenSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "leaf-session"
      })
    );
  });

  it("会在桌面分支侧板里点击节点后弹出悬浮预览", async () => {
    mockedGetSessionMessages.mockResolvedValue({
      messages: [createHistoryMessage("child-1", "assistant", "当前分支预览。", 1)],
      cursor: null,
      nextCursor: null,
      total: 1
    });

    render(
      <SessionBranchTreePanel
        open
        navigationGroups={[createWorkspaceGroup()]}
        workspaceId="workspace-1"
        sessionId="child-session"
        onClose={vi.fn()}
        onOpenSession={vi.fn()}
      />
    );

    expect(
      screen.getByRole("dialog", { name: t("conversation.branchTreeTitle") })
    ).toBeInTheDocument();
    expect(screen.getByText(t("conversation.branchTreeMapTitle"))).toBeInTheDocument();
    expect(document.querySelector(".conversation-branch-panel")).toBeNull();
    expect(screen.getByRole("separator", { name: t("conversation.branchTreeResizeHandle") })).toBeInTheDocument();
    expect(mockedGetSessionMessages).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Child Session/i }));

    await waitFor(() => {
      expect(mockedGetSessionMessages).toHaveBeenCalledWith("child-session", null, 6, "backward");
    });

    await waitFor(() => {
      const previewPopover = screen.getByRole("dialog", { name: /Child Session/i });
      expect(within(previewPopover).getByText("当前分支预览。")).toBeInTheDocument();
      expect(previewPopover.closest(".conversation-branch-canvas-viewport")).toBeNull();
    });
  });

  it("移动端会使用全屏裸画布视图并支持点击空白关闭", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    const onClose = vi.fn();

    try {
      render(
        <SessionBranchTreePanel
          open
          navigationGroups={[createWorkspaceGroup()]}
          workspaceId="workspace-1"
          sessionId="child-session"
          onClose={onClose}
          onOpenSession={vi.fn()}
        />
      );

      const dialog = screen.getByRole("dialog", { name: t("conversation.branchTreeTitle") });
      expect(dialog).toBeInTheDocument();
      expect(dialog.querySelector(".conversation-branch-mobile-controls")).toBeNull();
      expect(dialog.querySelector(".conversation-branch-canvas-viewport")?.getAttribute("data-mobile")).toBe("true");
      expect(screen.queryByRole("separator", { name: t("conversation.branchTreeResizeHandle") })).toBeNull();
      expect(screen.queryByText(t("conversation.branchTreeMapTitle"))).toBeNull();
      expect(screen.queryByText(t("conversation.branchTreePreviewDescription"))).toBeNull();

      const viewport = document.querySelector(".conversation-branch-canvas-viewport");
      expect(viewport).not.toBeNull();

      fireEvent.click(viewport!);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: originalInnerWidth
      });
    }
  });
});

function createWorkspaceGroup(): WorkspaceSessionGroup {
  const workspace = createWorkspace("workspace-1", "Project One");

  return {
    workspace,
    sessions: [
      createSessionSummary({
        sessionId: "root-session",
        title: "Root Session",
        workspaceId: workspace.id
      }),
      createSessionSummary({
        sessionId: "mid-session",
        title: "Mid Session",
        workspaceId: workspace.id,
        parentSessionId: "root-session",
        forkMethod: "native_session_fork",
        forkSourceType: "session"
      }),
      createSessionSummary({
        sessionId: "branch-session",
        title: "Branch Session",
        workspaceId: workspace.id,
        parentSessionId: "root-session",
        forkMethod: "native_message_fork",
        forkSourceType: "message"
      }),
      createSessionSummary({
        sessionId: "child-session",
        title: "Child Session",
        workspaceId: workspace.id,
        parentSessionId: "mid-session",
        forkMethod: "native_message_fork",
        forkSourceType: "message"
      }),
      createSessionSummary({
        sessionId: "leaf-session",
        title: "Leaf Session",
        workspaceId: workspace.id,
        parentSessionId: "child-session",
        forkMethod: "reconstructed_message_fork",
        forkSourceType: "message"
      })
    ]
  };
}

function createWorkspace(id: string, name: string): WorkspaceDto {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    repoRoot: `/tmp/${id}`
  };
}

function createSessionSummary(input: {
  sessionId: string;
  title: string;
  workspaceId: string;
  parentSessionId?: string | null;
  forkMethod?: SessionSummaryDto["forkMethod"];
  forkSourceType?: SessionSummaryDto["forkSourceType"];
}): SessionSummaryDto {
  return {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    provider: "codex",
    providerSessionId: `raw-${input.sessionId}`,
    rawStoreRef: `codex://${input.sessionId}`,
    parentSessionId: input.parentSessionId ?? null,
    forkMethod: input.forkMethod ?? null,
    forkSourceType: input.forkSourceType ?? null,
    forkSourceSessionId: null,
    forkSourceMessageId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    isFavorite: false,
    title: input.title,
    messageCount: 1,
    lastMessageAt: "2026-04-11T10:00:00.000Z",
    createdAt: "2026-04-11T09:00:00.000Z",
    updatedAt: "2026-04-11T10:00:00.000Z",
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
  };
}

function createHistoryMessage(
  messageId: string,
  role: "user" | "assistant" | "tool" | "system",
  content: string,
  sequence: number
) {
  return {
    messageId,
    provider: "codex" as const,
    providerSessionId: "provider-session-1",
    role,
    content,
    timestamp: `2026-04-11T10:0${sequence}:00.000Z`,
    sequence,
    rawRef: `codex://${messageId}`
  };
}

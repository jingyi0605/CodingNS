import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { MobileConversationSessionActions } from "./MobileConversationSessionActions";

import type { SessionSummaryDto, WorkspaceDto } from "../api/conversation-api";
import type { WorkspaceSessionGroup } from "./WorkbenchLayout";

vi.mock("./SessionButlerActionButton", () => ({
  SessionButlerActionButton: ({ session }: { session: SessionSummaryDto | null }) => (
    <button type="button">{session ? "AI" : "No Session"}</button>
  )
}));

vi.mock("./SessionBranchTreePanel", async () => {
  const actual = await vi.importActual("./SessionBranchTreePanel");
  return {
    ...actual,
    SessionBranchTreeExplorer: () => <div>Mock Branch Tree</div>
  };
});

describe("MobileConversationSessionActions", () => {
  it("没有分支关系时只显示 AI 按钮", () => {
    render(
      <MobileConversationSessionActions
        session={createSessionSummary({
          sessionId: "single-session",
          title: "Single Session",
          workspaceId: "workspace-1"
        })}
        navigationGroups={[
          {
            workspace: createWorkspace("workspace-1", "Project One"),
            sessions: [
              createSessionSummary({
                sessionId: "single-session",
                title: "Single Session",
                workspaceId: "workspace-1"
              })
            ]
          }
        ]}
        workspaceId="workspace-1"
        sessionId="single-session"
        onOpenSession={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "AI" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.moreSessionActions") })).not.toBeInTheDocument();
  });

  it("有分支关系时只显示更多按钮，并且能切换标签页", async () => {
    render(
      <MobileConversationSessionActions
        session={createSessionSummary({
          sessionId: "child-session",
          title: "Child Session",
          workspaceId: "workspace-1",
          parentSessionId: "root-session",
          forkMethod: "native_message_fork",
          forkSourceType: "message"
        })}
        navigationGroups={[createWorkspaceGroup()]}
        workspaceId="workspace-1"
        sessionId="child-session"
        onOpenSession={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "AI" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("conversation.moreSessionActions") }));

    expect(
      screen.getByRole("dialog", { name: t("conversation.moreSessionActionsTitle") })
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("conversation.branchTreeTab") })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Mock Branch Tree")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: t("conversation.aiAssistantTab") }));

    expect(screen.getByRole("tab", { name: t("conversation.aiAssistantTab") })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(t("conversation.aiAssistantTabDescription"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI" })).toBeInTheDocument();
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
        sessionId: "child-session",
        title: "Child Session",
        workspaceId: workspace.id,
        parentSessionId: "root-session",
        forkMethod: "native_message_fork",
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

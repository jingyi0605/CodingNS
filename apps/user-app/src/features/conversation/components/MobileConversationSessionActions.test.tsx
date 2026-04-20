import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { MobileConversationSessionActions } from "./MobileConversationSessionActions";

import type { SessionSummaryDto } from "../api/conversation-api";

vi.mock("./SessionButlerActionButton", () => ({
  SessionButlerActionButton: ({
    openRequestKey = 0,
    showTrigger = true
  }: {
    openRequestKey?: number;
    showTrigger?: boolean;
  }) => (
    <>
      <div
        data-testid="butler-action-state"
        data-open-request-key={String(openRequestKey)}
        data-show-trigger={String(showTrigger)}
      />
      {openRequestKey > 0 ? <div role="dialog">助手跟进模态框</div> : null}
    </>
  )
}));

describe("MobileConversationSessionActions", () => {
  it("有会话时显示更多按钮并展开菜单", () => {
    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/single-session"]}>
        <MobileConversationSessionActions
          session={createSessionSummary({
            sessionId: "single-session",
            title: "Single Session",
            workspaceId: "workspace-1"
          })}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: t("conversation.moreSessionActions") }));

    expect(screen.getByRole("menu", { name: t("conversation.moreSessionActions") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("shell.butlerEntry") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("shell.filesEntry") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("shell.gitEntry") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("shell.mobileConversationToolProcessesTab") })).toBeInTheDocument();
  });

  it("传入分支关系动作时菜单显示分支入口", () => {
    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/fork-session"]}>
        <MobileConversationSessionActions
          session={createSessionSummary({
            sessionId: "fork-session",
            title: "Fork Session",
            workspaceId: "workspace-1"
          })}
          onOpenBranchTree={() => {}}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: t("conversation.moreSessionActions") }));

    expect(screen.getByRole("menuitem", { name: t("conversation.branchAction") })).toBeInTheDocument();
  });

  it("点击工具菜单项会停留在当前会话，只切换工具面板参数", () => {
    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-nav-1?toolPanel=git"]}>
        <MobileConversationSessionActions
          session={createSessionSummary({
            sessionId: "session-nav-1",
            title: "Nav Session",
            workspaceId: "workspace-1"
          })}
        />
        <RouteProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: t("conversation.moreSessionActions") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("shell.filesEntry") }));
    expect(screen.getByTestId("route-probe")).toHaveTextContent(
      "/workspaces/workspace-1/sessions/session-nav-1?toolPanel=files"
    );

    fireEvent.click(screen.getByRole("button", { name: t("conversation.moreSessionActions") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("shell.gitEntry") }));
    expect(screen.getByTestId("route-probe")).toHaveTextContent(
      "/workspaces/workspace-1/sessions/session-nav-1?toolPanel=git"
    );

    fireEvent.click(screen.getByRole("button", { name: t("conversation.moreSessionActions") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("shell.mobileConversationToolProcessesTab") }));
    expect(screen.getByTestId("route-probe")).toHaveTextContent(
      "/workspaces/workspace-1/sessions/session-nav-1?toolPanel=processes"
    );
  });

  it("点击助手菜单项会打开当前会话的助手跟进模态框，而不是跳路由", () => {
    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-nav-1?toolPanel=git"]}>
        <MobileConversationSessionActions
          session={createSessionSummary({
            sessionId: "session-nav-1",
            title: "Nav Session",
            workspaceId: "workspace-1"
          })}
        />
        <RouteProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: t("conversation.moreSessionActions") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("shell.butlerEntry") }));

    expect(screen.getByText("助手跟进模态框")).toBeInTheDocument();
    expect(screen.getByTestId("route-probe")).toHaveTextContent(
      "/workspaces/workspace-1/sessions/session-nav-1?toolPanel=git"
    );
    expect(screen.getByTestId("butler-action-state")).toHaveAttribute("data-show-trigger", "false");
    expect(screen.getByTestId("butler-action-state")).toHaveAttribute("data-open-request-key", "1");
  });

  it("点击分支菜单项会触发分支树动作", () => {
    const onOpenBranchTree = vi.fn();

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions/session-branch-1"]}>
        <MobileConversationSessionActions
          session={createSessionSummary({
            sessionId: "session-branch-1",
            title: "Branch Session",
            workspaceId: "workspace-1"
          })}
          onOpenBranchTree={onOpenBranchTree}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: t("conversation.moreSessionActions") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("conversation.branchAction") }));

    expect(onOpenBranchTree).toHaveBeenCalledTimes(1);
  });

  it("没有会话时不渲染入口", () => {
    render(
      <MemoryRouter>
        <MobileConversationSessionActions
          session={null}
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole("button", { name: t("conversation.moreSessionActions") })).not.toBeInTheDocument();
  });
});

function RouteProbe() {
  const location = useLocation();

  return (
    <div data-testid="route-probe">
      {location.pathname}
      {location.search}
    </div>
  );
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

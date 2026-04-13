import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileConversationSessionActions } from "./MobileConversationSessionActions";

import type { SessionSummaryDto } from "../api/conversation-api";

vi.mock("./SessionButlerActionButton", () => ({
  SessionButlerActionButton: ({ session }: { session: SessionSummaryDto | null }) => (
    <button type="button">{session ? "AI" : "No Session"}</button>
  )
}));

describe("MobileConversationSessionActions", () => {
  it("有会话时只显示 AI 助手按钮", () => {
    render(
      <MobileConversationSessionActions
        session={createSessionSummary({
          sessionId: "single-session",
          title: "Single Session",
          workspaceId: "workspace-1"
        })}
      />
    );

    expect(screen.getByRole("button", { name: "AI" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("没有会话时不渲染入口", () => {
    render(
      <MobileConversationSessionActions
        session={null}
      />
    );

    expect(screen.queryByRole("button", { name: "AI" })).not.toBeInTheDocument();
  });
});

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

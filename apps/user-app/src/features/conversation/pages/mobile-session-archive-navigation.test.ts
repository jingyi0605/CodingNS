import { describe, expect, it } from "vitest";

import { resolveNextMobileSessionEntry } from "./mobile-session-archive-navigation";

describe("resolveNextMobileSessionEntry", () => {
  it("归档后会返回当前工作区列表里的下一条会话", () => {
    const result = resolveNextMobileSessionEntry(
      [
        {
          workspace: {
            id: "workspace-1",
            name: "工作区一"
          },
          sessions: [
            createSession({
              sessionId: "session-1",
              title: "会话 Alpha",
              lastMessageAt: "2026-04-12T10:00:00.000Z",
              updatedAt: "2026-04-12T10:00:00.000Z"
            }),
            createSession({
              sessionId: "session-2",
              title: "会话 Beta",
              lastMessageAt: "2026-04-12T09:00:00.000Z",
              updatedAt: "2026-04-12T09:00:00.000Z"
            })
          ]
        }
      ],
      "workspace-1",
      "session-1"
    );

    expect(result?.session.sessionId).toBe("session-2");
  });

  it("当前已经是最后一条会话时会返回 null", () => {
    const result = resolveNextMobileSessionEntry(
      [
        {
          workspace: {
            id: "workspace-1",
            name: "工作区一"
          },
          sessions: [
            createSession({
              sessionId: "session-last",
              title: "最后一个会话",
              lastMessageAt: "2026-04-12T08:00:00.000Z",
              updatedAt: "2026-04-12T08:00:00.000Z"
            })
          ]
        }
      ],
      "workspace-1",
      "session-last"
    );

    expect(result).toBeNull();
  });

  it("会跳过归档会话和子代理会话，避免跳到不该显示的目标", () => {
    const result = resolveNextMobileSessionEntry(
      [
        {
          workspace: {
            id: "workspace-1",
            name: "工作区一"
          },
          sessions: [
            createSession({
              sessionId: "session-1",
              title: "会话 Alpha",
              lastMessageAt: "2026-04-12T10:00:00.000Z",
              updatedAt: "2026-04-12T10:00:00.000Z"
            }),
            createSession({
              sessionId: "session-archived",
              title: "已归档会话",
              isArchived: true,
              lastMessageAt: "2026-04-12T09:30:00.000Z",
              updatedAt: "2026-04-12T09:30:00.000Z"
            }),
            createSession({
              sessionId: "session-subagent",
              title: "子代理会话",
              isSubagent: true,
              parentSessionId: "session-1",
              lastMessageAt: "2026-04-12T09:15:00.000Z",
              updatedAt: "2026-04-12T09:15:00.000Z"
            }),
            createSession({
              sessionId: "session-2",
              title: "会话 Beta",
              lastMessageAt: "2026-04-12T09:00:00.000Z",
              updatedAt: "2026-04-12T09:00:00.000Z"
            })
          ]
        }
      ],
      "workspace-1",
      "session-1"
    );

    expect(result?.session.sessionId).toBe("session-2");
  });
});

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    provider: "codex",
    providerSessionId: "provider-session-1",
    rawStoreRef: "codex://session-1",
    parentSessionId: null,
    forkMethod: null,
    forkSourceType: null,
    forkSourceSessionId: null,
    forkSourceMessageId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    isFavorite: false,
    title: "会话",
    messageCount: 1,
    lastMessageAt: "2026-04-12T10:00:00.000Z",
    createdAt: "2026-04-12T09:00:00.000Z",
    updatedAt: "2026-04-12T10:00:00.000Z",
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    activityResolutionSource: "authoritative_runtime",
    lastEventAt: "2026-04-12T10:00:00.000Z",
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle",
    ...overrides
  };
}

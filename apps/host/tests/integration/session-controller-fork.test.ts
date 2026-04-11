import { describe, expect, it, vi } from "vitest";

import { SessionController } from "../../src/modules/sessions/session-controller.js";

describe("SessionController.fork", () => {
  it("会返回包含 fork 元数据的统一 DTO", async () => {
    const sessionHistoryService = {
      forkSession: vi.fn(async () => ({
        sessionId: "child-session",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "child-thread",
        rawStoreRef: "/tmp/child-thread.jsonl",
        parentSessionId: "parent-session",
        forkMethod: "native_message_fork",
        forkSourceType: "message",
        forkSourceSessionId: "parent-session",
        forkSourceMessageId: "msg-1",
        inheritedPrefixMessageCount: 2,
        isArchived: false,
        isFavorite: false,
        title: "子会话",
        messageCount: 2,
        lastMessageAt: "2026-04-10T08:00:00.000Z",
        createdAt: "2026-04-10T08:00:00.000Z",
        updatedAt: "2026-04-10T08:00:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: "2026-04-10T08:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "idle",
        activitySource: "none",
        lastEventAt: null,
        completedAt: null,
        lastSeenAt: null,
        activityState: "idle"
      }))
    };
    const controller = new SessionController(
      sessionHistoryService as never,
      {} as never,
      {
        listSessionIds: () => []
      }
    );
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn()
    };

    await controller.fork(
      {
        params: {
          sessionId: "parent-session"
        },
        body: {
          sourceType: "message",
          sourceMessageId: "msg-1",
          strategy: "auto"
        },
        auth: {
          user: {
            userId: "user-1"
          }
        }
      } as never,
      reply as never
    );

    expect(reply.status).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "child-session",
        parentSessionId: "parent-session",
        forkMethod: "native_message_fork",
        forkSourceType: "message",
        forkSourceMessageId: "msg-1",
        inheritedPrefixMessageCount: 2
      })
    );
  });
});

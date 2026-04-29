import { afterEach, describe, expect, it, vi } from "vitest";

import { ChannelBridgeService } from "../../src/modules/channels/channel-bridge-service.js";
import { createId } from "../../src/shared/utils/id.js";
import { nowIso } from "../../src/shared/utils/time.js";
import { ChannelAccountRepository } from "../../src/storage/repositories/channel-account-repository.js";
import { ChannelInboundEventRepository } from "../../src/storage/repositories/channel-inbound-event-repository.js";
import { ChannelThreadRepository } from "../../src/storage/repositories/channel-thread-repository.js";
import { ButlerControlSessionRepository } from "../../src/storage/repositories/butler-control-session-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import type {
  ButlerControlSession,
  ButlerControlSessionStatus,
  ChannelAccount
} from "../../src/types/domain.js";

describe("ChannelBridgeService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("首次入站会创建 Butler control session 和线程映射，后续消息会复用映射", async () => {
    const database = createDatabaseClient(":memory:");
    seedAuthUser(database.db, "user-1");
    const accountRepository = new ChannelAccountRepository(database.db);
    const threadRepository = new ChannelThreadRepository(database.db);
    const eventRepository = new ChannelInboundEventRepository(database.db);
    const controlSessionRepository = new ButlerControlSessionRepository(database.db);
    const account = createChannelAccount(accountRepository, {
      id: "account-1",
      userId: "user-1",
      platformCode: "telegram",
      displayName: "Telegram Bot",
      providerId: "codex",
      connectionMode: "polling",
      status: "active",
      config: {
        botToken: "tg-token"
      }
    });

    const controlSessions = new Map<string, ButlerControlSession>();
    let startCount = 0;
    let sendCount = 0;
    const bridgeService = new ChannelBridgeService(
      accountRepository,
      threadRepository,
      eventRepository,
      {
        startSessionForProvider: vi.fn(async (_userId, providerId, input) => {
          startCount += 1;
          const sessionId = `session-${startCount}`;
          const controlSessionId = `control-${startCount}`;
          const timestamp = nowIso();
          const controlSession: ButlerControlSession = {
            id: controlSessionId,
            providerId,
            sessionId,
            purpose: input.purpose ?? "chat",
            title: input.title ?? null,
            sourceItemId: input.sourceItemId ?? null,
            model: null,
            reasoningLevel: null,
            permissionMode: null,
            status: "running",
            lastContextVersion: "ctx-1",
            lastSummary: input.content ?? null,
            createdAt: timestamp,
            updatedAt: timestamp
          };
          seedWorkspaceAndSessionBinding(database.db, controlSession);
          controlSessions.set(controlSessionId, controlSession);
          controlSessionRepository.create(controlSession);
          return toControlSessionView(controlSession);
        }),
        sendMessageToSession: vi.fn(async (_userId, input) => {
          sendCount += 1;
          const current = controlSessions.get(input.controlSessionId);

          if (!current) {
            throw new Error("missing control session");
          }

          current.updatedAt = nowIso();

          return {
            controlSession: toControlSessionView(current),
            sessionId: current.sessionId,
            provider: current.providerId,
            providerSessionId: `provider-${current.sessionId}`,
            acceptedAt: current.updatedAt,
            clientRequestId: input.clientRequestId ?? null,
            message: {
              messageId: `msg-${sendCount}`,
              role: "user" as const,
              content: input.content ?? "",
              timestamp: current.updatedAt,
              sequence: sendCount,
              attachments: []
            }
          };
        }),
        getSession: vi.fn((controlSessionId: string) => {
          const current = controlSessions.get(controlSessionId);
          return current ? toControlSessionView(current) : null;
        })
      }
    );

    const first = await bridgeService.dispatchInboundText(account.id, {
      externalEventId: "evt-1",
      externalConversationKey: "chat-001",
      externalUserId: "user-ext-1",
      externalThreadKey: null,
      text: "先看一下这个仓库",
      senderDisplayName: "Alice",
      rawPayload: {
        text: "先看一下这个仓库"
      },
      transportContext: {
        chatId: "chat-001"
      }
    });

    expect(first.dispatch.mode).toBe("started");
    expect(first.controlSession.providerId).toBe("codex");
    expect(first.thread.controlSessionId).toBe(first.controlSession.id);
    expect(first.event.status).toBe("dispatched");
    expect(startCount).toBe(1);
    expect(sendCount).toBe(0);

    const second = await bridgeService.dispatchInboundText(account.id, {
      externalEventId: "evt-2",
      externalConversationKey: "chat-001",
      externalUserId: "user-ext-1",
      externalThreadKey: null,
      text: "继续刚才的话题",
      senderDisplayName: "Alice",
      rawPayload: {
        text: "继续刚才的话题"
      },
      transportContext: {
        chatId: "chat-001"
      }
    });

    expect(second.dispatch.mode).toBe("continued");
    expect(second.thread.id).toBe(first.thread.id);
    expect(second.thread.controlSessionId).toBe(first.thread.controlSessionId);
    expect(second.event.status).toBe("dispatched");
    expect(startCount).toBe(1);
    expect(sendCount).toBe(1);

    const threads = threadRepository.listByAccountId(account.id);
    const events = eventRepository.listByAccountId(account.id);
    const updatedAccount = accountRepository.findById(account.id);

    expect(threads).toHaveLength(1);
    expect(events).toHaveLength(2);
    expect(updatedAccount?.lastInboundAt).toBeTruthy();
    expect(updatedAccount?.lastError).toBeNull();

    database.close();
  });

  it("Telegram 同一个 chat 下不同 message_thread_id 会落到不同 Butler control session", async () => {
    const database = createDatabaseClient(":memory:");
    seedAuthUser(database.db, "user-1");
    const accountRepository = new ChannelAccountRepository(database.db);
    const threadRepository = new ChannelThreadRepository(database.db);
    const eventRepository = new ChannelInboundEventRepository(database.db);
    const controlSessionRepository = new ButlerControlSessionRepository(database.db);
    const account = createChannelAccount(accountRepository, {
      id: "account-telegram-thread",
      userId: "user-1",
      platformCode: "telegram",
      displayName: "Telegram Topics",
      providerId: "codex",
      connectionMode: "polling",
      status: "active",
      config: {
        botToken: "tg-token"
      }
    });

    const controlSessions = new Map<string, ButlerControlSession>();
    let startCount = 0;
    const bridgeService = new ChannelBridgeService(
      accountRepository,
      threadRepository,
      eventRepository,
      {
        startSessionForProvider: vi.fn(async (_userId, providerId, input) => {
          startCount += 1;
          const sessionId = `session-topic-${startCount}`;
          const controlSessionId = `control-topic-${startCount}`;
          const timestamp = nowIso();
          const controlSession: ButlerControlSession = {
            id: controlSessionId,
            providerId,
            sessionId,
            purpose: input.purpose ?? "chat",
            title: input.title ?? null,
            sourceItemId: null,
            model: null,
            reasoningLevel: null,
            permissionMode: null,
            status: "running",
            lastContextVersion: "ctx-1",
            lastSummary: input.content ?? null,
            createdAt: timestamp,
            updatedAt: timestamp
          };
          seedWorkspaceAndSessionBinding(database.db, controlSession);
          controlSessions.set(controlSessionId, controlSession);
          controlSessionRepository.create(controlSession);
          return toControlSessionView(controlSession);
        }),
        sendMessageToSession: vi.fn(),
        getSession: vi.fn((controlSessionId: string) => {
          const current = controlSessions.get(controlSessionId);
          return current ? toControlSessionView(current) : null;
        })
      }
    );

    const first = await bridgeService.dispatchInboundText(account.id, {
      externalEventId: "evt-topic-1",
      externalConversationKey: "chat-1001:thread:11",
      externalUserId: "user-ext-1",
      externalThreadKey: "11",
      text: "topic 11 first",
      senderDisplayName: "Alice",
      rawPayload: {},
      transportContext: {
        chatId: "chat-1001",
        messageThreadId: "11"
      }
    });
    const second = await bridgeService.dispatchInboundText(account.id, {
      externalEventId: "evt-topic-2",
      externalConversationKey: "chat-1001:thread:22",
      externalUserId: "user-ext-1",
      externalThreadKey: "22",
      text: "topic 22 first",
      senderDisplayName: "Alice",
      rawPayload: {},
      transportContext: {
        chatId: "chat-1001",
        messageThreadId: "22"
      }
    });

    expect(first.dispatch.mode).toBe("started");
    expect(second.dispatch.mode).toBe("started");
    expect(first.thread.id).not.toBe(second.thread.id);
    expect(first.thread.controlSessionId).not.toBe(second.thread.controlSessionId);
    expect(startCount).toBe(2);
    expect(threadRepository.listByAccountId(account.id)).toHaveLength(2);

    database.close();
  });

  it("重复 externalEventId 不会重复派发", async () => {
    const database = createDatabaseClient(":memory:");
    seedAuthUser(database.db, "user-1");
    const accountRepository = new ChannelAccountRepository(database.db);
    const threadRepository = new ChannelThreadRepository(database.db);
    const eventRepository = new ChannelInboundEventRepository(database.db);
    const controlSessionRepository = new ButlerControlSessionRepository(database.db);
    const account = createChannelAccount(accountRepository, {
      id: "account-2",
      userId: "user-1",
      platformCode: "telegram",
      displayName: "Telegram App",
      providerId: "claude-code",
      connectionMode: "polling",
      status: "active",
      config: {
        botToken: "tg-token"
      }
    });

    const startSessionForProvider = vi.fn(async (_userId, providerId, input) => {
      const timestamp = nowIso();
      const existing = controlSessionRepository.findById("control-1");
      const controlSession = existing ?? {
        id: "control-1",
        providerId,
        sessionId: "session-1",
        purpose: input.purpose ?? "chat",
        title: input.title ?? null,
        sourceItemId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        status: "running" as const,
        lastContextVersion: "ctx-1",
        lastSummary: input.content ?? null,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      if (!existing) {
        seedWorkspaceAndSessionBinding(database.db, controlSession);
        controlSessionRepository.create(controlSession);
      }

      return toControlSessionView(controlSession);
    });
    const sendMessageToSession = vi.fn();
    const getSession = vi.fn((controlSessionId: string) =>
      controlSessionId === "control-1"
        ? toControlSessionView({
            id: "control-1",
            providerId: "claude-code",
            sessionId: "session-1",
            purpose: "chat",
            title: "Telegram App · telegram · Bob",
            sourceItemId: null,
            model: null,
            reasoningLevel: null,
            permissionMode: null,
            status: "running",
            lastContextVersion: "ctx-1",
            lastSummary: "先帮我看发布问题",
            createdAt: "2026-04-27T00:00:00.000Z",
            updatedAt: "2026-04-27T00:00:00.000Z"
          })
        : null
    );

    const bridgeService = new ChannelBridgeService(
      accountRepository,
      threadRepository,
      eventRepository,
      {
        startSessionForProvider,
        sendMessageToSession: sendMessageToSession as any,
        getSession
      }
    );

    const first = await bridgeService.dispatchInboundText(account.id, {
      externalEventId: "evt-dup",
      externalConversationKey: "channel-1",
      externalUserId: "u-ext-2",
      externalThreadKey: null,
      text: "先帮我看发布问题",
      senderDisplayName: "Bob",
      rawPayload: {},
      transportContext: {}
    });
    const duplicate = await bridgeService.dispatchInboundText(account.id, {
      externalEventId: "evt-dup",
      externalConversationKey: "channel-1",
      externalUserId: "u-ext-2",
      externalThreadKey: null,
      text: "先帮我看发布问题",
      senderDisplayName: "Bob",
      rawPayload: {},
      transportContext: {}
    });

    expect(first.dispatch.mode).toBe("started");
    expect(duplicate.dispatch.mode).toBe("duplicate");
    expect(startSessionForProvider).toHaveBeenCalledTimes(1);
    expect(sendMessageToSession).not.toHaveBeenCalled();
    expect(eventRepository.listByAccountId(account.id)).toHaveLength(1);

    database.close();
  });
});

function seedAuthUser(db: ReturnType<typeof createDatabaseClient>["db"], userId: string): void {
  db.prepare(
    `INSERT INTO auth_users (
       id,
       username,
       password_hash,
       role,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, `${userId}-name`, "hash", "admin", "2026-04-27T00:00:00.000Z", "2026-04-27T00:00:00.000Z");
}

function seedWorkspaceAndSessionBinding(
  db: ReturnType<typeof createDatabaseClient>["db"],
  controlSession: Pick<ButlerControlSession, "sessionId" | "providerId">
): void {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (
       id,
       name,
       path,
       repo_root,
       favorite,
       sort_order,
       created_at,
       updated_at,
       removed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "workspace-1",
    "channel-workspace",
    "/tmp/channel-workspace",
    "/tmp/channel-workspace",
    0,
    0,
    "2026-04-27T00:00:00.000Z",
    "2026-04-27T00:00:00.000Z",
    null
  );

  db.prepare(
    `INSERT OR IGNORE INTO session_bindings (
       session_id,
       workspace_id,
       provider,
       provider_session_id,
       raw_store_ref,
       provider_config_mode,
       provider_preset_id,
       runtime_home_dir,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    controlSession.sessionId,
    "workspace-1",
    controlSession.providerId,
    `provider-${controlSession.sessionId}`,
    `raw-${controlSession.sessionId}`,
    "global-default",
    null,
    null,
    "2026-04-27T00:00:00.000Z",
    "2026-04-27T00:00:00.000Z"
  );
}

function createChannelAccount(
  repository: ChannelAccountRepository,
  input: Omit<ChannelAccount, "createdAt" | "updatedAt" | "runtimeState" | "lastInboundAt" | "lastOutboundAt" | "lastError">
    & {
      config: Record<string, unknown>;
    }
): ChannelAccount {
  const timestamp = "2026-04-27T00:00:00.000Z";
  return repository.create({
    id: input.id ?? createId(),
    userId: input.userId,
    platformCode: input.platformCode,
    displayName: input.displayName,
    providerId: input.providerId,
    connectionMode: input.connectionMode,
    status: input.status,
    config: input.config,
    runtimeState: {},
    lastInboundAt: null,
    lastOutboundAt: null,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function toControlSessionView(controlSession: ButlerControlSession) {
  return {
    ...controlSession,
    session: {
      sessionId: controlSession.sessionId,
      workspaceId: "workspace-1",
      provider: controlSession.providerId,
      providerSessionId: `provider-${controlSession.sessionId}`,
      rawStoreRef: `raw-${controlSession.sessionId}`,
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: controlSession.title ?? "channel session",
      messageCount: 1,
      lastMessageAt: controlSession.updatedAt,
      createdAt: controlSession.createdAt,
      updatedAt: controlSession.updatedAt,
      syncStatus: "idle" as const,
      syncCursor: null,
      lastSyncAt: controlSession.updatedAt,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: mapRunningState(controlSession.status),
      activitySource: "runtime" as const,
      activityResolutionSource: "authoritative_runtime" as const,
      activityConfidence: "authoritative" as const,
      runId: null,
      lastEventAt: controlSession.updatedAt,
      completedAt: null,
      lastSeenAt: null,
      watchdogTriggeredAt: null,
      activityState: controlSession.status === "running" ? "running" : "idle"
    }
  };
}

function mapRunningState(status: ButlerControlSessionStatus) {
  if (status === "running") {
    return "running" as const;
  }

  if (status === "failed") {
    return "failed" as const;
  }

  if (status === "closed") {
    return "completed" as const;
  }

  return "idle" as const;
}

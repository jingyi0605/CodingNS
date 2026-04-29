import { describe, expect, it } from "vitest";

import { ChannelDeliveryService } from "../../src/modules/channels/channel-delivery-service.js";
import { HOST_TASK_TYPES, type TaskDefinition, type TaskHandle } from "../../src/modules/tasks/task-types.js";
import { ChannelAccountRepository } from "../../src/storage/repositories/channel-account-repository.js";
import { ButlerControlSessionRepository } from "../../src/storage/repositories/butler-control-session-repository.js";
import { ChannelDeliveryRepository } from "../../src/storage/repositories/channel-delivery-repository.js";
import { ChannelInboundEventRepository } from "../../src/storage/repositories/channel-inbound-event-repository.js";
import { ChannelThreadRepository } from "../../src/storage/repositories/channel-thread-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import type {
  ButlerControlSession,
  ChannelAccount,
  ChannelInboundEvent,
  ChannelThread
} from "../../src/types/domain.js";

describe("ChannelDeliveryService", () => {
  it("会等待 Butler 回复并落库 delivery", async () => {
    const database = createDatabaseClient(":memory:");
    seedAuthUser(database.db, "user-1");
    const accountRepository = new ChannelAccountRepository(database.db);
    const threadRepository = new ChannelThreadRepository(database.db);
    const eventRepository = new ChannelInboundEventRepository(database.db);
    const deliveryRepository = new ChannelDeliveryRepository(database.db);
    const controlSessionRepository = new ButlerControlSessionRepository(database.db);

    const account = createAccount(accountRepository, {
      id: "account-1",
      userId: "user-1",
      platformCode: "telegram",
      displayName: "Telegram App",
      providerId: "codex",
      connectionMode: "polling",
      status: "active",
      config: {
        botToken: "tg-token"
      }
    });
    const controlSession = createControlSession(database.db, controlSessionRepository, {
      id: "control-1",
      providerId: "codex",
      sessionId: "session-1"
    });
    const thread = createThread(threadRepository, account.id, controlSession);
    const event = createInboundEvent(eventRepository, account.id, controlSession, thread);

    const fakeTaskManager = createFakeTaskManager();
    const service = new ChannelDeliveryService(
      accountRepository,
      threadRepository,
      eventRepository,
      deliveryRepository,
      {
        readRecentHistoryEnvelope: async () => ({
          type: "session.delta",
          sessionId: "session-1",
          cursor: null,
          messages: [{
            sequence: 2,
            role: "assistant",
            kind: "text",
            content: "这里是 Butler 的回复",
            timestamp: "2026-04-27T01:00:10.000Z",
            messageId: "assistant-1",
            attachments: []
          }]
        })
      },
      {
        require: () => ({
          sendText: async () => ({
            status: "sent" as const,
            providerMessageRef: "platform-msg-1"
          })
        })
      } as any,
      fakeTaskManager
    );

    const delivery = await service.deliverAssistantReply({
      account,
      thread,
      event,
      controlSession: toControlSessionView(controlSession),
      dispatch: {
        mode: "continued",
        acceptedAt: "2026-04-27T01:00:00.000Z",
        sessionId: "session-1",
        provider: "codex",
        providerSessionId: "provider-session-1",
        clientRequestId: "client-1"
      }
    });

    expect(delivery.status).toBe("sent");
    expect(delivery.providerMessageRef).toBe("platform-msg-1");
    expect(delivery.textContent).toBe("这里是 Butler 的回复");
    expect(deliveryRepository.findByInboundEventId(event.id)?.id).toBe(delivery.id);
    expect(accountRepository.findById(account.id)?.lastOutboundAt).toBeTruthy();
    expect(eventRepository.listByAccountId(account.id)[0]?.status).toBe("replied");

    database.close();
  });

  it("首次回发失败后会登记正式 retry 任务，并在重试成功后更新 delivery", async () => {
    const database = createDatabaseClient(":memory:");
    seedAuthUser(database.db, "user-1");
    const accountRepository = new ChannelAccountRepository(database.db);
    const threadRepository = new ChannelThreadRepository(database.db);
    const eventRepository = new ChannelInboundEventRepository(database.db);
    const deliveryRepository = new ChannelDeliveryRepository(database.db);
    const controlSessionRepository = new ButlerControlSessionRepository(database.db);
    const fakeTaskManager = createFakeTaskManager();

    const account = createAccount(accountRepository, {
      id: "account-2",
      userId: "user-1",
      platformCode: "telegram",
      displayName: "Telegram App",
      providerId: "codex",
      connectionMode: "polling",
      status: "active",
      config: {
        botToken: "tg-token"
      }
    });
    const controlSession = createControlSession(database.db, controlSessionRepository, {
      id: "control-2",
      providerId: "codex",
      sessionId: "session-2"
    });
    const thread = createThread(threadRepository, account.id, controlSession);
    const event = createInboundEvent(eventRepository, account.id, controlSession, thread);
    let sendAttempt = 0;

    const service = new ChannelDeliveryService(
      accountRepository,
      threadRepository,
      eventRepository,
      deliveryRepository,
      {
        readRecentHistoryEnvelope: async () => ({
          type: "session.delta",
          sessionId: "session-2",
          cursor: null,
          messages: [{
            sequence: 2,
            role: "assistant",
            kind: "text",
            content: "稍后回给你。",
            timestamp: "2026-04-27T01:10:10.000Z",
            messageId: "assistant-2",
            attachments: []
          }]
        })
      },
      {
        require: () => ({
          sendText: async () => {
            sendAttempt += 1;
            if (sendAttempt === 1) {
              throw new Error("temporary network failure");
            }

            return {
              status: "sent" as const,
              providerMessageRef: "platform-msg-retry"
            };
          }
        })
      } as any,
      fakeTaskManager
    );

    const firstDelivery = await service.deliverAssistantReply({
      account,
      thread,
      event,
      controlSession: toControlSessionView(controlSession),
      dispatch: {
        mode: "continued",
        acceptedAt: "2026-04-27T01:10:00.000Z",
        sessionId: "session-2",
        provider: "codex",
        providerSessionId: "provider-session-2",
        clientRequestId: "client-2"
      }
    });

    expect(firstDelivery.status).toBe("failed");
    expect(firstDelivery.textContent).toBe("稍后回给你。");
    expect(fakeTaskManager.enqueuedTaskTypes).toEqual([HOST_TASK_TYPES.channelDeliveryRetry]);

    const retryResult = await fakeTaskManager.lastHandle?.promise;
    expect(retryResult).toEqual({
      deliveryId: firstDelivery.id,
      status: "sent",
      attemptedAt: expect.any(String),
      detail: null
    });

    expect(deliveryRepository.findById(firstDelivery.id)).toEqual(expect.objectContaining({
      id: firstDelivery.id,
      status: "sent",
      providerMessageRef: "platform-msg-retry",
      textContent: "稍后回给你。"
    }));
    expect(eventRepository.listByAccountId(account.id)[0]?.status).toBe("replied");

    database.close();
  });

  it("sent 状态带说明文案时，不应该把说明文案落成 error_message", async () => {
    const database = createDatabaseClient(":memory:");
    seedAuthUser(database.db, "user-1");
    const accountRepository = new ChannelAccountRepository(database.db);
    const threadRepository = new ChannelThreadRepository(database.db);
    const eventRepository = new ChannelInboundEventRepository(database.db);
    const deliveryRepository = new ChannelDeliveryRepository(database.db);
    const controlSessionRepository = new ButlerControlSessionRepository(database.db);

    const account = createAccount(accountRepository, {
      id: "account-3",
      userId: "user-1",
      platformCode: "wechat-claw",
      displayName: "Wechat Claw",
      providerId: "codex",
      connectionMode: "polling",
      status: "active",
      config: {
        botToken: "wx-token"
      }
    });
    const controlSession = createControlSession(database.db, controlSessionRepository, {
      id: "control-3",
      providerId: "codex",
      sessionId: "session-3"
    });
    const thread = createThread(threadRepository, account.id, controlSession);
    const event = createInboundEvent(eventRepository, account.id, controlSession, thread);

    const fakeTaskManager = createFakeTaskManager();
    const service = new ChannelDeliveryService(
      accountRepository,
      threadRepository,
      eventRepository,
      deliveryRepository,
      {
        readRecentHistoryEnvelope: async () => ({
          type: "session.delta",
          sessionId: "session-3",
          cursor: null,
          messages: [{
            sequence: 2,
            role: "assistant",
            kind: "text",
            content: "第一段\n\n第二段",
            timestamp: "2026-04-27T01:20:10.000Z",
            messageId: "assistant-3",
            attachments: []
          }]
        })
      },
      {
        require: () => ({
          sendText: async () => ({
            status: "sent" as const,
            providerMessageRef: null,
            detail: "个人微信（claw）第一阶段已把多段落回复压平成单条纯文本发送。"
          })
        })
      } as any,
      fakeTaskManager
    );

    const delivery = await service.deliverAssistantReply({
      account,
      thread,
      event,
      controlSession: toControlSessionView(controlSession),
      dispatch: {
        mode: "continued",
        acceptedAt: "2026-04-27T01:20:00.000Z",
        sessionId: "session-3",
        provider: "codex",
        providerSessionId: "provider-session-3",
        clientRequestId: "client-3"
      }
    });

    expect(delivery.status).toBe("sent");
    expect(delivery.errorMessage).toBeNull();
    expect(deliveryRepository.findById(delivery.id)?.errorMessage).toBeNull();
    expect(eventRepository.findById(event.id)?.errorMessage).toBeNull();

    database.close();
  });
});

function createFakeTaskManager() {
  let registered:
    | TaskDefinition<{ deliveryId: string }, { deliveryId: string; status: "sent" | "skipped"; attemptedAt: string; detail: string | null }>
    | null = null;
  const enqueuedTaskTypes: string[] = [];
  let lastHandle: TaskHandle<any> | null = null;

  return {
    enqueuedTaskTypes,
    get lastHandle() {
      return lastHandle;
    },
    has: () => false,
    register: (definition: TaskDefinition<any, any>) => {
      registered = definition;
    },
    enqueue: (_taskType: string, options: { key: string; input: { deliveryId: string } }) => {
      if (!registered) {
        throw new Error("task not registered");
      }

      enqueuedTaskTypes.push(registered.taskType);
      const promise = registered.run(options.input, {
        taskType: registered.taskType,
        key: options.key,
        taskId: `task-${options.key}`,
        executionLane: registered.executionLane,
        attempt: 1,
        signal: new AbortController().signal
      });

      lastHandle = {
        taskId: `task-${options.key}`,
        taskType: registered.taskType,
        key: options.key,
        executionLane: registered.executionLane,
        deduped: false,
        promise,
        cancel: () => {}
      };

      return lastHandle;
    }
  };
}

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

function createAccount(
  repository: ChannelAccountRepository,
  account: Omit<ChannelAccount, "runtimeState" | "lastInboundAt" | "lastOutboundAt" | "lastError" | "createdAt" | "updatedAt">
    & { config: Record<string, unknown> }
): ChannelAccount {
  return repository.create({
    ...account,
    runtimeState: {},
    lastInboundAt: null,
    lastOutboundAt: null,
    lastError: null,
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  });
}

function createControlSession(
  db: ReturnType<typeof createDatabaseClient>["db"],
  repository: ButlerControlSessionRepository,
  record: Pick<ButlerControlSession, "id" | "providerId" | "sessionId">
): ButlerControlSession {
  const controlSession: ButlerControlSession = {
    ...record,
    purpose: "chat",
    title: "控制会话",
    sourceItemId: null,
    model: null,
    reasoningLevel: null,
    permissionMode: null,
    status: "running",
    lastContextVersion: "ctx-1",
    lastSummary: "summary",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  };
  seedWorkspaceAndSessionBinding(db, controlSession);
  repository.create(controlSession);
  return controlSession;
}

function createThread(
  repository: ChannelThreadRepository,
  accountId: string,
  controlSession: ButlerControlSession
): ChannelThread {
  return repository.create({
    id: "thread-1",
    channelAccountId: accountId,
    externalConversationKey: "channel-1",
    externalUserId: "u-1",
    externalThreadKey: null,
    controlSessionId: controlSession.id,
    sessionId: controlSession.sessionId,
    title: "Telegram App · telegram · Alice",
    status: "active",
    lastInboundAt: "2026-04-27T01:00:00.000Z",
    lastOutboundAt: null,
    lastTransportContext: {
      chatId: "1001"
    },
    createdAt: "2026-04-27T01:00:00.000Z",
    updatedAt: "2026-04-27T01:00:00.000Z"
  });
}

function createInboundEvent(
  repository: ChannelInboundEventRepository,
  accountId: string,
  controlSession: ButlerControlSession,
  thread: ChannelThread
): ChannelInboundEvent {
  return repository.create({
    id: "event-1",
    channelAccountId: accountId,
    externalEventId: "evt-1",
    externalConversationKey: thread.externalConversationKey,
    externalUserId: thread.externalUserId,
    controlSessionId: controlSession.id,
    sessionId: controlSession.sessionId,
    textContent: "用户提问",
    payload: {},
    status: "dispatched",
    errorMessage: null,
    receivedAt: "2026-04-27T01:00:00.000Z",
    processedAt: "2026-04-27T01:00:00.000Z"
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
      title: controlSession.title ?? "control",
      messageCount: 2,
      lastMessageAt: "2026-04-27T01:00:10.000Z",
      createdAt: controlSession.createdAt,
      updatedAt: "2026-04-27T01:00:10.000Z",
      syncStatus: "idle" as const,
      syncCursor: null,
      lastSyncAt: "2026-04-27T01:00:10.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "running" as const,
      activitySource: "runtime" as const,
      activityResolutionSource: "authoritative_runtime" as const,
      activityConfidence: "authoritative" as const,
      runId: null,
      lastEventAt: "2026-04-27T01:00:10.000Z",
      completedAt: null,
      lastSeenAt: null,
      watchdogTriggeredAt: null,
      activityState: "running" as const
    }
  };
}

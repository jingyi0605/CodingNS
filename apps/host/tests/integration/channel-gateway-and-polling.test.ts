import { describe, expect, it } from "vitest";

import { ChannelGatewayService } from "../../src/modules/channels/channel-gateway-service.js";
import { ChannelPollingService } from "../../src/modules/channels/channel-polling-service.js";
import type { TaskDefinition, TaskHandle } from "../../src/modules/tasks/task-types.js";
import type { ChannelAccount } from "../../src/types/domain.js";

describe("ChannelGatewayService", () => {
  it("公网 webhook 会解析消息、桥接 Butler，并异步触发 delivery", async () => {
    const account: ChannelAccount = {
      id: "account-1",
      userId: "user-1",
      platformCode: "telegram",
      displayName: "Telegram App",
      providerId: "codex",
      connectionMode: "webhook",
      status: "active",
      config: {},
      runtimeState: {},
      lastInboundAt: null,
      lastOutboundAt: null,
      lastError: null,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z"
    };
    const deliveries: string[] = [];
    const service = new ChannelGatewayService(
      {
        findById: () => account
      },
      {
        require: () => ({
          parseWebhook: async () => ({
            statusCode: 200,
            body: {
              ok: true
            },
            inboundMessages: [{
              externalEventId: "evt-1",
              externalConversationKey: "channel-1",
              externalUserId: "u-1",
              externalThreadKey: null,
              text: "继续处理",
              senderDisplayName: "Alice",
              rawPayload: {},
              transportContext: {}
            }]
          })
        })
      } as any,
      {
        dispatchInboundText: async () => ({
          account,
          thread: {
            id: "thread-1"
          },
          event: {
            id: "event-1"
          },
          controlSession: {
            id: "control-1",
            sessionId: "session-1"
          },
          dispatch: {
            mode: "started",
            acceptedAt: "2026-04-27T00:00:10.000Z",
            sessionId: "session-1",
            provider: "codex",
            providerSessionId: "provider-1",
            clientRequestId: null
          }
        })
      } as any,
      {
        deliverAssistantReply: async (dispatch) => {
          deliveries.push(dispatch.event.id);
          return {
            id: "delivery-1"
          };
        }
      } as any
    );

    const result = await service.handlePublicWebhook("account-1", {
      method: "POST",
      headers: {},
      query: {},
      body: {}
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({
      statusCode: 200,
      body: {
        ok: true
      }
    });
    expect(deliveries).toEqual(["event-1"]);
  });
});

describe("ChannelPollingService", () => {
  it("手动 poll 会进入 TaskManager，并把拉到的消息桥接给 Butler", async () => {
    const account: ChannelAccount = {
      id: "account-2",
      userId: "user-1",
      platformCode: "telegram",
      displayName: "Telegram Bot",
      providerId: "codex",
      connectionMode: "polling",
      status: "active",
      config: {
        botToken: "token"
      },
      runtimeState: {},
      lastInboundAt: null,
      lastOutboundAt: null,
      lastError: null,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z"
    };
    let registered:
      | TaskDefinition<{ accountId: string; requestedAt: string }, { inboundCount: number; dispatchedCount: number; duplicateCount: number; accountId: string; requestedAt: string }>
      | null = null;
    const dispatched: string[] = [];
    const fakeTaskManager = {
      has: () => false,
      register: (definition: TaskDefinition<any, any>) => {
        registered = definition;
      },
      enqueue: (_taskType: string, options: { key: string; input: { accountId: string; requestedAt: string } }): TaskHandle<any> => {
        if (!registered) {
          throw new Error("task not registered");
        }

        const promise = registered.run(options.input, {
          taskType: registered.taskType,
          key: options.key,
          taskId: `task-${options.key}`,
          executionLane: registered.executionLane,
          attempt: 1,
          signal: new AbortController().signal
        });

        return {
          taskId: `task-${options.key}`,
          taskType: registered.taskType,
          key: options.key,
          executionLane: registered.executionLane,
          deduped: false,
          promise,
          cancel: () => {}
        };
      }
    } as any;

    const service = new ChannelPollingService(
      {
        findById: () => account,
        listActiveByConnectionModes: () => [account],
        update: (next: ChannelAccount) => {
          Object.assign(account, next);
          return next;
        }
      },
      {
        require: () => ({
          poll: async () => ({
            inboundMessages: [{
              externalEventId: "evt-1",
              externalConversationKey: "chat-1",
              externalUserId: "u-1",
              externalThreadKey: null,
              text: "你好",
              senderDisplayName: "Bob",
              rawPayload: {},
              transportContext: {}
            }],
            runtimeStatePatch: {
              telegramUpdateOffset: "101"
            }
          })
        })
      } as any,
      {
        dispatchInboundText: async (_accountId: string, input: { externalEventId: string }) => {
          dispatched.push(input.externalEventId);
          return {
            dispatch: {
              mode: "started"
            },
            event: {
              id: "event-1"
            }
          };
        }
      } as any,
      {
        deliverAssistantReply: async () => ({
          id: "delivery-1"
        })
      } as any,
      fakeTaskManager
    );

    const handle = service.requestPoll("account-2");
    const result = await handle.promise;

    expect(result.inboundCount).toBe(1);
    expect(result.dispatchedCount).toBe(1);
    expect(dispatched).toEqual(["evt-1"]);
    expect(account.runtimeState).toEqual(expect.objectContaining({
      telegramUpdateOffset: "101",
      lastManualPollRequestedAt: expect.any(String),
      lastPollAt: expect.any(String)
    }));
  });

  it("个人微信（claw）在官方 runtime 未接入时不会进入手动或后台轮询", async () => {
    const account: ChannelAccount = {
      id: "account-3",
      userId: "user-1",
      platformCode: "wechat-claw",
      displayName: "WeChat Claw",
      providerId: "codex",
      connectionMode: "polling",
      status: "active",
      config: {},
      runtimeState: {},
      lastInboundAt: null,
      lastOutboundAt: null,
      lastError: null,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z"
    };
    let enqueueCount = 0;
    let registered:
      | TaskDefinition<{ accountId: string; requestedAt: string }, { inboundCount: number; dispatchedCount: number; duplicateCount: number; accountId: string; requestedAt: string }>
      | null = null;
    const fakeTaskManager = {
      has: () => false,
      register: (definition: TaskDefinition<any, any>) => {
        registered = definition;
      },
      enqueue: (_taskType: string, options: { key: string; input: { accountId: string; requestedAt: string } }): TaskHandle<any> => {
        enqueueCount += 1;
        if (!registered) {
          throw new Error("task not registered");
        }

        const promise = registered.run(options.input, {
          taskType: registered.taskType,
          key: options.key,
          taskId: `task-${options.key}`,
          executionLane: registered.executionLane,
          attempt: 1,
          signal: new AbortController().signal
        });

        return {
          taskId: `task-${options.key}`,
          taskType: registered.taskType,
          key: options.key,
          executionLane: registered.executionLane,
          deduped: false,
          promise,
          cancel: () => {}
        };
      }
    } as any;

    const service = new ChannelPollingService(
      {
        findById: () => account,
        listActiveByConnectionModes: () => [account],
        update: (next: ChannelAccount) => {
          Object.assign(account, next);
          return next;
        }
      },
      {
        require: () => ({
          poll: async () => {
            throw new Error("missing token");
          }
        })
      } as any,
      {
        dispatchInboundText: async () => {
          throw new Error("should not dispatch");
        }
      } as any,
      {
        deliverAssistantReply: async () => ({
          id: "delivery-1"
        })
      } as any,
      fakeTaskManager
    );

    try {
      service.requestPoll("account-3");
      throw new Error("expected requestPoll to throw");
    } catch (error) {
      expect(error).toMatchObject({
        errorCode: "CHANNEL_PLATFORM_RUNTIME_REQUIRED"
      });
    }
    expect(enqueueCount).toBe(0);

    const dueResult = await service.runDuePolls("2026-04-27T00:00:00.000Z");
    expect(dueResult).toEqual({
      idle: true,
      dueAccountCount: 0
    });
    expect(enqueueCount).toBe(0);
  });
});

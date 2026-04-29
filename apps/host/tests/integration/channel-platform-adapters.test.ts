import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultChannelPlatformAdapterRegistry } from "../../src/modules/channels/channel-platform-adapters.js";
import type { ChannelAccount, ChannelThread } from "../../src/types/domain.js";

describe("ChannelPlatformAdapters", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Telegram polling 会把 forum topic 映射成更细粒度的 conversation key，并在发送时带上 message_thread_id", async () => {
    const registry = createDefaultChannelPlatformAdapterRegistry();
    const adapter = registry.require("telegram");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [{
            update_id: 101,
            message: {
              message_id: 55,
              message_thread_id: 77,
              text: "topic hi",
              chat: {
                id: 1001
              },
              from: {
                id: 2002,
                username: "alice"
              }
            }
          }]
        });
      }

      if (url.includes("/sendMessage")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          chat_id: "1001",
          text: "reply text",
          message_thread_id: 77
        });

        return jsonResponse({
          ok: true,
          result: {
            message_id: 88
          }
        });
      }

      throw new Error(`unexpected telegram url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const account = createAccount("telegram", {
      botToken: "tg-token"
    });
    const pollResult = await adapter.poll(account);

    expect(pollResult.inboundMessages).toHaveLength(1);
    expect(pollResult.inboundMessages[0]).toEqual(expect.objectContaining({
      externalEventId: "101",
      externalConversationKey: "1001:thread:77",
      externalThreadKey: "77",
      text: "topic hi"
    }));

    const sendResult = await adapter.sendText(account, createThread("1001:thread:77", {
      chatId: "1001",
      messageThreadId: "77"
    }), "reply text");

    expect(sendResult).toEqual({
      status: "sent",
      providerMessageRef: "88"
    });
  });

  it("个人微信（claw）轮询和回发会明确要求官方 runtime 集成", async () => {
    const registry = createDefaultChannelPlatformAdapterRegistry();
    const adapter = registry.require("wechat-claw");
    const account = createAccount("wechat-claw", {});

    await expect(adapter.poll(account)).rejects.toMatchObject({
      errorCode: "CHANNEL_PLATFORM_RUNTIME_REQUIRED"
    });
    await expect(adapter.sendText(account, createThread("direct:wx-user-1", {
      fromUserId: "wx-user-1",
      contextToken: "ctx-1"
    }), "微信回复")).rejects.toMatchObject({
      errorCode: "CHANNEL_PLATFORM_RUNTIME_REQUIRED"
    });

    const probeResult = await adapter.probe(account);
    expect(probeResult).toEqual({
      ok: false,
      detail: expect.stringContaining("helper"),
      warnings: []
    });
  });
});

function createAccount(
  platformCode: ChannelAccount["platformCode"],
  config: Record<string, unknown>,
  runtimeState: Record<string, unknown> = {}
): ChannelAccount {
  return {
    id: `account-${platformCode}`,
    userId: "user-1",
    platformCode,
    displayName: `${platformCode}-account`,
    providerId: "codex",
    connectionMode: "polling",
    status: "active",
    config,
    runtimeState,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastError: null,
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  };
}

function createThread(
  externalConversationKey: string,
  transportContext: Record<string, unknown>
): ChannelThread {
  return {
    id: `thread-${externalConversationKey}`,
    channelAccountId: "account-1",
    externalConversationKey,
    externalUserId: "external-user",
    externalThreadKey: typeof transportContext.messageThreadId === "string"
      ? transportContext.messageThreadId
      : null,
    controlSessionId: "control-1",
    sessionId: "session-1",
    title: "thread",
    status: "active",
    lastInboundAt: "2026-04-27T00:00:00.000Z",
    lastOutboundAt: null,
    lastTransportContext: transportContext,
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

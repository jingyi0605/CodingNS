import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createId } from "../../src/shared/utils/id.js";
import type {
  ChannelAccount,
  ChannelDelivery,
  ChannelInboundEvent,
  ChannelThread
} from "../../src/types/domain.js";
import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();

    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("channels 管理接口", () => {
  it("会返回 Telegram 和个人微信（claw）的能力声明，并支持创建和更新账号", async () => {
    const hosted = await createHostedApp();
    const accessToken = await bootstrapAndLogin(hosted);

    const platformsResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/channels/platforms",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(platformsResponse.statusCode).toBe(200);
    expect(platformsResponse.json()).toEqual([
      expect.objectContaining({
        code: "wechat-claw",
        displayName: "个人微信（claw）",
        supportedConnectionModes: ["polling"],
        multiSessionSupportLevel: "limited"
      }),
      expect.objectContaining({
        code: "telegram",
        displayName: "Telegram",
        supportedConnectionModes: ["polling"],
        multiSessionSupportLevel: "supported"
      })
    ]);

    const createdResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/channels/accounts",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        platformCode: "telegram",
        displayName: "主 Telegram Bot",
        connectionMode: "polling",
        config: {
          botToken: "tg-token"
        }
      }
    });

    expect(createdResponse.statusCode).toBe(201);
    expect(createdResponse.json()).toEqual(
      expect.objectContaining({
        platformCode: "telegram",
        displayName: "主 Telegram Bot",
        providerId: "codex",
        connectionMode: "polling",
        status: "active",
        threadCount: 0,
        inboundEventCount: 0,
        deliveryCount: 0
      })
    );

    const accountId = createdResponse.json().id as string;
    const updatedResponse = await hosted.app.inject({
      method: "PATCH",
      url: `/api/channels/accounts/${accountId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        providerId: "claude-code",
        status: "disabled",
        config: {
          botToken: "tg-token-2",
          webhookFallbackUrl: "https://example.com"
        }
      }
    });

    expect(updatedResponse.statusCode).toBe(200);
    expect(updatedResponse.json()).toEqual(
      expect.objectContaining({
        id: accountId,
        providerId: "claude-code",
        status: "disabled",
        config: {
          botToken: "tg-token-2",
          webhookFallbackUrl: "https://example.com"
        }
      })
    );

    const listResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/channels/accounts",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([
      expect.objectContaining({
        id: accountId,
        platformCode: "telegram",
        providerId: "claude-code",
        status: "disabled"
      })
    ]);
  });

  it("会拒绝非法 provider，并能返回 threads / events / deliveries", async () => {
    const hosted = await createHostedApp();
    const accessToken = await bootstrapAndLogin(hosted);

    const invalidCreate = await hosted.app.inject({
      method: "POST",
      url: "/api/channels/accounts",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        platformCode: "telegram",
        displayName: "Telegram App",
        connectionMode: "polling",
        providerId: "gemini"
      }
    });

    expect(invalidCreate.statusCode).toBe(400);
    expect(invalidCreate.json()).toEqual(
      expect.objectContaining({
        error_code: "INVALID_INPUT",
        field: "providerId"
      })
    );

    const createdAccount = await hosted.app.inject({
      method: "POST",
      url: "/api/channels/accounts",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        platformCode: "telegram",
        displayName: "Telegram App",
        connectionMode: "polling",
        config: {
          botToken: "tg-token"
        }
      }
    });
    const account = createdAccount.json() as ChannelAccount;
    seedChannelRecords(hosted, account);

    const threadsResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/channels/accounts/${account.id}/threads`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const eventsResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/channels/accounts/${account.id}/events`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const deliveriesResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/channels/accounts/${account.id}/deliveries`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(threadsResponse.statusCode).toBe(200);
    expect(threadsResponse.json()).toEqual([
      expect.objectContaining({
        channelAccountId: account.id,
        externalConversationKey: "telegram:chat-1001"
      })
    ]);
    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.json()).toEqual([
      expect.objectContaining({
        channelAccountId: account.id,
        externalEventId: "evt-001",
        status: "received"
      })
    ]);
    expect(deliveriesResponse.statusCode).toBe(200);
    expect(deliveriesResponse.json()).toEqual([
      expect.objectContaining({
        channelAccountId: account.id,
        providerMessageRef: "msg-001",
        status: "sent"
      })
    ]);
  });

  it("probe 会回写基础校验结果，poll 会记录手动请求", async () => {
    const hosted = await createHostedApp();
    const accessToken = await bootstrapAndLogin(hosted);

    const emptyConfigAccount = await hosted.app.inject({
      method: "POST",
      url: "/api/channels/accounts",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        platformCode: "telegram",
        displayName: "Telegram App",
        connectionMode: "polling"
      }
    });
    const telegramProbeAccountId = emptyConfigAccount.json().id as string;

    const probeResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/channels/accounts/${telegramProbeAccountId}/probe`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(probeResponse.statusCode).toBe(200);
    expect(probeResponse.json()).toEqual(
      expect.objectContaining({
        ok: false,
        detail: "缺少 botToken，Telegram 账号还不能工作。",
        account: expect.objectContaining({
          id: telegramProbeAccountId,
          status: "degraded",
          lastError: "缺少 botToken，Telegram 账号还不能工作。"
        }),
        warnings: []
      })
    );

    const pollingAccount = await hosted.app.inject({
      method: "POST",
      url: "/api/channels/accounts",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        platformCode: "telegram",
        displayName: "轮询 Telegram",
        connectionMode: "polling",
        config: {
          botToken: "tg-token"
        }
      }
    });
    const telegramAccountId = pollingAccount.json().id as string;

    const pollResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/channels/accounts/${telegramAccountId}/poll`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(pollResponse.statusCode).toBe(200);
    expect(pollResponse.json()).toEqual(
      expect.objectContaining({
        accepted: true,
        detail: "已记录手动 poll 请求，并已进入后台任务队列。",
        account: expect.objectContaining({
          id: telegramAccountId,
          runtimeState: expect.objectContaining({
            lastManualPollRequestedAt: expect.any(String),
            lastManualPollSource: "api"
          })
        })
      })
    );
  });

  it("个人微信（claw）登录、刷新和退出入口会明确返回 runtime 未接入", async () => {
    const hosted = await createHostedApp();
    const accessToken = await bootstrapAndLogin(hosted);

    const created = await hosted.app.inject({
      method: "POST",
      url: "/api/channels/accounts",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        platformCode: "wechat-claw",
        displayName: "值班微信",
        connectionMode: "polling"
      }
    });
    const accountId = created.json().id as string;

    const startResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/channels/accounts/${accountId}/wechat-claw/start-login`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const refreshResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/channels/accounts/${accountId}/wechat-claw/refresh-login`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const logoutResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/channels/accounts/${accountId}/wechat-claw/logout`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    for (const response of [startResponse, refreshResponse, logoutResponse]) {
      expect(response.statusCode).toBe(501);
      expect(response.json()).toEqual(expect.objectContaining({
        error_code: "CHANNEL_PLATFORM_RUNTIME_REQUIRED",
        detail: expect.stringContaining("helper")
      }));
    }
  });
});

async function createHostedApp() {
  const fixture = createEmptyFixture();
  activeFixtures.push(fixture);

  const hosted = createTestApp(fixture, {
    databasePath: path.join(fixture.rootDir, "host.sqlite")
  });
  activeServers.push(hosted);
  await hosted.app.ready();

  return hosted;
}

function seedChannelRecords(
  hosted: ReturnType<typeof createTestApp>,
  account: Pick<ChannelAccount, "id">
): void {
  const timestamp = "2026-04-27T08:00:00.000Z";
  const thread: ChannelThread = {
    id: createId(),
    channelAccountId: account.id,
    externalConversationKey: "telegram:chat-1001",
    externalUserId: "user:10001",
    externalThreadKey: null,
    controlSessionId: null,
    sessionId: null,
    title: "Telegram 构建问题",
    status: "active",
    lastInboundAt: timestamp,
    lastOutboundAt: timestamp,
    lastTransportContext: {
      chatId: "1001"
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const event: ChannelInboundEvent = {
    id: createId(),
    channelAccountId: account.id,
    externalEventId: "evt-001",
    externalConversationKey: "telegram:chat-1001",
    externalUserId: "user:10001",
    controlSessionId: null,
    sessionId: null,
    textContent: "继续看构建失败",
    payload: {
      text: "继续看构建失败"
    },
    status: "received",
    errorMessage: null,
    receivedAt: timestamp,
    processedAt: null
  };
  const delivery: ChannelDelivery = {
    id: createId(),
    channelAccountId: account.id,
    threadId: thread.id,
    inboundEventId: event.id,
    controlSessionId: null,
    sessionId: null,
    textContent: "已经开始排查。",
    providerMessageRef: "msg-001",
    status: "sent",
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  hosted.services.repositories.channelThreadRepository.create(thread);
  hosted.services.repositories.channelInboundEventRepository.create(event);
  hosted.services.repositories.channelDeliveryRepository.create(delivery);
}

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(loginResponse.statusCode).toBe(200);
  return loginResponse.json().accessToken as string;
}

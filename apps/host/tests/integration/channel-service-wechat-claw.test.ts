import { describe, expect, it, vi } from "vitest";

import { ChannelService } from "../../src/modules/channels/channel-service.js";
import type { ChannelAccount } from "../../src/types/domain.js";

describe("ChannelService wechat claw", () => {
  it("会通过 runtime client 处理 start / refresh / logout，并把公开状态写回 Host 账号", async () => {
    const account: ChannelAccount = {
      id: "wechat-1",
      userId: "user-1",
      platformCode: "wechat-claw",
      displayName: "微信 helper",
      providerId: "codex",
      connectionMode: "polling",
      status: "active",
      config: {},
      runtimeState: {},
      lastInboundAt: null,
      lastOutboundAt: null,
      lastError: null,
      createdAt: "2026-04-29T10:00:00.000Z",
      updatedAt: "2026-04-29T10:00:00.000Z"
    };
    const updatedRecords: ChannelAccount[] = [];
    const service = new ChannelService(
      {
        listByUserId: () => [account],
        findById: () => account,
        create: (record) => record,
        delete: () => true,
        update: (record) => {
          Object.assign(account, record);
          updatedRecords.push(record);
          return record;
        }
      },
      {
        listByAccountId: () => [],
        countByAccountId: () => 0
      },
      {
        listByAccountId: () => [],
        countByAccountId: () => 0
      },
      {
        listByAccountId: () => [],
        countByAccountId: () => 0
      },
      {
        get: () => ({
          enabled: true
        })
      },
      {
        require: () => {
          throw new Error("not used");
        }
      } as any,
      {
        requestPoll: () => {
          throw new Error("not used");
        }
      },
      {
        startLogin: vi.fn(async () => ({
          accountId: "wechat-1",
          actedAt: "2026-04-29T10:01:00.000Z",
          detail: "二维码已生成",
          session: {
            channelAccountId: "wechat-1",
            status: "waiting_scan" as const,
            loginSessionKey: "session-1",
            qrCodeText: "https://example.com/qr",
            qrCodeUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
            qrCodeSourceUrl: "https://example.com/qr",
            providerAccountId: null,
            userId: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            loginStartedAt: "2026-04-29T10:01:00.000Z",
            expiresAt: "2026-04-29T10:06:00.000Z",
            createdAt: "2026-04-29T10:01:00.000Z",
            updatedAt: "2026-04-29T10:01:00.000Z"
          }
        })),
        getLoginStatus: vi.fn(async () => ({
          accountId: "wechat-1",
          checkedAt: "2026-04-29T10:02:00.000Z",
          detail: "微信账号已登录。",
          session: {
            channelAccountId: "wechat-1",
            status: "active" as const,
            loginSessionKey: "session-1",
            qrCodeText: null,
            qrCodeUrl: null,
            qrCodeSourceUrl: null,
            providerAccountId: "bot-1",
            userId: "wx-user-1",
            lastErrorCode: null,
            lastErrorMessage: null,
            loginStartedAt: "2026-04-29T10:01:00.000Z",
            expiresAt: null,
            createdAt: "2026-04-29T10:01:00.000Z",
            updatedAt: "2026-04-29T10:02:00.000Z"
          }
        })),
        logout: vi.fn(async () => ({
          accountId: "wechat-1",
          actedAt: "2026-04-29T10:03:00.000Z",
          detail: "微信 helper 私有运行态已清理。",
          session: null
        }))
      } as any
    );

    const startResult = await service.startWechatClawLogin("user-1", "wechat-1");
    const refreshResult = await service.refreshWechatClawLogin("user-1", "wechat-1");
    const logoutResult = await service.logoutWechatClaw("user-1", "wechat-1");

    expect(startResult.loginStatus).toBe("waiting_scan");
    expect(startResult.qrcodeUrl).toBe("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
    expect(startResult.qrcodeSourceUrl).toBe("https://example.com/qr");
    expect(startResult.qrcodeText).toBe("https://example.com/qr");
    expect(refreshResult.loginStatus).toBe("active");
    expect(refreshResult.account.status).toBe("active");
    expect(refreshResult.account.runtimeState).toEqual(expect.objectContaining({
      wechatClawLoginStatus: "active",
      wechatClawQrCodeText: null,
      wechatClawQrCodeUrl: null,
      wechatClawQrCodeSourceUrl: null
    }));
    expect(logoutResult.loginStatus).toBe("not_logged_in");
    expect(logoutResult.account.status).toBe("degraded");
    expect(updatedRecords).toHaveLength(3);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WechatClawRuntimeClient } from "../../src/modules/channels/wechat-claw-runtime-client.js";
import { WechatClawRuntimeManager } from "../../src/modules/channels/wechat-claw-runtime-manager.js";
import { createWechatClawUpstreamStub, type WechatClawUpstreamStub } from "../helpers/wechat-claw-upstream-stub.js";

describe("WechatClawRuntimeClient", () => {
  const tempDirs: string[] = [];
  const managers: WechatClawRuntimeManager[] = [];
  const upstreams: WechatClawUpstreamStub[] = [];

  afterEach(async () => {
    while (managers.length > 0) {
      managers.pop()?.dispose();
    }

    while (upstreams.length > 0) {
      await upstreams.pop()?.close();
    }

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("会由 Host 懒启动 helper，并能读取空登录态和执行 logout", async () => {
    const runtimeRootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-wechat-helper-"));
    tempDirs.push(runtimeRootDir);

    const manager = new WechatClawRuntimeManager(runtimeRootDir);
    managers.push(manager);
    const client = new WechatClawRuntimeClient(manager);

    const loginStatus = await client.getLoginStatus("account-1");
    const logoutResult = await client.logout("account-1");

    expect(loginStatus.session.status).toBe("not_logged_in");
    expect(loginStatus.detail).toContain("还没有登录会话");
    expect(logoutResult.detail).toContain("已清理");
    expect(logoutResult.session).toBeNull();
  });

  it("会通过 helper 走通扫码、探活、轮询和发送链路", async () => {
    const upstream = await createWechatClawUpstreamStub();
    upstreams.push(upstream);
    upstream.setQrStatuses(["confirmed"]);
    upstream.setPollBatches([{
      cursor: "cursor-1",
      msgs: [{
        message_id: 101,
        from_user_id: "wx-user-1",
        session_id: "wx-user-1",
        item_list: [{
          type: 1,
          text_item: {
            text: "收到第一条微信消息"
          }
        }],
        context_token: "context-1"
      }]
    }]);

    const runtimeRootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-wechat-helper-"));
    tempDirs.push(runtimeRootDir);

    const manager = new WechatClawRuntimeManager(runtimeRootDir);
    managers.push(manager);
    const client = new WechatClawRuntimeClient(manager);
    const config = {
      loginBaseUrl: upstream.baseUrl,
      apiBaseUrl: upstream.baseUrl
    };
    const account = {
      id: "account-2",
      userId: "user-1",
      platformCode: "wechat-claw" as const,
      displayName: "微信 helper",
      providerId: "codex" as const,
      connectionMode: "polling" as const,
      status: "active" as const,
      config,
      runtimeState: {},
      lastInboundAt: null,
      lastOutboundAt: null,
      lastError: null,
      createdAt: "2026-04-29T10:00:00.000Z",
      updatedAt: "2026-04-29T10:00:00.000Z"
    };

    const startResult = await client.startLogin(account);
    const refreshResult = await client.getLoginStatus("account-2");
    const probeResult = await client.probe(account);
    const pollResult = await client.poll(account);
    const sendResult = await client.sendText(
      account,
      {
        id: "thread-1",
        channelAccountId: "account-2",
        externalConversationKey: "wx-user-1",
        externalUserId: "wx-user-1",
        externalThreadKey: null,
        controlSessionId: null,
        sessionId: null,
        title: null,
        status: "active",
        lastInboundAt: null,
        lastOutboundAt: null,
        lastTransportContext: {
          contextToken: "context-1"
        },
        createdAt: "2026-04-29T10:00:00.000Z",
        updatedAt: "2026-04-29T10:00:00.000Z"
      },
      "这是 Host 的回复"
    );

    expect(startResult.session.status).toBe("waiting_scan");
    expect(startResult.session.qrCodeText).toBe(`${upstream.baseUrl}/mock-qr.png`);
    expect(startResult.session.qrCodeUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(startResult.session.qrCodeSourceUrl).toBe(`${upstream.baseUrl}/mock-qr.png`);
    expect(refreshResult.session.status).toBe("active");
    expect(probeResult.ok).toBe(true);
    expect(pollResult.inboundMessages).toEqual([
      expect.objectContaining({
        externalEventId: "101",
        externalConversationKey: "wx-user-1",
        text: "收到第一条微信消息"
      })
    ]);
    expect(sendResult.status).toBe("sent");
    expect(upstream.calls.getBotQrCode).toBe(1);
    expect(upstream.calls.getQrCodeStatus).toBe(1);
    expect(upstream.calls.getConfig).toBe(1);
    expect(upstream.calls.getUpdates).toBe(1);
    expect(upstream.calls.sendMessage).toBe(1);
    expect(upstream.calls.sendBodies[0]).toEqual(expect.objectContaining({
      msg: expect.objectContaining({
        to_user_id: "wx-user-1",
        context_token: "context-1"
      })
    }));
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WechatClawRuntimeStateStore } from "../../src/helpers/wechat-claw-runtime/modules/runtime-state-store.js";

describe("WechatClawRuntimeStateStore", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("会把登录态、轮询游标和 context token 落到 helper 私有 SQLite", () => {
    const runtimeRootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-wechat-claw-"));
    tempDirs.push(runtimeRootDir);
    const store = new WechatClawRuntimeStateStore(runtimeRootDir);

    const session = store.saveAccountSession("account-1", {
      status: "waiting_scan",
      loginSessionKey: "login-1",
      qrCodeUrl: "data:image/png;base64,ZmFrZQ==",
      qrCodeSourceUrl: "https://example.com/qr"
    });
    const checkpoint = store.setPollCheckpoint("account-1", {
      cursor: "cursor-1",
      latestExternalEventId: "event-1"
    });
    const contextToken = store.upsertContextToken("account-1", {
      conversationKey: "wx-user-1",
      externalUserId: "wx-user-1",
      token: "ctx-1"
    });

    expect(store.getAccountSession("account-1")).toEqual(expect.objectContaining({
      status: "waiting_scan",
      loginSessionKey: "login-1",
      qrCodeUrl: "data:image/png;base64,ZmFrZQ==",
      qrCodeSourceUrl: "https://example.com/qr"
    }));
    expect(store.getPollCheckpoint("account-1")).toEqual(checkpoint);
    expect(store.getContextToken("account-1", "wx-user-1", "wx-user-1")).toEqual(contextToken);
    expect(store.toSessionView(session)).toEqual(expect.objectContaining({
      channelAccountId: "account-1",
      status: "waiting_scan",
      qrCodeText: "https://example.com/qr",
      qrCodeSourceUrl: "https://example.com/qr"
    }));

    store.dispose();
  });
});

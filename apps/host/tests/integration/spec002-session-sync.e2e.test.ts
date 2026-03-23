import { appendFileSync } from "node:fs";

import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProviderFixture,
  createTestApp,
  destroyFixture,
  type ProviderFixture
} from "../helpers/test-app.js";

const activeClosers: Array<() => Promise<void> | void> = [];
const activeFixtures: ProviderFixture[] = [];

function createWsMessageQueue(socket: WebSocket) {
  const pending: string[] = [];
  const waiters: Array<(value: string) => void> = [];

  socket.on("message", (raw) => {
    const text = raw.toString();
    const waiter = waiters.shift();

    if (waiter) {
      waiter(text);
      return;
    }

    pending.push(text);
  });

  return {
    async next(timeoutMs = 2000): Promise<string> {
      if (pending.length > 0) {
        return pending.shift()!;
      }

      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(resolve);

          if (index >= 0) {
            waiters.splice(index, 1);
          }

          reject(new Error(`等待 WebSocket 消息超时: ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    }
  };
}

afterEach(async () => {
  while (activeClosers.length > 0) {
    const close = activeClosers.pop();
    await close?.();
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("spec002 会话同步核心", () => {
  it("打通 bootstrap、导入工作区、发现会话、历史读取、能力查询、续接和新建会话", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const bootstrapStatus = await hosted.app.inject({
      method: "GET",
      url: "/api/public/bootstrap-status"
    });
    expect(bootstrapStatus.statusCode).toBe(200);
    expect(bootstrapStatus.json()).toEqual({ initialized: false });

    const setup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(setup.statusCode).toBe(201);

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken;

    const unauthorized = await hosted.app.inject({
      method: "GET",
      url: "/api/providers/claude-code/capabilities"
    });
    expect(unauthorized.statusCode).toBe(401);

    const unsupportedProvider = await hosted.app.inject({
      method: "GET",
      url: "/api/providers/openai/capabilities",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(unsupportedProvider.statusCode).toBe(400);
    expect(unsupportedProvider.json().error_code).toBe("PROVIDER_NOT_SUPPORTED");

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id;

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().items).toHaveLength(2);

    const sessionItems = sessions.json().items;
    const claudeSession = sessionItems.find(
      (item: { provider: string }) => item.provider === "claude-code"
    );
    const codexSession = sessionItems.find((item: { provider: string }) => item.provider === "codex");

    expect(claudeSession?.title).toBe("Claude 样本会话");
    expect(codexSession).toBeTruthy();

    const firstHistory = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${claudeSession.sessionId}/messages?limit=1`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(firstHistory.statusCode).toBe(200);
    expect(firstHistory.json().messages).toHaveLength(1);
    expect(firstHistory.json().messages[0].rawRef).toContain("claude-code://");
    expect(firstHistory.json().nextCursor).toBeTruthy();

    const nextHistory = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${claudeSession.sessionId}/messages?limit=10&cursor=${encodeURIComponent(firstHistory.json().nextCursor)}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(nextHistory.statusCode).toBe(200);
    expect(nextHistory.json().messages).toHaveLength(1);

    const providerCapability = await hosted.app.inject({
      method: "GET",
      url: "/api/providers/claude-code/capabilities",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(providerCapability.statusCode).toBe(200);
    expect(providerCapability.json()).toMatchObject({
      provider: "claude-code",
      canStartSession: true,
      canResumeSession: true,
      supportsSubagents: true
    });

    const sessionCapability = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${codexSession.sessionId}/capabilities`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessionCapability.statusCode).toBe(200);
    expect(sessionCapability.json()).toMatchObject({
      provider: "codex",
      supportsInterrupt: true
    });

    const resumed = await hosted.app.inject({
      method: "POST",
      url: `/api/sessions/${codexSession.sessionId}/resume`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().provider).toBe("codex");

    const started = await hosted.app.inject({
      method: "POST",
      url: "/api/sessions/start",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        provider: "codex",
        initialPrompt: "新建一个最小主链路"
      }
    });
    expect(started.statusCode).toBe(201);
    expect(started.json().provider).toBe("codex");

    const schemaTables = hosted.services.database.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(schemaTables.map((item) => item.name)).toContain("session_bindings");
    expect(schemaTables.map((item) => item.name)).toContain("session_indices");
    expect(schemaTables.map((item) => item.name)).toContain("session_status_snapshots");

    const bindingColumns = hosted.services.database.db
      .prepare("PRAGMA table_info(session_bindings)")
      .all() as Array<{ name: string }>;
    expect(bindingColumns.map((column) => column.name)).not.toContain("content");
    expect(bindingColumns.map((column) => column.name)).not.toContain("raw_message");
  });

  it("支持 WebSocket 订阅、增量推送和鉴权拒绝", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    await hosted.app.ready();

    await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    const accessToken = login.json().accessToken;

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    const workspaceId = imported.json().id;

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const codexSessionId = sessions.json().items.find(
      (item: { provider: string }) => item.provider === "codex"
    ).sessionId;

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    activeClosers.push(() => hosted.app.close());

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("测试服务器地址异常");
    }

    const okSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => okSocket.close());
    const okMessages = createWsMessageQueue(okSocket);

    expect(JSON.parse(await okMessages.next()).type).toBe("system.connected");

    okSocket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: codexSessionId,
        limit: 20
      })
    );

    let subscribed = false;
    let backfillReceived = false;

    for (let index = 0; index < 3; index += 1) {
      const payload = JSON.parse(await okMessages.next()) as { type: string; messages?: unknown[] };

      if (payload.type === "session.subscribed") {
        subscribed = true;
      }

      if (payload.type === "session.backfill") {
        backfillReceived = true;
        expect(payload.messages?.length).toBeGreaterThan(0);
      }

      if (subscribed && backfillReceived) {
        break;
      }
    }

    expect(subscribed).toBe(true);
    expect(backfillReceived).toBe(true);

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:20.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "WebSocket 增量消息到了。"
        }
      })}`,
      "utf8"
    );

    let deltaPayload: null | { messages: Array<{ content: string }> } = null;
    let deltaCursor: string | null = null;

    for (let index = 0; index < 4; index += 1) {
      const payload = JSON.parse(await okMessages.next()) as {
        type: string;
        cursor?: string | null;
        messages?: Array<{ content: string }>;
      };

      if (payload.type === "session.delta" && payload.messages) {
        deltaPayload = {
          messages: payload.messages
        };
        deltaCursor = payload.cursor ?? null;
        break;
      }
    }

    expect(deltaPayload).not.toBeNull();
    expect(deltaPayload?.messages.length).toBeGreaterThan(0);
    expect(deltaPayload?.messages[0].content).toBe("WebSocket 增量消息到了。");
    expect(deltaCursor).toBeTruthy();

    okSocket.close();

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:25.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "断线重连后的补齐消息"
        }
      })}`,
      "utf8"
    );

    const reconnectSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`
    );
    activeClosers.push(() => reconnectSocket.close());
    const reconnectMessages = createWsMessageQueue(reconnectSocket);

    expect(JSON.parse(await reconnectMessages.next()).type).toBe("system.connected");

    reconnectSocket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: codexSessionId,
        cursor: deltaCursor,
        limit: 20
      })
    );

    let reconnectSubscribed = false;
    let reconnectBackfill: null | { messages: Array<{ content: string }> } = null;

    for (let index = 0; index < 3; index += 1) {
      const payload = JSON.parse(await reconnectMessages.next()) as {
        type: string;
        messages?: Array<{ content: string }>;
      };

      if (payload.type === "session.subscribed") {
        reconnectSubscribed = true;
      }

      if (payload.type === "session.backfill" && payload.messages) {
        reconnectBackfill = {
          messages: payload.messages
        };
      }

      if (reconnectSubscribed && reconnectBackfill) {
        break;
      }
    }

    expect(reconnectSubscribed).toBe(true);
    expect(reconnectBackfill).not.toBeNull();
    expect(reconnectBackfill?.messages).toHaveLength(1);
    expect(reconnectBackfill?.messages[0].content).toBe("断线重连后的补齐消息");

    await expect(
      new Promise((resolve, reject) => {
        const badSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=bad-token`);
        badSocket.once("open", () => reject(new Error("不应该连上")));
        badSocket.once("error", () => resolve(true));
        badSocket.once("unexpected-response", () => resolve(true));
        badSocket.once("close", () => resolve(true));
      })
    ).resolves.toBe(true);
  });
});

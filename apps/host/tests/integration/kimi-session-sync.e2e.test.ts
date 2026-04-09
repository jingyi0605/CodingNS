import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];

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
    async next(timeoutMs = 2_500): Promise<string> {
      if (pending.length > 0) {
        return pending.shift()!;
      }

      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);

          if (index >= 0) {
            waiters.splice(index, 1);
          }

          reject(new Error("等待 WebSocket 消息超时"));
        }, timeoutMs);

        const waiter = (value: string) => {
          clearTimeout(timer);
          resolve(value);
        };

        waiters.push(waiter);
      });
    }
  };
}

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

describe("Kimi 会话发现与历史读取", () => {
  it("可以发现本地 Kimi 会话并绑定原生 session id", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    prepareKimiSessionFixture(fixture);

    const hosted = createTestApp(fixture, {
      databasePath: path.join(fixture.rootDir, "host.sqlite")
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const listed = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(listed.statusCode).toBe(200);
    const kimiSession = listed
      .json()
      .items.find((item: { provider: string }) => item.provider === "kimi");

    expect(kimiSession).toBeDefined();
    expect(kimiSession.providerSessionId).toBe("kimi-session-1");
    expect(kimiSession.rawStoreRef).toBe("kimi://session/kimi-session-1");
    expect(kimiSession.title).toBe("Kimi 样本会话");
    expect(kimiSession.messageCount).toBe(5);
  });

  it("读取历史时会归一化 text/thinking/tool 消息", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    prepareKimiSessionFixture(fixture);

    const hosted = createTestApp(fixture, {
      databasePath: path.join(fixture.rootDir, "host.sqlite")
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const listed = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const kimiSession = listed
      .json()
      .items.find((item: { provider: string }) => item.provider === "kimi");

    expect(kimiSession).toBeDefined();

    const history = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${kimiSession.sessionId}/messages?limit=20`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(history.statusCode).toBe(200);
    const messages = history.json().messages as Array<{ kind: string; rawRef: string }>;
    const kinds = new Set(messages.map((message) => message.kind));

    expect(kinds.has("text")).toBe(true);
    expect(kinds.has("thinking")).toBe(true);
    expect(kinds.has("tool_call")).toBe(true);
    expect(kinds.has("tool_result")).toBe(true);
    expect(messages.every((message) => message.rawRef.startsWith("kimi://session/kimi-session-1/"))).toBe(true);
  });

  it("会把 synthetic 时间戳的 Kimi user 消息识别成刚发送的权威消息", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    prepareRealtimeKimiSessionFixture(fixture);

    const hosted = createTestApp(fixture, {
      databasePath: path.join(fixture.rootDir, "host.sqlite")
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const listed = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const kimiSession = listed
      .json()
      .items.find((item: { provider: string }) => item.provider === "kimi");

    expect(kimiSession).toBeDefined();

    const matched = await hosted.services.modules.sessionHistoryService.findLatestUserMessage(
      kimiSession.sessionId,
      "对话测试实时用户消息",
      1,
      "2026-04-09T02:00:00.000Z"
    );

    expect(matched).toBeTruthy();
    expect(matched?.content).toBe("对话测试实时用户消息");
    expect(matched?.rawRef).toContain("/context#");
  });

  it("Kimi 尾部消息内容被覆盖但条数不变时，WebSocket 仍会实时推送最新正文", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const mutableSessionDir = prepareMutableKimiSessionFixture(fixture);

    const hosted = createTestApp(fixture, {
      databasePath: path.join(fixture.rootDir, "host.sqlite")
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const listed = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const kimiSession = listed
      .json()
      .items.find((item: { provider: string }) => item.provider === "kimi");

    expect(kimiSession).toBeDefined();

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("测试服务地址异常");
    }

    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?access_token=${encodeURIComponent(accessToken)}`
    );
    const queue = createWsMessageQueue(socket);

    expect(JSON.parse(await queue.next()).type).toBe("system.connected");

    socket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: kimiSession.sessionId,
        limit: 20
      })
    );

    let backfillMessages: Array<{ content: string }> = [];

    for (let index = 0; index < 3; index += 1) {
      const payload = JSON.parse(await queue.next()) as {
        type: string;
        messages?: Array<{ content: string }>;
      };

      if (payload.type === "session.backfill" && payload.messages) {
        backfillMessages = payload.messages;
        break;
      }
    }

    expect(backfillMessages.map((message) => message.content)).toContain("第一段");

    writeFileSync(
      path.join(mutableSessionDir, "context.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-04-09T10:00:00.000Z",
          role: "user",
          content: [{ type: "text", text: "请继续展开说明。" }],
          cwd: fixture.workspaceDir
        }),
        JSON.stringify({
          timestamp: "2026-04-09T10:00:02.000Z",
          role: "assistant",
          content: [{ type: "text", text: "第一段\n第二段" }],
          cwd: fixture.workspaceDir
        })
      ].join("\n"),
      "utf8"
    );

    let deltaMessages: Array<{ content: string }> = [];

    for (let index = 0; index < 6; index += 1) {
      const payload = JSON.parse(await queue.next(4_000)) as {
        type: string;
        messages?: Array<{ content: string }>;
      };

      if (payload.type === "session.delta" && payload.messages) {
        deltaMessages = payload.messages;
        break;
      }
    }

    expect(deltaMessages).toHaveLength(1);
    expect(deltaMessages[0]?.content).toBe("第一段\n第二段");

    socket.close();
  });
});

function prepareKimiSessionFixture(fixture: EmptyFixture): void {
  const kimiSessionDir = path.join(
    fixture.kimiHomeDir,
    "sessions",
    "workspace-hash-1",
    "kimi-session-1"
  );

  mkdirSync(kimiSessionDir, { recursive: true });

  writeFileSync(
    path.join(kimiSessionDir, "state.json"),
    JSON.stringify({
      sessionId: "kimi-session-1",
      title: "Kimi 样本会话",
      cwd: fixture.workspaceDir,
      archived: false
    }),
    "utf8"
  );

  writeFileSync(
    path.join(kimiSessionDir, "context.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-04-03T08:00:00.000Z",
        role: "user",
        content: [{ type: "text", text: "请总结今天的任务。" }],
        cwd: fixture.workspaceDir
      }),
      JSON.stringify({
        timestamp: "2026-04-03T08:00:02.000Z",
        role: "assistant",
        content: [{ type: "text", text: "好的，我先整理关键风险。" }],
        cwd: fixture.workspaceDir
      })
    ].join("\n"),
    "utf8"
  );

  writeFileSync(
    path.join(kimiSessionDir, "wire.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-04-03T08:00:03.000Z",
        role: "assistant",
        content: [{ type: "thinking", text: "先检查会话结构和字段。" }]
      }),
      JSON.stringify({
        timestamp: "2026-04-03T08:00:04.000Z",
        role: "assistant",
        content: [
          {
            type: "tool_call",
            id: "call-1",
            name: "read_file",
            input: {
              path: "README.md"
            }
          }
        ]
      }),
      JSON.stringify({
        timestamp: "2026-04-03T08:00:05.000Z",
        role: "tool",
        content: [
          {
            type: "tool_result",
            call_id: "call-1",
            output: "README 内容已读取"
          }
        ]
      })
    ].join("\n"),
    "utf8"
  );
}

function prepareRealtimeKimiSessionFixture(fixture: EmptyFixture): void {
  const kimiSessionDir = path.join(
    fixture.kimiHomeDir,
    "sessions",
    "workspace-hash-1",
    "kimi-session-1"
  );

  mkdirSync(kimiSessionDir, { recursive: true });

  writeFileSync(
    path.join(kimiSessionDir, "state.json"),
    JSON.stringify({
      sessionId: "kimi-session-1",
      title: "Kimi 实时样本会话",
      cwd: fixture.workspaceDir,
      archived: false
    }),
    "utf8"
  );

  writeFileSync(
    path.join(kimiSessionDir, "context.jsonl"),
    [
      JSON.stringify({
        role: "_system_prompt",
        content: "system prompt"
      }),
      JSON.stringify({
        role: "_checkpoint",
        id: 0
      }),
      JSON.stringify({
        role: "user",
        content: "对话测试实时用户消息"
      }),
      JSON.stringify({
        role: "_checkpoint",
        id: 1
      }),
      JSON.stringify({
        role: "assistant",
        content: "你好，这是实时样本回复。"
      })
    ].join("\n"),
    "utf8"
  );

  writeFileSync(
    path.join(kimiSessionDir, "wire.jsonl"),
    [
      JSON.stringify({
        type: "metadata",
        protocol_version: "1.8"
      }),
      JSON.stringify({
        timestamp: "2026-04-09T02:00:01.000Z",
        message: {
          type: "TurnBegin",
          payload: {
            user_input: "对话测试实时用户消息"
          }
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-09T02:00:02.000Z",
        message: {
          type: "ContentPart",
          payload: {
            type: "text",
            text: "你好，这是实时样本回复。"
          }
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-09T02:00:03.000Z",
        message: {
          type: "TurnEnd",
          payload: {}
        }
      })
    ].join("\n"),
    "utf8"
  );
}

function prepareMutableKimiSessionFixture(fixture: EmptyFixture): string {
  const kimiSessionDir = path.join(
    fixture.kimiHomeDir,
    "sessions",
    "workspace-hash-1",
    "kimi-session-1"
  );

  mkdirSync(kimiSessionDir, { recursive: true });

  writeFileSync(
    path.join(kimiSessionDir, "state.json"),
    JSON.stringify({
      sessionId: "kimi-session-1",
      title: "Kimi 可变尾部会话",
      cwd: fixture.workspaceDir,
      archived: false
    }),
    "utf8"
  );

  writeFileSync(
    path.join(kimiSessionDir, "context.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-04-09T10:00:00.000Z",
        role: "user",
        content: [{ type: "text", text: "请继续展开说明。" }],
        cwd: fixture.workspaceDir
      }),
      JSON.stringify({
        timestamp: "2026-04-09T10:00:02.000Z",
        role: "assistant",
        content: [{ type: "text", text: "第一段" }],
        cwd: fixture.workspaceDir
      })
    ].join("\n"),
    "utf8"
  );

  writeFileSync(path.join(kimiSessionDir, "wire.jsonl"), "", "utf8");
  return kimiSessionDir;
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

async function importWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  workspacePath: string
): Promise<string> {
  const imported = await hosted.app.inject({
    method: "POST",
    url: "/api/workspaces/import",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      path: workspacePath,
      name: "Kimi Fixture Workspace"
    }
  });

  expect(imported.statusCode).toBe(201);
  return imported.json().id as string;
}

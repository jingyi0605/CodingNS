import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
    expect(nextHistory.json().messages).toHaveLength(3);
    expect(nextHistory.json().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          role: "tool",
          toolCall: expect.objectContaining({
            callId: "toolu_fixture_1",
            name: "Read",
            input: expect.stringContaining("README.md"),
            status: "running"
          })
        }),
        expect.objectContaining({
          kind: "tool_result",
          role: "tool",
          toolCall: expect.objectContaining({
            callId: "toolu_fixture_1",
            name: "Read",
            output: "README fixture content",
            status: "completed"
          })
        })
      ])
    );

    const codexHistory = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${codexSession.sessionId}/messages?limit=10`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(codexHistory.statusCode).toBe(200);
    expect(codexHistory.json().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          role: "tool",
          toolCall: expect.objectContaining({
            callId: "call-shell-1",
            name: "shell_command",
            input: "{\n  \"command\": \"git status --short\"\n}",
            status: "running"
          })
        }),
        expect.objectContaining({
          kind: "tool_result",
          role: "tool",
          toolCall: expect.objectContaining({
            callId: "call-shell-1",
            name: "shell_command",
            output: expect.stringContaining("M src/main.ts"),
            status: "completed"
          })
        })
      ])
    );

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
      canSendMessage: true,
      supportsSubagents: true
    });

    const detail = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${claudeSession.sessionId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      sessionId: claudeSession.sessionId,
      provider: "claude-code"
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

    const sent = await hosted.app.inject({
      method: "POST",
      url: `/api/sessions/${codexSession.sessionId}/messages`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        content: "把前端主链路先接上",
        clientRequestId: "client-request-1"
      }
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      sessionId: codexSession.sessionId,
      clientRequestId: "client-request-1",
      message: {
        role: "user",
        content: "把前端主链路先接上"
      }
    });

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
    expect(started.statusCode).toBe(409);
    expect(started.json()).toMatchObject({
      error_code: "SESSION_START_DEFERRED"
    });

    const schemaTables = hosted.services.database.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(schemaTables.map((item) => item.name)).toContain("session_bindings");
    expect(schemaTables.map((item) => item.name)).toContain("session_indices");
    expect(schemaTables.map((item) => item.name)).toContain("session_states");
    expect(schemaTables.map((item) => item.name)).toContain("session_status_snapshots");

    const bindingColumns = hosted.services.database.db
      .prepare("PRAGMA table_info(session_bindings)")
      .all() as Array<{ name: string }>;
    expect(bindingColumns.map((column) => column.name)).not.toContain("content");
    expect(bindingColumns.map((column) => column.name)).not.toContain("raw_message");

    const sessionStateColumns = hosted.services.database.db
      .prepare("PRAGMA table_info(session_states)")
      .all() as Array<{ name: string }>;
    expect(sessionStateColumns.map((column) => column.name)).not.toContain("is_archived");
  });

  it("发现工作区会话时会忽略 Claude 顶层 Warmup sidechain 调试会话", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);
    writeFileSync(
      path.join(
        fixture.claudeHomeDir,
        "projects",
        "c--Fixtures-Workspace",
        "agent-a18af649.jsonl"
      ),
      [
        JSON.stringify({
          parentUuid: null,
          isSidechain: true,
          userType: "external",
          cwd: fixture.workspaceDir,
          sessionId: "claude-session-1",
          agentId: "a18af649",
          type: "user",
          message: {
            role: "user",
            content: "Warmup"
          },
          uuid: "warmup-user-1",
          timestamp: "2026-03-26T00:00:01.000Z"
        }),
        JSON.stringify({
          parentUuid: "warmup-user-1",
          isSidechain: true,
          userType: "external",
          cwd: fixture.workspaceDir,
          sessionId: "claude-session-1",
          agentId: "a18af649",
          type: "assistant",
          message: {
            id: "msg-warmup-1",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "调试 warmup 回复" }]
          },
          uuid: "warmup-assistant-1",
          timestamp: "2026-03-26T00:00:02.000Z"
        })
      ].join("\n"),
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
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

    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().items).toHaveLength(2);
    expect(
      sessions
        .json()
        .items.some(
          (item: { provider: string; providerSessionId: string; title: string }) =>
            item.provider === "claude-code" &&
            item.providerSessionId === "agent-a18af649"
        )
    ).toBe(false);
  });

  it("继续 Claude 现有会话时会优先认领本次请求之后的新用户消息", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);
    appendFileSync(
      fixture.claudeSessionFile,
      `\n${JSON.stringify({
        type: "user",
        sessionId: "claude-session-1",
        cwd: fixture.workspaceDir,
        timestamp: "2026-03-26T00:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "重复内容" }]
        }
      })}`
    );

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const claudeSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code");

    if (!claudeSession) {
      throw new Error("Claude 会话没有按预期加载出来");
    }

    appendFileSync(
      fixture.claudeSessionFile,
      `\n${JSON.stringify({
        type: "user",
        sessionId: "claude-session-1",
        cwd: fixture.workspaceDir,
        timestamp: "2026-03-26T00:00:05.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "重复内容" }]
        }
      })}`
    );

    const matched = await hosted.services.modules.sessionHistoryService.findLatestUserMessage(
      claudeSession.sessionId,
      "重复内容",
      1,
      "2026-03-26T00:00:04.000Z"
    );

    expect(matched).toBeTruthy();
    expect(matched?.timestamp).toBe("2026-03-26T00:00:05.000Z");
    expect(matched?.sequence).toBeGreaterThan(4);
  });

  it("会跳过 Codex 规则消息标题，并支持手动重命名回写原始记录", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    writeFileSync(
      fixture.codexSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-03-23T09:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-session-1",
            timestamp: "2026-03-23T09:00:00.000Z",
            cwd: fixture.workspaceDir,
            originator: "Codex",
            source: "test"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:05.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message:
              "# AGENTS.md instructions for C:\\\\Code\\\\CodingNS\\n\\n<INSTRUCTIONS>\\n规则正文\\n</INSTRUCTIONS>"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:08.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "真正的用户需求标题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:12.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "已经开始处理"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const codexStateDbPath = path.join(fixture.codexHomeDir, "state_999.sqlite");
    const codexStateDb = new DatabaseSync(codexStateDbPath);
    codexStateDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        created_at INTEGER,
        first_user_message TEXT,
        agent_nickname TEXT,
        agent_role TEXT
      );
    `);
    codexStateDb
      .prepare(
        `INSERT INTO threads (id, title, cwd, created_at, first_user_message, agent_nickname, agent_role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "codex-session-1",
        null,
        fixture.workspaceDir,
        Math.floor(Date.parse("2026-03-23T09:00:00.000Z") / 1000),
        "# AGENTS.md instructions for C:\\Code\\CodingNS\n\n<INSTRUCTIONS>\n规则正文\n</INSTRUCTIONS>",
        null,
        null
      );
    codexStateDb.close();

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const sessionItems = sessions.json().items;
    const codexSession = sessionItems.find((item: { provider: string }) => item.provider === "codex");
    const claudeSession = sessionItems.find(
      (item: { provider: string }) => item.provider === "claude-code"
    );

    if (!codexSession || !claudeSession) {
      throw new Error("测试会话没有按预期加载出来");
    }

    expect(codexSession?.title).toBe("真正的用户需求标题");
    expect(claudeSession).toBeTruthy();

    const renamedCodexTitle = "重命名后的 Codex 会话";
    const renamedCodex = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${codexSession.sessionId}/title`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        title: renamedCodexTitle
      }
    });
    expect(renamedCodex.statusCode).toBe(200);
    expect(renamedCodex.json().title).toBe(renamedCodexTitle);

    const codexIndexLines = readFileSync(path.join(fixture.codexHomeDir, "session_index.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { id?: string; thread_name?: string });
    expect(codexIndexLines.at(-1)).toEqual({
      id: "codex-session-1",
      thread_name: renamedCodexTitle
    });

    const renamedCodexDb = new DatabaseSync(codexStateDbPath, { readOnly: true });
    const codexThreadRow = renamedCodexDb
      .prepare("SELECT title FROM threads WHERE id = ?")
      .get("codex-session-1") as { title: string | null } | undefined;
    renamedCodexDb.close();
    expect(codexThreadRow?.title).toBe(renamedCodexTitle);

    const renamedClaudeTitle = "重命名后的 Claude 会话";
    const renamedClaude = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${claudeSession.sessionId}/title`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        title: renamedClaudeTitle
      }
    });
    expect(renamedClaude.statusCode).toBe(200);
    expect(renamedClaude.json().title).toBe(renamedClaudeTitle);

    const claudeLines = readFileSync(fixture.claudeSessionFile, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { type?: string; aiTitle?: string });
    expect(claudeLines.at(-1)).toEqual({
      type: "ai-title",
      sessionId: "claude-session-1",
      aiTitle: renamedClaudeTitle
    });
  });

  it("已有的 Codex 脏标题缓存会在源文件未变化时被重新解析修正", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const rulesMessage =
      "# AGENTS.md instructions for C:\\\\Code\\\\CodingNS\\n\\n<INSTRUCTIONS>\\n规则正文\\n</INSTRUCTIONS>";
    const realUserTitle = "真正的用户需求标题";

    writeFileSync(
      fixture.codexSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-03-23T09:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-session-1",
            timestamp: "2026-03-23T09:00:00.000Z",
            cwd: fixture.workspaceDir,
            originator: "Codex",
            source: "test"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:05.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: rulesMessage
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:08.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: realUserTitle
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-23T09:00:12.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "已经开始处理"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const codexStateDbPath = path.join(fixture.codexHomeDir, "state_999.sqlite");
    const codexStateDb = new DatabaseSync(codexStateDbPath);
    codexStateDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        created_at INTEGER,
        first_user_message TEXT,
        agent_nickname TEXT,
        agent_role TEXT
      );
    `);
    codexStateDb
      .prepare(
        `INSERT INTO threads (id, title, cwd, created_at, first_user_message, agent_nickname, agent_role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "codex-session-1",
        realUserTitle,
        fixture.workspaceDir,
        Math.floor(Date.parse("2026-03-23T09:00:00.000Z") / 1000),
        realUserTitle,
        null,
        null
      );
    codexStateDb.close();

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const staleSessionId = "stale-codex-host-session";
    const staleUpdatedAt = "2026-03-23T09:00:12.000Z";

    hosted.services.database.db
      .prepare(
        `INSERT INTO session_bindings (
           session_id,
           workspace_id,
           provider,
           provider_session_id,
           raw_store_ref,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        staleSessionId,
        workspaceId,
        "codex",
        "codex-session-1",
        fixture.codexSessionFile,
        staleUpdatedAt,
        staleUpdatedAt
      );
    hosted.services.database.db
      .prepare(
        `INSERT INTO session_indices (
           session_id,
           workspace_id,
           provider,
           title,
           message_count,
           last_message_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        staleSessionId,
        workspaceId,
        "codex",
        rulesMessage.slice(0, 48),
        2,
        staleUpdatedAt,
        staleUpdatedAt,
        staleUpdatedAt
      );

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const codexSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");

    expect(codexSession).toBeTruthy();
    expect(codexSession.sessionId).toBe(staleSessionId);
    expect(codexSession.title).toBe(realUserTitle);

    const corrected = hosted.services.database.db
      .prepare("SELECT title FROM session_indices WHERE session_id = ?")
      .get(staleSessionId) as { title: string };
    expect(corrected.title).toBe(realUserTitle);
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

  it("claude-code 会在消息推送时同步刷新会话列表标题", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const claudeSessionId = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code")?.sessionId;
    expect(claudeSessionId).toBeTruthy();

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    activeClosers.push(() => hosted.app.close());

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("测试服务器地址异常");
    }

    const workbenchSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`
    );
    activeClosers.push(() => workbenchSocket.close());
    const workbenchMessages = createWsMessageQueue(workbenchSocket);
    expect(JSON.parse(await workbenchMessages.next()).type).toBe("system.connected");
    workbenchSocket.send(JSON.stringify({ type: "workbench.subscribe" }));

    const initialSnapshot = await nextWorkbenchSnapshot(workbenchMessages);
    expect(findWorkbenchSession(initialSnapshot, claudeSessionId!)?.title).toBe("Claude 样本会话");

    const sessionSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => sessionSocket.close());
    const sessionMessages = createWsMessageQueue(sessionSocket);
    expect(JSON.parse(await sessionMessages.next()).type).toBe("system.connected");
    sessionSocket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: claudeSessionId,
        limit: 20
      })
    );

    for (let index = 0; index < 3; index += 1) {
      const payload = JSON.parse(await sessionMessages.next()) as { type: string };

      if (payload.type === "session.backfill") {
        break;
      }
    }

    appendFileSync(
      fixture.claudeSessionFile,
      `\n${JSON.stringify({
        type: "ai-title",
        sessionId: "claude-session-1",
        aiTitle: "Claude 新标题"
      })}\n${JSON.stringify({
        type: "assistant",
        sessionId: "claude-session-1",
        cwd: fixture.workspaceDir,
        timestamp: "2026-03-23T08:00:20.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Claude 标题已经更新。" }]
        }
      })}`,
      "utf8"
    );

    const delta = await waitForSessionDelta(sessionMessages);
    expect(delta.messages[0]?.content).toBe("Claude 标题已经更新。");

    const refreshedSessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(refreshedSessions.statusCode).toBe(200);
    expect(
      refreshedSessions
        .json()
        .items.find((item: { sessionId: string }) => item.sessionId === claudeSessionId)?.title
    ).toBe("Claude 新标题");

    await waitForWorkbenchSessionTitle(workbenchMessages, claudeSessionId!, "Claude 新标题");
  });

  it("codex 会在消息推送时同步刷新会话列表标题", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const codexStateDbPath = path.join(fixture.codexHomeDir, "state_999.sqlite");
    const initialDb = new DatabaseSync(codexStateDbPath);
    initialDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        created_at INTEGER,
        archived INTEGER,
        first_user_message TEXT,
        agent_nickname TEXT,
        agent_role TEXT,
        rollout_path TEXT
      );
    `);
    initialDb
      .prepare(
        `INSERT INTO threads (
           id,
           title,
           cwd,
           created_at,
           archived,
           first_user_message,
           agent_nickname,
           agent_role,
           rollout_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "codex-session-1",
        "旧 Codex 标题",
        fixture.workspaceDir,
        Math.floor(Date.parse("2026-03-23T09:00:00.000Z") / 1000),
        0,
        "继续实现 spec002",
        null,
        null,
        fixture.codexSessionFile
      );
    initialDb.close();

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const codexSessionId = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex")?.sessionId;
    expect(codexSessionId).toBeTruthy();

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    activeClosers.push(() => hosted.app.close());

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("测试服务器地址异常");
    }

    const workbenchSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`
    );
    activeClosers.push(() => workbenchSocket.close());
    const workbenchMessages = createWsMessageQueue(workbenchSocket);
    expect(JSON.parse(await workbenchMessages.next()).type).toBe("system.connected");
    workbenchSocket.send(JSON.stringify({ type: "workbench.subscribe" }));

    const initialSnapshot = await nextWorkbenchSnapshot(workbenchMessages);
    expect(findWorkbenchSession(initialSnapshot, codexSessionId!)?.title).toBe("旧 Codex 标题");

    const sessionSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => sessionSocket.close());
    const sessionMessages = createWsMessageQueue(sessionSocket);
    expect(JSON.parse(await sessionMessages.next()).type).toBe("system.connected");
    sessionSocket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: codexSessionId,
        limit: 20
      })
    );

    for (let index = 0; index < 3; index += 1) {
      const payload = JSON.parse(await sessionMessages.next()) as { type: string };

      if (payload.type === "session.backfill") {
        break;
      }
    }

    const updatedDb = new DatabaseSync(codexStateDbPath);
    updatedDb.prepare("UPDATE threads SET title = ? WHERE id = ?").run("新 Codex 标题", "codex-session-1");
    updatedDb.close();

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:20.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "Codex 标题已经刷新。"
        }
      })}`,
      "utf8"
    );

    const delta = await waitForSessionDelta(sessionMessages);
    expect(delta.messages[0]?.content).toBe("Codex 标题已经刷新。");

    await waitForWorkbenchSessionTitle(workbenchMessages, codexSessionId!, "新 Codex 标题");
  });

  it("session_state 涓夋€佹祦杞」", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);
    writeFileSync(fixture.claudeSessionFile, "", "utf8");
    writeCodexSessionFile({
      codexHomeDir: fixture.codexHomeDir,
      workspaceDir: fixture.workspaceDir,
      fileName: "codex-session-1",
      timestamps: [
        "2026-03-23T09:00:00.000Z",
        "2026-03-23T09:00:05.000Z",
        "2026-03-23T09:00:08.000Z"
      ],
      includeToolCall: true
    });

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const firstList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(firstList.statusCode).toBe(200);

    const runningSession = firstList
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(runningSession).toMatchObject({
      runningState: "running",
      activityState: "running"
    });

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:10.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-shell-1",
          output: "Exit code: 0\nOutput:\nall good"
        }
      })}`,
      "utf8"
    );

    const unreadList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(unreadList.statusCode).toBe(200);

    const unreadSession = unreadList
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(unreadSession.runningState).toBe("idle");
    expect(unreadSession.activityState).toBe("completed_unread");
    expect(unreadSession.completedAt).toBe("2026-03-23T09:00:10.000Z");
    expect(unreadSession.lastSeenAt).toBeNull();

    const seen = await hosted.app.inject({
      method: "POST",
      url: `/api/sessions/${unreadSession.sessionId}/seen`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(seen.statusCode).toBe(204);

    const idleList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(idleList.statusCode).toBe(200);

    const idleSession = idleList
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(idleSession.activityState).toBe("idle");
    expect(idleSession.lastSeenAt).toBeTruthy();

    const archive = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${idleSession.sessionId}/archive`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        archived: true
      }
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().isArchived).toBe(true);

    const archivedList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(archivedList.statusCode).toBe(200);

    const archivedSession = archivedList
      .json()
      .items.find((item: { sessionId: string }) => item.sessionId === idleSession.sessionId);
    expect(archivedSession?.isArchived).toBe(true);

    const unarchive = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${idleSession.sessionId}/archive`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        archived: false
      }
    });
    expect(unarchive.statusCode).toBe(200);
    expect(unarchive.json().isArchived).toBe(false);
  });

  it("鍙埛鏂版渶杩?10 鏉′細璇濈姸鎬?", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);
    writeFileSync(fixture.claudeSessionFile, "", "utf8");

    for (let index = 0; index < 12; index += 1) {
      const minute = String(index).padStart(2, "0");
      writeCodexSessionFile({
        codexHomeDir: fixture.codexHomeDir,
        workspaceDir: fixture.workspaceDir,
        fileName: `codex-session-${index + 1}`,
        timestamps: [
          `2026-03-23T09:${minute}:00.000Z`,
          `2026-03-23T09:${minute}:10.000Z`,
          `2026-03-23T09:${minute}:20.000Z`
        ]
      });
    }

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const list = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(12);

    const stateRows = hosted.services.database.db
      .prepare("SELECT session_id FROM session_states ORDER BY updated_at DESC")
      .all() as Array<{ session_id: string }>;
    expect(stateRows).toHaveLength(10);
    expect(stateRows.map((row) => row.session_id).sort()).toEqual(
      list
        .json()
        .items.slice(0, 10)
        .map((item: { sessionId: string }) => item.sessionId)
        .sort()
    );
    expect(list.json().items[10].runningState).toBeNull();
    expect(list.json().items[11].runningState).toBeNull();
  });
  it("会把历史工具写文件结果回填为正式会话索引，并把绝对路径归一成工作区相对路径", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:14.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-apply-patch-1",
          name: "apply_patch",
          arguments: `*** Begin Patch\n*** Update File: ${fixture.workspaceDir.replace(/\\/g, "/")}/.gitignore\n*** End Patch`
        }
      })}`,
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const codexSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(codexSession).toBeTruthy();

    const changedFiles = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${codexSession.sessionId}/changed-files`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(changedFiles.statusCode).toBe(200);
    expect(changedFiles.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ".gitignore",
          lastToolName: "apply_patch"
        })
      ])
    );

    const storedFiles = hosted.services.database.db
      .prepare(
        "SELECT path, last_tool_name FROM session_changed_files WHERE session_id = ? ORDER BY path"
      )
      .all(codexSession.sessionId) as Array<{ path: string; last_tool_name: string | null }>;
    expect(storedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ".gitignore",
          last_tool_name: "apply_patch"
        })
      ])
    );

    const indexState = hosted.services.database.db
      .prepare("SELECT indexed_at FROM session_changed_file_states WHERE session_id = ?")
      .get(codexSession.sessionId) as { indexed_at: string } | undefined;
    expect(indexState?.indexed_at).toBeTruthy();
  });

  it("claude-code 归档只认 session_indices，discover 和 workbench 订阅都不会把它刷回未归档", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const claudeSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code");

    if (!claudeSession) {
      throw new Error("未找到 claude-code 测试会话");
    }

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("测试服务地址异常");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => socket.close());
    const queue = createWsMessageQueue(socket);

    expect(JSON.parse(await queue.next()).type).toBe("system.connected");

    socket.send(
      JSON.stringify({
        type: "workbench.subscribe"
      })
    );

    const initialSnapshot = await nextWorkbenchSnapshot(queue);
    expect(findWorkbenchSession(initialSnapshot, claudeSession.sessionId)?.isArchived).toBe(false);

    const archive = await hosted.app.inject({
      method: "PATCH",
      url: `/api/sessions/${claudeSession.sessionId}/archive`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        archived: true
      }
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().isArchived).toBe(true);

    const storedFlags = hosted.services.database.db
      .prepare(
        `SELECT indices.is_archived AS index_archived
         FROM session_indices indices
         WHERE indices.session_id = ?`
      )
      .get(claudeSession.sessionId) as {
      index_archived: number;
    };
    expect(storedFlags.index_archived).toBe(1);

    const sessionStateColumns = hosted.services.database.db
      .prepare("PRAGMA table_info(session_states)")
      .all() as Array<{ name: string }>;
    expect(sessionStateColumns.map((column) => column.name)).not.toContain("is_archived");

    const archivedList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(archivedList.statusCode).toBe(200);

    const archivedClaudeSession = archivedList
      .json()
      .items.find((item: { sessionId: string }) => item.sessionId === claudeSession.sessionId);
    expect(archivedClaudeSession?.isArchived).toBe(true);

    socket.send(
      JSON.stringify({
        type: "workbench.subscribe"
      })
    );

    const archivedSnapshot = await nextWorkbenchSnapshot(queue);
    expect(findWorkbenchSession(archivedSnapshot, claudeSession.sessionId)?.isArchived).toBe(true);
  });

  it("Codex 会话只要文件已经进入 archived_sessions，就必须判定为已归档", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const archivedDir = path.join(fixture.codexHomeDir, "archived_sessions");
    const archivedFile = path.join(archivedDir, "codex-session-1.jsonl");
    mkdirSync(archivedDir, { recursive: true });
    renameSync(fixture.codexSessionFile, archivedFile);

    const codexStateDbPath = path.join(fixture.codexHomeDir, "state_999.sqlite");
    const codexStateDb = new DatabaseSync(codexStateDbPath);
    codexStateDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        created_at INTEGER,
        archived INTEGER,
        first_user_message TEXT,
        agent_nickname TEXT,
        agent_role TEXT,
        rollout_path TEXT
      );
    `);
    codexStateDb
      .prepare(
        `INSERT INTO threads (
           id,
           title,
           cwd,
           created_at,
           archived,
           first_user_message,
           agent_nickname,
           agent_role,
           rollout_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "codex-session-1",
        "已经归档的 Codex 会话",
        fixture.workspaceDir,
        Math.floor(Date.parse("2026-03-23T09:00:00.000Z") / 1000),
        0,
        "继续实现 spec002",
        null,
        null,
        fixture.codexSessionFile
      );
    codexStateDb.close();

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const codexSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");

    expect(codexSession).toBeTruthy();
    expect(codexSession.rawStoreRef).toBe(archivedFile);
    expect(codexSession.isArchived).toBe(true);
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
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

  return login.json().accessToken as string;
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
      name: "Fixture Workspace"
    }
  });

  expect(imported.statusCode).toBe(201);
  return imported.json().id as string;
}

async function nextWorkbenchSnapshot(
  queue: ReturnType<typeof createWsMessageQueue>,
  timeoutMs = 2000
): Promise<{
  items: Array<{
    workspace: { id: string };
    sessions: Array<{ sessionId: string; isArchived: boolean; title?: string }>;
  }>;
}> {
  while (true) {
    const payload = JSON.parse(await queue.next(timeoutMs)) as {
      type: string;
      snapshot?: {
        items: Array<{
          workspace: { id: string };
          sessions: Array<{ sessionId: string; isArchived: boolean; title?: string }>;
        }>;
      };
    };

    if (payload.type === "workbench.snapshot" && payload.snapshot) {
      return payload.snapshot;
    }
  }
}

function findWorkbenchSession(
  snapshot: {
    items: Array<{
      sessions: Array<{ sessionId: string; isArchived: boolean; title?: string }>;
    }>;
  },
  sessionId: string
): { sessionId: string; isArchived: boolean; title?: string } | undefined {
  return snapshot.items
    .flatMap((item) => item.sessions)
    .find((session) => session.sessionId === sessionId);
}

async function waitForSessionDelta(
  queue: ReturnType<typeof createWsMessageQueue>,
  timeoutMs = 2500
): Promise<{
  sessionId: string;
  cursor: string | null;
  messages: Array<{ content: string }>;
}> {
  while (true) {
    const payload = JSON.parse(await queue.next(timeoutMs)) as {
      type: string;
      sessionId?: string;
      cursor?: string | null;
      messages?: Array<{ content: string }>;
    };

    if (payload.type === "session.delta" && payload.sessionId && payload.messages) {
      return {
        sessionId: payload.sessionId,
        cursor: payload.cursor ?? null,
        messages: payload.messages
      };
    }
  }
}

async function waitForWorkbenchSessionTitle(
  queue: ReturnType<typeof createWsMessageQueue>,
  sessionId: string,
  expectedTitle: string,
  timeoutMs = 2500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await nextWorkbenchSnapshot(queue, Math.max(50, deadline - Date.now()));

    if (findWorkbenchSession(snapshot, sessionId)?.title === expectedTitle) {
      return;
    }
  }

  throw new Error(`等待 workbench 标题更新超时: ${expectedTitle}`);
}

function writeCodexSessionFile(input: {
  codexHomeDir: string;
  workspaceDir: string;
  fileName: string;
  timestamps: [string, string, string];
  includeToolCall?: boolean;
}): string {
  const sessionDir = path.join(input.codexHomeDir, "sessions", "2026", "03", "23");
  const sessionFile = path.join(sessionDir, `${input.fileName}.jsonl`);
  mkdirSync(sessionDir, { recursive: true });

  const lines = [
    JSON.stringify({
      timestamp: input.timestamps[0],
      type: "session_meta",
      payload: {
        id: input.fileName,
        timestamp: input.timestamps[0],
        cwd: input.workspaceDir,
        originator: "Codex",
        source: "test"
      }
    }),
    JSON.stringify({
      timestamp: input.timestamps[1],
      type: "event_msg",
      payload: {
        type: "user_message",
        message: `${input.fileName} user message`
      }
    }),
    JSON.stringify({
      timestamp: input.timestamps[2],
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: `${input.fileName} assistant message`
      }
    })
  ];

  if (input.includeToolCall) {
    lines.push(
      JSON.stringify({
        timestamp: "2026-03-23T09:00:09.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-shell-1",
          name: "shell_command",
          arguments: {
            command: "git status --short"
          }
        }
      })
    );
  }

  writeFileSync(sessionFile, lines.join("\n"), "utf8");
  return sessionFile;
}

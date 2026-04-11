import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { OpenCodeAdapter } from "../dist/index.js";

test("OpenCodeAdapter 会暴露 OpenCode 已接入后的能力边界", () => {
  const adapter = new OpenCodeAdapter({ dbPath: "/tmp/codingns-opencode.db" });
  const capabilities = adapter.getProviderCapabilities();

  assert.equal(capabilities.provider, "opencode");
  assert.equal(capabilities.canStartSession, true);
  assert.equal(capabilities.canResumeSession, true);
  assert.equal(capabilities.canSendMessage, true);
  assert.equal(capabilities.supportsStructuredToolCalls, true);
  assert.equal(capabilities.supportsInterrupt, true);
  assert.equal(capabilities.supportsAsyncPrompt, true);
  assert.equal(capabilities.supportsNativeAgents, true);
  assert.equal(capabilities.inRunInputMode, "none");
});

test("OpenCodeAdapter 能按 workspace 发现会话并返回稳定 rawStoreRef", async () => {
  const fixture = createOpenCodeFixture();

  try {
    const adapter = new OpenCodeAdapter({ dbPath: fixture.dbPath });
    const sessions = await adapter.detectSessions("/workspace/demo");

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.provider, "opencode");
    assert.equal(sessions[0]?.providerSessionId, "ses_demo");
    assert.equal(sessions[0]?.workspacePath, "/workspace/demo");
    assert.equal(sessions[0]?.rawStoreRef, "opencode://session/ses_demo");
    assert.equal(sessions[0]?.messageCount, 2);
    assert.equal(sessions[0]?.isArchived, false);
  } finally {
    fixture.dispose();
  }
});

test("OpenCodeAdapter 旧消息发送路径在非 default permissionMode 下也只会沿用 OpenCode 当前配置", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    requests.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : null
    });

    if (url === "http://127.0.0.1:41827/session/ses_send_permission/message" && method === "POST") {
      return jsonResponse({});
    }

    if (url === "http://127.0.0.1:41827/session/ses_send_permission/message?limit=20" && method === "GET") {
      return jsonResponse([]);
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    dbPath: "/tmp/codingns-opencode.db"
  });

  const result = await adapter.sendMessage(
    "ses_send_permission",
    "opencode://session/ses_send_permission",
    "继续执行",
    "client-1",
    "bypassPermissions"
  );

  const messageRequest = requests.find(
    (request) => request.method === "POST" && request.url.endsWith("/session/ses_send_permission/message")
  );
  assert.ok(messageRequest);
  assert.deepEqual(JSON.parse(messageRequest.body), {
    parts: [
      {
        type: "text",
        text: "继续执行"
      }
    ]
  });
  assert.equal(result.clientRequestId, "client-1");
  assert.equal(result.message.content, "继续执行");
});

test("OpenCodeAdapter 会用 knownSessions 补回 server 短暂漏掉的会话，并标记发现结果不完整", async (context) => {
  const fixture = createOpenCodeFixture();
  const originalFetch = globalThis.fetch;
  const db = new DatabaseSync(fixture.dbPath);

  db.prepare(
    `INSERT INTO session (
      id,
      project_id,
      parent_id,
      slug,
      directory,
      title,
      version,
      time_created,
      time_updated,
      time_archived,
      workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "ses_hidden",
    "global",
    null,
    "hidden",
    "/workspace/demo",
    "Hidden Session",
    "v1",
    1_700_000_030_000,
    1_700_000_040_000,
    null,
    null
  );
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "msg_hidden_user",
    "ses_hidden",
    1_700_000_030_100,
    1_700_000_030_100,
    JSON.stringify({
      role: "user",
      time: {
        created: 1_700_000_030_100
      }
    })
  );
  db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    "prt_hidden_text",
    "msg_hidden_user",
    "ses_hidden",
    1_700_000_030_200,
    1_700_000_030_200,
    JSON.stringify({
      type: "text",
      text: "retained"
    })
  );
  db.close();

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "http://127.0.0.1:41827/session?directory=%2Fworkspace%2Fdemo&roots=true") {
      return jsonResponse([
        {
          id: "ses_demo",
          directory: "/workspace/demo",
          title: "Demo Session",
          time: {
            created: 1_700_000_000_000,
            updated: 1_700_000_020_000
          }
        }
      ]);
    }

    throw new Error(`unexpected request: ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  try {
    const adapter = new OpenCodeAdapter({
      baseUrl: "http://127.0.0.1:41827",
      dbPath: fixture.dbPath
    });
    const discovery = await adapter.detectSessionsDetailed("/workspace/demo", {
      knownSessions: [
        {
          provider: "opencode",
          providerSessionId: "ses_hidden",
          title: "Hidden Session",
          workspacePath: "/workspace/demo",
          rawStoreRef: "opencode://session/ses_hidden",
          lastMessageAt: "2023-11-14T22:18:50.100Z",
          messageCount: 1
        }
      ]
    });

    assert.equal(discovery.isComplete, false);
    assert.deepEqual(
      discovery.sessions.map((session) => session.providerSessionId).sort(),
      ["ses_demo", "ses_hidden"]
    );
  } finally {
    fixture.dispose();
  }
});

test("OpenCodeAdapter 在 server 请求超时时会回退 sqlite 发现会话", async (context) => {
  const fixture = createOpenCodeFixture();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init = {}) => {
    return await new Promise((_resolve, reject) => {
      const signal = init.signal;

      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };

      if (signal?.aborted) {
        abort();
        return;
      }

      signal?.addEventListener("abort", abort, { once: true });
    });
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  try {
    const adapter = new OpenCodeAdapter({
      baseUrl: "http://127.0.0.1:41827",
      dbPath: fixture.dbPath,
      requestTimeoutMs: 5
    });
    const discovery = await adapter.detectSessionsDetailed("/workspace/demo");

    assert.equal(discovery.isComplete, true);
    assert.equal(discovery.sessions.length, 1);
    assert.equal(discovery.sessions[0]?.providerSessionId, "ses_demo");
  } finally {
    fixture.dispose();
  }
});

test("OpenCodeAdapter 新建会话时会把 directory 同时写进 query 和 body", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    requests.push({
      url,
      method,
      body: typeof init.body === "string" ? init.body : null
    });

    if (url === "http://127.0.0.1:41827/session?directory=%2Fworkspace%2Fdemo" && method === "POST") {
      return jsonResponse({
        id: "ses_new",
        title: "Demo Session"
      });
    }

    if (url === "http://127.0.0.1:41827/session/ses_new/message" && method === "POST") {
      return jsonResponse({});
    }

    if (url === "http://127.0.0.1:41827/session/ses_new/message?limit=20" && method === "GET") {
      return jsonResponse([]);
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeAdapter({
    baseUrl: "http://127.0.0.1:41827"
  });
  const result = await adapter.startSession("/workspace/demo", {
    initialPrompt: "请帮我记录测试"
  });

  assert.equal(result.session.providerSessionId, "ses_new");

  const sessionCreateRequest = requests.find(
    (request) => request.method === "POST" && request.url === "http://127.0.0.1:41827/session?directory=%2Fworkspace%2Fdemo"
  );
  assert.ok(sessionCreateRequest);
  assert.equal(JSON.parse(sessionCreateRequest.body).directory, "/workspace/demo");
});

test("OpenCodeAdapter 能把核心 part 类型映射到统一消息模型", async () => {
  const fixture = createOpenCodeFixture();

  try {
    const adapter = new OpenCodeAdapter({ dbPath: fixture.dbPath });
    const page = await adapter.readSessionHistory(
      "ses_demo",
      "opencode://session/ses_demo",
      null,
      50
    );

    assert.equal(page.messages.length, 5);
    assert.equal(page.messages[0]?.role, "user");
    assert.equal(page.messages[0]?.kind, "text");
    assert.equal(page.messages[0]?.content, "你好，OpenCode");

    assert.equal(page.messages[1]?.kind, "thinking");
    assert.equal(page.messages[1]?.content, "先分析一下问题");

    assert.equal(page.messages[2]?.kind, "tool_call");
    assert.equal(page.messages[2]?.toolCall?.name, "bash");
    assert.equal(page.messages[2]?.toolCall?.status, "running");

    assert.equal(page.messages[3]?.kind, "tool_result");
    assert.equal(page.messages[3]?.toolCall?.status, "completed");
    assert.equal(page.messages[3]?.content.includes("README.md"), true);

    assert.equal(page.messages[4]?.kind, "tool_call");
    assert.equal(page.messages[4]?.toolCall?.name, "apply_patch");
    assert.ok(page.messages[4]?.content.includes("*** Begin Patch"));
    assert.ok(page.messages[4]?.content.includes("styles.css"));
    assert.equal(
      page.messages[3]?.rawRef,
      "opencode://session/ses_demo/message/msg_demo_assistant/part/prt_demo_tool_done"
    );
    assert.equal(page.messages[4]?.sequence, 5);
    assert.equal(page.nextCursor, null);
  } finally {
    fixture.dispose();
  }
});

test("OpenCodeAdapter 的历史分页支持 backward 读取", async () => {
  const fixture = createOpenCodeFixture();

  try {
    const adapter = new OpenCodeAdapter({ dbPath: fixture.dbPath });
    const page = await adapter.readSessionHistory(
      "ses_demo",
      "opencode://session/ses_demo",
      null,
      2,
      "backward"
    );

    assert.equal(page.messages.length, 2);
    assert.equal(page.messages[0]?.content.includes("README.md"), true);
    assert.equal(page.messages[1]?.toolCall?.name, "apply_patch");
    assert.ok(page.messages[1]?.content.includes("*** Begin Patch"));
    assert.ok(page.nextCursor);
  } finally {
    fixture.dispose();
  }
});

test("OpenCodeAdapter 只会保留真正的 reasoning 内容，不会把 step 事件伪装成思考", async (context) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "http://127.0.0.1:41827/session/ses_reasoning_only/message?limit=100") {
      return jsonResponse([
        {
          info: {
            id: "msg_user_1",
            sessionID: "ses_reasoning_only",
            role: "user",
            time: {
              created: 1
            }
          },
          parts: [
            {
              id: "prt_user_1",
              messageID: "msg_user_1",
              sessionID: "ses_reasoning_only",
              type: "text",
              text: "测试"
            }
          ]
        },
        {
          info: {
            id: "msg_assistant_1",
            sessionID: "ses_reasoning_only",
            role: "assistant",
            time: {
              created: 2
            }
          },
          parts: [
            {
              id: "prt_step_start",
              messageID: "msg_assistant_1",
              sessionID: "ses_reasoning_only",
              type: "step-start"
            },
            {
              id: "prt_reasoning",
              messageID: "msg_assistant_1",
              sessionID: "ses_reasoning_only",
              type: "reasoning",
              text: "这里才是真正的思考"
            },
            {
              id: "prt_step_finish",
              messageID: "msg_assistant_1",
              sessionID: "ses_reasoning_only",
              type: "step-finish",
              reason: "stop"
            },
            {
              id: "prt_text",
              messageID: "msg_assistant_1",
              sessionID: "ses_reasoning_only",
              type: "text",
              text: "最终回答",
              time: {
                end: 3
              }
            }
          ]
        }
      ]);
    }

    throw new Error(`unexpected request: ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    dbPath: "/tmp/codingns-opencode.db"
  });

  const page = await adapter.readSessionHistory(
    "ses_reasoning_only",
    "opencode://session/ses_reasoning_only",
    null,
    10,
    "forward"
  );

  assert.deepEqual(
    page.messages.map((message) => ({ kind: message.kind, content: message.content })),
    [
      { kind: "text", content: "测试" },
      { kind: "thinking", content: "这里才是真正的思考" },
      { kind: "text", content: "最终回答" }
    ]
  );
});

test("OpenCodeAdapter 不会把空 text part 序列化成 JSON 正文", async (context) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "http://127.0.0.1:41827/session/ses_empty_text/message?limit=100") {
      return jsonResponse([
        {
          info: {
            id: "msg_assistant_1",
            sessionID: "ses_empty_text",
            role: "assistant",
            time: {
              created: 1
            }
          },
          parts: [
            {
              id: "prt_empty_text",
              messageID: "msg_assistant_1",
              sessionID: "ses_empty_text",
              type: "text",
              text: "",
              time: {
                start: 1
              },
              metadata: {
                openai: {
                  itemId: "msg_raw"
                }
              }
            },
            {
              id: "prt_final_text",
              messageID: "msg_assistant_1",
              sessionID: "ses_empty_text",
              type: "text",
              text: "4567",
              time: {
                start: 2,
                end: 2
              }
            }
          ]
        }
      ]);
    }

    throw new Error(`unexpected request: ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    dbPath: "/tmp/codingns-opencode.db"
  });

  const page = await adapter.readSessionHistory(
    "ses_empty_text",
    "opencode://session/ses_empty_text",
    null,
    10,
    "forward"
  );

  assert.deepEqual(
    page.messages.map((message) => message.content),
    ["4567"]
  );
});

test("OpenCodeAdapter 会保留服务端消息的正序，避免新增消息倒插到顶部", async (context) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "http://127.0.0.1:41827/session/ses_server_order/message?limit=100") {
      return jsonResponse([
        {
          info: {
            id: "msg_user_1",
            sessionID: "ses_server_order",
            role: "user",
            time: {
              created: 1
            }
          },
          parts: [
            {
              id: "prt_user_1",
              messageID: "msg_user_1",
              sessionID: "ses_server_order",
              type: "text",
              text: "第一条"
            }
          ]
        },
        {
          info: {
            id: "msg_assistant_1",
            sessionID: "ses_server_order",
            role: "assistant",
            time: {
              created: 2
            }
          },
          parts: [
            {
              id: "prt_assistant_1",
              messageID: "msg_assistant_1",
              sessionID: "ses_server_order",
              type: "text",
              text: "第一条回复",
              time: {
                end: 2
              }
            }
          ]
        },
        {
          info: {
            id: "msg_user_2",
            sessionID: "ses_server_order",
            role: "user",
            time: {
              created: 3
            }
          },
          parts: [
            {
              id: "prt_user_2",
              messageID: "msg_user_2",
              sessionID: "ses_server_order",
              type: "text",
              text: "第二条"
            }
          ]
        },
        {
          info: {
            id: "msg_assistant_2",
            sessionID: "ses_server_order",
            role: "assistant",
            time: {
              created: 4
            }
          },
          parts: [
            {
              id: "prt_assistant_2",
              messageID: "msg_assistant_2",
              sessionID: "ses_server_order",
              type: "text",
              text: "第二条回复",
              time: {
                end: 4
              }
            }
          ]
        }
      ]);
    }

    throw new Error(`unexpected request: ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    dbPath: "/tmp/codingns-opencode.db"
  });

  const firstPage = await adapter.readSessionHistory(
    "ses_server_order",
    "opencode://session/ses_server_order",
    null,
    10,
    "forward"
  );

  assert.deepEqual(
    firstPage.messages.map((message) => message.content),
    ["第一条", "第一条回复", "第二条", "第二条回复"]
  );
  assert.equal(firstPage.cursor !== null, true);

  const deltaPage = await adapter.readSessionHistory(
    "ses_server_order",
    "opencode://session/ses_server_order",
    firstPage.cursor,
    10,
    "forward"
  );

  assert.equal(deltaPage.messages.length, 0);
});

test("OpenCodeAdapter 遇到倒序返回的 OpenCode 用户消息时，会按时间线重排", async (context) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "http://127.0.0.1:41827/session/ses_reverse_user_order/message?limit=100") {
      return jsonResponse([
        {
          info: {
            id: "msg_user_3",
            sessionID: "ses_reverse_user_order",
            role: "user",
            time: {
              created: 3
            }
          },
          parts: [
            {
              id: "prt_user_3",
              messageID: "msg_user_3",
              sessionID: "ses_reverse_user_order",
              type: "text",
              text: "第三句"
            }
          ]
        },
        {
          info: {
            id: "msg_user_2",
            sessionID: "ses_reverse_user_order",
            role: "user",
            time: {
              created: 2
            }
          },
          parts: [
            {
              id: "prt_user_2",
              messageID: "msg_user_2",
              sessionID: "ses_reverse_user_order",
              type: "text",
              text: "第二句"
            }
          ]
        },
        {
          info: {
            id: "msg_user_1",
            sessionID: "ses_reverse_user_order",
            role: "user",
            time: {
              created: 1
            }
          },
          parts: [
            {
              id: "prt_user_1",
              messageID: "msg_user_1",
              sessionID: "ses_reverse_user_order",
              type: "text",
              text: "第一句"
            }
          ]
        }
      ]);
    }

    throw new Error(`unexpected request: ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    dbPath: "/tmp/codingns-opencode.db"
  });

  const page = await adapter.readSessionHistory(
    "ses_reverse_user_order",
    "opencode://session/ses_reverse_user_order",
    null,
    10,
    "forward"
  );

  assert.deepEqual(
    page.messages.map((message) => message.content),
    ["第一句", "第二句", "第三句"]
  );
  assert.deepEqual(
    page.messages.map((message) => message.sequence),
    [1, 2, 3]
  );
});

test("OpenCodeAdapter 会话级 fork 会复制 sqlite 会话并返回统一 fork 元数据", async () => {
  const fixture = createOpenCodeFixture();

  try {
    const adapter = new OpenCodeAdapter({ dbPath: fixture.dbPath });
    const result = await adapter.forkSession("ses_demo", "/workspace/demo", {
      rawStoreRef: "opencode://session/ses_demo",
      sourceType: "session"
    });
    const page = await adapter.readSessionHistory(
      result.session.providerSessionId,
      result.session.rawStoreRef,
      null,
      20,
      "forward"
    );

    assert.equal(result.forkMethod, "native_session_fork");
    assert.equal(result.forkSourceType, "session");
    assert.equal(result.inheritedPrefixMessageCount, 5);
    assert.equal(result.session.messageCount, 5);
    assert.equal(result.session.title, "你好，OpenCode");
    assert.equal(page.messages[0]?.content, "你好，OpenCode");
    assert.equal(page.messages[1]?.content, "先分析一下问题");
    assert.match(page.messages[2]?.content ?? "", /command/);
    assert.equal(page.messages[3]?.content, "README.md\nsrc");
    assert.match(page.messages[4]?.content ?? "", /\*\*\* Begin Patch/);
    assert.match(page.messages[4]?.content ?? "", /styles\.css/);
  } finally {
    fixture.dispose();
  }
});

test("OpenCodeAdapter 消息级 fork 会精确截断到指定 part 锚点", async () => {
  const fixture = createOpenCodeFixture();

  try {
    const adapter = new OpenCodeAdapter({ dbPath: fixture.dbPath });
    const sourcePage = await adapter.readSessionHistory(
      "ses_demo",
      "opencode://session/ses_demo",
      null,
      20,
      "forward"
    );
    const anchorMessage = sourcePage.messages[1];

    assert.ok(anchorMessage);
    assert.equal(anchorMessage?.content, "先分析一下问题");

    const result = await adapter.forkSession("ses_demo", "/workspace/demo", {
      rawStoreRef: "opencode://session/ses_demo",
      sourceType: "message",
      sourceMessageId: anchorMessage.messageId
    });
    const page = await adapter.readSessionHistory(
      result.session.providerSessionId,
      result.session.rawStoreRef,
      null,
      20,
      "forward"
    );

    assert.equal(result.forkMethod, "native_message_fork");
    assert.equal(result.forkSourceType, "message");
    assert.equal(result.inheritedPrefixMessageCount, 2);
    assert.equal(result.session.messageCount, 2);
    assert.equal(result.session.title, "你好，OpenCode");
    assert.equal(result.providerSourceMessageId, "prt_demo_reasoning");
    assert.deepEqual(
      page.messages.map((message) => message.content),
      ["你好，OpenCode", "先分析一下问题"]
    );
  } finally {
    fixture.dispose();
  }
});

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
}

function createOpenCodeFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-opencode-adapter-"));
  const dbPath = join(tempDir, "opencode.db");
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      share_url TEXT,
      summary_additions INTEGER,
      summary_deletions INTEGER,
      summary_files INTEGER,
      summary_diffs TEXT,
      revert TEXT,
      permission TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      time_compacting INTEGER,
      time_archived INTEGER,
      workspace_id TEXT
    );

    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  db.prepare(
    `INSERT INTO session (
      id,
      project_id,
      parent_id,
      slug,
      directory,
      title,
      version,
      time_created,
      time_updated,
      time_archived,
      workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "ses_demo",
    "global",
    null,
    "demo",
    "/workspace/demo",
    "Demo Session",
    "v1",
    1_700_000_000_000,
    1_700_000_020_000,
    null,
    null
  );

  db.prepare(
    `INSERT INTO session (
      id,
      project_id,
      parent_id,
      slug,
      directory,
      title,
      version,
      time_created,
      time_updated,
      time_archived,
      workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "ses_other",
    "global",
    null,
    "other",
    "/workspace/other",
    "Other Session",
    "v1",
    1_700_000_100_000,
    1_700_000_110_000,
    null,
    null
  );

  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "msg_demo_user",
    "ses_demo",
    1_700_000_001_000,
    1_700_000_001_200,
    JSON.stringify({
      role: "user",
      time: {
        created: 1_700_000_001_000
      }
    })
  );
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_000,
    1_700_000_020_000,
    JSON.stringify({
      role: "assistant",
      time: {
        created: 1_700_000_002_000,
        completed: 1_700_000_020_000
      }
    })
  );
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "msg_other_user",
    "ses_other",
    1_700_000_100_200,
    1_700_000_100_200,
    JSON.stringify({
      role: "user",
      time: {
        created: 1_700_000_100_200
      }
    })
  );

  const insertPart = db.prepare(
    `INSERT INTO part (
      id,
      message_id,
      session_id,
      time_created,
      time_updated,
      data
    ) VALUES (?, ?, ?, ?, ?, ?)`
  );

  insertPart.run(
    "prt_demo_user_text",
    "msg_demo_user",
    "ses_demo",
    1_700_000_001_100,
    1_700_000_001_100,
    JSON.stringify({
      type: "text",
      text: "你好，OpenCode"
    })
  );
  insertPart.run(
    "prt_demo_step_start",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_100,
    1_700_000_002_100,
    JSON.stringify({
      type: "step-start"
    })
  );
  insertPart.run(
    "prt_demo_reasoning",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_200,
    1_700_000_002_200,
    JSON.stringify({
      type: "reasoning",
      text: "先分析一下问题"
    })
  );
  insertPart.run(
    "prt_demo_tool_running",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_300,
    1_700_000_002_300,
    JSON.stringify({
      type: "tool",
      callID: "call-1",
      tool: "bash",
      state: {
        status: "running",
        input: {
          command: "ls"
        }
      }
    })
  );
  insertPart.run(
    "prt_demo_tool_done",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_400,
    1_700_000_002_400,
    JSON.stringify({
      type: "tool",
      callID: "call-1",
      tool: "bash",
      state: {
        status: "completed",
        input: {
          command: "ls"
        },
        output: "README.md\nsrc"
      }
    })
  );
  insertPart.run(
    "prt_demo_patch",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_500,
    1_700_000_002_500,
    JSON.stringify({
      type: "patch",
      hash: "604cbacfa354f74120047742bfa43e935249c817",
      files: [
        "/Users/jackson/Code/CodingNS/apps/user-app/src/app/styles.css"
      ]
    })
  );
  insertPart.run(
    "prt_demo_step_finish",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_600,
    1_700_000_002_600,
    JSON.stringify({
      type: "step-finish",
      reason: "stop"
    })
  );
  insertPart.run(
    "prt_other_text",
    "msg_other_user",
    "ses_other",
    1_700_000_100_300,
    1_700_000_100_300,
    JSON.stringify({
      type: "text",
      text: "other"
    })
  );

  db.close();

  return {
    dbPath,
    dispose() {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

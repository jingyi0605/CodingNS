import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { CodexAdapter } from "../dist/index.js";

test("CodexAdapter 会如实声明 queued guidance 的产品语义与当前 SDK 接入限制", async () => {
  const adapter = new CodexAdapter({ homeDir: "/tmp/codingns-codex-capabilities" });
  const capabilities = adapter.getProviderCapabilities();

  assert.equal(capabilities.inRunInputMode, "none");
  assert.equal(
    capabilities.limitations.some(
      (item) => item.includes("加入队列") && item.includes("SDK 0.116.0")
    ),
    true
  );
});

test("CodexAdapter 会优先保留 response_item，并忽略末尾空白差异导致的重复消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-adapter-"));
  const sessionFile = join(tempDir, "session.jsonl");

  try {
    const lines = [
      JSON.stringify({
        timestamp: "2026-03-23T15:17:05.614Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "用户消息" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T15:17:05.614Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "用户消息\n"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T15:17:41.897Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "助手消息"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T15:17:41.898Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "助手消息" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T15:17:50.000Z",
        type: "event_msg",
        payload: {
          type: "agent_reasoning",
          text: "思考消息"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T15:17:50.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "思考消息" }]
        }
      })
    ];

    writeFileSync(sessionFile, lines.join("\n"), "utf8");

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory("session-1", sessionFile, null, 50);

    assert.equal(page.messages.length, 3);
    assert.deepEqual(
      page.messages.map((message) => ({
        role: message.role,
        kind: message.kind,
        content: message.content,
        sequence: message.sequence,
        rawRef: message.rawRef
      })),
      [
        {
          role: "user",
          kind: "text",
          content: "用户消息",
          sequence: 1,
          rawRef: `codex://${sessionFile.replaceAll("\\", "/")}#line=1`
        },
        {
          role: "assistant",
          kind: "text",
          content: "助手消息",
          sequence: 2,
          rawRef: `codex://${sessionFile.replaceAll("\\", "/")}#line=4`
        },
        {
          role: "assistant",
          kind: "thinking",
          content: "思考消息",
          sequence: 3,
          rawRef: `codex://${sessionFile.replaceAll("\\", "/")}#line=6`
        }
      ]
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 读取历史时会应用 thread_rolled_back，隐藏已回滚的旧 turn", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-rollback-history-"));
  const sessionFile = join(tempDir, "session.jsonl");

  try {
    const lines = [
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.354Z",
        type: "session_meta",
        payload: {
          id: "child-thread",
          forked_from_id: "source-thread",
          cwd: "/Users/jackson/Code/CodingNS"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.355Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-1"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.355Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "对话测试，口令：1314" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.355Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "收到，口令是 `1314`。" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.355Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.355Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-2"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.355Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "最新口令是520" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.355Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "当前口令已更新为 `520`。" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.355Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-2"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.356Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-3"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.356Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "最新口令是4567" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.356Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "当前口令已更新为 `4567`。" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.356Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-3"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.596Z",
        type: "event_msg",
        payload: {
          type: "thread_rolled_back",
          num_turns: 2
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.833Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-4"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:50.834Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "最新口令是多少" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:57.085Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "最新口令是 `1314`。" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-11T06:32:57.189Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-4"
        }
      })
    ];

    writeFileSync(sessionFile, lines.join("\n"), "utf8");

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory("child-thread", sessionFile, null, 50);

    assert.deepEqual(
      page.messages.map((message) => ({
        role: message.role,
        content: message.content
      })),
      [
        {
          role: "user",
          content: "对话测试，口令：1314"
        },
        {
          role: "assistant",
          content: "收到，口令是 `1314`。"
        },
        {
          role: "user",
          content: "最新口令是多少"
        },
        {
          role: "assistant",
          content: "最新口令是 `1314`。"
        }
      ]
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 能识别 macOS 工作区下的原生会话", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-macos-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionFile = join(tempDir, "sessions", "2026", "03", "26", "session.jsonl");
  const threadId = "12345678-1234-4234-9234-1234567890ab";

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "03", "26"), { recursive: true });
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: threadId,
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-26T00:00:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "macOS Codex 会话" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.providerSessionId, threadId);
    assert.equal(sessions[0]?.rawStoreRef, sessionFile);
    assert.equal(sessions[0]?.workspacePath, workspacePath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 会读取最近一轮 token_count 作为真实上下文占用", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-usage-"));
  const sessionFile = join(tempDir, "session.jsonl");

  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-03-26T00:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              model: "gpt-5.3-codex",
              model_context_window: 258400,
              last_token_usage: {
                input_tokens: 32000,
                cached_input_tokens: 8000
              },
              total_token_usage: {
                input_tokens: 500000
              }
            }
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const usage = await adapter.readContextUsage("session-1", sessionFile);

    assert.deepEqual(usage, {
      provider: "codex",
      promptTokens: 32000,
      uncachedInputTokens: 32000,
      cachedInputTokens: 8000,
      contextWindow: 258400,
      usageRatio: 32000 / 258400,
      source: "provider-log",
      contextWindowSource: "provider-log",
      modelId: "gpt-5.3-codex",
      capturedAt: "2026-03-26T00:00:00.000Z",
      isEstimated: false
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 读取标题时应优先采用 session_index.jsonl 的 thread_name", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-title-priority-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "03", "26");
  const sessionFile = join(sessionDir, "session.jsonl");
  const threadId = "12345678-1234-4234-9234-1234567890ab";
  const summarizedTitle = "修复Markdown查看器样式错位问题";
  const staleTitle = "markdown查看器的样式存在问题，属于markdown文本的内容显示到了模态框中";

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: threadId,
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-26T00:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: staleTitle
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      join(tempDir, "session_index.jsonl"),
      `${JSON.stringify({
        id: threadId,
        thread_name: summarizedTitle,
        updated_at: "2026-03-26T00:57:20.60362Z"
      })}\n`,
      "utf8"
    );

    const db = new DatabaseSync(join(tempDir, "state_1.sqlite"));
    db.exec(`
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
    db.prepare(
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
    ).run(
      threadId,
      staleTitle,
      workspacePath,
      Math.floor(Date.parse("2026-03-26T00:56:47.042Z") / 1000),
      0,
      staleTitle,
      null,
      null,
      sessionFile
    );
    db.close();

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.title, summarizedTitle);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 取消归档后即使线程索引 mtime 没变，也不会把活动会话重新判回 archived", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-unarchive-cache-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const archivedDir = join(tempDir, "archived_sessions");
  const archivedFile = join(archivedDir, "archived-thread.jsonl");
  const activeFile = join(tempDir, "sessions", "archived-thread.jsonl");
  const dbPath = join(tempDir, "state_1.sqlite");
  const threadId = "12345678-1234-4234-9234-1234567890b0";
  const archivedTitle = "恢复后不该再被判回归档";

  try {
    mkdirSync(archivedDir, { recursive: true });
    writeFileSync(
      archivedFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: threadId,
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-26T00:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: archivedTitle
          }
        })
      ].join("\n"),
      "utf8"
    );

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        created_at INTEGER,
        archived INTEGER,
        archived_at INTEGER,
        first_user_message TEXT,
        agent_nickname TEXT,
        agent_role TEXT,
        rollout_path TEXT
      );
    `);
    db.prepare(
      `INSERT INTO threads (
         id, title, cwd, created_at, archived, archived_at,
         first_user_message, agent_nickname, agent_role, rollout_path
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      threadId,
      archivedTitle,
      workspacePath,
      Math.floor(Date.parse("2026-03-26T00:00:00.000Z") / 1000),
      1,
      Math.floor(Date.parse("2026-03-26T00:01:00.000Z") / 1000),
      archivedTitle,
      null,
      null,
      archivedFile
    );
    db.close();

    const initialDbStat = statSync(dbPath);
    const adapter = new CodexAdapter({ homeDir: tempDir });
    await adapter.updateSessionArchiveState(threadId, archivedFile, false);
    utimesSync(dbPath, new Date(initialDbStat.atimeMs), new Date(initialDbStat.mtimeMs));

    const restoredSessions = await adapter.detectSessions(workspacePath);
    assert.equal(restoredSessions[0]?.isArchived, false);
    assert.equal(restoredSessions[0]?.rawStoreRef, activeFile);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});


test("CodexAdapter 支持原生会话级 fork", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-session-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "10", "source-thread.jsonl");
  const childFile = join(tempDir, "sessions", "2026", "04", "10", "child-thread.jsonl");

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "10"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "source-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "源会话"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "child-thread",
            cwd: workspacePath,
            forked_from_id: "source-thread"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "源会话"
          }
        })
      ].join("\n"),
      "utf8"
    );

    let initialized = false;
    let closed = false;
    let forkedThreadId = null;
    const adapter = new CodexAdapter({
      homeDir: tempDir,
      forkTransportFactory: () => ({
        async initialize() {
          initialized = true;
        },
        async forkThread(providerSessionId) {
          forkedThreadId = providerSessionId;
          return {
            providerSessionId: "child-thread",
            rawStoreRef: childFile
          };
        },
        async readThread() {
          throw new Error("UNEXPECTED_READ_THREAD");
        },
        async rollbackThread() {
          throw new Error("UNEXPECTED_ROLLBACK_THREAD");
        },
        async resumeThreadFromHistory() {
          throw new Error("UNEXPECTED_RESUME_THREAD_FROM_HISTORY");
        },
        close() {
          closed = true;
        }
      })
    });

    const result = await adapter.forkSession("source-thread", workspacePath, {
      rawStoreRef: sourceFile,
      sourceType: "session",
      strategy: "auto"
    });

    assert.equal(initialized, true);
    assert.equal(closed, true);
    assert.equal(forkedThreadId, "source-thread");
    assert.equal(result.forkMethod, "native_session_fork");
    assert.equal(result.forkSourceType, "session");
    assert.equal(result.session.providerSessionId, "child-thread");
    assert.equal(result.session.parentProviderSessionId, "source-thread");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 在子线程没有 CLI 标题和首条用户消息时，不再回退父会话标题", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-title-fallback-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "10", "source-thread.jsonl");
  const childFile = join(tempDir, "sessions", "2026", "04", "10", "child-thread.jsonl");

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "10"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "source-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "父会话标题"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childFile,
      JSON.stringify({
        timestamp: "2026-04-10T08:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "child-thread",
          cwd: workspacePath,
          forked_from_id: "source-thread"
        }
      }),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      forkTransportFactory: () => ({
        async initialize() {},
        async forkThread() {
          return {
            providerSessionId: "child-thread",
            rawStoreRef: childFile
          };
        },
        async readThread() {
          throw new Error("UNEXPECTED_READ_THREAD");
        },
        async rollbackThread() {
          throw new Error("UNEXPECTED_ROLLBACK_THREAD");
        },
        async resumeThreadFromHistory() {
          throw new Error("UNEXPECTED_RESUME_THREAD_FROM_HISTORY");
        },
        close() {}
      })
    });

    const result = await adapter.forkSession("source-thread", workspacePath, {
      rawStoreRef: sourceFile,
      sourceType: "session",
      strategy: "auto"
    });

    assert.equal(result.session.title, "");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 在 fork transport 返回父会话 rawStoreRef 时，会按 child threadId 改绑到真正的子会话文件", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-raw-store-rebind-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "10", "source-thread.jsonl");
  const childFile = join(tempDir, "sessions", "2026", "04", "10", "child-thread.jsonl");

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "10"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "source-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "父会话第一句"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "父会话第一句回复"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:05:00.000Z",
          type: "session_meta",
          payload: {
            id: "child-thread",
            cwd: workspacePath,
            forked_from_id: "source-thread"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:05:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "子会话继承的第一句"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      forkTransportFactory: () => ({
        async initialize() {},
        async forkThread(providerSessionId) {
          assert.equal(providerSessionId, "source-thread");
          return {
            providerSessionId: "child-thread",
            rawStoreRef: sourceFile
          };
        },
        async readThread() {
          throw new Error("UNEXPECTED_READ_THREAD");
        },
        async rollbackThread() {
          throw new Error("UNEXPECTED_ROLLBACK_THREAD");
        },
        async resumeThreadFromHistory() {
          throw new Error("UNEXPECTED_RESUME_THREAD_FROM_HISTORY");
        },
        close() {}
      })
    });

    const result = await adapter.forkSession("source-thread", workspacePath, {
      rawStoreRef: sourceFile,
      sourceType: "session",
      strategy: "auto"
    });

    assert.equal(result.session.providerSessionId, "child-thread");
    assert.equal(result.session.rawStoreRef, childFile);
    assert.equal(result.session.messageCount, 1);
    assert.equal(result.session.parentProviderSessionId, "source-thread");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 在 child transcript 还没落盘时，会把错误的父 rawStoreRef 隔离成 synthetic codex transcript", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-synthetic-isolation-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "10", "source-thread.jsonl");

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "10"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "source-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "父会话第一句"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      forkTransportFactory: () => ({
        async initialize() {},
        async forkThread(providerSessionId) {
          assert.equal(providerSessionId, "source-thread");
          return {
            providerSessionId: "child-thread",
            rawStoreRef: sourceFile
          };
        },
        async readThread() {
          throw new Error("UNEXPECTED_READ_THREAD");
        },
        async rollbackThread() {
          throw new Error("UNEXPECTED_ROLLBACK_THREAD");
        },
        async resumeThreadFromHistory() {
          throw new Error("UNEXPECTED_RESUME_THREAD_FROM_HISTORY");
        },
        close() {}
      })
    });

    const result = await adapter.forkSession("source-thread", workspacePath, {
      rawStoreRef: sourceFile,
      sourceType: "session",
      strategy: "auto"
    });

    assert.equal(
      result.session.rawStoreRef,
      join(tempDir, "runtime", "codex", "child-thread.jsonl")
    );
    assert.equal(result.session.messageCount, 0);

    const page = await adapter.readSessionHistory(
      "child-thread",
      result.session.rawStoreRef,
      null,
      50
    );

    assert.equal(page.messages.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter detectSessions 会忽略 providerSessionId 与文件 threadId 对不上的旧 rawStoreRef 缓存", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-detect-heal-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "10", "source-thread.jsonl");
  const childFile = join(tempDir, "sessions", "2026", "04", "10", "child-thread.jsonl");

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "10"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "source-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "父会话第一句"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:05:00.000Z",
          type: "session_meta",
          payload: {
            id: "child-thread",
            cwd: workspacePath,
            forked_from_id: "source-thread"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:05:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "子会话第一句"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath, {
      knownSessions: [
        {
          provider: "codex",
          providerSessionId: "source-thread",
          rawStoreRef: sourceFile,
          title: "父会话",
          workspacePath,
          isArchived: false,
          lastMessageAt: "2026-04-10T08:00:01.000Z",
          messageCount: 1,
          parentProviderSessionId: null,
          sourceMtimeMs: statSync(sourceFile).mtimeMs,
          sourceSizeBytes: statSync(sourceFile).size
        },
        {
          provider: "codex",
          providerSessionId: "child-thread",
          rawStoreRef: sourceFile,
          title: "错误绑定的子会话",
          workspacePath,
          isArchived: false,
          lastMessageAt: "2026-04-10T08:05:01.000Z",
          messageCount: 1,
          parentProviderSessionId: "source-thread",
          sourceMtimeMs: statSync(sourceFile).mtimeMs,
          sourceSizeBytes: statSync(sourceFile).size
        }
      ]
    });

    const childSession = sessions.find((session) => session.providerSessionId === "child-thread");

    assert.ok(childSession);
    assert.equal(childSession.rawStoreRef, childFile);
    assert.equal(childSession.parentProviderSessionId, "source-thread");
    assert.equal(childSession.title, "子会话第一句");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 遇到只提供扁平 history 的 thread/read 时，会拒绝使用重建型 message fork", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-message-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "10", "source-thread.jsonl");
  const childFile = join(tempDir, "sessions", "2026", "04", "10", "child-thread.jsonl");

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "10"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "source-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第一轮问题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "第一轮回答"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:03.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第二轮问题"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "child-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第一轮问题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "第一轮回答"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      forkTransportFactory: () => ({
        async initialize() {},
        async forkThread(providerSessionId) {
          assert.equal(providerSessionId, "source-thread");
          return {
            providerSessionId: "child-thread",
            rawStoreRef: childFile
          };
        },
        async readThread() {
          return {
            history: [
              {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: "第一轮问题" }]
              },
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "第一轮回答" }]
              },
              {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: "第二轮问题" }]
              }
            ]
          };
        },
        async resumeThreadFromHistory(input) {
          throw new Error(`UNEXPECTED_RESUME_THREAD_FROM_HISTORY:${JSON.stringify(input)}`);
        },
        close() {}
      })
    });
    const page = await adapter.readSessionHistory("source-thread", sourceFile, null, 50);
    const anchorMessageId = page.messages[1].messageId;

    await assert.rejects(
      adapter.forkSession("source-thread", workspacePath, {
        rawStoreRef: sourceFile,
        sourceType: "message",
        sourceMessageId: anchorMessageId,
        strategy: "auto"
      }),
      /CODEX_RECONSTRUCTED_MESSAGE_FORK_NOT_SUPPORTED/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 在 child thread 正确但本地 transcript 仍然脏时，仍然保留 native message fork", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-verify-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "10", "source-thread.jsonl");
  const dirtyChildFile = join(tempDir, "sessions", "2026", "04", "10", "dirty-child-thread.jsonl");

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "10"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "source-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第一轮问题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "第一轮回答"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:03.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "父会话最新问题"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      dirtyChildFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "dirty-child-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第一轮问题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "第一轮回答"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:03.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "父会话最新问题"
          }
        })
      ].join("\n"),
      "utf8"
    );
    const adapter = new CodexAdapter({
      homeDir: tempDir,
      forkTransportFactory: () => ({
        async initialize() {},
        async forkThread(providerSessionId) {
          assert.equal(providerSessionId, "source-thread");
          return {
            providerSessionId: "dirty-child-thread",
            rawStoreRef: dirtyChildFile
          };
        },
        async readThread(providerSessionId) {
          if (providerSessionId === "dirty-child-thread") {
            return {
              thread: {
                id: "dirty-child-thread",
                turns: [
                  {
                    id: "turn-1",
                    items: [
                      {
                        type: "userMessage",
                        id: "item-1",
                        content: [{ type: "input_text", text: "第一轮问题" }]
                      },
                      {
                        type: "agentMessage",
                        id: "item-2",
                        text: "第一轮回答",
                        phase: "final_answer"
                      }
                    ]
                  }
                ]
              }
            };
          }

          return {
            thread: {
              id: "source-thread",
              turns: [
                {
                  id: "turn-1",
                  items: [
                    {
                      type: "userMessage",
                      id: "item-1",
                      content: [{ type: "input_text", text: "第一轮问题" }]
                    },
                    {
                      type: "agentMessage",
                      id: "item-2",
                      text: "第一轮回答",
                      phase: "final_answer"
                    }
                  ]
                },
                {
                  id: "turn-2",
                  items: [
                    {
                      type: "userMessage",
                      id: "item-3",
                      content: [{ type: "input_text", text: "父会话最新问题" }]
                    }
                  ]
                }
              ]
            }
          };
        },
        async rollbackThread(providerSessionId, numTurns) {
          assert.equal(providerSessionId, "dirty-child-thread");
          assert.equal(numTurns, 1);
          return {
            providerSessionId: "dirty-child-thread",
            rawStoreRef: dirtyChildFile
          };
        },
        async resumeThreadFromHistory(input) {
          throw new Error(`UNEXPECTED_RESUME_THREAD_FROM_HISTORY:${JSON.stringify(input)}`);
        },
        close() {}
      })
    });

    const page = await adapter.readSessionHistory("source-thread", sourceFile, null, 50);
    const anchorMessageId = page.messages[1]?.messageId;

    assert.ok(anchorMessageId);

    const result = await adapter.forkSession("source-thread", workspacePath, {
      rawStoreRef: sourceFile,
      sourceType: "message",
      sourceMessageId: anchorMessageId,
      strategy: "auto"
    });

    assert.equal(result.forkMethod, "native_message_fork");
    assert.equal(result.forkSourceType, "message");
    assert.equal(result.session.providerSessionId, "dirty-child-thread");
    assert.equal(result.session.messageCount, 2);
    assert.equal(result.inheritedPrefixMessageCount, 2);
    assert.equal(result.session.lastMessageAt, "2026-04-10T08:00:02.000Z");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 在 native rollback 后如果 child thread 仍然带着父会话脏历史，会直接报错", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-dirty-provider-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "10", "source-thread.jsonl");
  const childFile = join(tempDir, "sessions", "2026", "04", "10", "child-thread.jsonl");

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "10"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "source-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第一轮问题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "第一轮回答"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:03.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "父会话最新问题"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "child-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第一轮问题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "第一轮回答"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:03.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "父会话最新问题"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      forkTransportFactory: () => ({
        async initialize() {},
        async forkThread(providerSessionId) {
          assert.equal(providerSessionId, "source-thread");
          return {
            providerSessionId: "child-thread",
            rawStoreRef: childFile
          };
        },
        async readThread(providerSessionId) {
          if (providerSessionId === "child-thread") {
            return {
              thread: {
                id: "child-thread",
                turns: [
                  {
                    id: "turn-1",
                    items: [
                      {
                        type: "userMessage",
                        id: "item-1",
                        content: [{ type: "input_text", text: "第一轮问题" }]
                      },
                      {
                        type: "agentMessage",
                        id: "item-2",
                        text: "第一轮回答",
                        phase: "final_answer"
                      }
                    ]
                  },
                  {
                    id: "turn-2",
                    items: [
                      {
                        type: "userMessage",
                        id: "item-3",
                        content: [{ type: "input_text", text: "父会话最新问题" }]
                      }
                    ]
                  }
                ]
              }
            };
          }

          return {
            thread: {
              id: "source-thread",
              turns: [
                {
                  id: "turn-1",
                  items: [
                    {
                      type: "userMessage",
                      id: "item-1",
                      content: [{ type: "input_text", text: "第一轮问题" }]
                    },
                    {
                      type: "agentMessage",
                      id: "item-2",
                      text: "第一轮回答",
                      phase: "final_answer"
                    }
                  ]
                },
                {
                  id: "turn-2",
                  items: [
                    {
                      type: "userMessage",
                      id: "item-3",
                      content: [{ type: "input_text", text: "父会话最新问题" }]
                    }
                  ]
                }
              ]
            }
          };
        },
        async rollbackThread(providerSessionId, numTurns) {
          assert.equal(providerSessionId, "child-thread");
          assert.equal(numTurns, 1);
          return {
            providerSessionId: "child-thread",
            rawStoreRef: childFile
          };
        },
        async resumeThreadFromHistory(input) {
          throw new Error(`UNEXPECTED_RESUME_THREAD_FROM_HISTORY:${JSON.stringify(input)}`);
        },
        close() {}
      })
    });

    const page = await adapter.readSessionHistory("source-thread", sourceFile, null, 50);
    const anchorMessageId = page.messages[1]?.messageId;

    assert.ok(anchorMessageId);

    await assert.rejects(
      adapter.forkSession("source-thread", workspacePath, {
        rawStoreRef: sourceFile,
        sourceType: "message",
        sourceMessageId: anchorMessageId,
        strategy: "auto"
      }),
      /CODEX_NATIVE_MESSAGE_FORK_DIRTY/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 能兼容 Codex app-server thread/read 返回的 turns.items 历史结构", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-turns-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "10", "source-thread.jsonl");
  const childFile = join(tempDir, "sessions", "2026", "04", "10", "child-thread.jsonl");

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "10"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "source-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第一轮问题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "第一轮回答"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:03.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第二轮问题"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childFile,
      [
        JSON.stringify({
          timestamp: "2026-04-10T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "child-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第一轮问题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-10T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "第一轮回答"
          }
        })
      ].join("\n"),
      "utf8"
    );

    let resumedHistory = [];
    const adapter = new CodexAdapter({
      homeDir: tempDir,
      forkTransportFactory: () => ({
        async initialize() {},
        async forkThread(providerSessionId) {
          assert.equal(providerSessionId, "source-thread");
          return {
            providerSessionId: "child-thread",
            rawStoreRef: childFile
          };
        },
        async readThread(providerSessionId) {
          if (providerSessionId === "child-thread") {
            return {
              thread: {
                id: "child-thread",
                turns: [
                  {
                    id: "turn-1",
                    items: [
                      {
                        type: "userMessage",
                        id: "item-1",
                        content: [{ type: "input_text", text: "第一轮问题" }]
                      },
                      {
                        type: "agentMessage",
                        id: "item-2",
                        text: "第一轮回答",
                        phase: "final_answer"
                      }
                    ]
                  }
                ]
              }
            };
          }

          return {
            thread: {
              id: "source-thread",
              turns: [
                {
                  id: "turn-1",
                  items: [
                    {
                      type: "userMessage",
                      id: "item-1",
                      content: [{ type: "input_text", text: "第一轮问题" }]
                    },
                    {
                      type: "agentMessage",
                      id: "item-2",
                      text: "第一轮回答",
                      phase: "final_answer"
                    }
                  ]
                },
                {
                  id: "turn-2",
                  items: [
                    {
                      type: "userMessage",
                      id: "item-3",
                      content: [{ type: "input_text", text: "第二轮问题" }]
                    }
                  ]
                }
              ]
            }
          };
        },
        async rollbackThread(providerSessionId, numTurns) {
          assert.equal(providerSessionId, "child-thread");
          assert.equal(numTurns, 1);
          return {
            providerSessionId: "child-thread",
            rawStoreRef: childFile
          };
        },
        async resumeThreadFromHistory(input) {
          throw new Error(`UNEXPECTED_RESUME_THREAD_FROM_HISTORY:${JSON.stringify(input)}`);
        },
        close() {}
      })
    });

    const page = await adapter.readSessionHistory("source-thread", sourceFile, null, 50);
    const anchorMessageId = page.messages[1]?.messageId;

    assert.ok(anchorMessageId);

    const result = await adapter.forkSession("source-thread", workspacePath, {
      rawStoreRef: sourceFile,
      sourceType: "message",
      sourceMessageId: anchorMessageId,
      strategy: "auto"
    });

    assert.equal(resumedHistory.length, 0);
    assert.equal(result.forkMethod, "native_message_fork");
    assert.equal(result.forkSourceType, "message");
    assert.equal(result.session.providerSessionId, "child-thread");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 按首轮 assistant 锚点派生时会保留完整 turn 结构并排除后续轮次", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-realish-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "11", "source-thread.jsonl");
  const childFile = join(tempDir, "sessions", "2026", "04", "11", "child-thread.jsonl");

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "11"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-11T06:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "source-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T06:00:00.100Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "# AGENTS.md instructions for /Users/jackson/Code/CodingNS\n\n<INSTRUCTIONS>...</INSTRUCTIONS>"
              }
            ]
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T06:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "对话测试，口令：1314" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T06:00:02.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "收到，口令是 1314。" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T06:00:03.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<environment_context>...</environment_context>" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T06:00:04.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "最新口令是520" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T06:00:05.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "当前口令已更新为 520。" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T06:00:06.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "最新口令是4567" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T06:00:07.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "当前口令已更新为 4567。" }]
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childFile,
      [
        JSON.stringify({
          timestamp: "2026-04-11T06:01:00.000Z",
          type: "session_meta",
          payload: {
            id: "child-thread",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T06:01:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "对话测试，口令：1314" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T06:01:02.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "收到，口令是 1314。" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    let resumedHistory = [];
    const adapter = new CodexAdapter({
      homeDir: tempDir,
      forkTransportFactory: () => ({
        async initialize() {},
        async forkThread(providerSessionId) {
          assert.equal(providerSessionId, "source-thread");
          return {
            providerSessionId: "child-thread",
            rawStoreRef: childFile
          };
        },
        async readThread(providerSessionId) {
          if (providerSessionId === "child-thread") {
            return {
              thread: {
                id: "child-thread",
                turns: [
                  {
                    id: "turn-1",
                    items: [
                      {
                        type: "userMessage",
                        id: "item-1",
                        content: [{ type: "input_text", text: "对话测试，口令：1314" }]
                      },
                      {
                        type: "agentMessage",
                        id: "item-2",
                        text: "收到，口令是 1314。",
                        phase: "final_answer"
                      }
                    ]
                  }
                ]
              }
            };
          }

          return {
            thread: {
              id: "source-thread",
              turns: [
                {
                  id: "turn-1",
                  items: [
                    {
                      type: "userMessage",
                      id: "item-1",
                      content: [{ type: "input_text", text: "对话测试，口令：1314" }]
                    },
                    {
                      type: "agentMessage",
                      id: "item-2",
                      text: "收到，口令是 1314。",
                      phase: "final_answer"
                    }
                  ]
                },
                {
                  id: "turn-2",
                  items: [
                    {
                      type: "userMessage",
                      id: "item-3",
                      content: [{ type: "input_text", text: "最新口令是520" }]
                    },
                    {
                      type: "agentMessage",
                      id: "item-4",
                      text: "当前口令已更新为 520。",
                      phase: "final_answer"
                    }
                  ]
                },
                {
                  id: "turn-3",
                  items: [
                    {
                      type: "userMessage",
                      id: "item-5",
                      content: [{ type: "input_text", text: "最新口令是4567" }]
                    },
                    {
                      type: "agentMessage",
                      id: "item-6",
                      text: "当前口令已更新为 4567。",
                      phase: "final_answer"
                    }
                  ]
                }
              ]
            }
          };
        },
        async rollbackThread(providerSessionId, numTurns) {
          assert.equal(providerSessionId, "child-thread");
          assert.equal(numTurns, 2);
          return {
            providerSessionId: "child-thread",
            rawStoreRef: childFile
          };
        },
        async resumeThreadFromHistory(input) {
          throw new Error(`UNEXPECTED_RESUME_THREAD_FROM_HISTORY:${JSON.stringify(input)}`);
        },
        close() {}
      })
    });

    const page = await adapter.readSessionHistory("source-thread", sourceFile, null, 50);
    const anchorMessageId = page.messages.find(
      (message) => message.role === "assistant" && message.content.includes("1314")
    )?.messageId;

    assert.ok(anchorMessageId);

    await adapter.forkSession("source-thread", workspacePath, {
      rawStoreRef: sourceFile,
      sourceType: "message",
      sourceMessageId: anchorMessageId,
      strategy: "auto"
    });

    assert.equal(resumedHistory.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 遇到和首条用户消息相同的长标题时应截断到统一长度", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-title-truncate-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "03", "26");
  const sessionFile = join(sessionDir, "session.jsonl");
  const threadId = "12345678-1234-4234-9234-1234567890ac";
  const longTitle = "终端管理页面点击加号以后终端实际上加载成功但是页面没有刷新出终端窗口刷新页面后终端才显示";

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: threadId,
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-26T00:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: longTitle
          }
        })
      ].join("\n"),
      "utf8"
    );

    const db = new DatabaseSync(join(tempDir, "state_1.sqlite"));
    db.exec(`
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
    db.prepare(
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
    ).run(
      threadId,
      longTitle,
      workspacePath,
      Math.floor(Date.parse("2026-03-26T00:56:47.042Z") / 1000),
      0,
      longTitle,
      null,
      null,
      sessionFile
    );
    db.close();

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.title, longTitle.slice(0, 48));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 会优先使用 session_meta 里的 parent_thread_id 识别子 Agent 父子关系", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-subagent-parent-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "03", "27");
  const parentThreadId = "019d2a92-b74b-7981-862f-ecf3fd4f28d1";
  const childThreadId = "019d2b12-e5d1-7430-9b7f-35b46be47bde";
  const parentSessionFile = join(sessionDir, `rollout-${parentThreadId}.jsonl`);
  const childSessionFile = join(sessionDir, `rollout-${childThreadId}.jsonl`);

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      parentSessionFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: parentThreadId,
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-27T00:50:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "请评估如果要兼容opencode到本项目，都需要考虑哪些方面？"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childSessionFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: childThreadId,
            cwd: workspacePath,
            forked_from_id: parentThreadId,
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: parentThreadId,
                  depth: 1,
                  agent_path: "/root/spec0101_tasks_update",
                  agent_nickname: "Wegener",
                  agent_role: "worker"
                }
              }
            },
            agent_nickname: "Wegener",
            agent_role: "worker",
            agent_path: "/root/spec0101_tasks_update"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-27T00:55:52.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "请评估如果要兼容opencode到本项目，都需要考虑哪些方面？"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const db = new DatabaseSync(join(tempDir, "state_1.sqlite"));
    db.exec(`
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
    db.prepare(
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
    ).run(
      parentThreadId,
      "请评估如果要兼容opencode到本项目，都需要考虑哪些方面？",
      workspacePath,
      Math.floor(Date.parse("2026-03-27T00:50:00.000Z") / 1000),
      0,
      "请评估如果要兼容opencode到本项目，都需要考虑哪些方面？",
      null,
      null,
      parentSessionFile
    );
    db.prepare(
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
    ).run(
      childThreadId,
      "请评估如果要兼容opencode到本项目，都需要考虑哪些方面？",
      workspacePath,
      Math.floor(Date.parse("2026-03-27T00:55:52.000Z") / 1000),
      0,
      "请评估如果要兼容opencode到本项目，都需要考虑哪些方面？",
      "Wegener",
      "worker",
      childSessionFile
    );
    db.close();

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);
    const childSession = sessions.find((session) => session.providerSessionId === childThreadId);

    assert.equal(childSession?.parentProviderSessionId, parentThreadId);
    assert.equal(childSession?.isSubagent, true);
    assert.equal(childSession?.subagentLabel, "worker · Wegener");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 会纠正 knownSessions 里已经缓存错的子 Agent 关系", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-subagent-known-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "03", "27");
  const parentThreadId = "019d2a42-21a1-7f13-ac1d-1e8791959204";
  const childThreadId = "019d2af8-19aa-77a2-8169-a1898ad42b0d";
  const childSessionFile = join(sessionDir, `rollout-${childThreadId}.jsonl`);

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      childSessionFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: childThreadId,
            cwd: workspacePath,
            forked_from_id: parentThreadId,
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: parentThreadId,
                  depth: 1,
                  agent_path: "/root/spec0091_workspace_pages_impl",
                  agent_nickname: "Parfit",
                  agent_role: "worker"
                }
              }
            },
            agent_nickname: "Parfit",
            agent_role: "worker",
            agent_path: "/root/spec0091_workspace_pages_impl"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-27T00:26:36.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "我希望按照IOS以及android的最佳实践风格分别对H5移动端、IOS端、android端进行改造"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const db = new DatabaseSync(join(tempDir, "state_1.sqlite"));
    db.exec(`
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
    db.prepare(
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
    ).run(
      childThreadId,
      "我希望按照IOS以及android的最佳实践风格分别对H5移动端、IOS端、android端进行",
      workspacePath,
      Math.floor(Date.parse("2026-03-27T00:26:36.000Z") / 1000),
      0,
      "我希望按照IOS以及android的最佳实践风格分别对H5移动端、IOS端、android端进行改造",
      "Parfit",
      "worker",
      childSessionFile
    );
    db.close();

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const stats = statSync(childSessionFile);
    const sessions = await adapter.detectSessions(workspacePath, {
      knownSessions: [
        {
          provider: "codex",
          providerSessionId: childThreadId,
          title: "我希望按照IOS以及android的最佳实践风格分别对H5移动端、IOS端、android端进行",
          workspacePath,
          rawStoreRef: childSessionFile,
          lastMessageAt: "2026-03-27T00:26:36.000Z",
          messageCount: 1,
          parentProviderSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          sourceMtimeMs: stats.mtimeMs,
          sourceSizeBytes: stats.size
        }
      ]
    });
    const childSession = sessions.find((session) => session.providerSessionId === childThreadId);

    assert.equal(childSession?.parentProviderSessionId, parentThreadId);
    assert.equal(childSession?.isSubagent, true);
    assert.equal(childSession?.subagentLabel, "worker · Parfit");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

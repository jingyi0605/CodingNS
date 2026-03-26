import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
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

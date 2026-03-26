import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { CodexAdapter } from "../dist/index.js";

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

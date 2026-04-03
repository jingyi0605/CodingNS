import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GeminiAdapter } from "../dist/index.js";

test("GeminiAdapter 会合并 CLI 与本地 chats 发现结果，并按工作区过滤", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-discovery-"));
  const homeDir = join(rootDir, "gemini-home");
  const alphaChatFile = join(
    homeDir,
    "tmp",
    "hash-alpha",
    "chats",
    "gemini-session-alpha.json"
  );
  const betaChatFile = join(
    homeDir,
    "tmp",
    "hash-beta",
    "chats",
    "gemini-session-beta.json"
  );

  try {
    mkdirSync(join(homeDir, "tmp", "hash-alpha", "chats"), { recursive: true });
    mkdirSync(join(homeDir, "tmp", "hash-beta", "chats"), { recursive: true });

    writeFileSync(
      alphaChatFile,
      JSON.stringify({
        sessionId: "gemini-session-alpha",
        workspacePath: "/workspace/alpha",
        title: "Alpha 本地会话",
        updatedAt: "2026-04-03T08:10:00.000Z",
        messages: [
          {
            role: "user",
            timestamp: "2026-04-03T08:00:00.000Z",
            parts: [{ text: "你好，Gemini" }]
          },
          {
            role: "assistant",
            timestamp: "2026-04-03T08:01:00.000Z",
            parts: [{ text: "已收到" }]
          }
        ]
      }),
      "utf8"
    );
    writeFileSync(
      betaChatFile,
      JSON.stringify({
        sessionId: "gemini-session-beta",
        workspacePath: "/workspace/beta",
        title: "Beta 本地会话",
        updatedAt: "2026-04-03T09:10:00.000Z",
        messages: [
          {
            role: "user",
            timestamp: "2026-04-03T09:00:00.000Z",
            parts: [{ text: "仅 beta 可见" }]
          }
        ]
      }),
      "utf8"
    );

    const adapter = new GeminiAdapter({
      homeDir,
      listSessions: async () => [
        {
          providerSessionId: "gemini-session-alpha",
          workspacePath: "/workspace/alpha",
          title: "Alpha CLI 标题",
          lastMessageAt: "2026-04-03T08:12:00.000Z",
          messageCount: 2
        },
        {
          providerSessionId: "gemini-session-remote",
          workspacePath: "/workspace/alpha",
          title: "CLI only 会话",
          lastMessageAt: "2026-04-03T09:00:00.000Z",
          messageCount: 4
        }
      ]
    });

    const discovery = await adapter.detectSessionsDetailed("/workspace/alpha");

    assert.equal(discovery.isComplete, true);
    assert.deepEqual(
      discovery.sessions.map((session) => session.providerSessionId),
      ["gemini-session-remote", "gemini-session-alpha"]
    );
    assert.equal(discovery.sessions[0]?.rawStoreRef, "gemini://session/gemini-session-remote");
    assert.equal(discovery.sessions[1]?.title, "Alpha 本地会话");
    assert.equal(discovery.sessions[1]?.messageCount, 2);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("GeminiAdapter 能把文本、工具调用和工具结果归一化到统一消息模型", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-history-"));
  const homeDir = join(rootDir, "gemini-home");
  const chatFile = join(homeDir, "tmp", "hash-alpha", "chats", "gemini-session-alpha.json");

  try {
    mkdirSync(join(homeDir, "tmp", "hash-alpha", "chats"), { recursive: true });
    writeFileSync(
      chatFile,
      JSON.stringify({
        sessionId: "gemini-session-alpha",
        workspacePath: "/workspace/alpha",
        title: "Alpha 会话",
        messages: [
          {
            id: "msg-1",
            role: "user",
            timestamp: "2026-04-03T08:00:00.000Z",
            parts: [{ text: "请检查当前目录" }]
          },
          {
            id: "msg-2",
            role: "assistant",
            timestamp: "2026-04-03T08:00:05.000Z",
            parts: [
              {
                tool_use: {
                  id: "tool-call-1",
                  name: "shell_command",
                  input: {
                    command: "pwd"
                  }
                }
              }
            ]
          },
          {
            id: "msg-3",
            role: "tool",
            timestamp: "2026-04-03T08:00:06.000Z",
            parts: [
              {
                tool_result: {
                  tool_use_id: "tool-call-1",
                  name: "shell_command",
                  output: "/workspace/alpha"
                }
              }
            ]
          },
          {
            id: "msg-4",
            role: "assistant",
            timestamp: "2026-04-03T08:00:10.000Z",
            parts: [{ text: "目录已确认。" }]
          }
        ]
      }),
      "utf8"
    );

    const adapter = new GeminiAdapter({
      homeDir,
      listSessions: async () => []
    });
    const page = await adapter.readSessionHistory(
      "gemini-session-alpha",
      "gemini://session/gemini-session-alpha",
      null,
      20
    );

    assert.equal(page.messages.length, 4);
    assert.equal(page.messages[0]?.role, "user");
    assert.equal(page.messages[0]?.kind, "text");
    assert.equal(page.messages[1]?.kind, "tool_call");
    assert.equal(page.messages[1]?.toolCall?.name, "shell_command");
    assert.equal(page.messages[1]?.toolCall?.status, "running");
    assert.equal(page.messages[2]?.kind, "tool_result");
    assert.equal(page.messages[2]?.toolCall?.status, "completed");
    assert.equal(page.messages[2]?.content, "/workspace/alpha");
    assert.equal(page.messages[3]?.role, "assistant");
    assert.equal(page.messages[3]?.content, "目录已确认。");
    assert.equal(page.messages[1]?.rawRef.includes("gemini://session/gemini-session-alpha"), true);
    assert.equal(page.messages[1]?.rawRef.includes("file="), true);
    assert.equal(page.messages[1]?.rawRef.includes("index=1"), true);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("GeminiAdapter 遇到损坏 chats 文件时会返回结构化 schema 错误", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-schema-"));
  const homeDir = join(rootDir, "gemini-home");
  const brokenChatFile = join(homeDir, "tmp", "hash-alpha", "chats", "broken-session.json");

  try {
    mkdirSync(join(homeDir, "tmp", "hash-alpha", "chats"), { recursive: true });
    writeFileSync(brokenChatFile, "{ not valid json", "utf8");

    const adapter = new GeminiAdapter({
      homeDir,
      listSessions: async () => []
    });

    await assert.rejects(
      () => adapter.readSessionHistory("broken-session", "gemini://session/broken-session", null, 10),
      /GEMINI_CHAT_SCHEMA_INVALID/
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

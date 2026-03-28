import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ClaudeCodeAdapter } from "../dist/index.js";

test("ClaudeCodeAdapter 会使用 Claude CLI 的项目目录命名规则", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-path-"));
  const workspacePath = "C:\\Code\\CodingNS";

  try {
    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const result = await adapter.startSession(workspacePath, {
      initialPrompt: "测试 Claude 路径"
    });

    assert.match(
      result.session.rawStoreRef.replaceAll("\\", "/"),
      /\/projects\/c--Code-CodingNS\/[0-9a-f-]+\.jsonl$/i
    );
    assert.equal(existsSync(result.session.rawStoreRef), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 会优先读取真实 Claude 项目目录下的会话", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-detect-"));
  const workspacePath = "C:\\Code\\CodingNS";
  const actualProjectDir = join(tempDir, "projects", "c--Code-CodingNS");
  const legacyProjectDir = join(tempDir, "projects", "c-code-codingns");
  const actualSessionId = "11111111-1111-4111-8111-111111111111";

  try {
    mkdirSync(actualProjectDir, { recursive: true });
    mkdirSync(legacyProjectDir, { recursive: true });
    writeFileSync(join(legacyProjectDir, "placeholder.jsonl"), "", "utf8");

    writeFileSync(
      join(actualProjectDir, `${actualSessionId}.jsonl`),
      `${JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        promptId: "prompt-1",
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "真实 Claude 会话" }]
        },
        uuid: "message-1",
        timestamp: "2026-03-25T00:00:00.000Z",
        cwd: workspacePath,
        sessionId: actualSessionId
      })}\n${JSON.stringify({
        type: "ai-title",
        sessionId: actualSessionId,
        aiTitle: "真实 Claude 会话"
      })}`,
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.providerSessionId, actualSessionId);
    assert.equal(sessions[0]?.rawStoreRef, join(actualProjectDir, `${actualSessionId}.jsonl`));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 能在 macOS 工作区里重新发现刚创建的会话", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-macos-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";

  try {
    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const started = await adapter.startSession(workspacePath, {
      initialPrompt: "macOS Claude 会话"
    });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.providerSessionId, started.session.providerSessionId);
    assert.equal(sessions[0]?.rawStoreRef, started.session.rawStoreRef);
    assert.equal(sessions[0]?.workspacePath, workspacePath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 会忽略顶层 Warmup sidechain 调试会话", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-sidechain-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "22222222-2222-4222-8222-222222222222";

  try {
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, `${sessionId}.jsonl`),
      `${JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        promptId: "prompt-1",
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "正常主会话" }]
        },
        uuid: "message-1",
        timestamp: "2026-03-26T00:00:00.000Z",
        cwd: workspacePath,
        sessionId
      })}\n${JSON.stringify({
        type: "ai-title",
        sessionId,
        aiTitle: "正常主会话"
      })}`,
      "utf8"
    );

    writeFileSync(
      join(projectDir, "agent-a18af649.jsonl"),
      `${JSON.stringify({
        parentUuid: null,
        isSidechain: true,
        userType: "external",
        cwd: workspacePath,
        sessionId,
        agentId: "a18af649",
        type: "user",
        message: {
          role: "user",
          content: "Warmup"
        },
        uuid: "message-agent-1",
        timestamp: "2026-03-26T00:00:01.000Z"
      })}\n${JSON.stringify({
        parentUuid: "message-agent-1",
        isSidechain: true,
        userType: "external",
        cwd: workspacePath,
        sessionId,
        agentId: "a18af649",
        type: "assistant",
        message: {
          id: "msg-agent-1",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "我是调试 warmup" }]
        },
        uuid: "message-agent-2",
        timestamp: "2026-03-26T00:00:02.000Z"
      })}`,
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.providerSessionId, sessionId);
    assert.equal(sessions[0]?.title, "正常主会话");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 能解析 content 为字符串的用户消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-string-content-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const rawStoreRef = join(projectDir, `${sessionId}.jsonl`);

  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          type: "user",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-03-26T01:14:34.949Z",
          message: {
            role: "user",
            content: "对话测试，仅回复2598"
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-03-26T01:14:39.494Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "2598" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory(sessionId, rawStoreRef, null, 20, "forward");

    assert.equal(page.messages.length, 2);
    assert.equal(page.messages[0]?.role, "user");
    assert.equal(page.messages[0]?.content, "对话测试，仅回复2598");
    assert.equal(page.messages[1]?.role, "assistant");
    assert.equal(page.messages[1]?.content, "2598");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 会把同一条 Claude thinking 的 progress 与最终消息并成一条历史记录", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-thinking-merge-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "34343434-3434-4434-8434-343434343434";
  const rawStoreRef = join(projectDir, `${sessionId}.jsonl`);

  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          type: "progress",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-03-28T01:00:00.000Z",
          data: {
            message: {
              type: "assistant",
              timestamp: "2026-03-28T01:00:00.000Z",
              message: {
                id: "msg-thinking-1",
                role: "assistant",
                content: [{ type: "thinking", thinking: "先想" }]
              }
            }
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-03-28T01:00:01.000Z",
          message: {
            id: "msg-thinking-1",
            role: "assistant",
            content: [{ type: "thinking", thinking: "先想\n再回答" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory(sessionId, rawStoreRef, null, 20, "forward");

    assert.equal(page.messages.length, 1);
    assert.equal(page.messages[0]?.kind, "thinking");
    assert.equal(page.messages[0]?.content, "先想\n再回答");
    assert.match(page.messages[0]?.rawRef ?? "", /#line=1&part=0$/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 会读取 assistant usage 作为压缩后的真实上下文占用", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-usage-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const rawStoreRef = join(projectDir, `${sessionId}.jsonl`);

  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          type: "assistant",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-03-26T02:00:00.000Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            usage: {
              input_tokens: 42000,
              cache_creation_input_tokens: 6000,
              cache_read_input_tokens: 2000,
              output_tokens: 800
            },
            content: [{ type: "text", text: "完成了。" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const usage = await adapter.readContextUsage(sessionId, rawStoreRef);

    assert.deepEqual(usage, {
      provider: "claude-code",
      promptTokens: 50000,
      uncachedInputTokens: 42000,
      cachedInputTokens: 8000,
      contextWindow: 200000,
      usageRatio: 0.25,
      source: "provider-log",
      contextWindowSource: "model-map",
      modelId: "claude-sonnet-4-5",
      capturedAt: "2026-03-26T02:00:00.000Z",
      isEstimated: true
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

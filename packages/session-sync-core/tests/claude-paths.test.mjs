import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("ClaudeCodeAdapter 会忽略运行时生成的 .pending 临时 transcript", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-pending-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const pendingSessionId = "pending-runtime-session";
  const realSessionId = "55555555-5555-4555-8555-555555555555";

  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, `.pending-${pendingSessionId}.jsonl`),
      [
        JSON.stringify({
          type: "user",
          sessionId: `pending://claude-code/${pendingSessionId}`,
          cwd: workspacePath,
          timestamp: "2026-03-29T11:00:00.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "这是一条临时运行时记录" }]
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      join(projectDir, `${realSessionId}.jsonl`),
      [
        JSON.stringify({
          type: "user",
          sessionId: realSessionId,
          cwd: workspacePath,
          timestamp: "2026-03-29T11:00:01.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "真实 Claude 会话" }]
          }
        }),
        JSON.stringify({
          type: "ai-title",
          sessionId: realSessionId,
          aiTitle: "真实 Claude 会话"
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.providerSessionId, realSessionId);
    assert.match(sessions[0]?.rawStoreRef ?? "", /55555555-5555-4555-8555-555555555555\.jsonl$/);
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

test("ClaudeCodeAdapter 会把顶层 Task 子代理 transcript 识别为子会话", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-task-subagent-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const parentSessionId = "fa494234-ba36-438d-9b01-44ee0ab7684c";
  const childAgentId = "ec4ca8be";
  const childFileName = `agent-${childAgentId}`;

  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, `${parentSessionId}.jsonl`),
      [
        JSON.stringify({
          type: "user",
          sessionId: parentSessionId,
          cwd: workspacePath,
          timestamp: "2026-04-02T04:31:04.111Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "帮我修改 GLM MCP 配置" }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: parentSessionId,
          cwd: workspacePath,
          timestamp: "2026-04-02T04:31:42.963Z",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "我先让子代理去搜索 MCP 配置。" },
              {
                type: "tool_use",
                id: "call_task_1",
                name: "Task",
                input: {
                  description: "查找GLM MCP配置文件",
                  prompt: "搜索 MCP 相关配置",
                  subagent_type: "Explore"
                }
              }
            ]
          }
        }),
        JSON.stringify({
          type: "user",
          sessionId: parentSessionId,
          cwd: workspacePath,
          timestamp: "2026-04-02T04:35:27.713Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "call_task_1",
                content: [{ type: "text", text: "查找完成" }]
              }
            ]
          },
          toolUseResult: {
            status: "completed",
            agentId: childAgentId
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      join(projectDir, `${childFileName}.jsonl`),
      [
        JSON.stringify({
          parentUuid: null,
          isSidechain: true,
          userType: "external",
          cwd: workspacePath,
          sessionId: parentSessionId,
          agentId: childAgentId,
          type: "user",
          message: {
            role: "user",
            content: "搜索 MCP 相关配置"
          },
          uuid: "child-user-1",
          timestamp: "2026-04-02T04:31:43.451Z"
        }),
        JSON.stringify({
          parentUuid: "child-user-1",
          isSidechain: true,
          userType: "external",
          cwd: workspacePath,
          sessionId: parentSessionId,
          agentId: childAgentId,
          type: "assistant",
          message: {
            id: "msg-child-1",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "我来查找 MCP 配置。" }]
          },
          uuid: "child-assistant-1",
          timestamp: "2026-04-02T04:31:44.000Z"
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);
    const childSession = sessions.find((session) => session.rawStoreRef === join(projectDir, `${childFileName}.jsonl`));

    assert.equal(sessions.length, 2);
    assert.equal(childSession?.providerSessionId, `${parentSessionId}::${childFileName}`);
    assert.equal(childSession?.parentProviderSessionId, parentSessionId);
    assert.equal(childSession?.isSubagent, true);
    assert.equal(childSession?.subagentLabel, "explore · 查找GLM MCP配置文件");
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

test("ClaudeCodeAdapter 在没有 ai-title 时会优先用真实用户提示词，而不是 slug", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-slug-title-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "3a3a3a3a-3333-4333-8333-3a3a3a3a3a3a";
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
          timestamp: "2026-04-12T10:00:00.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "<ide_opened_file>The user opened the file /Users/jackson/Documents/Code/CodingNS/README.md in the IDE. This may or may not be related to the current task.</ide_opened_file>"
              },
              {
                type: "text",
                text: "请帮我修复 Claude 会话标题读取异常"
              }
            ]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-04-12T10:00:02.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "我先检查标题解析链路。" }]
          },
          slug: "keen-riding-unicorn"
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);
    const title = await adapter.readSessionTitle(sessionId, rawStoreRef);

    assert.equal(sessions[0]?.title, "请帮我修复 Claude 会话标题读取异常");
    assert.equal(title, "请帮我修复 Claude 会话标题读取异常");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 在没有 slug 时会跳过 IDE 注入和规则块，改用真实用户提示词做标题", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-fallback-title-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "4b4b4b4b-4444-4444-8444-4b4b4b4b4b4b";
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
          timestamp: "2026-04-12T10:05:00.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "# AGENTS.md instructions for /Users/jackson/Documents/Code/CodingNS\n<INSTRUCTIONS>\n请始终使用中文\n</INSTRUCTIONS>"
              },
              {
                type: "text",
                text: "<ide_opened_file>The user opened the file /Users/jackson/Documents/Code/CodingNS/apps/user-app/src/main.tsx in the IDE. This may or may not be related to the current task.</ide_opened_file>"
              },
              {
                type: "text",
                text: "请把 Claude 外部会话标题读取修好，不要再显示 IDE 注入内容"
              }
            ]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);
    const title = await adapter.readSessionTitle(sessionId, rawStoreRef);

    assert.equal(sessions[0]?.title, "请把 Claude 外部会话标题读取修好，不要再显示 IDE 注入内容");
    assert.equal(title, "请把 Claude 外部会话标题读取修好，不要再显示 IDE 注入内容");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 只有 slug 可用时才回退到 slug", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-slug-fallback-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "5c5c5c5c-5555-4555-8555-5c5c5c5c5c5c";
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
          timestamp: "2026-04-12T10:08:00.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "这是只有 assistant 的异常 transcript。" }]
          },
          slug: "quiet-floating-feather"
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);
    const title = await adapter.readSessionTitle(sessionId, rawStoreRef);

    assert.equal(sessions[0]?.title, "quiet-floating-feather");
    assert.equal(title, "quiet-floating-feather");
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
    assert.match(page.messages[0]?.rawRef ?? "", /^claude-code:\/\/message\//);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 不会把连续两条同前缀 assistant 文本误并成一条消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-consecutive-prefix-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "34343434-3434-4434-8434-343434343435";
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
          timestamp: "2026-03-28T01:00:00.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "先回答第一句" }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-03-28T01:00:01.000Z",
          message: {
            id: "msg-prefix-1",
            role: "assistant",
            content: [{ type: "text", text: "收到" }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-03-28T01:00:02.000Z",
          message: {
            id: "msg-prefix-2",
            role: "assistant",
            content: [{ type: "text", text: "收到，继续处理下一句" }]
          }
        }),
        JSON.stringify({
          type: "user",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-03-28T01:00:03.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "再问一个问题" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory(sessionId, rawStoreRef, null, 20, "forward");

    assert.equal(page.messages.length, 4);
    assert.deepEqual(
      page.messages.map((message) => [message.role, message.kind, message.content]),
      [
        ["user", "text", "先回答第一句"],
        ["assistant", "text", "收到"],
        ["assistant", "text", "收到，继续处理下一句"],
        ["user", "text", "再问一个问题"]
      ]
    );
    assert.notEqual(page.messages[1]?.messageId, page.messages[2]?.messageId);
    assert.notEqual(page.messages[1]?.rawRef, page.messages[2]?.rawRef);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 会把同一条 assistant 消息里的重复 text block 收敛成一条正式消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-duplicate-text-blocks-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "35353535-3535-4535-8535-353535353535";
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
          timestamp: "2026-03-29T01:00:00.000Z",
          message: {
            id: "msg-duplicate-text-1",
            role: "assistant",
            content: [
              { type: "text", text: "正式回复" },
              { type: "text", text: "正式回复" },
              { type: "text", text: "正式回复" }
            ]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory(sessionId, rawStoreRef, null, 20, "forward");

    assert.equal(page.messages.length, 1);
    assert.equal(page.messages[0]?.role, "assistant");
    assert.equal(page.messages[0]?.kind, "text");
    assert.equal(page.messages[0]?.content, "正式回复");
    assert.match(page.messages[0]?.rawRef ?? "", /^claude-code:\/\/message\//);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 会把同一条 assistant 消息里的重复 thinking block 收敛成一条正式消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-duplicate-thinking-blocks-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "36363636-3636-4636-8636-363636363636";
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
          timestamp: "2026-03-29T01:00:00.000Z",
          message: {
            id: "msg-duplicate-thinking-1",
            role: "assistant",
            content: [
              { type: "thinking", thinking: "先想一下" },
              { type: "thinking", thinking: "先想一下" }
            ]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory(sessionId, rawStoreRef, null, 20, "forward");

    assert.equal(page.messages.length, 1);
    assert.equal(page.messages[0]?.role, "assistant");
    assert.equal(page.messages[0]?.kind, "thinking");
    assert.equal(page.messages[0]?.content, "先想一下");
    assert.match(page.messages[0]?.rawRef ?? "", /^claude-code:\/\/message\//);
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

test("ClaudeCodeAdapter 会话级 fork 会复制 transcript 并重写新的 sessionId", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-fork-session-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "56565656-5656-4565-8565-565656565656";
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
          timestamp: "2026-04-11T01:00:00.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "请继续整理会话分叉。" }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-04-11T01:00:05.000Z",
          message: {
            id: "msg-fork-session-1",
            role: "assistant",
            content: [{ type: "text", text: "先把能力抽象出来。" }]
          }
        }),
        JSON.stringify({
          type: "ai-title",
          sessionId,
          aiTitle: "会话分叉源会话"
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const result = await adapter.forkSession(sessionId, workspacePath, {
      rawStoreRef,
      sourceType: "session"
    });
    const forkedPage = await adapter.readSessionHistory(
      result.session.providerSessionId,
      result.session.rawStoreRef,
      null,
      20,
      "forward"
    );
    const forkedTranscript = readFileSync(result.session.rawStoreRef, "utf8");
    const discoveredSessions = await adapter.detectSessions(workspacePath);
    const forkedSummary = discoveredSessions.find(
      (session) => session.providerSessionId === result.session.providerSessionId
    );

    assert.equal(result.forkMethod, "native_session_fork");
    assert.equal(result.forkSourceType, "session");
    assert.equal(result.inheritedPrefixMessageCount, 2);
    assert.equal(result.session.title, "");
    assert.equal(result.session.messageCount, 2);
    assert.equal(forkedPage.messages.length, 2);
    assert.equal(forkedPage.messages[1]?.content, "先把能力抽象出来。");
    assert.equal(forkedSummary?.title, "请继续整理会话分叉。");
    assert.equal(forkedTranscript.includes(sessionId), false);
    assert.equal(forkedTranscript.includes(result.session.providerSessionId), true);
    assert.equal(forkedTranscript.includes('"type":"ai-title"'), false);
    assert.equal(forkedTranscript.endsWith("\n"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 消息级 fork 会截断到指定消息锚点", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-fork-message-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "57575757-5757-4575-8575-575757575757";
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
          timestamp: "2026-04-11T02:00:00.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "从这里开始分析。" }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-04-11T02:00:05.000Z",
          message: {
            id: "msg-fork-message-1",
            role: "assistant",
            content: [
              { type: "thinking", thinking: "先拆数据结构" },
              { type: "text", text: "然后把分叉能力抽出来。" }
            ]
          }
        }),
        JSON.stringify({
          type: "user",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-04-11T02:00:10.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "这条消息不该被带进子分支。" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const sourcePage = await adapter.readSessionHistory(sessionId, rawStoreRef, null, 20, "forward");
    const anchorMessage = sourcePage.messages[1];

    assert.ok(anchorMessage);
    assert.equal(anchorMessage?.kind, "thinking");

    const result = await adapter.forkSession(sessionId, workspacePath, {
      rawStoreRef,
      sourceType: "message",
      sourceMessageId: anchorMessage.messageId
    });
    const forkedPage = await adapter.readSessionHistory(
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
    assert.equal(forkedPage.messages.length, 2);
    assert.equal(forkedPage.messages[1]?.kind, "thinking");
    assert.equal(forkedPage.messages[1]?.content, "先拆数据结构");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 会优先使用 fork 点击当下的消息快照，而不是后续刷新的最新内容", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-fork-snapshot-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "67676767-6767-4676-8676-676767676767";
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
          timestamp: "2026-04-11T02:10:00.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "从这里开始分析。" }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          cwd: workspacePath,
          timestamp: "2026-04-11T02:10:05.000Z",
          message: {
            id: "msg-fork-message-2",
            role: "assistant",
            content: [
              { type: "text", text: "旧回答 X，后来又继续长成了 Y。" }
            ]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const sourcePage = await adapter.readSessionHistory(sessionId, rawStoreRef, null, 20, "forward");
    const anchorMessage = sourcePage.messages[1];

    assert.ok(anchorMessage);

    const result = await adapter.forkSession(sessionId, workspacePath, {
      rawStoreRef,
      sourceType: "message",
      sourceMessageId: anchorMessage.messageId,
      sourceMessageSnapshot: {
        role: "assistant",
        kind: "text",
        content: "旧回答 X"
      }
    });
    const forkedPage = await adapter.readSessionHistory(
      result.session.providerSessionId,
      result.session.rawStoreRef,
      null,
      20,
      "forward"
    );

    assert.equal(result.forkMethod, "native_message_fork");
    assert.equal(forkedPage.messages[1]?.content, "旧回答 X");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter discovery 第二轮会复用文件摘要缓存", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-summary-cache-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const projectDir = join(tempDir, "projects", "-Users-jackson-Documents-Code-CodingNS");
  const sessionId = "cache-session-1";
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
          timestamp: "2026-04-17T10:00:00.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "Claude cache test" }]
          }
        }),
        JSON.stringify({
          type: "ai-title",
          sessionId,
          aiTitle: "Claude cache title"
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const firstSessions = await adapter.detectSessions(workspacePath);

    assert.equal(firstSessions.length, 1);

    adapter.parseMessages = () => {
      throw new Error("should not reparse unchanged claude session");
    };

    const secondSessions = await adapter.detectSessions(workspacePath);

    assert.equal(secondSessions.length, 1);
    assert.equal(secondSessions[0]?.providerSessionId, sessionId);
    assert.equal(secondSessions[0]?.title, "Claude cache title");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

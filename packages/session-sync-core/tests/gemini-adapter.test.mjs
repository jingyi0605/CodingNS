import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GeminiAdapter } from "../dist/index.js";
import { messageIdFromRawRef } from "../dist/providers/utils.js";

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

test("GeminiAdapter 对重写的同一消息 usage 采用最后一次值", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-session-stats-"));
  const homeDir = join(rootDir, "gemini-home");
  const chatFile = join(homeDir, "tmp", "hash", "chats", "session-1.json");

  try {
    mkdirSync(join(homeDir, "tmp", "hash", "chats"), { recursive: true });
    writeFileSync(
      chatFile,
      JSON.stringify({
        sessionId: "session-1",
        workspacePath: "/workspace/demo",
        messages: [
          {
            id: "assistant-1",
            type: "gemini",
            timestamp: "2026-04-25T10:00:00.000Z",
            content: "partial",
            tokens: { input: 10, output: 1, cached: 0, thoughts: 0, tool: 0, total: 11 }
          },
          {
            id: "assistant-1",
            type: "gemini",
            timestamp: "2026-04-25T10:00:01.000Z",
            content: "final",
            tokens: { input: 20, output: 2, cached: 3, thoughts: 4, tool: 5, total: 34 }
          }
        ]
      }),
      "utf8"
    );

    const stats = await new GeminiAdapter({ homeDir, listSessions: async () => [] }).readSessionStats(
      "session-1",
      "gemini://session/session-1"
    );

    assert.equal(stats?.metrics.inputTokens?.value, 20);
    assert.equal(stats?.metrics.totalTokens?.value, 34);
    assert.equal(stats?.metrics.toolTokens?.value, 5);
    assert.equal(stats?.metrics.inputTokens?.semantic, "sum-of-final-events");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("GeminiAdapter capability 浼氬０鏄庡彲鍚姩 runtime 涓斾笉鏀寔闄勪欢", () => {
  const adapter = new GeminiAdapter({
    homeDir: "/tmp/gemini-home"
  });
  const capabilities = adapter.getProviderCapabilities();

  assert.equal(capabilities.provider, "gemini");
  assert.equal(capabilities.canStartSession, true);
  assert.equal(capabilities.canResumeSession, true);
  assert.equal(capabilities.canSendMessage, true);
  assert.equal(capabilities.supportsInterrupt, true);
  assert.equal(capabilities.supportsAttachments, false);
  assert.equal(capabilities.supportsPermissionPrompt, false);
});

test("Gemini CLI 未安装时仍然把本地 chats 发现视为 complete", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-no-cli-"));
  const homeDir = join(rootDir, "gemini-home");
  const chatFile = join(homeDir, "tmp", "hash-alpha", "chats", "gemini-session-alpha.json");

  try {
    mkdirSync(join(homeDir, "tmp", "hash-alpha", "chats"), { recursive: true });
    writeFileSync(
      chatFile,
      JSON.stringify({
        sessionId: "gemini-session-alpha",
        workspacePath: "/workspace/alpha",
        title: "Alpha 本地会话",
        updatedAt: "2026-04-03T08:10:00.000Z",
        messages: [
          {
            role: "user",
            timestamp: "2026-04-03T08:00:00.000Z",
            parts: [{ text: "hello" }]
          }
        ]
      }),
      "utf8"
    );

    const adapter = new GeminiAdapter({
      homeDir,
      commandPath: join(rootDir, "missing-gemini")
    });
    const discovery = await adapter.detectSessionsDetailed("/workspace/alpha");

    assert.equal(discovery.isComplete, true);
    assert.deepEqual(
      discovery.sessions.map((session) => session.providerSessionId),
      ["gemini-session-alpha"]
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("GeminiAdapter discovery 第二轮会复用 mtime/size 轻摘要缓存并输出扫描诊断", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-diagnostics-"));
  const homeDir = join(rootDir, "gemini-home");
  const chatFile = join(homeDir, "tmp", "hash-alpha", "chats", "gemini-session-alpha.json");

  try {
    mkdirSync(join(homeDir, "tmp", "hash-alpha", "chats"), { recursive: true });
    writeFileSync(
      chatFile,
      JSON.stringify({
        sessionId: "gemini-session-alpha",
        workspacePath: "/workspace/alpha",
        title: "Alpha 本地会话",
        updatedAt: "2026-04-03T08:10:00.000Z",
        messages: [
          {
            role: "user",
            timestamp: "2026-04-03T08:00:00.000Z",
            parts: [{ text: "hello" }]
          },
          {
            role: "assistant",
            timestamp: "2026-04-03T08:00:01.000Z",
            parts: [{ text: "world" }]
          }
        ]
      }),
      "utf8"
    );

    const adapter = new GeminiAdapter({
      homeDir,
      listSessions: async () => []
    });

    const firstDiscovery = await adapter.detectSessionsDetailed("/workspace/alpha");
    const firstDiagnostic = firstDiscovery.providerDiagnostics?.[0];

    assert.equal(firstDiagnostic?.provider, "gemini");
    assert.equal(firstDiagnostic?.scannedFiles, 1);
    assert.equal(firstDiagnostic?.skippedByMtimeSize, 0);
    assert.equal(firstDiagnostic?.parsedFiles, 1);
    assert.equal(firstDiagnostic?.bytesRead > 0, true);

    const secondDiscovery = await adapter.detectSessionsDetailed("/workspace/alpha");
    const secondDiagnostic = secondDiscovery.providerDiagnostics?.[0];

    assert.equal(secondDiagnostic?.provider, "gemini");
    assert.equal(secondDiagnostic?.scannedFiles, 1);
    assert.equal(secondDiagnostic?.skippedByMtimeSize, 1);
    assert.equal(secondDiagnostic?.parsedFiles, 0);
    assert.equal(secondDiagnostic?.bytesRead, 0);
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

test("GeminiAdapter 会从 .project_root 回填工作区，并兼容当前 Gemini chats 结构", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-project-root-"));
  const homeDir = join(rootDir, "gemini-home");
  const workspaceDir = join(rootDir, "workspace-alpha");
  const projectDir = join(homeDir, "tmp", "codingns");
  const chatFile = join(projectDir, "chats", "session-project-root.json");

  try {
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(join(projectDir, "chats"), { recursive: true });
    writeFileSync(join(projectDir, ".project_root"), workspaceDir, "utf8");
    writeFileSync(
      chatFile,
      JSON.stringify({
        sessionId: "session-project-root",
        lastUpdated: "2026-04-08T12:10:00.000Z",
        messages: [
          {
            id: "msg-user",
            timestamp: "2026-04-08T12:00:00.000Z",
            type: "user",
            content: [{ text: "继续修 Gemini 会话发现" }]
          },
          {
            id: "msg-assistant",
            timestamp: "2026-04-08T12:10:00.000Z",
            type: "gemini",
            content: "已经补上工作区回填。"
          }
        ],
        kind: "main"
      }),
      "utf8"
    );

    const adapter = new GeminiAdapter({
      homeDir,
      listSessions: async () => []
    });

    const discovery = await adapter.detectSessionsDetailed(workspaceDir);

    assert.equal(discovery.isComplete, true);
    assert.equal(discovery.sessions.length, 1);
    assert.equal(discovery.sessions[0]?.providerSessionId, "session-project-root");
    assert.equal(discovery.sessions[0]?.workspacePath, workspaceDir);
    assert.equal(discovery.sessions[0]?.title, "继续修 Gemini 会话发现");
    assert.equal(discovery.sessions[0]?.lastMessageAt, "2026-04-08T12:10:00.000Z");

    const page = await adapter.readSessionHistory(
      "session-project-root",
      "gemini://session/session-project-root",
      null,
      10
    );

    assert.equal(page.messages[0]?.role, "user");
    assert.equal(page.messages[0]?.content, "继续修 Gemini 会话发现");
    assert.equal(page.messages[1]?.role, "assistant");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("GeminiAdapter 能解析纯文本 --list-sessions 输出，并把命令工作目录视为当前工作区", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-cli-text-"));
  const homeDir = join(rootDir, "gemini-home");
  const workspaceDir = join(rootDir, "workspace-alpha");
  const scriptPath = join(
    rootDir,
    process.platform === "win32" ? "fake-gemini.cmd" : "fake-gemini.sh"
  );

  try {
    mkdirSync(workspaceDir, { recursive: true });

    if (process.platform === "win32") {
      writeFileSync(
        scriptPath,
        "@echo off\r\necho Available sessions for this project (1):\r\necho   1. tmpmd (12 minutes ago) [cli-session-1]\r\n",
        "utf8"
      );
    } else {
      writeFileSync(
        scriptPath,
        "#!/bin/sh\necho \"Available sessions for this project (1):\"\necho \"  1. tmpmd (12 minutes ago) [cli-session-1]\"\n",
        "utf8"
      );
      chmodSync(scriptPath, 0o755);
    }

    const adapter = new GeminiAdapter({
      homeDir,
      commandPath: scriptPath
    });
    const discovery = await adapter.detectSessionsDetailed(workspaceDir);

    assert.equal(discovery.isComplete, true);
    assert.equal(discovery.sessions.length, 1);
    assert.equal(discovery.sessions[0]?.providerSessionId, "cli-session-1");
    assert.equal(discovery.sessions[0]?.workspacePath, workspaceDir);
    assert.equal(discovery.sessions[0]?.title, "tmpmd");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("GeminiAdapter 会把当前 Gemini schema 的 thoughts 和 toolCalls 归一化进历史消息", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-current-schema-"));
  const homeDir = join(rootDir, "gemini-home");
  const workspaceDir = join(rootDir, "workspace-alpha");
  const projectDir = join(homeDir, "tmp", "codingns");
  const chatFile = join(projectDir, "chats", "session-current-schema.json");

  try {
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(join(projectDir, "chats"), { recursive: true });
    writeFileSync(join(projectDir, ".project_root"), workspaceDir, "utf8");
    writeFileSync(
      chatFile,
      JSON.stringify({
        sessionId: "session-current-schema",
        lastUpdated: "2026-04-08T12:52:46.292Z",
        messages: [
          {
            id: "msg-user",
            timestamp: "2026-04-08T12:52:08.955Z",
            type: "user",
            content: [
              {
                text: "请在 tmp 目录下写一个文件"
              }
            ]
          },
          {
            id: "msg-assistant",
            timestamp: "2026-04-08T12:52:46.292Z",
            type: "gemini",
            content: "文件已经写好了。",
            thoughts: [
              {
                subject: "Planning",
                description: "先确认目标目录，再准备写入内容。",
                timestamp: "2026-04-08T12:52:17.179Z"
              }
            ],
            toolCalls: [
              {
                id: "write-file-1",
                name: "write_file",
                args: {
                  file_path: "tmp/demo.md",
                  content: "# demo"
                },
                result: [
                  {
                    functionResponse: {
                      id: "write-file-1",
                      name: "write_file",
                      response: {
                        output: "Successfully created tmp/demo.md"
                      }
                    }
                  }
                ],
                status: "success",
                timestamp: "2026-04-08T12:52:36.316Z"
              }
            ]
          }
        ],
        kind: "main"
      }),
      "utf8"
    );

    const adapter = new GeminiAdapter({
      homeDir,
      listSessions: async () => []
    });
    const discovery = await adapter.detectSessionsDetailed(workspaceDir);

    assert.equal(discovery.sessions.length, 1);
    assert.equal(discovery.sessions[0]?.messageCount, 5);

    const page = await adapter.readSessionHistory(
      "session-current-schema",
      "gemini://session/session-current-schema",
      null,
      20
    );

    assert.equal(page.messages.length, 5);
    assert.deepEqual(
      page.messages.map((message) => [message.role, message.kind]),
      [
        ["user", "text"],
        ["assistant", "thinking"],
        ["tool", "tool_call"],
        ["tool", "tool_result"],
        ["assistant", "text"]
      ]
    );
    assert.equal(page.messages[1]?.content, "Planning\n\n先确认目标目录，再准备写入内容。");
    assert.equal(page.messages[1]?.timestamp, "2026-04-08T12:52:17.179Z");
    assert.equal(page.messages[2]?.toolCall?.callId, "write-file-1");
    assert.equal(page.messages[2]?.toolCall?.name, "apply_patch");
    assert.equal(page.messages[2]?.toolCall?.input.includes("*** Add File: tmp/demo.md"), true);
    assert.equal(page.messages[2]?.content.includes("*** Begin Patch"), true);
    assert.equal(page.messages[3]?.toolCall?.status, "completed");
    assert.equal(page.messages[3]?.toolCall?.name, "apply_patch");
    assert.equal(page.messages[3]?.toolCall?.output, "Successfully created tmp/demo.md");
    assert.equal(page.messages[3]?.timestamp, "2026-04-08T12:52:36.316Z");
    assert.equal(page.messages[4]?.content, "文件已经写好了。");
    assert.equal(
      page.messages[0]?.messageId,
      messageIdFromRawRef("gemini://session/session-current-schema/message/user-1")
    );
    assert.equal(
      page.messages[2]?.messageId,
      messageIdFromRawRef("gemini://session/session-current-schema/tool/write-file-1/call")
    );
    assert.equal(
      page.messages[3]?.messageId,
      messageIdFromRawRef("gemini://session/session-current-schema/tool/write-file-1/result")
    );
    assert.equal(
      page.messages[4]?.messageId,
      messageIdFromRawRef("gemini://session/session-current-schema/message/assistant-1")
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("GeminiAdapter 能读取当前真实 Gemini jsonl chats，并发现标题与历史消息", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-jsonl-current-"));
  const homeDir = join(rootDir, "gemini-home");
  const workspaceDir = join(rootDir, "workspace-alpha");
  const projectDir = join(homeDir, "tmp", "codingns");
  const chatFile = join(projectDir, "chats", "session-2026-04-25T15-24-7f75c9df.jsonl");

  try {
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(join(projectDir, "chats"), { recursive: true });
    writeFileSync(join(projectDir, ".project_root"), workspaceDir, "utf8");
    writeFileSync(
      chatFile,
      [
        JSON.stringify({
          sessionId: "7f75c9df-c657-4197-8cf4-48c97d5fbbcd",
          projectHash: "hash-alpha",
          startTime: "2026-04-25T15:24:02.097Z",
          lastUpdated: "2026-04-25T15:24:02.097Z",
          kind: "main"
        }),
        JSON.stringify({
          id: "msg-user-1",
          timestamp: "2026-04-25T15:24:02.104Z",
          type: "user",
          content: [{ text: "请只回复 OK，不要调用任何工具。" }]
        }),
        JSON.stringify({
          $set: {
            lastUpdated: "2026-04-25T15:24:02.104Z"
          }
        }),
        JSON.stringify({
          id: "msg-assistant-1",
          timestamp: "2026-04-25T15:24:29.090Z",
          type: "gemini",
          content: "OK",
          thoughts: [
            {
              subject: "Assessing the Prompt",
              description: "先理解要求，再直接回复。",
              timestamp: "2026-04-25T15:24:28.464Z"
            }
          ],
          tokens: {
            input: 9941,
            output: 1,
            total: 10078
          },
          model: "gemini-3.1-pro"
        }),
        JSON.stringify({
          $set: {
            lastUpdated: "2026-04-25T15:24:29.090Z"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new GeminiAdapter({
      homeDir,
      listSessions: async () => []
    });
    const discovery = await adapter.detectSessionsDetailed(workspaceDir);

    assert.equal(discovery.sessions.length, 1);
    assert.equal(discovery.sessions[0]?.providerSessionId, "7f75c9df-c657-4197-8cf4-48c97d5fbbcd");
    assert.equal(discovery.sessions[0]?.workspacePath, workspaceDir);
    assert.equal(discovery.sessions[0]?.title, "请只回复 OK，不要调用任何工具。");
    assert.equal(discovery.sessions[0]?.lastMessageAt, "2026-04-25T15:24:29.090Z");
    assert.equal(discovery.sessions[0]?.messageCount, 3);

    const page = await adapter.readSessionHistory(
      "7f75c9df-c657-4197-8cf4-48c97d5fbbcd",
      "gemini://session/7f75c9df-c657-4197-8cf4-48c97d5fbbcd",
      null,
      20
    );

    assert.deepEqual(
      page.messages.map((message) => [message.role, message.kind, message.content]),
      [
        ["user", "text", "请只回复 OK，不要调用任何工具。"],
        ["assistant", "thinking", "Assessing the Prompt\n\n先理解要求，再直接回复。"],
        ["assistant", "text", "OK"]
      ]
    );
    assert.equal(
      page.messages[0]?.messageId,
      messageIdFromRawRef("gemini://session/7f75c9df-c657-4197-8cf4-48c97d5fbbcd/message/user-1")
    );
    assert.equal(
      page.messages[2]?.messageId,
      messageIdFromRawRef("gemini://session/7f75c9df-c657-4197-8cf4-48c97d5fbbcd/message/assistant-1")
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

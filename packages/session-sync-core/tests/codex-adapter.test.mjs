import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexAdapter } from "../dist/index.js";
import { loadDatabaseSync } from "../dist/sqlite/node-sqlite.js";

const DatabaseSync = loadDatabaseSync();

function createStableMessageId(providerSessionId, stableIdentity) {
  return createHash("sha1").update(`codex:${providerSessionId}:${stableIdentity}`).digest("hex");
}

test("CodexAdapter 会如实声明 Codex CLI app-server steer 能力与 SDK 限制", async () => {
  const adapter = new CodexAdapter({ homeDir: "/tmp/codingns-codex-capabilities" });
  const capabilities = adapter.getProviderCapabilities();

  assert.equal(capabilities.inRunInputMode, "streaming_guidance");
  assert.equal(
    capabilities.limitations.some(
      (item) => item.includes("turn/steer") && item.includes("codex-cli 0.118.0")
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

test("CodexAdapter 会为 app-server 落盘的 assistant 与 tool 消息复用稳定 messageId", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-adapter-stable-id-"));
  const sessionFile = join(tempDir, "session.jsonl");

  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-04-17T10:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            id: "assistant-1",
            message: "开始整理"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-17T10:00:01.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "command-1",
            name: "command_execution",
            arguments: "pwd"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-17T10:00:02.000Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "command-1",
            output: "/workspace",
            status: "completed"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory("thread-1", sessionFile, null, 50);

    assert.deepEqual(
      page.messages.map((message) => ({
        messageId: message.messageId,
        role: message.role,
        kind: message.kind
      })),
      [
        {
          messageId: createStableMessageId("thread-1", "assistant:text:assistant-1"),
          role: "assistant",
          kind: "text"
        },
        {
          messageId: createStableMessageId("thread-1", "tool:call:command-1"),
          role: "tool",
          kind: "tool_call"
        },
        {
          messageId: createStableMessageId("thread-1", "tool:result:command-1"),
          role: "tool",
          kind: "tool_result"
        }
      ]
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 会把 Codex 新版命令式编辑脚本归一化成 apply_patch", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-adapter-command-edit-"));
  const sessionFile = join(tempDir, "session.jsonl");
  const editCommand = [
    "python3 - <<'PY'",
    "from pathlib import Path",
    "path = Path('src/runtime/codex-runtime.ts')",
    "text = path.read_text()",
    "old = '''const normalized = value.trim().toLowerCase();'''",
    "new = '''const normalized = value.trim().toLowerCase();\\nreturn normalized;'''",
    "text = text.replace(old, new, 1)",
    "path.write_text(text)",
    "PY",
    "npm run build"
  ].join("\\n");

  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-05-06T10:00:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "command-edit-1",
            name: "exec_command",
            arguments: JSON.stringify({
              cmd: editCommand,
              workdir: "/Users/jackson/Code/CodingNS",
              yield_time_ms: 1000
            })
          }
        }),
        JSON.stringify({
          timestamp: "2026-05-06T10:00:01.000Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "command-edit-1",
            output: [
              "Command: /bin/zsh -lc " + JSON.stringify(editCommand),
              "Chunk ID: abc123",
              "Wall time: 0.0000 seconds",
              "Process exited with code 0",
              "Output:"
            ].join("\n"),
            status: "completed"
          }
        }),
        JSON.stringify({
          timestamp: "2026-05-06T10:00:02.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "poll-edit-1",
            name: "write_stdin",
            arguments: JSON.stringify({
              session_id: 14837,
              chars: "",
              yield_time_ms: 1000
            })
          }
        }),
        JSON.stringify({
          timestamp: "2026-05-06T10:00:03.000Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "poll-edit-1",
            output: [
              "Command: /bin/zsh -lc " + JSON.stringify(editCommand),
              "Chunk ID: c395a4",
              "Wall time: 0.0000 seconds",
              "Process exited with code 0",
              "Output:"
            ].join("\n"),
            status: "completed"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory("thread-command-edit", sessionFile, null, 50);
    const commandCall = page.messages.find((message) => message.messageId === createStableMessageId(
      "thread-command-edit",
      "tool:call:command-edit-1"
    ));
    const commandResult = page.messages.find((message) => message.messageId === createStableMessageId(
      "thread-command-edit",
      "tool:result:command-edit-1"
    ));
    const pollCall = page.messages.find((message) => message.messageId === createStableMessageId(
      "thread-command-edit",
      "tool:call:poll-edit-1"
    ));
    const pollResult = page.messages.find((message) => message.messageId === createStableMessageId(
      "thread-command-edit",
      "tool:result:poll-edit-1"
    ));

    assert.equal(commandCall?.toolCall?.name, "apply_patch");
    assert.match(commandCall?.toolCall?.input ?? "", /^\*\*\* Begin Patch/m);
    assert.match(commandCall?.toolCall?.input ?? "", /\*\*\* Update File: src\/runtime\/codex-runtime\.ts/);
    assert.equal(commandResult?.toolCall?.name, "apply_patch");
    assert.match(commandResult?.toolCall?.input ?? "", /\*\*\* Update File: src\/runtime\/codex-runtime\.ts/);
    assert.match(commandResult?.toolCall?.input ?? "", /-const normalized = value\.trim\(\)\.toLowerCase\(\);/);
    assert.match(commandResult?.toolCall?.input ?? "", /\+return normalized;/);
    assert.equal(pollCall?.toolCall?.name, "apply_patch");
    assert.match(pollCall?.toolCall?.input ?? "", /\*\*\* Update File: src\/runtime\/codex-runtime\.ts/);
    assert.equal(pollResult?.toolCall?.name, "apply_patch");
    assert.match(pollResult?.toolCall?.input ?? "", /\*\*\* Update File: src\/runtime\/codex-runtime\.ts/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 合并等价 assistant 记录时会保留 event_msg 提供的稳定 messageId", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-adapter-merged-stable-id-"));
  const sessionFile = join(tempDir, "session.jsonl");

  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-04-17T10:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            id: "assistant-merge-1",
            message: "整理完成"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-17T10:00:00.400Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "整理完成" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-17T10:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "agent_reasoning",
            id: "reasoning-merge-1",
            text: "先确认影响范围"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-17T10:00:01.400Z",
          type: "response_item",
          payload: {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "先确认影响范围" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory("thread-merge-1", sessionFile, null, 50);

    assert.equal(page.messages.length, 2);
    assert.deepEqual(
      page.messages.map((message) => ({
        messageId: message.messageId,
        role: message.role,
        kind: message.kind
      })),
      [
        {
          messageId: createStableMessageId("thread-merge-1", "assistant:text:assistant-merge-1"),
          role: "assistant",
          kind: "text"
        },
        {
          messageId: createStableMessageId("thread-merge-1", "assistant:thinking:reasoning-merge-1"),
          role: "assistant",
          kind: "thinking"
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
        archived_at INTEGER,
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

test("CodexAdapter 改名时会优先调用 Codex 官方 thread/name/set", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-title-set-"));
  const sessionDir = join(tempDir, "sessions", "2026", "06", "08");
  const sessionFile = join(sessionDir, "session.jsonl");
  const threadId = "019ea636-3698-7332-a898-a147969b36aa";
  const calls = [];

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: threadId,
            cwd: "/Users/jackson/Code/CodingNS"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T00:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "请使用子Agent写一个笑话，保存到输出物文件夹"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      threadControlTransportFactory: () => ({
        async initialize() {
          calls.push("initialize");
        },
        async archiveThread() {
          throw new Error("SHOULD_NOT_ARCHIVE");
        },
        async unarchiveThread() {
          throw new Error("SHOULD_NOT_UNARCHIVE");
        },
        async readThread() {
          throw new Error("SHOULD_NOT_READ");
        },
        async setThreadName(providerSessionId, name) {
          calls.push(`set:${providerSessionId}:${name}`);
        },
        close() {
          calls.push("close");
        }
      })
    });

    const nextTitle = await adapter.renameSessionTitle(threadId, sessionFile, "子 Agent 笑话输出");

    assert.equal(nextTitle, "子 Agent 笑话输出");
    assert.deepEqual(calls, [
      "initialize",
      `set:${threadId}:子 Agent 笑话输出`,
      "close"
    ]);
    assert.match(
      readFileSync(join(tempDir, "session_index.jsonl"), "utf8"),
      /子 Agent 笑话输出/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 读取标题时应优先复用 discovery 摘要缓存，避免重复解析整份会话", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-title-cache-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "03", "26");
  const sessionFile = join(sessionDir, "session.jsonl");
  const threadId = "12345678-1234-4234-9234-1234567890ad";
  const sessionTitle = "给工作区扫描补缓存，避免重复读取大文件";

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
            message: sessionTitle
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
        archived_at INTEGER,
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
      sessionTitle,
      workspacePath,
      Math.floor(Date.parse("2026-03-26T00:00:00.000Z") / 1000),
      0,
      sessionTitle,
      null,
      null,
      sessionFile
    );
    db.close();

    const adapter = new CodexAdapter({ homeDir: tempDir });
    await adapter.detectSessions(workspacePath);
    adapter.parseMessagesFromEntries = () => {
      throw new Error("SHOULD_NOT_PARSE_MESSAGES");
    };

    const title = await adapter.readSessionTitle(threadId, sessionFile);
    assert.equal(title, sessionTitle);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 直接读取过一次标题后，应复用标题缓存避免再次整文件解析", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-title-read-cache-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "04", "17");
  const sessionFile = join(sessionDir, "session.jsonl");
  const threadId = "22345678-1234-4234-9234-1234567890ad";
  const sessionTitle = "把标题读取结果也缓存下来，别反复吃整文件";

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
          timestamp: "2026-04-17T00:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: sessionTitle
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const firstTitle = await adapter.readSessionTitle(threadId, sessionFile);
    assert.equal(firstTitle, sessionTitle);

    adapter.parseMessagesFromEntries = () => {
      throw new Error("SHOULD_NOT_PARSE_MESSAGES_TWICE");
    };

    const secondTitle = await adapter.readSessionTitle(threadId, sessionFile);
    assert.equal(secondTitle, sessionTitle);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 会根据线程索引只纳入当前工作区的 archived 会话", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-archived-index-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const otherWorkspacePath = "/Users/jackson/Documents/Code/OtherRepo";
  const archivedDir = join(tempDir, "archived_sessions");
  const archivedFile = join(archivedDir, "archived-thread.jsonl");
  const otherArchivedFile = join(archivedDir, "other-thread.jsonl");
  const threadId = "12345678-1234-4234-9234-1234567890ae";
  const otherThreadId = "12345678-1234-4234-9234-1234567890af";
  const archivedTitle = "归档会话仍应能出现在当前工作区里";

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
    writeFileSync(
      otherArchivedFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: otherThreadId,
            cwd: otherWorkspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-26T00:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "其他工作区的 archived 会话不该被纳入"
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
        archived_at INTEGER,
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
         archived_at,
         first_user_message,
         agent_nickname,
         agent_role,
         rollout_path
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
    db.prepare(
      `INSERT INTO threads (
         id,
         title,
         cwd,
         created_at,
         archived,
         archived_at,
         first_user_message,
         agent_nickname,
         agent_role,
         rollout_path
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      otherThreadId,
      "其他工作区 archived",
      otherWorkspacePath,
      Math.floor(Date.parse("2026-03-26T00:00:00.000Z") / 1000),
      1,
      Math.floor(Date.parse("2026-03-26T00:01:00.000Z") / 1000),
      "其他工作区 archived",
      null,
      null,
      otherArchivedFile
    );
    db.close();

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.providerSessionId, threadId);
    assert.equal(sessions[0]?.isArchived, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 在线程索引仍未标记 archived 时，也能补捞已被移入 archived_sessions 的会话", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-archived-fallback-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const archivedDir = join(tempDir, "archived_sessions");
  const archivedFile = join(archivedDir, "fallback-thread.jsonl");
  const staleActiveFile = join(tempDir, "sessions", "2026", "03", "26", "fallback-thread.jsonl");
  const threadId = "12345678-1234-4234-9234-1234567890b8";
  const archivedTitle = "索引没跟上时也不能把归档会话扫没";

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

    const db = new DatabaseSync(join(tempDir, "state_1.sqlite"));
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
         id,
         title,
         cwd,
         created_at,
         archived,
         archived_at,
         first_user_message,
         agent_nickname,
         agent_role,
         rollout_path
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      threadId,
      archivedTitle,
      workspacePath,
      Math.floor(Date.parse("2026-03-26T00:00:00.000Z") / 1000),
      0,
      null,
      archivedTitle,
      null,
      null,
      staleActiveFile
    );
    db.close();

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.providerSessionId, threadId);
    assert.equal(sessions[0]?.isArchived, true);
    assert.equal(sessions[0]?.rawStoreRef, archivedFile);
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
         id,
         title,
         cwd,
         created_at,
         archived,
         archived_at,
         first_user_message,
         agent_nickname,
         agent_role,
         rollout_path
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
    const archivedSessions = await adapter.detectSessions(workspacePath);

    assert.equal(archivedSessions[0]?.isArchived, true);

    const updated = await adapter.updateSessionArchiveState(threadId, archivedFile, false);
    utimesSync(dbPath, new Date(initialDbStat.atimeMs), new Date(initialDbStat.mtimeMs));

    assert.equal(updated.rawStoreRef, activeFile);
    assert.equal(updated.isArchived, false);
    assert.equal(statSync(activeFile).isFile(), true);

    const restoredSessions = await adapter.detectSessions(workspacePath);

    assert.equal(restoredSessions.length, 1);
    assert.equal(restoredSessions[0]?.providerSessionId, threadId);
    assert.equal(restoredSessions[0]?.rawStoreRef, activeFile);
    assert.equal(restoredSessions[0]?.isArchived, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 归档时会优先走官方线程归档接口，避免只改本地索引", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-archive-transport-"));
  const activeFile = join(
    tempDir,
    "sessions",
    "2026",
    "04",
    "19",
    "rollout-2026-04-19T10-00-00-019db000-0000-7000-8000-000000000001.jsonl"
  );
  const archivedFile = join(
    tempDir,
    "archived_sessions",
    "rollout-2026-04-19T10-00-00-019db000-0000-7000-8000-000000000001.jsonl"
  );
  const threadId = "019db000-0000-7000-8000-000000000001";
  const calls = [];

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "19"), { recursive: true });
    writeFileSync(
      activeFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: threadId,
            cwd: "/Users/jackson/Code/CodingNS"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-19T10:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "优先走 Codex 官方归档接口"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      threadControlTransportFactory: () => ({
        async initialize() {
          calls.push("initialize");
        },
        async archiveThread(providerSessionId) {
          calls.push(`archive:${providerSessionId}`);
          mkdirSync(join(tempDir, "archived_sessions"), { recursive: true });
          writeFileSync(archivedFile, readFileSync(activeFile, "utf8"), "utf8");
          rmSync(activeFile, { force: true });
        },
        async unarchiveThread() {
          throw new Error("SHOULD_NOT_UNARCHIVE");
        },
        async readThread(providerSessionId) {
          calls.push(`read:${providerSessionId}`);
          return {
            thread: {
              id: providerSessionId,
              path: archivedFile
            }
          };
        },
        close() {
          calls.push("close");
        }
      })
    });

    const updated = await adapter.updateSessionArchiveState(threadId, activeFile, true);

    assert.equal(updated.isArchived, true);
    assert.equal(updated.rawStoreRef, archivedFile);
    assert.deepEqual(calls, [
      "initialize",
      `archive:${threadId}`,
      `read:${threadId}`,
      "close"
    ]);
    assert.equal(existsSync(activeFile), false);
    assert.equal(existsSync(archivedFile), true);
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

test("CodexAdapter fork 冷启动时如果源 thread 未加载，会按本地 transcript 冷恢复后再继续分叉", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-cold-source-"));
  const workspacePath = "/Users/jackson/Code/CodingNS";
  const sourceFile = join(tempDir, "sessions", "2026", "04", "19", "source-thread.jsonl");
  const childFile = join(tempDir, "sessions", "2026", "04", "19", "child-thread.jsonl");
  const resumeFromHistoryCalls = [];
  const forkThreadCalls = [];

  try {
    mkdirSync(join(tempDir, "sessions", "2026", "04", "19"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-04-19T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "019da3bc-6401-74e1-90f6-52fcb30d225f",
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-19T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "第一轮问题"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-19T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "第一轮回答"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childFile,
      [
        JSON.stringify({
          timestamp: "2026-04-19T08:00:03.000Z",
          type: "session_meta",
          payload: {
            id: "child-thread",
            cwd: workspacePath,
            forked_from_id: "rebuilt-source-thread"
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
          forkThreadCalls.push(providerSessionId);

          if (providerSessionId === "019da3bc-6401-74e1-90f6-52fcb30d225f") {
            throw new Error("thread not loaded: 019da3bc-6401-74e1-90f6-52fcb30d225f");
          }

          assert.equal(providerSessionId, "rebuilt-source-thread");
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
        async resumeThreadFromHistory(input) {
          resumeFromHistoryCalls.push(input);
          return {
            providerSessionId: "rebuilt-source-thread",
            rawStoreRef: join(tempDir, "runtime", "rebuilt-source-thread.jsonl")
          };
        },
        close() {}
      })
    });

    const result = await adapter.forkSession("019da3bc-6401-74e1-90f6-52fcb30d225f", workspacePath, {
      rawStoreRef: sourceFile,
      sourceType: "session",
      strategy: "auto"
    });

    assert.deepEqual(forkThreadCalls, [
      "019da3bc-6401-74e1-90f6-52fcb30d225f",
      "rebuilt-source-thread"
    ]);
    assert.equal(resumeFromHistoryCalls.length, 1);
    assert.deepEqual(
      resumeFromHistoryCalls[0]?.history,
      [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "第一轮问题" }]
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "第一轮回答" }]
        }
      ]
    );
    assert.equal(result.forkMethod, "native_session_fork");
    assert.equal(result.session.providerSessionId, "child-thread");
    assert.equal(result.session.parentProviderSessionId, "019da3bc-6401-74e1-90f6-52fcb30d225f");
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

test("CodexAdapter 读取 Codex 子 Agent 时不会把昵称当标题，也不会保留继承的父会话消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-subagent-inherited-history-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "06", "08");
  const parentThreadId = "019ea4ef-a305-7f20-8da5-0b4dcc47ea29";
  const childThreadId = "019ea5e8-05c2-77a1-977e-90a6df8a44a7";
  const parentTurnId = "019ea4ef-a386-7c71-a7d3-35b97dd841b9";
  const childTurnId = "019ea5e8-06c2-7ae3-bb16-891a49a43bc9";
  const childSessionFile = join(sessionDir, `rollout-${childThreadId}.jsonl`);
  const inheritedParentPrompt =
    "https://github.com/certd/certd\n请分析以上证书自动化部署的开源项目";
  const ownPrompt = "你是 Agent F，负责 macOS 端 X-File 样式迁移收尾与回归验证";
  const expectedTitle = "macOS 端 X-File 样式迁移收尾与回归验证";

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      childSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-06-08T06:25:07.228Z",
          type: "session_meta",
          payload: {
            id: childThreadId,
            forked_from_id: parentThreadId,
            cwd: workspacePath,
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: parentThreadId,
                  depth: 1,
                  agent_nickname: "Einstein",
                  agent_role: null
                }
              }
            },
            thread_source: "subagent",
            agent_nickname: "Einstein"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T01:53:48.805Z",
          type: "session_meta",
          payload: {
            id: parentThreadId,
            cwd: workspacePath,
            source: "vscode"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T01:53:48.806Z",
          type: "event_msg",
          payload: {
            type: "task_started",
            turn_id: parentTurnId
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T01:53:49.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: inheritedParentPrompt
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T01:54:00.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "父会话回答"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T06:25:07.300Z",
          type: "event_msg",
          payload: {
            type: "task_started",
            turn_id: childTurnId
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T06:25:07.301Z",
          type: "turn_context",
          payload: {
            turn_id: childTurnId,
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T06:25:07.302Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: ownPrompt
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T06:25:08.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "我先检查模板结构。"
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
      inheritedParentPrompt,
      workspacePath,
      Math.floor(Date.parse("2026-06-08T06:25:07.228Z") / 1000),
      0,
      inheritedParentPrompt,
      "Einstein",
      null,
      childSessionFile
    );
    db.close();

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);
    const childSession = sessions.find((session) => session.providerSessionId === childThreadId);

    assert.ok(childSession);
    assert.equal(childSession.title, expectedTitle);
    assert.equal(childSession.subagentLabel, "Einstein");

    const page = await adapter.readSessionHistory(childThreadId, childSessionFile, null, 50);

    assert.deepEqual(
      page.messages.map((message) => message.content),
      [ownPrompt, "我先检查模板结构。"]
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 会使用 app-server Thread.name 作为子 Agent 独立会话名，而不是昵称", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-subagent-appserver-title-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "06", "08");
  const parentThreadId = "019ea4ef-a305-7f20-8da5-0b4dcc47ea29";
  const childThreadId = "019ea5e8-05c2-77a1-977e-90a6df8a44a7";
  const childSessionFile = join(sessionDir, `rollout-${childThreadId}.jsonl`);
  const calls = [];

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      childSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-06-08T06:25:07.228Z",
          type: "session_meta",
          payload: {
            id: childThreadId,
            forked_from_id: parentThreadId,
            cwd: workspacePath,
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: parentThreadId,
                  depth: 1,
                  agent_nickname: "Einstein",
                  agent_role: null
                }
              }
            },
            thread_source: "subagent",
            agent_nickname: "Einstein"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T06:25:08.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "子 Agent 自己的任务"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      threadControlTransportFactory: () => ({
        async initialize() {
          calls.push("initialize");
        },
        async archiveThread() {
          throw new Error("SHOULD_NOT_ARCHIVE");
        },
        async unarchiveThread() {
          throw new Error("SHOULD_NOT_UNARCHIVE");
        },
        async readThread() {
          throw new Error("SHOULD_NOT_READ");
        },
        async listThreads(input) {
          calls.push(`list:${input.workspacePath}`);
          return [
            {
              id: childThreadId,
              sessionId: childThreadId,
              forkedFromId: parentThreadId,
              cwd: workspacePath,
              name: "补齐 Vue 控制台 Spec",
              preview: "父会话第一条消息不该当标题",
              path: childSessionFile,
              createdAt: Math.floor(Date.parse("2026-06-08T06:25:07.228Z") / 1000),
              source: {
                subAgent: {
                  thread_spawn: {
                    parent_thread_id: parentThreadId,
                    depth: 1,
                    agent_nickname: "Einstein",
                    agent_role: null
                  }
                }
              },
              agentNickname: "Einstein",
              agentRole: null
            }
          ];
        },
        close() {
          calls.push("close");
        }
      })
    });

    const sessions = await adapter.detectSessions(workspacePath);
    const childSession = sessions.find((session) => session.providerSessionId === childThreadId);

    assert.ok(childSession);
    assert.equal(childSession.title, "补齐 Vue 控制台 Spec");
    assert.equal(childSession.parentProviderSessionId, parentThreadId);
    assert.equal(childSession.isSubagent, true);
    assert.equal(childSession.subagentLabel, "Einstein");
    assert.deepEqual(calls, ["initialize", `list:${workspacePath}`, "close"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 会使用 app-server Thread.name 修正父会话里缓存的第一句话标题", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-parent-appserver-title-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "06", "08");
  const parentThreadId = "019ea4ef-a305-7f20-8da5-0b4dcc47ea29";
  const parentSessionFile = join(sessionDir, `rollout-${parentThreadId}.jsonl`);
  const firstPrompt = "https://github.com/certd/certd 请分析这个项目";

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      parentSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-06-08T01:53:48.805Z",
          type: "session_meta",
          payload: {
            id: parentThreadId,
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T01:53:49.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: firstPrompt
          }
        })
      ].join("\n"),
      "utf8"
    );

    const stats = statSync(parentSessionFile);
    const adapter = new CodexAdapter({
      homeDir: tempDir,
      threadControlTransportFactory: () => ({
        async initialize() {},
        async archiveThread() {
          throw new Error("SHOULD_NOT_ARCHIVE");
        },
        async unarchiveThread() {
          throw new Error("SHOULD_NOT_UNARCHIVE");
        },
        async readThread() {
          throw new Error("SHOULD_NOT_READ");
        },
        async listThreads(input) {
          assert.equal(input.workspacePath, workspacePath);
          return [
            {
              id: parentThreadId,
              sessionId: parentThreadId,
              cwd: workspacePath,
              name: "certd 开源项目分析",
              preview: firstPrompt,
              path: parentSessionFile,
              createdAt: Date.parse("2026-06-08T01:53:48.000Z") / 1000,
              updatedAt: Date.parse("2026-06-08T01:54:00.000Z") / 1000,
              status: {
                type: "idle"
              },
              source: "vscode"
            }
          ];
        },
        close() {}
      })
    });

    const sessions = await adapter.detectSessions(workspacePath, {
      knownSessions: [
        {
          provider: "codex",
          providerSessionId: parentThreadId,
          title: firstPrompt,
          workspacePath,
          rawStoreRef: parentSessionFile,
          lastMessageAt: "2026-06-08T01:53:49.000Z",
          messageCount: 1,
          sourceMtimeMs: stats.mtimeMs,
          sourceSizeBytes: stats.size
        }
      ]
    });
    const parentSession = sessions.find((session) => session.providerSessionId === parentThreadId);

    assert.ok(parentSession);
    assert.equal(parentSession.title, "certd 开源项目分析");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 会从 app-server Thread.status 读取 Codex 会话运行状态", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-thread-status-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "06", "08");
  const threadId = "019ea5e8-05c2-77a1-977e-90a6df8a44a7";
  const sessionFile = join(sessionDir, `rollout-${threadId}.jsonl`);

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-06-08T06:25:07.228Z",
          type: "session_meta",
          payload: {
            id: threadId,
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T06:25:08.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "检查当前状态"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      threadControlTransportFactory: () => ({
        async initialize() {},
        async archiveThread() {
          throw new Error("SHOULD_NOT_ARCHIVE");
        },
        async unarchiveThread() {
          throw new Error("SHOULD_NOT_UNARCHIVE");
        },
        async readThread() {
          throw new Error("SHOULD_NOT_READ");
        },
        async listThreads() {
          return [
            {
              id: threadId,
              sessionId: threadId,
              cwd: workspacePath,
              name: "检查当前状态",
              preview: "检查当前状态",
              path: sessionFile,
              createdAt: Date.parse("2026-06-08T06:25:07.000Z") / 1000,
              updatedAt: Date.parse("2026-06-08T06:25:09.000Z") / 1000,
              status: {
                type: "active",
                activeFlags: []
              },
              source: "vscode"
            }
          ];
        },
        close() {}
      })
    });

    const sessions = await adapter.detectSessions(workspacePath);
    const session = sessions.find((item) => item.providerSessionId === threadId);

    assert.ok(session);
    assert.deepEqual(session.activityObservation, {
      runningState: "running",
      confidence: "authoritative",
      observedAt: "2026-06-08T06:25:09.000Z",
      detail: null,
      errorCode: null,
      runId: null
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 会用父线程 collabAgentToolCall 状态覆盖子 Agent 运行状态", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-subagent-collab-status-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "06", "08");
  const parentThreadId = "019ea4ef-a305-7f20-8da5-0b4dcc47ea29";
  const childThreadId = "019ea5e8-05c2-77a1-977e-90a6df8a44a7";
  const parentSessionFile = join(sessionDir, `rollout-${parentThreadId}.jsonl`);
  const childSessionFile = join(sessionDir, `rollout-${childThreadId}.jsonl`);

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      parentSessionFile,
      JSON.stringify({
        timestamp: "2026-06-08T01:53:48.805Z",
        type: "session_meta",
        payload: {
          id: parentThreadId,
          cwd: workspacePath
        }
      }),
      "utf8"
    );
    writeFileSync(
      childSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-06-08T06:25:07.228Z",
          type: "session_meta",
          payload: {
            id: childThreadId,
            forked_from_id: parentThreadId,
            cwd: workspacePath,
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: parentThreadId,
                  agent_nickname: "Einstein"
                }
              }
            },
            thread_source: "subagent",
            agent_nickname: "Einstein"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T06:25:08.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "子 Agent 自己的任务"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      threadControlTransportFactory: () => ({
        async initialize() {},
        async archiveThread() {
          throw new Error("SHOULD_NOT_ARCHIVE");
        },
        async unarchiveThread() {
          throw new Error("SHOULD_NOT_UNARCHIVE");
        },
        async readThread(providerSessionId) {
          assert.equal(providerSessionId, parentThreadId);
          return {
            thread: {
              id: parentThreadId,
              turns: [
                {
                  id: "019ea5e8-1000-7000-9000-000000000001",
                  startedAt: Date.parse("2026-06-08T06:26:00.000Z") / 1000,
                  completedAt: Date.parse("2026-06-08T06:26:02.000Z") / 1000,
                  items: [
                    {
                      type: "collabAgentToolCall",
                      id: "call-close-agent",
                      tool: "closeAgent",
                      status: "completed",
                      senderThreadId: parentThreadId,
                      receiverThreadIds: [childThreadId],
                      agentsStates: {
                        [childThreadId]: {
                          status: "shutdown",
                          message: null
                        }
                      }
                    }
                  ]
                }
              ]
            }
          };
        },
        async listThreads() {
          return [
            {
              id: parentThreadId,
              sessionId: parentThreadId,
              cwd: workspacePath,
              name: "父会话",
              preview: "父会话",
              path: parentSessionFile,
              createdAt: Date.parse("2026-06-08T01:53:48.000Z") / 1000,
              updatedAt: Date.parse("2026-06-08T06:26:02.000Z") / 1000,
              status: {
                type: "idle"
              },
              source: "vscode"
            },
            {
              id: childThreadId,
              sessionId: childThreadId,
              forkedFromId: parentThreadId,
              cwd: workspacePath,
              name: "子 Agent 自己的任务",
              preview: "父会话第一条消息不该当标题",
              path: childSessionFile,
              createdAt: Date.parse("2026-06-08T06:25:07.000Z") / 1000,
              updatedAt: Date.parse("2026-06-08T06:25:09.000Z") / 1000,
              status: {
                type: "active",
                activeFlags: []
              },
              source: {
                subAgent: {
                  thread_spawn: {
                    parent_thread_id: parentThreadId,
                    agent_nickname: "Einstein"
                  }
                }
              },
              agentNickname: "Einstein"
            }
          ];
        },
        close() {}
      })
    });

    const sessions = await adapter.detectSessions(workspacePath);
    const childSession = sessions.find((item) => item.providerSessionId === childThreadId);

    assert.ok(childSession);
    assert.equal(childSession.isSubagent, true);
    assert.equal(childSession.activityObservation?.runningState, "completed");
    assert.equal(childSession.activityObservation?.confidence, "strong");
    assert.equal(childSession.activityObservation?.observedAt, "2026-06-08T06:26:02.000Z");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexAdapter 会用子 Agent JSONL 的 task_started 推断运行中状态", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-subagent-jsonl-running-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "06", "08");
  const parentThreadId = "019ea661-e1a1-7fc2-b33e-216c42289e9b";
  const childThreadId = "019ea663-88f0-7b22-8f11-712df2017784";
  const childTurnId = "019ea663-89d9-7f71-8219-e06449e0c916";
  const parentSessionFile = join(sessionDir, `rollout-${parentThreadId}.jsonl`);
  const childSessionFile = join(sessionDir, `rollout-${childThreadId}.jsonl`);

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      parentSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-06-08T08:38:28.000Z",
          type: "session_meta",
          payload: {
            id: parentThreadId,
            cwd: workspacePath
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T08:40:01.516Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "spawn_agent",
            call_id: "call_spawn",
            arguments: JSON.stringify({
              agent_type: "worker",
              message: "请写一个简短笑话"
            })
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T08:40:01.964Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call_spawn",
            output: JSON.stringify({
              agent_id: childThreadId,
              nickname: "Arendt"
            })
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-06-08T08:40:01.755Z",
          type: "session_meta",
          payload: {
            id: childThreadId,
            forked_from_id: parentThreadId,
            cwd: workspacePath,
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: parentThreadId,
                  agent_nickname: "Arendt",
                  agent_role: "worker"
                }
              }
            },
            thread_source: "subagent",
            agent_nickname: "Arendt",
            agent_role: "worker"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T08:40:01.759Z",
          type: "event_msg",
          payload: {
            type: "task_started",
            turn_id: childTurnId,
            started_at: Date.parse("2026-06-08T08:40:01.000Z") / 1000
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-08T08:40:16.756Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "请写一个简短笑话"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexAdapter({
      homeDir: tempDir,
      threadControlTransportFactory: () => ({
        async initialize() {},
        async archiveThread() {
          throw new Error("SHOULD_NOT_ARCHIVE");
        },
        async unarchiveThread() {
          throw new Error("SHOULD_NOT_UNARCHIVE");
        },
        async readThread(providerSessionId) {
          assert.equal(providerSessionId, parentThreadId);
          return {
            thread: {
              id: parentThreadId,
              turns: []
            }
          };
        },
        async listThreads() {
          return [
            {
              id: parentThreadId,
              sessionId: parentThreadId,
              cwd: workspacePath,
              name: "父会话",
              preview: "父会话",
              path: parentSessionFile,
              createdAt: Date.parse("2026-06-08T08:38:28.000Z") / 1000,
              updatedAt: Date.parse("2026-06-08T08:40:01.000Z") / 1000,
              status: {
                type: "active"
              }
            },
            {
              id: childThreadId,
              sessionId: childThreadId,
              forkedFromId: parentThreadId,
              cwd: workspacePath,
              name: "请写一个简短笑话",
              preview: "请写一个简短笑话",
              path: childSessionFile,
              createdAt: Date.parse("2026-06-08T08:40:01.000Z") / 1000,
              updatedAt: Date.parse("2026-06-08T08:40:01.000Z") / 1000,
              status: {
                type: "idle"
              },
              source: {
                subAgent: {
                  thread_spawn: {
                    parent_thread_id: parentThreadId,
                    agent_nickname: "Arendt",
                    agent_role: "worker"
                  }
                }
              },
              agentNickname: "Arendt",
              agentRole: "worker"
            }
          ];
        },
        close() {}
      })
    });
    const sessions = await adapter.detectSessions(workspacePath);
    const childSession = sessions.find((item) => item.providerSessionId === childThreadId);

    assert.ok(childSession);
    assert.equal(childSession.isSubagent, true);
    assert.equal(childSession.subagentLabel, "worker · Arendt");
    assert.deepEqual(childSession.activityObservation, {
      runningState: "running",
      confidence: "strong",
      observedAt: "2026-06-08T08:40:01.000Z",
      detail: null,
      errorCode: null,
      runId: childTurnId
    });
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

test("CodexAdapter 不会把只有 forked_from_id 的普通分支会话误判成子 Agent", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-fork-thread-"));
  const workspacePath = "/Users/jackson/Documents/Code/CodingNS";
  const sessionDir = join(tempDir, "sessions", "2026", "04", "26");
  const parentThreadId = "019dc78d-923b-74f3-898e-0e2832be87cb";
  const childThreadId = "019dc8ff-4b24-7f83-bab1-31b8f8381340";
  const childSessionFile = join(sessionDir, `rollout-${childThreadId}.jsonl`);

  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      childSessionFile,
      [
        JSON.stringify({
          timestamp: "2026-04-26T08:54:27.404Z",
          type: "session_meta",
          payload: {
            id: childThreadId,
            forked_from_id: parentThreadId,
            timestamp: "2026-04-26T08:54:27.365Z",
            cwd: workspacePath,
            originator: "codingns-runtime-helper",
            cli_version: "0.116.0",
            source: "vscode",
            model_provider: "gmn"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-26T08:55:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "随着CLI提供商越来越多，我希望在项目中将当前后端CLI提供商抽象层的能力具现化"
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
      "随着CLI提供商越来越多，我希望在项目中将当前后端CLI提供商抽象层的能力具现化",
      workspacePath,
      Math.floor(Date.parse("2026-04-26T08:54:27.404Z") / 1000),
      0,
      "随着CLI提供商越来越多，我希望在项目中将当前后端CLI提供商抽象层的能力具现化",
      null,
      null,
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
          title: "随着CLI提供商越来越多，我希望在项目中将当前后端CLI提供商抽象层的能力具现化",
          workspacePath,
          rawStoreRef: childSessionFile,
          lastMessageAt: "2026-04-26T08:55:00.000Z",
          messageCount: 1,
          parentProviderSessionId: null,
          isSubagent: true,
          subagentLabel: "worker · stale",
          sourceMtimeMs: stats.mtimeMs,
          sourceSizeBytes: stats.size
        }
      ]
    });
    const childSession = sessions.find((session) => session.providerSessionId === childThreadId);

    assert.equal(childSession?.parentProviderSessionId, parentThreadId);
    assert.equal(childSession?.isSubagent, false);
    assert.equal(childSession?.subagentLabel, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ClaudeRuntimeAdapter } from "../dist/runtime/claude-runtime.js";
import { ClaudeCodeAdapter } from "../dist/index.js";

function createRuntimeRequest(workspacePath, overrides = {}) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath,
    provider: "claude-code",
    providerSessionId: null,
    rawStoreRef: null,
    options: {
      content: "首条消息",
      clientRequestId: "client-1",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      providerPrompt: "首条消息",
      attachments: []
    },
    ...overrides
  };
}

function waitFor(condition, timeoutMs = 2000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      if (condition()) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("WAIT_TIMEOUT"));
        return;
      }

      setTimeout(tick, 20);
    };

    tick();
  });
}

function workspaceSlug(workspacePath) {
  const trimmed = workspacePath.replace(/[\\/]+$/, "");
  const normalizedDriveLetter = trimmed.replace(/^[A-Z](?=:)/, (value) => value.toLowerCase());

  return normalizedDriveLetter
    .replaceAll(":", "-")
    .replaceAll("\\", "-")
    .replaceAll("/", "-");
}

test("ClaudeRuntimeAdapter 会把首条消息和运行中追加指导都写入 stream-json stdin", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-claude-runtime-"));
  const scriptPath = join(rootDir, "fake-claude.mjs");
  const homeDir = join(rootDir, ".claude");
  const emitted = [];
  const bindings = [];

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let count = 0;

rl.on("line", (line) => {
  const parsed = JSON.parse(line);
  const text = parsed?.message?.content?.[0]?.text ?? "";
  count += 1;
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "claude-session-1",
    timestamp: new Date().toISOString(),
    message: {
      content: [
        {
          type: "text",
          text: "echo:" + text
        }
      ]
    }
  }) + "\\n");

  if (count >= 2) {
    process.exit(0);
  }
});
`,
    "utf8"
  );
  chmodSync(scriptPath, 0o755);

  const adapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath: scriptPath
  });

  try {
    const launch = await adapter.startSession(
      createRuntimeRequest(rootDir),
      {
        emit: async (event) => {
          emitted.push(event);
        },
        updateSessionBinding: (binding) => {
          bindings.push(binding);
        }
      }
    );

    await waitFor(() => emitted.length >= 1);
    await launch.submitDuringRun?.({
      content: "追加指导",
      clientRequestId: "client-2",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      providerPrompt: "追加指导",
      attachments: []
    });
    await launch.completed;

    const messageEvents = emitted.filter((event) => event.type === "message");
    const completedEvents = emitted.filter((event) => event.type === "complete");
    const errorEvents = emitted.filter((event) => event.type === "error");
    const resolvedBindings = bindings.filter(
      (binding) =>
        typeof binding.providerSessionId === "string"
        && binding.providerSessionId.length > 0
        && !binding.providerSessionId.startsWith("pending://")
    );
    const providerSessionIds = new Set(
      resolvedBindings
        .map((binding) => binding.providerSessionId)
        .filter((value) => typeof value === "string" && value.length > 0)
    );
    const rawStoreRefs = new Set(
      resolvedBindings
        .map((binding) => binding.rawStoreRef)
        .filter((value) => typeof value === "string" && value.length > 0)
    );
    const finalBinding = resolvedBindings.at(-1) ?? bindings.at(-1);

    assert.deepEqual(
      messageEvents.map((event) => event.message.content),
      ["echo:首条消息", "echo:追加指导"]
    );
    assert.equal(providerSessionIds.size, 1);
    assert.equal(rawStoreRefs.size, 1);
    assert.equal(finalBinding?.providerSessionId, "claude-session-1");
    assert.equal(completedEvents.length, 1);
    assert.equal(errorEvents.length, 0);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ClaudeRuntimeAdapter 在同一逻辑消息更新时保持稳定 messageId 与 rawRef", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-claude-runtime-stable-id-"));
  const scriptPath = join(rootDir, "fake-claude-stable-id.mjs");
  const homeDir = join(rootDir, ".claude");
  const emitted = [];

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let handled = false;

rl.on("line", () => {
  if (handled) {
    return;
  }

  handled = true;
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "claude-session-stable",
    timestamp: "2026-03-28T10:00:00.000Z",
    message: {
      id: "msg-stable-1",
      content: [
        {
          type: "text",
          text: "第一段"
        }
      ]
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "claude-session-stable",
    timestamp: "2026-03-28T10:00:00.000Z",
    message: {
      id: "msg-stable-1",
      content: [
        {
          type: "text",
          text: "第一段\\n第二段"
        }
      ]
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "claude-session-stable"
  }) + "\\n");
  setTimeout(() => {
    process.exit(0);
  }, 5);
});
`,
    "utf8"
  );
  chmodSync(scriptPath, 0o755);

  const adapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath: scriptPath
  });

  try {
    const launch = await adapter.startSession(
      createRuntimeRequest(rootDir),
      {
        emit: async (event) => {
          emitted.push(event);
        },
        updateSessionBinding: () => {}
      }
    );

    await launch.completed;

    const messageEvents = emitted.filter((event) => event.type === "message");
    assert.equal(messageEvents.length, 2);
    assert.deepEqual(
      messageEvents.map((event) => event.message.content),
      ["第一段", "第一段\n第二段"]
    );
    assert.equal(messageEvents[0]?.message.messageId, messageEvents[1]?.message.messageId);
    assert.equal(messageEvents[0]?.message.rawRef, messageEvents[1]?.message.rawRef);
    assert.equal(messageEvents[0]?.message.sequence, messageEvents[1]?.message.sequence);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ClaudeRuntimeAdapter 能消费 stream_event thinking 增量并保持稳定消息身份", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-claude-runtime-stream-event-"));
  const scriptPath = join(rootDir, "fake-claude-stream-event.mjs");
  const homeDir = join(rootDir, ".claude");
  const emitted = [];

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let handled = false;

rl.on("line", () => {
  if (handled) {
    return;
  }

  handled = true;
  const sessionId = "claude-session-stream-event";
  const timestamp = "2026-03-28T11:00:00.000Z";
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: sessionId,
    timestamp,
    event: {
      type: "message_start",
      message: {
        id: "msg-stream-event-1",
        role: "assistant",
        content: []
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: sessionId,
    timestamp,
    event: {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "thinking",
        thinking: ""
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: sessionId,
    timestamp,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "thinking_delta",
        thinking: "第一段"
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: sessionId,
    timestamp,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "thinking_delta",
        thinking: "\\n第二段"
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: sessionId,
    timestamp,
    event: {
      type: "content_block_stop",
      index: 0
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: sessionId,
    timestamp,
    message: {
      id: "msg-stream-event-1",
      content: [
        {
          type: "thinking",
          thinking: "第一段\\n第二段"
        }
      ]
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: sessionId
  }) + "\\n");
  setTimeout(() => {
    process.exit(0);
  }, 5);
});
`,
    "utf8"
  );
  chmodSync(scriptPath, 0o755);

  const adapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath: scriptPath
  });

  try {
    const launch = await adapter.startSession(
      createRuntimeRequest(rootDir),
      {
        emit: async (event) => {
          emitted.push(event);
        },
        updateSessionBinding: () => {}
      }
    );

    await launch.completed;

    const thinkingEvents = emitted
      .filter((event) => event.type === "message")
      .map((event) => event.message)
      .filter((message) => message.kind === "thinking");

    assert.equal(thinkingEvents.length, 2);
    assert.deepEqual(
      thinkingEvents.map((message) => message.content),
      ["第一段", "第一段\n第二段"]
    );
    assert.equal(new Set(thinkingEvents.map((message) => message.messageId)).size, 1);
    assert.equal(new Set(thinkingEvents.map((message) => message.rawRef)).size, 1);
    assert.equal(new Set(thinkingEvents.map((message) => message.sequence)).size, 1);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ClaudeRuntimeAdapter 不会把空 text 占位块序列化成正式 assistant 消息", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-claude-runtime-empty-text-"));
  const scriptPath = join(rootDir, "fake-claude-empty-text.mjs");
  const homeDir = join(rootDir, ".claude");
  const emitted = [];

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let handled = false;

rl.on("line", () => {
  if (handled) {
    return;
  }

  handled = true;
  const sessionId = "claude-session-empty-text";
  const timestamp = "2026-03-29T10:00:00.000Z";
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: sessionId,
    timestamp,
    event: {
      type: "message_start",
      message: {
        id: "msg-empty-text-1",
        role: "assistant",
        content: []
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: sessionId,
    timestamp,
    event: {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "text",
        text: ""
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: sessionId,
    timestamp,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "text_delta",
        text: "最终输出"
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: sessionId,
    timestamp,
    message: {
      id: "msg-empty-text-1",
      content: [
        {
          type: "text",
          text: "最终输出"
        }
      ]
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: sessionId
  }) + "\\n");
  setTimeout(() => {
    process.exit(0);
  }, 5);
});
`,
    "utf8"
  );
  chmodSync(scriptPath, 0o755);

  const adapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath: scriptPath
  });

  try {
    const launch = await adapter.startSession(
      createRuntimeRequest(rootDir),
      {
        emit: async (event) => {
          emitted.push(event);
        },
        updateSessionBinding: () => {}
      }
    );

    await launch.completed;

    const messageEvents = emitted.filter((event) => event.type === "message");
    assert.deepEqual(
      messageEvents.map((event) => event.message.content),
      ["最终输出"]
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ClaudeRuntimeAdapter 会把无 messageId 的重复全文快照折叠成同一条消息更新", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-claude-runtime-duplicate-collapse-"));
  const scriptPath = join(rootDir, "fake-claude-duplicate-collapse.mjs");
  const homeDir = join(rootDir, ".claude");
  const emitted = [];

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let handled = false;

rl.on("line", () => {
  if (handled) {
    return;
  }

  handled = true;
  const timestamp = "2026-03-29T00:00:00.000Z";
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "claude-session-no-id",
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "好的，我在这里。有什么" }]
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "claude-session-no-id",
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "好的，我在这里。有什么需要帮助的吗？" }]
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "claude-session-no-id",
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "好的，我在这里。有什么需要帮助的吗？" }]
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "claude-session-no-id"
  }) + "\\n");
  setTimeout(() => {
    process.exit(0);
  }, 5);
});
`,
    "utf8"
  );
  chmodSync(scriptPath, 0o755);

  const adapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath: scriptPath
  });

  try {
    const launch = await adapter.startSession(
      createRuntimeRequest(rootDir),
      {
        emit: async (event) => {
          emitted.push(event);
        },
        updateSessionBinding: () => {}
      }
    );

    await launch.completed;

    const textEvents = emitted
      .filter((event) => event.type === "message")
      .map((event) => event.message)
      .filter((message) => message.kind === "text" && message.role === "assistant");

    assert.equal(textEvents.length, 2);
    assert.deepEqual(
      textEvents.map((message) => message.content),
      ["好的，我在这里。有什么", "好的，我在这里。有什么需要帮助的吗？"]
    );
    assert.equal(textEvents[0]?.messageId, textEvents[1]?.messageId);
    assert.equal(textEvents[0]?.rawRef, textEvents[1]?.rawRef);
    assert.equal(textEvents[0]?.sequence, textEvents[1]?.sequence);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ClaudeRuntimeAdapter 与 ClaudeCodeAdapter 会为同一条消息生成一致的身份，即使 transcript 路径从 pending 切到真实文件", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-claude-runtime-history-align-"));
  const scriptPath = join(rootDir, "fake-claude-history-align.mjs");
  const homeDir = join(rootDir, ".claude");
  const emitted = [];
  const providerSessionId = "claude-session-history-align";
  const timestamp = "2026-03-29T10:36:00.000Z";

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let handled = false;

rl.on("line", () => {
  if (handled) {
    return;
  }

  handled = true;
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "${providerSessionId}",
    timestamp: "${timestamp}",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "我是由 glm-5 模型驱动的 Claude 代理。" }]
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "${providerSessionId}"
  }) + "\\n");
  setTimeout(() => {
    process.exit(0);
  }, 5);
});
`,
    "utf8"
  );
  chmodSync(scriptPath, 0o755);

  const runtimeAdapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath: scriptPath
  });

  try {
    const launch = await runtimeAdapter.startSession(
      createRuntimeRequest(rootDir),
      {
        emit: async (event) => {
          emitted.push(event);
        },
        updateSessionBinding: () => {}
      }
    );

    await launch.completed;

    const projectDir = join(homeDir, "projects", workspaceSlug(rootDir));
    const realStoreRef = join(projectDir, `${providerSessionId}.jsonl`);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      realStoreRef,
      [
        JSON.stringify({
          type: "assistant",
          sessionId: providerSessionId,
          cwd: rootDir,
          timestamp,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "我是由 glm-5 模型驱动的 Claude 代理。" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const runtimeMessage = emitted.find((event) => event.type === "message")?.message ?? null;
    const historyAdapter = new ClaudeCodeAdapter({ homeDir });
    const page = await historyAdapter.readSessionHistory(providerSessionId, realStoreRef, null, 20, "forward");
    const historyMessage = page.messages[0] ?? null;

    assert.ok(runtimeMessage);
    assert.ok(historyMessage);
    assert.equal(runtimeMessage.messageId, historyMessage.messageId);
    assert.equal(runtimeMessage.rawRef, historyMessage.rawRef);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ClaudeRuntimeAdapter 与 ClaudeCodeAdapter 会为包含首条 user 的 Claude transcript 生成一致的 assistant 身份", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-claude-runtime-history-align-with-user-"));
  const scriptPath = join(rootDir, "fake-claude-history-align-with-user.mjs");
  const homeDir = join(rootDir, ".claude");
  const emitted = [];
  const providerSessionId = "claude-session-history-align-with-user";
  const userTimestamp = "2026-03-29T10:40:00.000Z";
  const assistantTimestamp = "2026-03-29T10:40:03.000Z";
  const prompt = "对话测试5678";
  const reply = "收到，对话连接正常。";

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let handled = false;

rl.on("line", () => {
  if (handled) {
    return;
  }

  handled = true;
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "${providerSessionId}",
    timestamp: "${assistantTimestamp}",
    message: {
      id: "msg-history-align-with-user-1",
      role: "assistant",
      content: [{ type: "text", text: "${reply}" }]
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "${providerSessionId}"
  }) + "\\n");
  setTimeout(() => {
    process.exit(0);
  }, 5);
});
`,
    "utf8"
  );
  chmodSync(scriptPath, 0o755);

  const runtimeAdapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath: scriptPath
  });

  try {
    const launch = await runtimeAdapter.startSession(
      createRuntimeRequest(rootDir, {
        options: {
          content: prompt,
          clientRequestId: "client-1",
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: prompt,
          attachments: []
        }
      }),
      {
        emit: async (event) => {
          emitted.push(event);
        },
        updateSessionBinding: () => {}
      }
    );

    await launch.completed;

    const projectDir = join(homeDir, "projects", workspaceSlug(rootDir));
    const realStoreRef = join(projectDir, `${providerSessionId}.jsonl`);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      realStoreRef,
      [
        JSON.stringify({
          type: "user",
          sessionId: providerSessionId,
          cwd: rootDir,
          timestamp: userTimestamp,
          message: {
            role: "user",
            content: [{ type: "text", text: prompt }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: providerSessionId,
          cwd: rootDir,
          timestamp: assistantTimestamp,
          message: {
            id: "msg-history-align-with-user-1",
            role: "assistant",
            content: [{ type: "text", text: reply }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const runtimeMessage = emitted.find((event) => event.type === "message")?.message ?? null;
    const historyAdapter = new ClaudeCodeAdapter({ homeDir });
    const page = await historyAdapter.readSessionHistory(providerSessionId, realStoreRef, null, 20, "forward");
    const historyMessage = page.messages.find((message) => message.role === "assistant") ?? null;

    assert.ok(runtimeMessage);
    assert.ok(historyMessage);
    assert.equal(runtimeMessage.messageId, historyMessage.messageId);
    assert.equal(runtimeMessage.rawRef, historyMessage.rawRef);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ClaudeRuntimeAdapter 与 ClaudeCodeAdapter 会把 thinking+text 同轮消息对齐成同一组 assistant 身份", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-claude-runtime-thinking-text-align-"));
  const scriptPath = join(rootDir, "fake-claude-thinking-text-align.mjs");
  const homeDir = join(rootDir, ".claude");
  const emitted = [];
  const providerSessionId = "claude-session-thinking-text-align";
  const prompt = "对话测试，请思考后回复我";
  const thinking = "这是一个简单测试，先思考再回复。";
  const reply = "收到，对话正常。";
  const timestamp = "2026-03-29T11:35:00.000Z";

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let handled = false;

rl.on("line", () => {
  if (handled) {
    return;
  }

  handled = true;
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: "${providerSessionId}",
    timestamp: "${timestamp}",
    event: {
      type: "message_start",
      message: {
        id: "msg-thinking-text-align-1",
        role: "assistant",
        content: []
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: "${providerSessionId}",
    timestamp: "${timestamp}",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "thinking",
        thinking: ""
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: "${providerSessionId}",
    timestamp: "${timestamp}",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "thinking_delta",
        thinking: "${thinking}"
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: "${providerSessionId}",
    timestamp: "${timestamp}",
    event: {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "text",
        text: ""
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "stream_event",
    session_id: "${providerSessionId}",
    timestamp: "${timestamp}",
    event: {
      type: "content_block_delta",
      index: 1,
      delta: {
        type: "text_delta",
        text: "${reply}"
      }
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "${providerSessionId}",
    timestamp: "${timestamp}",
    message: {
      id: "msg-thinking-text-align-1",
      role: "assistant",
      content: [{ type: "text", text: "${reply}" }]
    }
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "${providerSessionId}"
  }) + "\\n");
  setTimeout(() => {
    process.exit(0);
  }, 5);
});
`,
    "utf8"
  );
  chmodSync(scriptPath, 0o755);

  const runtimeAdapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath: scriptPath
  });

  try {
    const launch = await runtimeAdapter.startSession(
      createRuntimeRequest(rootDir, {
        options: {
          content: prompt,
          clientRequestId: "client-1",
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: prompt,
          attachments: []
        }
      }),
      {
        emit: async (event) => {
          emitted.push(event);
        },
        updateSessionBinding: () => {}
      }
    );

    await launch.completed;

    const projectDir = join(homeDir, "projects", workspaceSlug(rootDir));
    const realStoreRef = join(projectDir, `${providerSessionId}.jsonl`);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      realStoreRef,
      [
        JSON.stringify({
          type: "user",
          sessionId: providerSessionId,
          cwd: rootDir,
          timestamp: "2026-03-29T11:34:58.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: prompt }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: providerSessionId,
          cwd: rootDir,
          timestamp: "2026-03-29T11:35:00.000Z",
          message: {
            id: "msg-thinking-text-align-1",
            role: "assistant",
            content: [{ type: "thinking", thinking }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: providerSessionId,
          cwd: rootDir,
          timestamp: "2026-03-29T11:35:01.000Z",
          message: {
            id: "msg-thinking-text-align-1",
            role: "assistant",
            content: [{ type: "text", text: reply }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const runtimeMessages = emitted
      .filter((event) => event.type === "message")
      .map((event) => event.message);
    const runtimeThinking = runtimeMessages.find((message) => message.kind === "thinking") ?? null;
    const runtimeText = runtimeMessages.find((message) => message.kind === "text") ?? null;

    const historyAdapter = new ClaudeCodeAdapter({ homeDir });
    const page = await historyAdapter.readSessionHistory(providerSessionId, realStoreRef, null, 20, "forward");
    const historyThinking = page.messages.find((message) => message.kind === "thinking") ?? null;
    const historyText = page.messages.find((message) => message.kind === "text" && message.role === "assistant") ?? null;

    assert.ok(runtimeThinking);
    assert.ok(runtimeText);
    assert.ok(historyThinking);
    assert.ok(historyText);
    assert.equal(runtimeThinking.messageId, historyThinking.messageId);
    assert.equal(runtimeThinking.rawRef, historyThinking.rawRef);
    assert.equal(runtimeText.messageId, historyText.messageId);
    assert.equal(runtimeText.rawRef, historyText.rawRef);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

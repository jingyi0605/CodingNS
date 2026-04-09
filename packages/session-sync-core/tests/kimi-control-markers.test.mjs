import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { KimiAdapter } from "../dist/providers/kimi.js";
import { KimiRuntimeAdapter } from "../dist/runtime/kimi-runtime.js";

function createProviderFixture() {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-kimi-control-provider-"));
  const workspaceDir = join(rootDir, "workspace-a");
  const homeDir = join(rootDir, "kimi-home");
  const sessionDir = join(homeDir, "sessions", "hash-a", "kimi-session-1");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });

  writeFileSync(
    join(sessionDir, "state.json"),
    JSON.stringify({
      sessionId: "kimi-session-1",
      title: "Kimi 控制标记测试",
      cwd: workspaceDir,
      archived: false
    }),
    "utf8"
  );

  return {
    rootDir,
    workspaceDir,
    homeDir,
    sessionDir
  };
}

function createRunRequest(workspacePath) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath,
    provider: "kimi",
    providerSessionId: null,
    rawStoreRef: null,
    sequenceBase: 0,
    options: {
      content: "控制标记测试",
      clientRequestId: "client-1",
      model: "kimi-k2",
      reasoningLevel: null,
      permissionMode: null,
      providerPrompt: null,
      attachments: []
    }
  };
}

function createSink() {
  const events = [];

  return {
    events,
    sink: {
      updateSessionBinding() {
        return;
      },
      async emit(event) {
        events.push(event);
      }
    }
  };
}

function createWireScript(tempDir, body) {
  const scriptPath = join(tempDir, `wire-${Math.random().toString(16).slice(2)}.mjs`);
  writeFileSync(scriptPath, body, "utf8");
  return scriptPath;
}

async function cleanupTempDir(tempDir) {
  rmSync(tempDir, { recursive: true, force: true });
}

test("KimiAdapter 会清理混入正文的 Turn/Step 控制标记", async () => {
  const fixture = createProviderFixture();

  try {
    writeFileSync(
      join(fixture.sessionDir, "context.jsonl"),
      JSON.stringify({
        timestamp: "2026-04-09T01:00:00.000Z",
        role: "assistant",
        content: `TurnBegin

瀵硅瘽娴嬭瘯

StepBegin

ContentPart

我看到您输入了乱码字符。

StatusUpdate

chatcmpl-BG0xGOwkz4U3c4J24l87wU96

TurnEnd`
      }),
      "utf8"
    );
    writeFileSync(join(fixture.sessionDir, "wire.jsonl"), "", "utf8");

    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir
    });
    const page = await adapter.readSessionHistory(
      "kimi-session-1",
      "kimi://session/kimi-session-1",
      null,
      20
    );

    assert.equal(page.messages.length, 1);
    assert.equal(page.messages[0]?.content.includes("TurnBegin"), false);
    assert.equal(page.messages[0]?.content.includes("TurnEnd"), false);
    assert.equal(page.messages[0]?.content.includes("StatusUpdate"), false);
    assert.equal(page.messages[0]?.content.includes("chatcmpl-"), false);
    assert.equal(page.messages[0]?.content.includes("我看到您输入了乱码字符。"), true);
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("KimiRuntimeAdapter 会清理 realtime 文本里的 Turn/Step 控制标记", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-control-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: kimi [OPTIONS]\\n  --wire\\n  --work-dir\\n  --session");
  process.exit(0);
}
console.log(JSON.stringify({
  type: "assistant.message",
  role: "assistant",
  timestamp: "2026-04-09T01:10:00.000Z",
  content: "TurnBegin\\n\\n瀵硅瘽娴嬭瘯\\n\\nStepBegin\\n\\nContentPart\\n\\n我看到您输入了乱码字符。\\n\\nStatusUpdate\\n\\nchatcmpl-test123\\n\\nTurnEnd"
}));
setTimeout(() => process.exit(0), 20);
`
  );

  try {
    const adapter = new KimiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath]
    });
    const { events, sink } = createSink();

    const launch = await adapter.startSession(createRunRequest(tempDir), sink);
    await launch.completed;

    const messageEvent = events.find((event) => event.type === "message");
    assert.ok(messageEvent);
    assert.equal(messageEvent.message.content.includes("TurnBegin"), false);
    assert.equal(messageEvent.message.content.includes("TurnEnd"), false);
    assert.equal(messageEvent.message.content.includes("StatusUpdate"), false);
    assert.equal(messageEvent.message.content.includes("chatcmpl-"), false);
    assert.equal(messageEvent.message.content.includes("我看到您输入了乱码字符。"), true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("KimiAdapter 会把 context 里的 tool_calls 和 tool 结果归一化成结构化消息", async () => {
  const fixture = createProviderFixture();

  try {
    writeFileSync(
      join(fixture.sessionDir, "context.jsonl"),
      [
        JSON.stringify({
          role: "user",
          content: "读取 README"
        }),
        JSON.stringify({
          role: "assistant",
          content: [],
          tool_calls: [
            {
              type: "function",
              id: "tool-call-1",
              function: {
                name: "ReadFile",
                arguments: "{\"path\":\"README.md\"}"
              }
            }
          ]
        }),
        JSON.stringify({
          role: "tool",
          tool_call_id: "tool-call-1",
          content: [
            {
              type: "text",
              text: "<system>Command executed successfully.</system>"
            },
            {
              type: "text",
              text: "README 内容"
            }
          ]
        }),
        JSON.stringify({
          role: "assistant",
          content: "已读取 README。"
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(join(fixture.sessionDir, "wire.jsonl"), "", "utf8");

    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir
    });
    const page = await adapter.readSessionHistory(
      "kimi-session-1",
      "kimi://session/kimi-session-1",
      null,
      20
    );

    assert.equal(page.messages.some((message) => message.content === "[]"), false);
    assert.equal(page.messages.some((message) => message.kind === "tool_call"), true);
    assert.equal(page.messages.some((message) => message.kind === "tool_result"), true);

    const toolCall = page.messages.find((message) => message.kind === "tool_call");
    const toolResult = page.messages.find((message) => message.kind === "tool_result");

    assert.equal(toolCall?.toolCall?.name, "ReadFile");
    assert.equal(toolCall?.toolCall?.callId, "tool-call-1");
    assert.equal(toolResult?.toolCall?.callId, "tool-call-1");
    assert.equal(toolResult?.content.includes("README 内容"), true);
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("KimiAdapter 会解析真实 wire 形状的 ToolCall 和 ToolResult", async () => {
  const fixture = createProviderFixture();

  try {
    writeFileSync(
      join(fixture.sessionDir, "context.jsonl"),
      JSON.stringify({
        role: "user",
        content: "列出当前目录"
      }),
      "utf8"
    );
    writeFileSync(
      join(fixture.sessionDir, "wire.jsonl"),
      [
        JSON.stringify({
          type: "metadata",
          protocol_version: "1.8"
        }),
        JSON.stringify({
          timestamp: "2026-04-09T03:20:00.000Z",
          message: {
            type: "ToolCall",
            payload: {
              type: "function",
              id: "tool-real-1",
              function: {
                name: "Shell",
                arguments: "{\"command\":\"Get-ChildItem -Name\"}"
              }
            }
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-09T03:20:01.000Z",
          message: {
            type: "ToolResult",
            payload: {
              tool_call_id: "tool-real-1",
              return_value: {
                is_error: false,
                output: "data\\ndocs",
                message: "Command executed successfully."
              }
            }
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir
    });
    const page = await adapter.readSessionHistory(
      "kimi-session-1",
      "kimi://session/kimi-session-1",
      null,
      20
    );

    const toolCall = page.messages.find((message) => message.kind === "tool_call");
    const toolResult = page.messages.find((message) => message.kind === "tool_result");

    assert.equal(toolCall?.toolCall?.name, "Shell");
    assert.equal(toolCall?.toolCall?.callId, "tool-real-1");
    assert.equal(toolResult?.toolCall?.callId, "tool-real-1");
    assert.equal(toolResult?.content.includes("data"), true);
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("KimiAdapter 会把 WriteFile 类工具统一映射成 apply_patch", async () => {
  const fixture = createProviderFixture();

  try {
    writeFileSync(
      join(fixture.sessionDir, "context.jsonl"),
      [
        JSON.stringify({
          role: "user",
          content: "写一个笑话，保存为 md 文件"
        }),
        JSON.stringify({
          role: "assistant",
          content: [],
          tool_calls: [
            {
              type: "function",
              id: "tool-write-1",
              function: {
                name: "WriteFile",
                arguments: "{\"path\":\"笑话.md\",\"content\":\"# 程序员的早餐\\n\\n一位程序员去餐厅吃早餐。\"}"
              }
            }
          ]
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(join(fixture.sessionDir, "wire.jsonl"), "", "utf8");

    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir
    });
    const page = await adapter.readSessionHistory(
      "kimi-session-1",
      "kimi://session/kimi-session-1",
      null,
      20
    );

    const toolCall = page.messages.find((message) => message.kind === "tool_call");

    assert.equal(toolCall?.toolCall?.name, "apply_patch");
    assert.equal(toolCall?.role, "tool");
    assert.equal(toolCall?.toolCall?.input.includes("*** Begin Patch"), true);
    assert.equal(toolCall?.toolCall?.input.includes("*** Add File: 笑话.md"), true);
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("KimiAdapter 会只保留 ContentPart 之后的真实助手正文", async () => {
  const fixture = createProviderFixture();

  try {
    writeFileSync(
      join(fixture.sessionDir, "context.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-04-09T02:00:00.000Z",
        role: "assistant",
        content: `对话测试02

对话测试02

<system-reminder> You are running in non-interactive mode. The user cannot answer questions during execution. </system-reminder>
TurnBegin

对话测试02

StepBegin

ContentPart

你好！这是一个对话测试。我已经准备好帮助你完成任务了。

请问有什么我可以帮助你的吗？

StatusUpdate

chatcmpl-inline123

TurnEnd`
      })}\n`,
      "utf8"
    );
    writeFileSync(join(fixture.sessionDir, "wire.jsonl"), "", "utf8");

    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir
    });
    const page = await adapter.readSessionHistory(
      "kimi-session-1",
      "kimi://session/kimi-session-1",
      null,
      20
    );

    assert.equal(page.messages.length, 1);
    assert.equal(
      page.messages[0]?.content,
      "你好！这是一个对话测试。我已经准备好帮助你完成任务了。\n\n请问有什么我可以帮助你的吗？"
    );
    assert.equal(page.messages[0]?.content.includes("<system-reminder>"), false);
    assert.equal(page.messages[0]?.content.includes("对话测试02"), false);
    assert.equal(page.messages[0]?.content.includes("StatusUpdate"), false);
    assert.equal(page.messages[0]?.content.includes("chatcmpl-"), false);
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("KimiRuntimeAdapter 会把命令模式的原始转录收敛成一条干净消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-control-command-"));
  const scriptPath = createWireScript(
    tempDir,
    `
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: kimi [OPTIONS]\\n  --wire\\n  --work-dir\\n  --session");
  process.exit(0);
}
console.log("对话测试02");
console.log("");
console.log("对话测试02");
console.log("");
console.log("<system-reminder> You are running in non-interactive mode. The user cannot answer questions during execution. </system-reminder>");
console.log("TurnBegin");
console.log("");
console.log("对话测试02");
console.log("");
console.log("StepBegin");
console.log("");
console.log("ContentPart");
console.log("");
console.log("你好！这是一个对话测试。我已经准备好帮助你完成任务了。");
console.log("");
console.log("请问有什么我可以帮助你的吗？");
console.log("");
console.log("StatusUpdate");
console.log("");
console.log("chatcmpl-runtime123");
console.log("");
console.log("TurnEnd");
setTimeout(() => process.exit(0), 20);
`
  );

  try {
    const adapter = new KimiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath]
    });
    const { events, sink } = createSink();

    const launch = await adapter.startSession(createRunRequest(tempDir), sink);
    await launch.completed;

    const messageEvents = events.filter((event) => event.type === "message");
    assert.equal(messageEvents.length, 1);
    assert.equal(
      messageEvents[0]?.message.content,
      "你好！这是一个对话测试。我已经准备好帮助你完成任务了。\n\n请问有什么我可以帮助你的吗？"
    );
    assert.equal(messageEvents[0]?.message.content.includes("<system-reminder>"), false);
    assert.equal(messageEvents[0]?.message.content.includes("对话测试02"), false);
    assert.equal(messageEvents[0]?.message.content.includes("StatusUpdate"), false);
    assert.equal(messageEvents[0]?.message.content.includes("chatcmpl-"), false);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("KimiAdapter 会折叠 context 和 wire 中重复的 assistant 正文", async () => {
  const fixture = createProviderFixture();

  try {
    writeFileSync(
      join(fixture.sessionDir, "context.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-04-09T03:00:00.000Z",
        role: "assistant",
        content: "你好！这是一个对话测试。我看到你发送了“对话测试04”。\n\n有什么我可以帮助你的吗？"
      })}\n`,
      "utf8"
    );
    writeFileSync(
      join(fixture.sessionDir, "wire.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-04-09T03:00:01.000Z",
        message: {
          type: "TurnBegin",
          payload: {
            user_input: "对话测试04"
          }
        }
      })}\n${JSON.stringify({
        timestamp: "2026-04-09T03:00:01.100Z",
        message: {
          type: "StepBegin",
          payload: {
            n: 1
          }
        }
      })}\n${JSON.stringify({
        timestamp: "2026-04-09T03:00:01.200Z",
        message: {
          type: "ContentPart",
          payload: {
            type: "text",
            text: "你好！这是一个对话测试。我看到你发送了“对话测试04”。\n\n有什么我可以帮助你的吗？"
          }
        }
      })}\n${JSON.stringify({
        timestamp: "2026-04-09T03:00:01.300Z",
        message: {
          type: "StatusUpdate",
          payload: {
            message_id: "chatcmpl-providerdup123"
          }
        }
      })}\n${JSON.stringify({
        timestamp: "2026-04-09T03:00:01.400Z",
        message: {
          type: "TurnEnd",
          payload: {}
        }
      })}\n`,
      "utf8"
    );

    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir
    });
    const page = await adapter.readSessionHistory(
      "kimi-session-1",
      "kimi://session/kimi-session-1",
      null,
      20
    );

    assert.equal(page.messages.length, 1);
    assert.equal(
      page.messages[0]?.content,
      "你好！这是一个对话测试。我看到你发送了“对话测试04”。\n\n有什么我可以帮助你的吗？"
    );
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("KimiRuntimeAdapter 会跳过结构化消息之后的重复原始转录", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-control-runtime-dup-"));
  const scriptPath = createWireScript(
    tempDir,
    `
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: kimi [OPTIONS]\\n  --wire\\n  --work-dir\\n  --session");
  process.exit(0);
}
console.log(JSON.stringify({
  type: "assistant.message",
  role: "assistant",
  timestamp: "2026-04-09T03:10:00.000Z",
  content: [{ type: "text", text: "你好！这是一个对话测试。我看到你发送了“对话测试04”。\\n\\n有什么我可以帮助你的吗？" }]
}));
console.log("TurnBegin");
console.log("");
console.log("对话测试04");
console.log("");
console.log("StepBegin");
console.log("");
console.log("ContentPart");
console.log("");
console.log("你好！这是一个对话测试。我看到你发送了“对话测试04”。");
console.log("");
console.log("有什么我可以帮助你的吗？");
console.log("");
console.log("StatusUpdate");
console.log("");
console.log("chatcmpl-runtime-dup123");
console.log("");
console.log("TurnEnd");
setTimeout(() => process.exit(0), 20);
`
  );

  try {
    const adapter = new KimiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath]
    });
    const { events, sink } = createSink();

    const launch = await adapter.startSession(createRunRequest(tempDir), sink);
    await launch.completed;

    const messageEvents = events.filter((event) => event.type === "message");
    assert.equal(messageEvents.length, 1);
    assert.equal(
      messageEvents[0]?.message.content,
      "你好！这是一个对话测试。我看到你发送了“对话测试04”。\n\n有什么我可以帮助你的吗？"
    );
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("KimiRuntimeAdapter 会解析真实 wire 形状的嵌套 ContentPart", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-control-runtime-wire-"));
  const scriptPath = createWireScript(
    tempDir,
    `
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: kimi [OPTIONS]\\n  --wire\\n  --work-dir\\n  --session");
  process.exit(0);
}
console.log(JSON.stringify({ type: "metadata", protocol_version: "1.8" }));
console.log(JSON.stringify({
  timestamp: 1775699860.343089,
  message: {
    type: "TurnBegin",
    payload: {
      user_input: "对话测试04"
    }
  }
}));
console.log(JSON.stringify({
  timestamp: 1775699860.3441417,
  message: {
    type: "StepBegin",
    payload: {
      n: 1
    }
  }
}));
console.log(JSON.stringify({
  timestamp: 1775699867.7813363,
  message: {
    type: "ContentPart",
    payload: {
      type: "text",
      text: "你好！这是一个对话测试。我看到你发送了\\"对话测试04\\"。\\n\\n有什么我可以帮助你的吗？"
    }
  }
}));
console.log(JSON.stringify({
  timestamp: 1775699867.7821517,
  message: {
    type: "StatusUpdate",
    payload: {
      message_id: "chatcmpl-UPnpMg1WhbLRCUFXnQJzDAeg"
    }
  }
}));
console.log(JSON.stringify({
  timestamp: 1775699867.7863927,
  message: {
    type: "TurnEnd",
    payload: {}
  }
}));
setTimeout(() => process.exit(0), 20);
`
  );

  try {
    const adapter = new KimiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath]
    });
    const { events, sink } = createSink();

    const launch = await adapter.startSession(createRunRequest(tempDir), sink);
    await launch.completed;

    const messageEvents = events.filter((event) => event.type === "message");
    assert.equal(messageEvents.length, 1);
    assert.equal(
      messageEvents[0]?.message.content,
      "你好！这是一个对话测试。我看到你发送了\"对话测试04\"。\n\n有什么我可以帮助你的吗？"
    );
  } finally {
    await cleanupTempDir(tempDir);
  }
});

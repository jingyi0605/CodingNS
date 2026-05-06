import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CodexAdapter } from "../dist/index.js";
import { CodexRuntimeAdapter } from "../dist/runtime/codex-runtime.js";

function createStableMessageId(providerSessionId, stableIdentity) {
  return createHash("sha1").update(`codex:${providerSessionId}:${stableIdentity}`).digest("hex");
}

function createRunRequest(overrides = {}) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath: "C:/workspace-1",
    provider: "codex",
    providerSessionId: null,
    rawStoreRef: null,
    sequenceBase: 2,
    options: {
      content: "请运行检查命令",
      clientRequestId: "client-1",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      providerPrompt: null,
      attachments: []
    },
    ...overrides
  };
}

function writeFakeCodexAppServer(scriptPath, source) {
  writeFileSync(scriptPath, source.trim(), "utf8");
}

test("CodexRuntimeAdapter 通过 app-server 处理审批请求并继续完成 turn", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-"));
  const scriptPath = join(tempDir, "fake-codex-app-server.cjs");
  const launcherPath = join(
    tempDir,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.sh"
  );
  const threadPath = join(tempDir, "thread-1.jsonl").replace(/\\/g, "/");
  const emitted = [];
  const approvalRequests = [];

  writeFakeCodexAppServer(
    scriptPath,
    `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "thread/start") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        thread: {
          id: "thread-1",
          preview: "",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: 0,
          updatedAt: 0,
          status: { type: "idle" },
          path: ${JSON.stringify(threadPath)},
          cwd: "C:/workspace-1",
          cliVersion: "0.0.0",
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: []
        }
      }
    });
    return;
  }
  if (msg.method === "turn/start") {
    write({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", items: [], status: "inProgress" }
      }
    });
    write({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "commandExecution",
          id: "cmd-1",
          command: "git status --short",
          cwd: "C:/workspace-1",
          processId: null,
          status: "inProgress",
          commandActions: [{ type: "unknown", command: "git status --short" }],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null
        }
      }
    });
    write({
      jsonrpc: "2.0",
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {
        itemId: "cmd-1",
        threadId: "thread-1",
        turnId: "turn-1",
        command: "git status --short",
        cwd: "C:/workspace-1",
        reason: "Need approval"
      }
    });
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        turn: { id: "turn-1", items: [], status: "inProgress" }
      }
    });
    return;
  }
  if (msg.id === "approval-1") {
    write({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "commandExecution",
          id: "cmd-1",
          command: "git status --short",
          cwd: "C:/workspace-1",
          processId: null,
          status: "completed",
          commandActions: [{ type: "unknown", command: "git status --short" }],
          aggregatedOutput: " M src/main.ts",
          exitCode: 0,
          durationMs: 12
        }
      }
    });
    write({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "检查完成",
          phase: "final_answer",
          memoryCitation: null
        }
      }
    });
    write({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", items: [], status: "completed" }
      }
    });
    setTimeout(() => process.exit(0), 10);
  }
});
`
  );
  writeFileSync(
    launcherPath,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`
      : `#!/usr/bin/env sh\n"${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8"
  );

  if (process.platform !== "win32") {
    chmodSync(launcherPath, 0o755);
  }

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      commandPath: launcherPath,
      handleServerRequest: async (input) => {
        approvalRequests.push(input);
        return { decision: "accept" };
      }
    });

    const launch = await adapter.startSession(createRunRequest(), {
      async emit(event) {
        emitted.push(event);
      },
      updateSessionBinding() {}
    });

    await launch.completed;
    const toolCallEvent = emitted.find((event) => event.type === "message" && event.message.kind === "tool_call");
    const toolResultEvent = emitted.find((event) => event.type === "message" && event.message.kind === "tool_result");
    const assistantEvent = emitted.find(
      (event) => event.type === "message" && event.message.role === "assistant" && event.message.content === "检查完成"
    );

    assert.equal(approvalRequests.length, 1);
    assert.equal(approvalRequests[0]?.request.method, "item/commandExecution/requestApproval");
    assert.equal(launch.providerSessionId, "thread-1");
    assert.equal(launch.rawStoreRef, threadPath);
    assert.equal(toolCallEvent?.message.messageId, createStableMessageId("thread-1", "tool:call:command-1"));
    assert.equal(toolResultEvent?.message.messageId, createStableMessageId("thread-1", "tool:result:command-1"));
    assert.equal(assistantEvent?.message.messageId, createStableMessageId("thread-1", "assistant:text:assistant-1"));
    assert.equal(emitted.some((event) => event.type === "complete"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter 支持直接使用 Node 脚本作为 codex 命令入口", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-script-"));
  const scriptPath = join(tempDir, "fake-codex-app-server.cjs");
  const threadPath = join(tempDir, "thread-2.jsonl").replace(/\\/g, "/");
  const emitted = [];

  writeFakeCodexAppServer(
    scriptPath,
    `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "thread/start") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        thread: {
          id: "thread-2",
          preview: "",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: 0,
          updatedAt: 0,
          status: { type: "idle" },
          path: ${JSON.stringify(threadPath)},
          cwd: "C:/workspace-1",
          cliVersion: "0.0.0",
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: []
        }
      }
    });
    return;
  }
  if (msg.method === "turn/start") {
    write({
      method: "turn/started",
      params: {
        threadId: "thread-2",
        turn: { id: "turn-2", items: [], status: "inProgress" }
      }
    });
    write({
      method: "item/completed",
      params: {
        threadId: "thread-2",
        turnId: "turn-2",
        item: {
          type: "agentMessage",
          id: "assistant-2",
          text: "脚本入口可用",
          phase: "final_answer",
          memoryCitation: null
        }
      }
    });
    write({
      method: "turn/completed",
      params: {
        threadId: "thread-2",
        turn: { id: "turn-2", items: [], status: "completed" }
      }
    });
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        turn: { id: "turn-2", items: [], status: "completed" }
      }
    });
    setTimeout(() => process.exit(0), 10);
  }
});
`
  );

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      commandPath: scriptPath
    });

    const launch = await adapter.startSession(
      createRunRequest({
        sessionId: "session-2",
        options: {
          content: "确认脚本入口能否启动",
          clientRequestId: "client-2",
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }
      }),
      {
        async emit(event) {
          emitted.push(event);
        },
        updateSessionBinding() {}
      }
    );

    await launch.completed;

    assert.equal(launch.providerSessionId, "thread-2");
    assert.equal(launch.rawStoreRef, threadPath);
    assert.equal(
      emitted.some((event) => event.type === "message" && event.message.role === "assistant" && event.message.content === "脚本入口可用"),
      true
    );
    assert.equal(emitted.some((event) => event.type === "complete"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter 会为 app-server assistant 与 tool 消息生成稳定 messageId", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-stable-id-"));
  const scriptPath = join(tempDir, "fake-codex-app-server.cjs");
  const launcherPath = join(
    tempDir,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.sh"
  );
  const threadPath = join(tempDir, "thread-stable.jsonl").replace(/\\/g, "/");
  const emitted = [];

  writeFakeCodexAppServer(
    scriptPath,
    `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "thread/start") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        thread: {
          id: "thread-stable",
          preview: "",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: 0,
          updatedAt: 0,
          status: { type: "idle" },
          path: ${JSON.stringify(threadPath)},
          cwd: "C:/workspace-1",
          cliVersion: "0.0.0",
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: []
        }
      }
    });
    return;
  }
  if (msg.method === "turn/start") {
    write({
      method: "item/started",
      params: {
        threadId: "thread-stable",
        turnId: "turn-stable",
        item: {
          type: "commandExecution",
          id: "command-1",
          command: ["/bin/zsh", "-lc", "pwd"],
          status: "inProgress"
        }
      }
    });
    write({
      method: "item/completed",
      params: {
        threadId: "thread-stable",
        turnId: "turn-stable",
        item: {
          type: "commandExecution",
          id: "command-1",
          command: ["/bin/zsh", "-lc", "pwd"],
          status: "completed",
          aggregatedOutput: "/workspace",
          exitCode: 0
        }
      }
    });
    write({
      method: "item/completed",
      params: {
        threadId: "thread-stable",
        turnId: "turn-stable",
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "整理完成",
          phase: "final_answer"
        }
      }
    });
    write({
      method: "turn/completed",
      params: {
        threadId: "thread-stable",
        turn: { id: "turn-stable", items: [], status: "completed" }
      }
    });
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        turn: { id: "turn-stable", items: [], status: "completed" }
      }
    });
    setTimeout(() => process.exit(0), 10);
  }
});
`
  );
  writeFileSync(
    launcherPath,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`
      : `#!/usr/bin/env sh\n"${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8"
  );

  if (process.platform !== "win32") {
    chmodSync(launcherPath, 0o755);
  }

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      commandPath: launcherPath
    });

    const launch = await adapter.startSession(createRunRequest(), {
      async emit(event) {
        emitted.push(event);
      },
      updateSessionBinding() {}
    });

    await launch.completed;

    const toolCallEvent = emitted.find((event) => event.type === "message" && event.message.kind === "tool_call");
    const toolResultEvent = emitted.find((event) => event.type === "message" && event.message.kind === "tool_result");
    const assistantEvent = emitted.find(
      (event) => event.type === "message" && event.message.role === "assistant" && event.message.content === "整理完成"
    );

    assert.equal(toolCallEvent?.message.messageId, createStableMessageId("thread-stable", "tool:call:command-1"));
    assert.equal(toolResultEvent?.message.messageId, createStableMessageId("thread-stable", "tool:result:command-1"));
    assert.equal(assistantEvent?.message.messageId, createStableMessageId("thread-stable", "assistant:text:assistant-1"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter 会把 app-server 的 item/updated 转成同一条流式消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-stream-"));
  const scriptPath = join(tempDir, "fake-codex-app-server.cjs");
  const launcherPath = join(
    tempDir,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.sh"
  );
  const threadPath = join(tempDir, "thread-3.jsonl").replace(/\\/g, "/");
  const emitted = [];

  writeFakeCodexAppServer(
    scriptPath,
    `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "thread/start") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        thread: {
          id: "thread-3",
          preview: "",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: 0,
          updatedAt: 0,
          status: { type: "idle" },
          path: ${JSON.stringify(threadPath)},
          cwd: "C:/workspace-1",
          cliVersion: "0.0.0",
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: []
        }
      }
    });
    return;
  }
  if (msg.method === "turn/start") {
    write({
      method: "turn/started",
      params: {
        threadId: "thread-3",
        turn: { id: "turn-3", items: [], status: "inProgress" }
      }
    });
    write({
      method: "item/updated",
      params: {
        threadId: "thread-3",
        turnId: "turn-3",
        item: {
          type: "agentMessage",
          id: "assistant-3",
          text: "正在",
          phase: "final_answer"
        }
      }
    });
    write({
      method: "item/updated",
      params: {
        threadId: "thread-3",
        turnId: "turn-3",
        item: {
          type: "agentMessage",
          id: "assistant-3",
          text: "正在检查",
          phase: "final_answer"
        }
      }
    });
    write({
      method: "item/completed",
      params: {
        threadId: "thread-3",
        turnId: "turn-3",
        item: {
          type: "agentMessage",
          id: "assistant-3",
          text: "正在检查",
          phase: "final_answer"
        }
      }
    });
    write({
      method: "turn/completed",
      params: {
        threadId: "thread-3",
        turn: { id: "turn-3", items: [], status: "completed" }
      }
    });
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        turn: { id: "turn-3", items: [], status: "completed" }
      }
    });
    setTimeout(() => process.exit(0), 10);
  }
});
`
  );
  writeFileSync(
    launcherPath,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`
      : `#!/usr/bin/env sh\n"${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8"
  );

  if (process.platform !== "win32") {
    chmodSync(launcherPath, 0o755);
  }

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      commandPath: launcherPath
    });

    const launch = await adapter.startSession(
      createRunRequest({
        sessionId: "session-3",
        options: {
          content: "请流式输出进度",
          clientRequestId: "client-3",
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }
      }),
      {
        async emit(event) {
          emitted.push(event);
        },
        updateSessionBinding() {}
      }
    );

    await launch.completed;

    const assistantMessages = emitted.filter((event) =>
      event.type === "message" && event.message.role === "assistant" && event.message.kind === "text"
    );

    assert.deepEqual(
      assistantMessages.map((event) => event.message.content),
      ["正在", "正在检查"]
    );
    assert.equal(assistantMessages[0]?.message.messageId, assistantMessages[1]?.message.messageId);
    assert.equal(assistantMessages[0]?.message.rawRef, assistantMessages[1]?.message.rawRef);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter 会把 app-server 的 item/agentMessage/delta 转成同一条流式消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-delta-stream-"));
  const scriptPath = join(tempDir, "fake-codex-app-server.cjs");
  const launcherPath = join(
    tempDir,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.sh"
  );
  const threadPath = join(tempDir, "thread-delta.jsonl").replace(/\\/g, "/");
  const emitted = [];

  writeFakeCodexAppServer(
    scriptPath,
    `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "thread/start") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        thread: {
          id: "thread-delta",
          preview: "",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: 0,
          updatedAt: 0,
          status: { type: "idle" },
          path: ${JSON.stringify(threadPath)},
          cwd: "C:/workspace-1",
          cliVersion: "0.0.0",
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: []
        }
      }
    });
    return;
  }
  if (msg.method === "turn/start") {
    write({
      method: "turn/started",
      params: {
        threadId: "thread-delta",
        turn: { id: "turn-delta", items: [], status: "inProgress" }
      }
    });
    write({
      method: "item/started",
      params: {
        threadId: "thread-delta",
        turnId: "turn-delta",
        item: {
          type: "agentMessage",
          id: "assistant-delta-1",
          text: "",
          phase: "final_answer"
        }
      }
    });
    write({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-delta",
        turnId: "turn-delta",
        itemId: "assistant-delta-1",
        delta: "正在"
      }
    });
    write({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-delta",
        turnId: "turn-delta",
        itemId: "assistant-delta-1",
        delta: "检查"
      }
    });
    write({
      method: "item/completed",
      params: {
        threadId: "thread-delta",
        turnId: "turn-delta",
        item: {
          type: "agentMessage",
          id: "assistant-delta-1",
          text: "正在检查",
          phase: "final_answer"
        }
      }
    });
    write({
      method: "turn/completed",
      params: {
        threadId: "thread-delta",
        turn: { id: "turn-delta", items: [], status: "completed" }
      }
    });
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        turn: { id: "turn-delta", items: [], status: "completed" }
      }
    });
    setTimeout(() => process.exit(0), 10);
  }
});
`
  );
  writeFileSync(
    launcherPath,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`
      : `#!/usr/bin/env sh\n"${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8"
  );

  if (process.platform !== "win32") {
    chmodSync(launcherPath, 0o755);
  }

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      commandPath: launcherPath
    });

    const launch = await adapter.startSession(
      createRunRequest({
        sessionId: "session-delta",
        options: {
          content: "请真正按 delta 流式输出",
          clientRequestId: "client-delta",
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }
      }),
      {
        async emit(event) {
          emitted.push(event);
        },
        updateSessionBinding() {}
      }
    );

    await launch.completed;

    const assistantMessages = emitted.filter((event) =>
      event.type === "message" && event.message.role === "assistant" && event.message.kind === "text"
    );

    assert.deepEqual(
      assistantMessages.map((event) => event.message.content),
      ["正在", "正在检查"]
    );
    assert.equal(assistantMessages[0]?.message.messageId, assistantMessages[1]?.message.messageId);
    assert.equal(assistantMessages[0]?.message.rawRef, assistantMessages[1]?.message.rawRef);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter 会把 app-server 的 item/reasoning/textDelta 转成同一条 thinking 流式消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-reasoning-text-"));
  const scriptPath = join(tempDir, "fake-codex-app-server.cjs");
  const launcherPath = join(
    tempDir,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.sh"
  );
  const threadPath = join(tempDir, "thread-reasoning-text.jsonl").replace(/\\/g, "/");
  const emitted = [];

  writeFakeCodexAppServer(
    scriptPath,
    `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "thread/start") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        thread: {
          id: "thread-reasoning-text",
          preview: "",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: 0,
          updatedAt: 0,
          status: { type: "idle" },
          path: ${JSON.stringify(threadPath)},
          cwd: "C:/workspace-1",
          cliVersion: "0.0.0",
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: []
        }
      }
    });
    return;
  }
  if (msg.method === "turn/start") {
    write({
      method: "turn/started",
      params: {
        threadId: "thread-reasoning-text",
        turn: { id: "turn-reasoning-text", items: [], status: "inProgress" }
      }
    });
    write({
      method: "item/started",
      params: {
        threadId: "thread-reasoning-text",
        turnId: "turn-reasoning-text",
        item: {
          type: "reasoning",
          id: "reasoning-text-1",
          summary: [],
          content: []
        }
      }
    });
    write({
      method: "item/reasoning/textDelta",
      params: {
        threadId: "thread-reasoning-text",
        turnId: "turn-reasoning-text",
        itemId: "reasoning-text-1",
        contentIndex: 0,
        delta: "先看"
      }
    });
    write({
      method: "item/reasoning/textDelta",
      params: {
        threadId: "thread-reasoning-text",
        turnId: "turn-reasoning-text",
        itemId: "reasoning-text-1",
        contentIndex: 0,
        delta: "日志"
      }
    });
    write({
      method: "item/completed",
      params: {
        threadId: "thread-reasoning-text",
        turnId: "turn-reasoning-text",
        item: {
          type: "reasoning",
          id: "reasoning-text-1",
          summary: [],
          content: ["先看日志"]
        }
      }
    });
    write({
      method: "turn/completed",
      params: {
        threadId: "thread-reasoning-text",
        turn: { id: "turn-reasoning-text", items: [], status: "completed" }
      }
    });
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        turn: { id: "turn-reasoning-text", items: [], status: "completed" }
      }
    });
    setTimeout(() => process.exit(0), 10);
  }
});
`
  );
  writeFileSync(
    launcherPath,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`
      : `#!/usr/bin/env sh\n"${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8"
  );

  if (process.platform !== "win32") {
    chmodSync(launcherPath, 0o755);
  }

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      commandPath: launcherPath
    });

    const launch = await adapter.startSession(
      createRunRequest({
        sessionId: "session-reasoning-text",
        options: {
          content: "请输出推理增量",
          clientRequestId: "client-reasoning-text",
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }
      }),
      {
        async emit(event) {
          emitted.push(event);
        },
        updateSessionBinding() {}
      }
    );

    await launch.completed;

    const thinkingMessages = emitted.filter((event) =>
      event.type === "message" && event.message.role === "assistant" && event.message.kind === "thinking"
    );

    assert.deepEqual(
      thinkingMessages.map((event) => event.message.content),
      ["先看", "先看日志"]
    );
    assert.equal(thinkingMessages[0]?.message.messageId, thinkingMessages[1]?.message.messageId);
    assert.equal(thinkingMessages[0]?.message.rawRef, thinkingMessages[1]?.message.rawRef);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter 会把 app-server 的 reasoning summary delta 转成同一条 thinking 流式消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-reasoning-summary-"));
  const scriptPath = join(tempDir, "fake-codex-app-server.cjs");
  const launcherPath = join(
    tempDir,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.sh"
  );
  const threadPath = join(tempDir, "thread-reasoning-summary.jsonl").replace(/\\/g, "/");
  const emitted = [];

  writeFakeCodexAppServer(
    scriptPath,
    `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "thread/start") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        thread: {
          id: "thread-reasoning-summary",
          preview: "",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: 0,
          updatedAt: 0,
          status: { type: "idle" },
          path: ${JSON.stringify(threadPath)},
          cwd: "C:/workspace-1",
          cliVersion: "0.0.0",
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: []
        }
      }
    });
    return;
  }
  if (msg.method === "turn/start") {
    write({
      method: "turn/started",
      params: {
        threadId: "thread-reasoning-summary",
        turn: { id: "turn-reasoning-summary", items: [], status: "inProgress" }
      }
    });
    write({
      method: "item/started",
      params: {
        threadId: "thread-reasoning-summary",
        turnId: "turn-reasoning-summary",
        item: {
          type: "reasoning",
          id: "reasoning-summary-1",
          summary: [],
          content: []
        }
      }
    });
    write({
      method: "item/reasoning/summaryPartAdded",
      params: {
        threadId: "thread-reasoning-summary",
        turnId: "turn-reasoning-summary",
        itemId: "reasoning-summary-1",
        summaryIndex: 0
      }
    });
    write({
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thread-reasoning-summary",
        turnId: "turn-reasoning-summary",
        itemId: "reasoning-summary-1",
        summaryIndex: 0,
        delta: "先确认"
      }
    });
    write({
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thread-reasoning-summary",
        turnId: "turn-reasoning-summary",
        itemId: "reasoning-summary-1",
        summaryIndex: 0,
        delta: "范围"
      }
    });
    write({
      method: "item/completed",
      params: {
        threadId: "thread-reasoning-summary",
        turnId: "turn-reasoning-summary",
        item: {
          type: "reasoning",
          id: "reasoning-summary-1",
          summary: ["先确认范围"],
          content: []
        }
      }
    });
    write({
      method: "turn/completed",
      params: {
        threadId: "thread-reasoning-summary",
        turn: { id: "turn-reasoning-summary", items: [], status: "completed" }
      }
    });
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        turn: { id: "turn-reasoning-summary", items: [], status: "completed" }
      }
    });
    setTimeout(() => process.exit(0), 10);
  }
});
`
  );
  writeFileSync(
    launcherPath,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`
      : `#!/usr/bin/env sh\n"${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8"
  );

  if (process.platform !== "win32") {
    chmodSync(launcherPath, 0o755);
  }

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      commandPath: launcherPath
    });

    const launch = await adapter.startSession(
      createRunRequest({
        sessionId: "session-reasoning-summary",
        options: {
          content: "请输出推理摘要增量",
          clientRequestId: "client-reasoning-summary",
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }
      }),
      {
        async emit(event) {
          emitted.push(event);
        },
        updateSessionBinding() {}
      }
    );

    await launch.completed;

    const thinkingMessages = emitted.filter((event) =>
      event.type === "message" && event.message.role === "assistant" && event.message.kind === "thinking"
    );

    assert.deepEqual(
      thinkingMessages.map((event) => event.message.content),
      ["先确认", "先确认范围"]
    );
    assert.equal(thinkingMessages[0]?.message.messageId, thinkingMessages[1]?.message.messageId);
    assert.equal(thinkingMessages[0]?.message.rawRef, thinkingMessages[1]?.message.rawRef);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter 不会把 turn/completed 回放的同一批 items 再写进 synthetic history", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-replay-dedupe-"));
  const threadId = `thread-replay-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const emitted = [];
  let notificationHandler = null;
  let closed = false;

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      transportFactory: () => ({
        async initialize() {},
        async startThread() {
          return {
            providerSessionId: threadId,
            rawStoreRef: null
          };
        },
        async resumeThread() {
          return {
            providerSessionId: threadId,
            rawStoreRef: null
          };
        },
        async resumeThreadFromHistory() {
          return {
            providerSessionId: threadId,
            rawStoreRef: null
          };
        },
        async startTurn() {
          queueMicrotask(() => {
            void notificationHandler?.({
              method: "item/started",
              params: {
                threadId,
                turnId: "turn-replay",
                item: {
                  type: "commandExecution",
                  id: "command-replay-1",
                  command: ["/bin/zsh", "-lc", "pwd"],
                  status: "inProgress"
                }
              }
            });
            void notificationHandler?.({
              method: "item/completed",
              params: {
                threadId,
                turnId: "turn-replay",
                item: {
                  type: "commandExecution",
                  id: "command-replay-1",
                  command: ["/bin/zsh", "-lc", "pwd"],
                  status: "completed",
                  aggregatedOutput: "/workspace",
                  exitCode: 0
                }
              }
            });
            void notificationHandler?.({
              method: "item/completed",
              params: {
                threadId,
                turnId: "turn-replay",
                item: {
                  type: "agentMessage",
                  id: "assistant-replay-1",
                  text: "整理完成"
                }
              }
            });
            void notificationHandler?.({
              method: "turn/completed",
              params: {
                threadId,
                turn: {
                  id: "turn-replay",
                  status: "completed",
                  items: [
                    {
                      type: "commandExecution",
                      id: "command-replay-1",
                      command: ["/bin/zsh", "-lc", "pwd"],
                      status: "completed",
                      aggregatedOutput: "/workspace",
                      exitCode: 0
                    },
                    {
                      type: "agentMessage",
                      id: "assistant-replay-1",
                      text: "整理完成"
                    }
                  ]
                }
              }
            });
          });
        },
        async steerTurn() {},
        async interruptTurn() {},
        setNotificationHandler(handler) {
          notificationHandler = handler;
        },
        setServerRequestHandler() {},
        setOnClose() {},
        isClosed() {
          return closed;
        },
        close() {
          closed = true;
        }
      })
    });

    const launch = await adapter.startSession(createRunRequest({
      sessionId: "session-replay",
      workspacePath: tempDir,
      sequenceBase: 0
    }), {
      async emit(event) {
        emitted.push(event);
      },
      updateSessionBinding() {}
    });

    await launch.completed;

    const historyAdapter = new CodexAdapter({ homeDir: tempDir });
    const page = await historyAdapter.readSessionHistory(
      threadId,
      launch.rawStoreRef,
      null,
      50
    );

    assert.deepEqual(
      page.messages.map((message) => ({
        role: message.role,
        kind: message.kind,
        content: message.content
      })),
      [
        {
          role: "user",
          kind: "text",
          content: "请运行检查命令"
        },
        {
          role: "tool",
          kind: "tool_call",
          content: "/bin/zsh\n-lc\npwd"
        },
        {
          role: "tool",
          kind: "tool_result",
          content: "/workspace"
        },
        {
          role: "assistant",
          kind: "text",
          content: "整理完成"
        }
      ]
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter 会把 exec_command 里的 apply_patch 归一化成编辑工具", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-exec-patch-"));
  const scriptPath = join(tempDir, "fake-codex-app-server.cjs");
  const launcherPath = join(
    tempDir,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.sh"
  );
  const threadPath = join(tempDir, "thread-exec-patch.jsonl").replace(/\\/g, "/");
  const emitted = [];
  const patchText = [
    "*** Begin Patch",
    "*** Update File: apps/user-app/src/main.ts",
    "@@",
    "-oldValue();",
    "+newValue();",
    "*** End Patch"
  ].join("\n");
  const patchCommand = `apply_patch <<'PATCH'\n${patchText}\nPATCH`;
  const warning = "Warning: apply_patch was requested via exec_command. Use the apply_patch tool instead of exec_command.";

  writeFakeCodexAppServer(
    scriptPath,
    `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "thread/start") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        thread: {
          id: "thread-exec-patch",
          preview: "",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: 0,
          updatedAt: 0,
          status: { type: "idle" },
          path: ${JSON.stringify(threadPath)},
          cwd: "C:/workspace-1",
          cliVersion: "0.0.0",
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: []
        }
      }
    });
    return;
  }
  if (msg.method === "turn/start") {
    write({
      method: "item/started",
      params: {
        threadId: "thread-exec-patch",
        turnId: "turn-exec-patch",
        item: {
          type: "commandExecution",
          id: "patch-command-1",
          command: ${JSON.stringify(patchCommand)},
          cwd: "C:/workspace-1",
          status: "inProgress",
          aggregatedOutput: null,
          exitCode: null
        }
      }
    });
    write({
      method: "item/completed",
      params: {
        threadId: "thread-exec-patch",
        turnId: "turn-exec-patch",
        item: {
          type: "commandExecution",
          id: "patch-command-1",
          command: ${JSON.stringify(patchCommand)},
          cwd: "C:/workspace-1",
          status: "completed",
          aggregatedOutput: ${JSON.stringify(warning)},
          exitCode: 0
        }
      }
    });
    write({
      method: "turn/completed",
      params: {
        threadId: "thread-exec-patch",
        turn: { id: "turn-exec-patch", items: [], status: "completed" }
      }
    });
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        turn: { id: "turn-exec-patch", items: [], status: "completed" }
      }
    });
    setTimeout(() => process.exit(0), 10);
  }
});
`
  );
  writeFileSync(
    launcherPath,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`
      : `#!/usr/bin/env sh\n"${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8"
  );

  if (process.platform !== "win32") {
    chmodSync(launcherPath, 0o755);
  }

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      commandPath: launcherPath
    });

    const launch = await adapter.startSession(
      createRunRequest({
        sessionId: "session-exec-patch",
        options: {
          content: "请修改文件",
          clientRequestId: "client-exec-patch",
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }
      }),
      {
        async emit(event) {
          emitted.push(event);
        },
        updateSessionBinding() {}
      }
    );

    await launch.completed;

    const toolCallEvent = emitted.find(
      (event) => event.type === "message" && event.message.kind === "tool_call"
    );
    const toolResultEvent = emitted.find(
      (event) => event.type === "message" && event.message.kind === "tool_result"
    );

    assert.equal(toolCallEvent?.message.toolCall?.name, "apply_patch");
    assert.equal(toolResultEvent?.message.toolCall?.name, "apply_patch");
    assert.match(toolCallEvent?.message.toolCall?.input ?? "", /^\*\*\* Begin Patch/m);
    assert.match(toolResultEvent?.message.toolCall?.input ?? "", /^\*\*\* Begin Patch/m);
    assert.equal(toolResultEvent?.message.toolCall?.status, "failed");
    assert.equal(toolResultEvent?.message.toolCall?.error, warning);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter 会把仅 completed 的 fileChange 转成标准 apply_patch 输入", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-file-change-"));
  const scriptPath = join(tempDir, "fake-codex-app-server.cjs");
  const launcherPath = join(
    tempDir,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.sh"
  );
  const threadPath = join(tempDir, "thread-4.jsonl").replace(/\\/g, "/");
  const emitted = [];

  writeFakeCodexAppServer(
    scriptPath,
    `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "thread/start") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        thread: {
          id: "thread-4",
          preview: "",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: 0,
          updatedAt: 0,
          status: { type: "idle" },
          path: ${JSON.stringify(threadPath)},
          cwd: "C:/workspace-1",
          cliVersion: "0.0.0",
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: []
        }
      }
    });
    return;
  }
  if (msg.method === "turn/start") {
    write({
      method: "turn/started",
      params: {
        threadId: "thread-4",
        turn: { id: "turn-4", items: [], status: "inProgress" }
      }
    });
    write({
      method: "item/completed",
      params: {
        threadId: "thread-4",
        turnId: "turn-4",
        item: {
          type: "fileChange",
          id: "patch-1",
          status: "completed",
          changes: [
            {
              path: "/Users/jackson/Code/CodingNS/apps/host/src/modules/sessions/session-live-runtime-service.ts",
              kind: "update"
            }
          ]
        }
      }
    });
    write({
      method: "turn/completed",
      params: {
        threadId: "thread-4",
        turn: { id: "turn-4", items: [], status: "completed" }
      }
    });
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        turn: { id: "turn-4", items: [], status: "completed" }
      }
    });
    setTimeout(() => process.exit(0), 10);
  }
});
`
  );
  writeFileSync(
    launcherPath,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`
      : `#!/usr/bin/env sh\n"${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8"
  );

  if (process.platform !== "win32") {
    chmodSync(launcherPath, 0o755);
  }

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      commandPath: launcherPath
    });

    const launch = await adapter.startSession(
      createRunRequest({
        sessionId: "session-4",
        options: {
          content: "请返回文件修改结果",
          clientRequestId: "client-4",
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }
      }),
      {
        async emit(event) {
          emitted.push(event);
        },
        updateSessionBinding() {}
      }
    );

    await launch.completed;

    const toolResultEvent = emitted.find(
      (event) => event.type === "message" && event.message.kind === "tool_result"
    );

    assert.equal(toolResultEvent?.message.toolCall?.name, "apply_patch");
    assert.match(toolResultEvent?.message.toolCall?.input ?? "", /^\*\*\* Begin Patch/m);
    assert.match(
      toolResultEvent?.message.toolCall?.input ?? "",
      /\*\*\* Update File: \/Users\/jackson\/Code\/CodingNS\/apps\/host\/src\/modules\/sessions\/session-live-runtime-service\.ts/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

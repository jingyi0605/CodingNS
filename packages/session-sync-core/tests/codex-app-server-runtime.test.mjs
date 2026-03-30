import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CodexRuntimeAdapter } from "../dist/runtime/codex-runtime.js";

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

test("CodexRuntimeAdapter 通过 app-server 处理审批请求并继续完成 turn", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-app-server-"));
  const scriptPath = join(tempDir, "fake-codex-app-server.cjs");
  const launcherPath = join(tempDir, "fake-codex.cmd");
  const threadPath = join(tempDir, "thread-1.jsonl").replace(/\\/g, "/");
  const emitted = [];
  const approvalRequests = [];

  writeFileSync(
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
`.trim(),
    "utf8"
  );
  writeFileSync(
    launcherPath,
    `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
    "utf8"
  );

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

    assert.equal(approvalRequests.length, 1);
    assert.equal(approvalRequests[0]?.request.method, "item/commandExecution/requestApproval");
    assert.equal(launch.providerSessionId, "thread-1");
    assert.equal(launch.rawStoreRef, threadPath);
    assert.equal(emitted.some((event) => event.type === "message" && event.message.kind === "tool_call"), true);
    assert.equal(emitted.some((event) => event.type === "message" && event.message.kind === "tool_result"), true);
    assert.equal(
      emitted.some((event) => event.type === "message" && event.message.role === "assistant" && event.message.content === "检查完成"),
      true
    );
    assert.equal(emitted.some((event) => event.type === "complete"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

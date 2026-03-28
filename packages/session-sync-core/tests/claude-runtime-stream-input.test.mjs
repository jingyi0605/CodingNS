import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ClaudeRuntimeAdapter } from "../dist/runtime/claude-runtime.js";

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

    assert.ok(thinkingEvents.length >= 3);
    assert.deepEqual(
      thinkingEvents.map((message) => message.content),
      ["第一段", "第一段\n第二段", "第一段\n第二段", "第一段\n第二段"]
    );
    assert.equal(new Set(thinkingEvents.map((message) => message.messageId)).size, 1);
    assert.equal(new Set(thinkingEvents.map((message) => message.rawRef)).size, 1);
    assert.equal(new Set(thinkingEvents.map((message) => message.sequence)).size, 1);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

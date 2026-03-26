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

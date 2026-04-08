import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GeminiRuntimeAdapter } from "../dist/runtime/gemini-runtime.js";

function createRunRequest(overrides = {}) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    provider: "gemini",
    providerSessionId: null,
    rawStoreRef: null,
    sequenceBase: 2,
    options: {
      content: "请继续实现 Gemini runtime",
      clientRequestId: "client-1",
      model: "flash",
      reasoningLevel: null,
      permissionMode: "acceptEdits",
      providerPrompt: null,
      attachments: []
    },
    ...overrides
  };
}

function createSink() {
  const bindings = [];
  const events = [];

  return {
    bindings,
    events,
    sink: {
      updateSessionBinding(binding) {
        bindings.push(binding);
      },
      async emit(event) {
        events.push(event);
      }
    }
  };
}

function createScript(tempDir, body) {
  const scriptPath = join(tempDir, `gemini-${Math.random().toString(16).slice(2)}.mjs`);
  writeFileSync(scriptPath, body, "utf8");
  return scriptPath;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("GeminiRuntimeAdapter 浼氬綊涓€鍖?headless stream-json 浜嬩欢骞剁粦瀹氱湡瀹?session id", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-gemini-runtime-"));
  const scriptPath = createScript(
    tempDir,
    `
const args = process.argv.slice(2);
const promptIndex = args.indexOf("--prompt");
const prompt = promptIndex >= 0 ? args[promptIndex + 1] : "";
const resumeIndex = args.indexOf("--resume");
const sessionId = resumeIndex >= 0 ? args[resumeIndex + 1] : "gemini-session-1";
const approvalIndex = args.indexOf("--approval-mode");
const approvalMode = approvalIndex >= 0 ? args[approvalIndex + 1] : "";
const modelIndex = args.indexOf("--model");
const model = modelIndex >= 0 ? args[modelIndex + 1] : "";

console.log(JSON.stringify({ type: "init", session_id: sessionId, model }));
console.log(JSON.stringify({ type: "message", role: "user", content: prompt }));
console.log(JSON.stringify({ type: "message", role: "assistant", content: "第一段", delta: true }));
console.log(JSON.stringify({ type: "message", role: "assistant", content: "第二段", delta: true }));
console.log(JSON.stringify({
  type: "tool_use",
  tool_name: "shell",
  tool_id: "tool-1",
  parameters: { approvalMode }
}));
console.log(JSON.stringify({
  type: "tool_result",
  tool_id: "tool-1",
  status: "success",
  output: "tool output"
}));
console.log(JSON.stringify({
  type: "result",
  status: "success",
  stats: { total_tokens: 12 }
}));
setTimeout(() => process.exit(0), 20);
`
  );

  try {
    const adapter = new GeminiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath]
    });
    const { sink, bindings, events } = createSink();

    const launch = await adapter.startSession(
      createRunRequest({
        workspacePath: tempDir
      }),
      sink
    );

    await launch.completed;

    assert.equal(launch.providerSessionId.startsWith("pending://gemini/"), true);
    assert.equal(bindings.some((binding) => binding.providerSessionId === "gemini-session-1"), true);

    const userMessage = events.find(
      (event) => event.type === "message" && event.message.role === "user"
    );
    const assistantMessages = events.filter(
      (event) => event.type === "message" && event.message.role === "assistant" && event.message.kind === "text"
    );
    const toolCall = events.find(
      (event) => event.type === "message" && event.message.kind === "tool_call"
    );
    const toolResult = events.find(
      (event) => event.type === "message" && event.message.kind === "tool_result"
    );

    assert.ok(userMessage);
    assert.equal(userMessage.message.content, "请继续实现 Gemini runtime");
    assert.equal(assistantMessages.length >= 2, true);
    assert.equal(assistantMessages.at(-1)?.message.content, "第一段第二段");
    assert.equal(assistantMessages[0]?.message.messageId, assistantMessages.at(-1)?.message.messageId);
    assert.equal(toolCall?.message.toolCall?.input.includes("auto_edit"), true);
    assert.equal(toolResult?.message.toolCall?.output, "tool output");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("GeminiRuntimeAdapter continueSession 浼氬鐢ㄥ凡鏈?providerSessionId", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-gemini-runtime-"));
  const scriptPath = createScript(
    tempDir,
    `
const args = process.argv.slice(2);
const resumeIndex = args.indexOf("--resume");
const sessionId = resumeIndex >= 0 ? args[resumeIndex + 1] : "missing";
console.log(JSON.stringify({ type: "init", session_id: sessionId, model: "flash" }));
console.log(JSON.stringify({ type: "message", role: "assistant", content: "continue", delta: true }));
setTimeout(() => process.exit(0), 20);
`
  );

  try {
    const adapter = new GeminiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath]
    });
    const { sink, events } = createSink();

    const launch = await adapter.continueSession(
      createRunRequest({
        providerSessionId: "gemini-session-continue",
        rawStoreRef: "gemini://session/gemini-session-continue",
        workspacePath: tempDir
      }),
      sink
    );

    await launch.completed;

    assert.equal(launch.providerSessionId, "gemini-session-continue");
    assert.equal(launch.rawStoreRef, "gemini://session/gemini-session-continue");
    assert.equal(
      events.some(
        (event) =>
          event.type === "message"
          && event.providerSessionId === "gemini-session-continue"
          && event.message.content === "continue"
      ),
      true
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("GeminiRuntimeAdapter interrupt 浼氫腑鏂?headless 杩涚▼", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-gemini-runtime-"));
  const scriptPath = createScript(
    tempDir,
    `
console.log(JSON.stringify({ type: "init", session_id: "gemini-session-interrupt", model: "flash" }));
const timer = setInterval(() => {
  console.log(JSON.stringify({ type: "message", role: "assistant", content: "tick", delta: true }));
}, 80);
const finish = () => {
  clearInterval(timer);
  process.exit(130);
};
process.on("SIGINT", finish);
process.on("SIGTERM", finish);
`
  );

  try {
    const adapter = new GeminiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath]
    });
    const { sink } = createSink();

    const launch = await adapter.startSession(
      createRunRequest({
        workspacePath: tempDir
      }),
      sink
    );

    await wait(180);
    await launch.interrupt?.();
    await Promise.race([
      launch.completed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("INTERRUPT_TIMEOUT")), 2_000))
    ]);

    assert.ok(true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

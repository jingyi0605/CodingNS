import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { KimiRuntimeAdapter } from "../dist/runtime/kimi-runtime.js";

function createRunRequest(overrides = {}) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    provider: "kimi",
    providerSessionId: null,
    rawStoreRef: null,
    sequenceBase: 3,
    options: {
      content: "继续实现 Kimi runtime",
      clientRequestId: "client-1",
      model: "kimi-k2",
      reasoningLevel: null,
      permissionMode: null,
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

function createWireScript(tempDir, body) {
  const scriptPath = join(tempDir, `wire-${Math.random().toString(16).slice(2)}.mjs`);
  writeFileSync(scriptPath, body, "utf8");
  return scriptPath;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("KimiRuntimeAdapter startSession 走 wire 主链路并输出消息事件", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
const args = process.argv.slice(2);
const resumeIndex = args.indexOf("--resume");
const sessionId = resumeIndex >= 0 ? args[resumeIndex + 1] : "wire-session-1";
console.log(JSON.stringify({ type: "session.created", session_id: sessionId }));
console.log(JSON.stringify({
  type: "assistant.message",
  role: "assistant",
  timestamp: "2026-04-03T10:00:00.000Z",
  content: [{ type: "text", text: "wire runtime 输出" }]
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
    const { sink, events, bindings } = createSink();

    const launch = await adapter.startSession(
      createRunRequest({
        workspacePath: tempDir
      }),
      sink
    );
    await launch.completed;

    assert.equal(typeof launch.providerSessionId, "string");
    assert.equal(launch.rawStoreRef?.startsWith("kimi://session/"), true);

    const boundSessionIds = bindings.map((binding) => binding.providerSessionId).filter(Boolean);
    assert.equal(boundSessionIds.includes("wire-session-1"), true);

    const messageEvent = events.find((event) => event.type === "message");
    assert.ok(messageEvent);
    assert.equal(messageEvent.message.role, "assistant");
    assert.equal(messageEvent.message.content.includes("wire runtime"), true);
    assert.equal(messageEvent.message.sequence >= 4, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KimiRuntimeAdapter continueSession 会复用已有 providerSessionId", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
const args = process.argv.slice(2);
const resumeIndex = args.indexOf("--resume");
const sessionId = resumeIndex >= 0 ? args[resumeIndex + 1] : "wire-session-default";
console.log(JSON.stringify({ type: "session.created", session_id: sessionId }));
console.log(JSON.stringify({
  type: "assistant.message",
  role: "assistant",
  timestamp: "2026-04-03T10:00:10.000Z",
  content: [{ type: "text", text: "continue runtime 输出" }]
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
    const { sink, events } = createSink();

    const launch = await adapter.continueSession(
      createRunRequest({
        providerSessionId: "resume-session-1",
        rawStoreRef: "kimi://session/resume-session-1",
        workspacePath: tempDir
      }),
      sink
    );

    await launch.completed;

    assert.equal(launch.providerSessionId, "resume-session-1");
    assert.equal(launch.rawStoreRef, "kimi://session/resume-session-1");

    const messageEvent = events.find((event) => event.type === "message");
    assert.ok(messageEvent);
    assert.equal(messageEvent.providerSessionId, "resume-session-1");
    assert.equal(messageEvent.message.content.includes("continue runtime"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KimiRuntimeAdapter interrupt 会中断 wire 进程且 completed 正常结束", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
let count = 0;
console.log(JSON.stringify({ type: "session.created", session_id: "wire-interrupt-1" }));
const timer = setInterval(() => {
  count += 1;
  console.log(JSON.stringify({
    type: "assistant.message",
    role: "assistant",
    content: [{ type: "text", text: "tick-" + count }]
  }));
}, 80);
process.on("SIGINT", () => {
  clearInterval(timer);
  process.exit(130);
});
`
  );

  try {
    const adapter = new KimiRuntimeAdapter({
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

test("KimiRuntimeAdapter submitDuringRun 支持运行中引导并在结束后拒绝继续输入", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const resumeIndex = args.indexOf("--resume");
const sessionId = resumeIndex >= 0 ? args[resumeIndex + 1] : "wire-guidance-1";
console.log(JSON.stringify({ type: "session.created", session_id: sessionId }));

const reader = createInterface({ input: process.stdin });
let count = 0;
reader.on("line", (line) => {
  const payload = JSON.parse(line);
  if (payload.type !== "prompt.submit") {
    return;
  }

  count += 1;
  console.log(JSON.stringify({
    type: "assistant.message",
    role: "assistant",
    content: [{ type: "text", text: "ack-" + count + ":" + payload.content }]
  }));

  if (count >= 2) {
    setTimeout(() => process.exit(0), 20);
  }
});

setTimeout(() => process.exit(0), 3000);
`
  );

  try {
    const adapter = new KimiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath]
    });
    const { sink, events } = createSink();

    const launch = await adapter.startSession(
      createRunRequest({
        workspacePath: tempDir
      }),
      sink
    );
    assert.equal(typeof launch.submitDuringRun, "function");

    await wait(80);
    await launch.submitDuringRun({
      content: "运行中补充说明",
      clientRequestId: "client-2",
      model: "kimi-k2",
      reasoningLevel: null,
      permissionMode: null,
      providerPrompt: "请继续执行并说明风险",
      attachments: []
    });
    await launch.completed;

    const messageContents = events
      .filter((event) => event.type === "message")
      .map((event) => event.message.content);
    assert.equal(
      messageContents.some((content) => content.includes("ack-1:继续实现 Kimi runtime")),
      true
    );
    assert.equal(
      messageContents.some((content) => content.includes("ack-2:请继续执行并说明风险")),
      true
    );

    await assert.rejects(
      () =>
        launch.submitDuringRun({
          content: "run ended",
          clientRequestId: "client-3",
          model: "kimi-k2",
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }),
      /IN_RUN_INPUT_NOT_SUPPORTED/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KimiRuntimeAdapter 在 wire 不可用时会回退到命令模式 stream-json", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
const args = process.argv.slice(2);
if (args[0] === "wire") {
  console.error("wire unsupported in this fixture");
  setTimeout(() => process.exit(2), 10);
} else {
  const resumeIndex = args.indexOf("--resume");
  const sessionId = resumeIndex >= 0 ? args[resumeIndex + 1] : "fallback-session-1";
  console.log(JSON.stringify({ type: "session.created", session_id: sessionId }));
  console.log(JSON.stringify({
    type: "assistant.message",
    role: "assistant",
    content: [{ type: "text", text: "fallback stream-json output" }]
  }));
  setTimeout(() => process.exit(0), 30);
}
`
  );

  try {
    const adapter = new KimiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath]
    });
    const { sink, events } = createSink();

    const launch = await adapter.startSession(
      createRunRequest({
        workspacePath: tempDir
      }),
      sink
    );
    await launch.completed;

    const statusEvent = events.find(
      (event) =>
        event.type === "status"
        && typeof event.detail === "string"
        && event.detail.includes("fallback")
    );
    assert.ok(statusEvent);

    const messageEvent = events.find((event) => event.type === "message");
    assert.ok(messageEvent);
    assert.equal(messageEvent.message.content.includes("fallback stream-json output"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

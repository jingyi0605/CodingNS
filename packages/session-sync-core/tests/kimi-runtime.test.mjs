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

async function cleanupTempDir(tempDir) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== "EBUSY" || attempt === 9) {
        throw error;
      }

      await wait(100);
    }
  }
}

test("KimiRuntimeAdapter startSession 走 wire 主链路并输出消息事件", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: kimi [OPTIONS]\\n  --wire\\n  --work-dir\\n  --session");
  process.exit(0);
}
const sessionOptionIndex = args.indexOf("--session");
const resumeIndex = sessionOptionIndex >= 0 ? sessionOptionIndex : args.indexOf("--resume");
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
    assert.equal(
      launch.providerSessionId.startsWith("pending://kimi/") || launch.providerSessionId === "wire-session-1",
      true
    );
    assert.equal(
      launch.rawStoreRef.startsWith("pending://kimi/") || launch.rawStoreRef === "kimi://session/wire-session-1",
      true
    );
    await launch.completed;

    const boundSessionIds = bindings.map((binding) => binding.providerSessionId).filter(Boolean);
    assert.equal(boundSessionIds.includes(launch.providerSessionId), true);

    const messageEvent = events.find((event) => event.type === "message");
    assert.ok(messageEvent);
    assert.equal(messageEvent.message.role, "assistant");
    assert.equal(messageEvent.message.content.includes("wire runtime"), true);
    assert.equal(messageEvent.message.sequence >= 4, true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("KimiRuntimeAdapter 启动新版会话后会回填真实 providerSessionId", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-resolve-"));
  const scriptPath = createWireScript(
    tempDir,
    `
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const workspaceDir = process.argv[2];
const homeDir = process.argv[3];
const sessionId = "resolved-session-1";

if (args.includes("--help")) {
  console.log("Usage: kimi [OPTIONS]\\n  --wire\\n  --work-dir\\n  --session");
  process.exit(0);
}

const workDirHash = createHash("md5").update(workspaceDir).digest("hex");
const sessionDir = join(homeDir, "sessions", workDirHash, sessionId);
mkdirSync(sessionDir, { recursive: true });
writeFileSync(
  join(homeDir, "kimi.json"),
  JSON.stringify({
    work_dirs: [
      {
        path: workspaceDir,
        kaos: "local",
        last_session_id: sessionId
      }
    ]
  }),
  "utf8"
);
writeFileSync(
  join(sessionDir, "context.jsonl"),
  JSON.stringify({
    timestamp: "2026-04-08T14:46:29.000Z",
    role: "assistant",
    content: "resolved runtime output"
  }) + "\\n",
  "utf8"
);
console.log(JSON.stringify({
  type: "assistant.message",
  role: "assistant",
  timestamp: "2026-04-08T14:46:29.000Z",
  content: [{ type: "text", text: "resolved runtime output" }]
}));
setTimeout(() => process.exit(0), 80);
`
  );

  try {
    const adapter = new KimiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath, tempDir, tempDir]
    });
    const { sink, bindings } = createSink();

    const launch = await adapter.startSession(
      createRunRequest({
        workspacePath: tempDir
      }),
      sink
    );

    await launch.completed;
    await wait(200);

    const boundSessionIds = bindings.map((binding) => binding.providerSessionId).filter(Boolean);
    assert.equal(boundSessionIds.includes("resolved-session-1"), true);
    assert.equal(launch.providerSessionId, "resolved-session-1");
    assert.equal(launch.rawStoreRef, "kimi://session/resolved-session-1");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("KimiRuntimeAdapter continueSession 会复用已有 providerSessionId", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: kimi [OPTIONS]\\n  --wire\\n  --work-dir\\n  --session");
  process.exit(0);
}
const sessionOptionIndex = args.indexOf("--session");
const resumeIndex = sessionOptionIndex >= 0 ? sessionOptionIndex : args.indexOf("--resume");
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
    await cleanupTempDir(tempDir);
  }
});

test("KimiRuntimeAdapter interrupt 会中断 wire 进程且 completed 正常结束", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
let count = 0;
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: kimi [OPTIONS]\\n  --wire\\n  --work-dir\\n  --session");
  process.exit(0);
}
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
    await cleanupTempDir(tempDir);
  }
});

test("KimiRuntimeAdapter 命令模式下不支持同一轮运行中继续输入", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: kimi [OPTIONS]\\n  --wire\\n  --work-dir\\n  --session");
  process.exit(0);
}
const sessionOptionIndex = args.indexOf("--session");
const resumeIndex = sessionOptionIndex >= 0 ? sessionOptionIndex : args.indexOf("--resume");
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
    await launch.completed;

    assert.equal(
      typeof launch.submitDuringRun,
      "undefined"
    );
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("KimiRuntimeAdapter 命令模式会直接输出 stream-json 结果", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-"));
  const scriptPath = createWireScript(
    tempDir,
    `
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: kimi [OPTIONS]\\n  --wire\\n  --work-dir\\n  --session");
  process.exit(0);
}
if (args.includes("--cwd")) {
  console.error("legacy work dir flag unsupported in this fixture");
  process.exit(2);
}
if (!args.includes("--work-dir")) {
  console.error("missing --work-dir in this fixture");
  process.exit(2);
}
const sessionOptionIndex = args.indexOf("--session");
const resumeIndex = sessionOptionIndex >= 0 ? sessionOptionIndex : args.indexOf("--resume");
const sessionId = resumeIndex >= 0 ? args[resumeIndex + 1] : "fallback-session-1";
console.log(JSON.stringify({
  type: "assistant.message",
  role: "assistant",
  content: [{ type: "text", text: "fallback stream-json output" }]
}));
setTimeout(() => process.exit(0), 30);
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

    const messageEvent = events.find((event) => event.type === "message");
    assert.ok(messageEvent);
    assert.equal(messageEvent.message.content.includes("fallback stream-json output"), true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

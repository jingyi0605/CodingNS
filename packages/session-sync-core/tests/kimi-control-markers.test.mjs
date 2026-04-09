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

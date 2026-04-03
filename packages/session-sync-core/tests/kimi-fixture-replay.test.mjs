import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { KimiAdapter } from "../dist/providers/kimi.js";
import { KimiRuntimeAdapter } from "../dist/runtime/kimi-runtime.js";

const WORKSPACE_PLACEHOLDER = "__WORKSPACE_PATH__";
const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/kimi", import.meta.url));

function createSink() {
  const events = [];
  const bindings = [];

  return {
    events,
    bindings,
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

function materializeKimiSessionFixture(baseDir) {
  const workspaceDir = join(baseDir, "workspace-fixture");
  const homeDir = join(baseDir, "kimi-home");
  const sessionDir = join(homeDir, "sessions", "fixture-hash-1", "kimi-session-fixture-1");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });

  for (const fileName of ["state.json", "context.jsonl", "wire.jsonl"]) {
    const sourcePath = join(FIXTURE_ROOT, "session-basic", fileName);
    const content = readFileSync(sourcePath, "utf8").replaceAll(WORKSPACE_PLACEHOLDER, workspaceDir);
    writeFileSync(join(sessionDir, fileName), content, "utf8");
  }

  return {
    workspaceDir,
    homeDir,
    sessionId: "kimi-session-fixture-1",
    rawStoreRef: "kimi://session/kimi-session-fixture-1"
  };
}

function createReplayScript(tempDir) {
  const scriptPath = join(tempDir, "runtime-fixture-replay.mjs");
  writeFileSync(
    scriptPath,
    `
import { readFileSync } from "node:fs";

const fixturePath = process.argv[2];
const lines = readFileSync(fixturePath, "utf8")
  .split("\\n")
  .map((line) => line.trim())
  .filter(Boolean);

for (const line of lines) {
  console.log(line);
}

setTimeout(() => process.exit(0), 20);
`,
    "utf8"
  );
  return scriptPath;
}

test("Kimi fixture 回放：可按样本发现会话并读取归一化历史", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-kimi-fixture-"));

  try {
    const fixture = materializeKimiSessionFixture(rootDir);
    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir,
      defaultModel: "kimi-k2"
    });

    const sessions = await adapter.detectSessions(fixture.workspaceDir);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].providerSessionId, fixture.sessionId);
    assert.equal(sessions[0].rawStoreRef, fixture.rawStoreRef);

    const history = await adapter.readSessionHistory(
      fixture.sessionId,
      fixture.rawStoreRef,
      null,
      20
    );
    const kinds = new Set(history.messages.map((message) => message.kind));
    assert.equal(history.messages.length, 5);
    assert.equal(kinds.has("text"), true);
    assert.equal(kinds.has("thinking"), true);
    assert.equal(kinds.has("tool_call"), true);
    assert.equal(kinds.has("tool_result"), true);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("Kimi fixture 回放：wire 事件样本可映射为统一 runtime 事件", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-kimi-runtime-fixture-"));

  try {
    const fixture = materializeKimiSessionFixture(rootDir);
    const runtimeFixturePath = join(FIXTURE_ROOT, "runtime-wire-events.jsonl");
    const replayScriptPath = createReplayScript(rootDir);
    const runtime = new KimiRuntimeAdapter({
      homeDir: fixture.homeDir,
      commandPath: process.execPath,
      baseArgs: [replayScriptPath, runtimeFixturePath]
    });
    const { events, sink } = createSink();

    const launch = await runtime.startSession(
      {
        sessionId: "runtime-session-1",
        workspaceId: "workspace-1",
        workspacePath: fixture.workspaceDir,
        provider: "kimi",
        providerSessionId: null,
        rawStoreRef: null,
        sequenceBase: 0,
        options: {
          content: "fixture runtime replay",
          clientRequestId: "client-runtime-fixture",
          model: "kimi-k2",
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }
      },
      sink
    );
    await launch.completed;

    const messageKinds = new Set(
      events
        .filter((event) => event.type === "message")
        .map((event) => event.message.kind)
    );

    assert.equal(messageKinds.has("text"), true);
    assert.equal(messageKinds.has("thinking"), true);
    assert.equal(messageKinds.has("tool_call"), true);
    assert.equal(messageKinds.has("tool_result"), true);
    assert.equal(events.some((event) => event.type === "complete"), true);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

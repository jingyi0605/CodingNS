import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LegnaRuntimeAdapter } from "../dist/runtime/legna-runtime.js";

function createRuntimeRequest(workspacePath, permissionMode, overrides = {}) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath,
    provider: "legna-code",
    providerSessionId: null,
    rawStoreRef: null,
    options: {
      content: "首条消息",
      clientRequestId: "client-1",
      model: null,
      reasoningLevel: null,
      permissionMode,
      providerPrompt: "首条消息",
      providerInstructionFilePath: null,
      attachments: [],
      ...overrides
    }
  };
}

function createCommandPath(rootDir, scriptPath) {
  if (process.platform !== "win32") {
    return scriptPath;
  }

  const launcherPath = join(rootDir, `${Date.now()}-legna-test.cmd`);
  writeFileSync(
    launcherPath,
    `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
    "utf8"
  );
  return launcherPath;
}

test("LegnaRuntimeAdapter 会注入 hook bridge settings 并透传 permissionMode", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-legna-hooks-"));
  const scriptPath = join(rootDir, "fake-legna-hooks.mjs");
  const argvPath = join(rootDir, "argv.json");
  const settingsPathCapture = join(rootDir, "settings.json.capture");
  const bridgeScriptPath = join(rootDir, "bridge.cjs");

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

const argv = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(argv), "utf8");
const settingsFlagIndex = argv.indexOf("--settings");
if (settingsFlagIndex !== -1 && argv[settingsFlagIndex + 1]) {
  const settingsPath = argv[settingsFlagIndex + 1];
  fs.writeFileSync(${JSON.stringify(settingsPathCapture)}, fs.readFileSync(settingsPath, "utf8"), "utf8");
}

const rl = readline.createInterface({ input: process.stdin });
rl.once("line", () => {
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "legna-session-1",
    timestamp: new Date().toISOString(),
    message: {
      content: [
        {
          type: "text",
          text: "ok"
        }
      ]
    }
  }) + "\\n");
  process.exit(0);
});
`,
    "utf8"
  );
  writeFileSync(bridgeScriptPath, "console.log('bridge');", "utf8");
  chmodSync(scriptPath, 0o755);
  const commandPath = createCommandPath(rootDir, scriptPath);

  const adapter = new LegnaRuntimeAdapter({
    homeDir: join(rootDir, ".legna-home"),
    commandPath,
    hookBridge: {
      url: "http://127.0.0.1:3002/api/providers/legna-code/hook-bridge/events",
      token: "token-1",
      scriptPath: bridgeScriptPath
    }
  });

  try {
    const launch = await adapter.startSession(
      createRuntimeRequest(rootDir, "acceptEdits"),
      {
        emit: async () => undefined,
        updateSessionBinding: () => undefined
      }
    );

    await launch.completed;

    const argv = JSON.parse(readFileSync(argvPath, "utf8"));
    const settingsFlagIndex = argv.indexOf("--settings");
    const permissionFlagIndex = argv.indexOf("--permission-mode");
    assert.notEqual(settingsFlagIndex, -1);
    assert.notEqual(permissionFlagIndex, -1);
    assert.equal(argv[permissionFlagIndex + 1], "acceptEdits");

    const settings = JSON.parse(readFileSync(settingsPathCapture, "utf8"));
    assert.ok(settings.hooks?.PreToolUse);
    assert.deepEqual(
      settings.hooks.PreToolUse.map((entry) => entry.matcher),
      ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"]
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

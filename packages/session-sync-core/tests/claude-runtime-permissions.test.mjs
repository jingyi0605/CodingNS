import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ClaudeRuntimeAdapter } from "../dist/runtime/claude-runtime.js";

function createRuntimeRequest(workspacePath, permissionMode) {
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
      permissionMode,
      providerPrompt: "首条消息",
      attachments: []
    }
  };
}

function createCommandPath(rootDir, scriptPath) {
  if (process.platform !== "win32") {
    return scriptPath;
  }

  const launcherPath = join(rootDir, `${Date.now()}-claude-test.cmd`);
  writeFileSync(
    launcherPath,
    `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
    "utf8"
  );
  return launcherPath;
}

test("ClaudeRuntimeAdapter 会把 permissionMode 映射到 CLI 参数", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-claude-perm-"));
  const scriptPath = join(rootDir, "fake-claude-permissions.mjs");
  const argvPath = join(rootDir, "argv.json");
  const homeDir = join(rootDir, ".claude");

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)), "utf8");

const rl = readline.createInterface({ input: process.stdin });

rl.once("line", () => {
  process.stdout.write(JSON.stringify({
    type: "assistant",
    session_id: "claude-session-1",
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
  chmodSync(scriptPath, 0o755);
  const commandPath = createCommandPath(rootDir, scriptPath);

  const adapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath
  });

  try {
    const launch = await adapter.startSession(
      createRuntimeRequest(rootDir, "bypassPermissions"),
      {
        emit: async () => undefined,
        updateSessionBinding: () => undefined
      }
    );

    await launch.completed;

    const argv = JSON.parse(readFileSync(argvPath, "utf8"));
    const permissionFlagIndex = argv.indexOf("--permission-mode");

    assert.notEqual(permissionFlagIndex, -1);
    assert.equal(argv[permissionFlagIndex + 1], "bypassPermissions");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ClaudeRuntimeAdapter 注入 PreToolUse hook bridge settings", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-claude-hooks-"));
  const scriptPath = join(rootDir, "fake-claude-hooks.mjs");
  const argvPath = join(rootDir, "argv.json");
  const settingsPathCapture = join(rootDir, "settings.json.capture");
  const homeDir = join(rootDir, ".claude");
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
    session_id: "claude-session-hooks-1",
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

  const adapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath,
    hookBridge: {
      url: "http://127.0.0.1:3002/api/providers/claude-code/hook-bridge/events",
      token: "token-1",
      scriptPath: bridgeScriptPath
    }
  });

  try {
    const launch = await adapter.startSession(
      createRuntimeRequest(rootDir, "default"),
      {
        emit: async () => undefined,
        updateSessionBinding: () => undefined
      }
    );

    await launch.completed;

    const argv = JSON.parse(readFileSync(argvPath, "utf8"));
    const settingsFlagIndex = argv.indexOf("--settings");
    assert.notEqual(settingsFlagIndex, -1);
    const settings = JSON.parse(readFileSync(settingsPathCapture, "utf8"));
    assert.ok(settings.hooks?.PreToolUse);
    assert.deepEqual(
      settings.hooks.PreToolUse.map((entry) => entry.matcher),
      ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"]
    );
    const hookCommand = settings.hooks.PreToolUse[0]?.hooks?.[0]?.command ?? "";
    assert.match(hookCommand, /bridge\.cjs/);
    assert.doesNotMatch(hookCommand, /claude-hook-bridge\.cmd/i);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

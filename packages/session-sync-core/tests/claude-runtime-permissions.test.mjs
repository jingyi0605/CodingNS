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

  const adapter = new ClaudeRuntimeAdapter({
    homeDir,
    commandPath: scriptPath
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

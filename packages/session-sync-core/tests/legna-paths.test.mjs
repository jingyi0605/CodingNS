import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LegnaCodeAdapter } from "../dist/index.js";

test("LegnaCodeAdapter 会把新会话写入工作区 .legna/sessions", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-legna-start-"));
  const workspacePath = join(tempDir, "workspace");

  try {
    mkdirSync(workspacePath, { recursive: true });

    const adapter = new LegnaCodeAdapter({
      homeDir: join(tempDir, ".legna-home"),
      legacyClaudeHomeDir: join(tempDir, ".claude-home")
    });
    const result = await adapter.startSession(workspacePath, {
      initialPrompt: "测试 Legna 本地会话路径"
    });

    assert.match(
      result.session.rawStoreRef.replaceAll("\\", "/"),
      /\/workspace\/\.legna\/sessions\/[0-9a-f-]+\.jsonl$/i
    );
    assert.equal(existsSync(result.session.rawStoreRef), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("LegnaCodeAdapter 会优先发现工作区 .legna/sessions 下的会话", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-legna-detect-"));
  const workspacePath = join(tempDir, "workspace");
  const workspaceSessionDir = join(workspacePath, ".legna", "sessions");
  const legnaHomeProjectDir = join(
    tempDir,
    ".legna-home",
    "projects",
    "-tmp-codingns-legna-detect-workspace"
  );
  const legacyClaudeProjectDir = join(
    tempDir,
    ".claude-home",
    "projects",
    "-tmp-codingns-legna-detect-workspace"
  );
  const workspaceSessionId = "11111111-1111-4111-8111-111111111111";
  const homeSessionId = "22222222-2222-4222-8222-222222222222";

  try {
    mkdirSync(workspaceSessionDir, { recursive: true });
    mkdirSync(legnaHomeProjectDir, { recursive: true });
    mkdirSync(legacyClaudeProjectDir, { recursive: true });

    writeFileSync(
      join(workspaceSessionDir, `${workspaceSessionId}.jsonl`),
      [
        JSON.stringify({
          type: "user",
          sessionId: workspaceSessionId,
          cwd: workspacePath,
          timestamp: "2026-04-25T12:00:00.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "工作区 Legna 会话" }]
          }
        }),
        JSON.stringify({
          type: "ai-title",
          sessionId: workspaceSessionId,
          aiTitle: "工作区 Legna 会话"
        })
      ].join("\n"),
      "utf8"
    );

    writeFileSync(
      join(legnaHomeProjectDir, `${homeSessionId}.jsonl`),
      [
        JSON.stringify({
          type: "user",
          sessionId: homeSessionId,
          cwd: workspacePath,
          timestamp: "2026-04-25T12:00:01.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "home Legna 会话" }]
          }
        }),
        JSON.stringify({
          type: "ai-title",
          sessionId: homeSessionId,
          aiTitle: "home Legna 会话"
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new LegnaCodeAdapter({
      homeDir: join(tempDir, ".legna-home"),
      legacyClaudeHomeDir: join(tempDir, ".claude-home")
    });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.provider, "legna-code");
    assert.equal(sessions[0]?.providerSessionId, workspaceSessionId);
    assert.equal(
      sessions[0]?.rawStoreRef,
      join(workspaceSessionDir, `${workspaceSessionId}.jsonl`)
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

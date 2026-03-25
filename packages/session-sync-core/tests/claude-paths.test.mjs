import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ClaudeCodeAdapter } from "../dist/index.js";

test("ClaudeCodeAdapter 会使用 Claude CLI 的项目目录命名规则", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-path-"));
  const workspacePath = "C:\\Code\\CodingNS";

  try {
    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const result = await adapter.startSession(workspacePath, {
      initialPrompt: "测试 Claude 路径"
    });

    assert.match(
      result.session.rawStoreRef.replaceAll("\\", "/"),
      /\/projects\/c--Code-CodingNS\/[0-9a-f-]+\.jsonl$/i
    );
    assert.equal(existsSync(result.session.rawStoreRef), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ClaudeCodeAdapter 会优先读取真实 Claude 项目目录下的会话", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-detect-"));
  const workspacePath = "C:\\Code\\CodingNS";
  const actualProjectDir = join(tempDir, "projects", "c--Code-CodingNS");
  const legacyProjectDir = join(tempDir, "projects", "c-code-codingns");
  const actualSessionId = "11111111-1111-4111-8111-111111111111";

  try {
    mkdirSync(actualProjectDir, { recursive: true });
    mkdirSync(legacyProjectDir, { recursive: true });
    writeFileSync(join(legacyProjectDir, "placeholder.jsonl"), "", "utf8");

    writeFileSync(
      join(actualProjectDir, `${actualSessionId}.jsonl`),
      `${JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        promptId: "prompt-1",
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "真实 Claude 会话" }]
        },
        uuid: "message-1",
        timestamp: "2026-03-25T00:00:00.000Z",
        cwd: workspacePath,
        sessionId: actualSessionId
      })}\n${JSON.stringify({
        type: "ai-title",
        sessionId: actualSessionId,
        aiTitle: "真实 Claude 会话"
      })}`,
      "utf8"
    );

    const adapter = new ClaudeCodeAdapter({ homeDir: tempDir });
    const sessions = await adapter.detectSessions(workspacePath);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.providerSessionId, actualSessionId);
    assert.equal(sessions[0]?.rawStoreRef, join(actualProjectDir, `${actualSessionId}.jsonl`));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

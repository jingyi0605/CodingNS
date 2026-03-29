import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CodexRuntimeAdapter } from "../dist/runtime/codex-runtime.js";

function createRunRequest(overrides = {}) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    provider: "codex",
    providerSessionId: "thread-1",
    rawStoreRef: "/tmp/codex-real/session.jsonl",
    sequenceBase: 5,
    options: {
      content: "请继续",
      clientRequestId: "client-1",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      providerPrompt: null,
      attachments: []
    },
    ...overrides
  };
}

test("CodexRuntimeAdapter 生成运行时消息时会接续 sequenceBase", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-runtime-sequence-"));
  const rawStoreRef = join(tempDir, "sessions", "2026", "03", "29", "session.jsonl");
  const emitted = [];
  const adapter = new CodexRuntimeAdapter({ homeDir: tempDir });

  mkdirSync(join(tempDir, "sessions", "2026", "03", "29"), { recursive: true });
  writeFileSync(rawStoreRef, "", "utf8");

  try {
    await adapter.runTurn(
      null,
      createRunRequest({
        rawStoreRef,
        sequenceBase: 5
      }),
      {
        async emit(event) {
          emitted.push(event);
        },
        updateSessionBinding() {}
      },
      "thread-1",
      rawStoreRef,
      new AbortController(),
      {
        async next() {
          return {
            done: true,
            value: undefined
          };
        }
      },
      [
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: "Codex 已处理完成"
          }
        }
      ],
      Date.now()
    );

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.type, "message");
    assert.equal(emitted[0]?.message.sequence, 6);
    assert.equal(emitted[0]?.message.role, "assistant");
    assert.equal(emitted[0]?.message.content, "Codex 已处理完成");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

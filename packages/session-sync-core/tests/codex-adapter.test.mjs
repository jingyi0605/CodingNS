import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CodexAdapter } from "../dist/index.js";

test("CodexAdapter 会优先保留 response_item，并忽略末尾空白差异导致的重复消息", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-adapter-"));
  const sessionFile = join(tempDir, "session.jsonl");

  try {
    const lines = [
      JSON.stringify({
        timestamp: "2026-03-23T15:17:05.614Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "用户消息" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T15:17:05.614Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "用户消息\n"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T15:17:41.897Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "助手消息"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T15:17:41.898Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "助手消息" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T15:17:50.000Z",
        type: "event_msg",
        payload: {
          type: "agent_reasoning",
          text: "思考消息"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T15:17:50.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "思考消息" }]
        }
      })
    ];

    writeFileSync(sessionFile, lines.join("\n"), "utf8");

    const adapter = new CodexAdapter({ homeDir: tempDir });
    const page = await adapter.readSessionHistory("session-1", sessionFile, null, 50);

    assert.equal(page.messages.length, 3);
    assert.deepEqual(
      page.messages.map((message) => ({
        role: message.role,
        kind: message.kind,
        content: message.content,
        sequence: message.sequence,
        rawRef: message.rawRef
      })),
      [
        {
          role: "user",
          kind: "text",
          content: "用户消息",
          sequence: 1,
          rawRef: `codex://${sessionFile.replaceAll("\\", "/")}#line=1`
        },
        {
          role: "assistant",
          kind: "text",
          content: "助手消息",
          sequence: 2,
          rawRef: `codex://${sessionFile.replaceAll("\\", "/")}#line=4`
        },
        {
          role: "assistant",
          kind: "thinking",
          content: "思考消息",
          sequence: 3,
          rawRef: `codex://${sessionFile.replaceAll("\\", "/")}#line=6`
        }
      ]
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

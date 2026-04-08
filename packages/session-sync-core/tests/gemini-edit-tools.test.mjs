import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GeminiAdapter } from "../dist/index.js";
import { GeminiRuntimeAdapter } from "../dist/runtime/gemini-runtime.js";

function createScript(tempDir, body) {
  const scriptPath = join(tempDir, `gemini-${Math.random().toString(16).slice(2)}.mjs`);
  writeFileSync(scriptPath, body, "utf8");
  return scriptPath;
}

function createRunRequest(workspacePath) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath,
    provider: "gemini",
    providerSessionId: null,
    rawStoreRef: null,
    sequenceBase: 0,
    options: {
      content: "continue",
      clientRequestId: "client-1",
      model: "flash",
      reasoningLevel: null,
      permissionMode: "acceptEdits",
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
      updateSessionBinding() {},
      async emit(event) {
        events.push(event);
      }
    }
  };
}

test("GeminiAdapter 会把 write_file toolCalls 转成 apply_patch", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-gemini-edit-tools-"));
  const homeDir = join(rootDir, "gemini-home");
  const workspaceDir = join(rootDir, "workspace-alpha");
  const projectDir = join(homeDir, "tmp", "codingns");
  const chatFile = join(projectDir, "chats", "session-write-file.json");

  try {
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(join(projectDir, "chats"), { recursive: true });
    writeFileSync(join(projectDir, ".project_root"), workspaceDir, "utf8");
    writeFileSync(
      chatFile,
      JSON.stringify({
        sessionId: "session-write-file",
        lastUpdated: "2026-04-08T12:52:46.292Z",
        messages: [
          {
            id: "msg-user",
            timestamp: "2026-04-08T12:52:08.955Z",
            type: "user",
            content: [{ text: "请写文件" }]
          },
          {
            id: "msg-assistant",
            timestamp: "2026-04-08T12:52:46.292Z",
            type: "gemini",
            content: "文件已写入。",
            toolCalls: [
              {
                id: "write-file-1",
                name: "write_file",
                args: {
                  file_path: "tmp/demo.md",
                  content: "# demo"
                },
                result: [
                  {
                    functionResponse: {
                      id: "write-file-1",
                      name: "write_file",
                      response: {
                        output: "Successfully created tmp/demo.md"
                      }
                    }
                  }
                ],
                status: "success",
                timestamp: "2026-04-08T12:52:36.316Z"
              }
            ]
          }
        ]
      }),
      "utf8"
    );

    const adapter = new GeminiAdapter({
      homeDir,
      listSessions: async () => []
    });
    const page = await adapter.readSessionHistory(
      "session-write-file",
      "gemini://session/session-write-file",
      null,
      20
    );

    const toolCall = page.messages.find((message) => message.kind === "tool_call");
    const toolResult = page.messages.find((message) => message.kind === "tool_result");

    assert.equal(toolCall?.role, "tool");
    assert.equal(toolCall?.toolCall?.name, "apply_patch");
    assert.equal(toolCall?.toolCall?.input.includes("*** Add File: tmp/demo.md"), true);
    assert.equal(toolResult?.toolCall?.name, "apply_patch");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("GeminiRuntimeAdapter 会把 write_file runtime 事件转成 apply_patch", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-gemini-edit-runtime-"));
  const scriptPath = createScript(
    tempDir,
    `
console.log(JSON.stringify({ type: "init", session_id: "gemini-session-write", model: "flash" }));
console.log(JSON.stringify({
  type: "tool_use",
  tool_name: "write_file",
  tool_id: "tool-write-1",
  parameters: {
    file_path: "tmp/demo.md",
    content: "# demo"
  }
}));
console.log(JSON.stringify({
  type: "tool_result",
  tool_id: "tool-write-1",
  status: "success",
  output: "Successfully created tmp/demo.md"
}));
setTimeout(() => process.exit(0), 20);
`
  );

  try {
    const adapter = new GeminiRuntimeAdapter({
      homeDir: tempDir,
      commandPath: process.execPath,
      baseArgs: [scriptPath]
    });
    const { sink, events } = createSink();

    const launch = await adapter.startSession(createRunRequest(tempDir), sink);
    await launch.completed;

    const toolCall = events.find(
      (event) => event.type === "message" && event.message.kind === "tool_call"
    );
    const toolResult = events.find(
      (event) => event.type === "message" && event.message.kind === "tool_result"
    );

    assert.equal(toolCall?.message.role, "tool");
    assert.equal(toolCall?.message.toolCall?.name, "apply_patch");
    assert.equal(toolCall?.message.toolCall?.input.includes("*** Add File: tmp/demo.md"), true);
    assert.equal(toolResult?.message.toolCall?.name, "apply_patch");
    assert.equal(toolResult?.message.toolCall?.output, "Successfully created tmp/demo.md");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

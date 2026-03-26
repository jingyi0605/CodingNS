import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { OpenCodeAdapter } from "../dist/index.js";

test("OpenCodeAdapter 会暴露 OpenCode 已接入后的能力边界", () => {
  const adapter = new OpenCodeAdapter({ dbPath: "/tmp/codingns-opencode.db" });
  const capabilities = adapter.getProviderCapabilities();

  assert.equal(capabilities.provider, "opencode");
  assert.equal(capabilities.canStartSession, true);
  assert.equal(capabilities.canResumeSession, true);
  assert.equal(capabilities.canSendMessage, true);
  assert.equal(capabilities.supportsStructuredToolCalls, true);
  assert.equal(capabilities.supportsInterrupt, true);
  assert.equal(capabilities.supportsAsyncPrompt, true);
  assert.equal(capabilities.supportsNativeAgents, true);
  assert.equal(capabilities.inRunInputMode, "none");
});

test("OpenCodeAdapter 能按 workspace 发现会话并返回稳定 rawStoreRef", async () => {
  const fixture = createOpenCodeFixture();

  try {
    const adapter = new OpenCodeAdapter({ dbPath: fixture.dbPath });
    const sessions = await adapter.detectSessions("/workspace/demo");

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.provider, "opencode");
    assert.equal(sessions[0]?.providerSessionId, "ses_demo");
    assert.equal(sessions[0]?.workspacePath, "/workspace/demo");
    assert.equal(sessions[0]?.rawStoreRef, "opencode://session/ses_demo");
    assert.equal(sessions[0]?.messageCount, 2);
    assert.equal(sessions[0]?.isArchived, false);
  } finally {
    fixture.dispose();
  }
});

test("OpenCodeAdapter 能把核心 part 类型映射到统一消息模型", async () => {
  const fixture = createOpenCodeFixture();

  try {
    const adapter = new OpenCodeAdapter({ dbPath: fixture.dbPath });
    const page = await adapter.readSessionHistory(
      "ses_demo",
      "opencode://session/ses_demo",
      null,
      50
    );

    assert.equal(page.messages.length, 7);
    assert.equal(page.messages[0]?.role, "user");
    assert.equal(page.messages[0]?.kind, "text");
    assert.equal(page.messages[0]?.content, "你好，OpenCode");

    assert.equal(page.messages[1]?.kind, "thinking");
    assert.equal(page.messages[1]?.content, "Step started");

    assert.equal(page.messages[2]?.kind, "thinking");
    assert.equal(page.messages[2]?.content, "先分析一下问题");

    assert.equal(page.messages[3]?.kind, "tool_call");
    assert.equal(page.messages[3]?.toolCall?.name, "bash");
    assert.equal(page.messages[3]?.toolCall?.status, "running");

    assert.equal(page.messages[4]?.kind, "tool_result");
    assert.equal(page.messages[4]?.toolCall?.status, "completed");
    assert.equal(page.messages[4]?.content.includes("README.md"), true);

    assert.equal(page.messages[5]?.kind, "text");
    assert.equal(page.messages[5]?.content.includes("[patch]"), true);

    assert.equal(page.messages[6]?.kind, "thinking");
    assert.equal(page.messages[6]?.content, "Step finished: stop");
    assert.equal(
      page.messages[4]?.rawRef,
      "opencode://session/ses_demo/message/msg_demo_assistant/part/prt_demo_tool_done"
    );
    assert.equal(page.messages[6]?.sequence, 7);
    assert.equal(page.nextCursor, null);
  } finally {
    fixture.dispose();
  }
});

test("OpenCodeAdapter 的历史分页支持 backward 读取", async () => {
  const fixture = createOpenCodeFixture();

  try {
    const adapter = new OpenCodeAdapter({ dbPath: fixture.dbPath });
    const page = await adapter.readSessionHistory(
      "ses_demo",
      "opencode://session/ses_demo",
      null,
      2,
      "backward"
    );

    assert.equal(page.messages.length, 2);
    assert.equal(page.messages[0]?.content.includes("[patch]"), true);
    assert.equal(page.messages[1]?.content, "Step finished: stop");
    assert.ok(page.nextCursor);
  } finally {
    fixture.dispose();
  }
});

function createOpenCodeFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-opencode-adapter-"));
  const dbPath = join(tempDir, "opencode.db");
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      share_url TEXT,
      summary_additions INTEGER,
      summary_deletions INTEGER,
      summary_files INTEGER,
      summary_diffs TEXT,
      revert TEXT,
      permission TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      time_compacting INTEGER,
      time_archived INTEGER,
      workspace_id TEXT
    );

    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  db.prepare(
    `INSERT INTO session (
      id,
      project_id,
      parent_id,
      slug,
      directory,
      title,
      version,
      time_created,
      time_updated,
      time_archived,
      workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "ses_demo",
    "global",
    null,
    "demo",
    "/workspace/demo",
    "Demo Session",
    "v1",
    1_700_000_000_000,
    1_700_000_020_000,
    null,
    null
  );

  db.prepare(
    `INSERT INTO session (
      id,
      project_id,
      parent_id,
      slug,
      directory,
      title,
      version,
      time_created,
      time_updated,
      time_archived,
      workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "ses_other",
    "global",
    null,
    "other",
    "/workspace/other",
    "Other Session",
    "v1",
    1_700_000_100_000,
    1_700_000_110_000,
    null,
    null
  );

  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "msg_demo_user",
    "ses_demo",
    1_700_000_001_000,
    1_700_000_001_200,
    JSON.stringify({
      role: "user",
      time: {
        created: 1_700_000_001_000
      }
    })
  );
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_000,
    1_700_000_020_000,
    JSON.stringify({
      role: "assistant",
      time: {
        created: 1_700_000_002_000,
        completed: 1_700_000_020_000
      }
    })
  );
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "msg_other_user",
    "ses_other",
    1_700_000_100_200,
    1_700_000_100_200,
    JSON.stringify({
      role: "user",
      time: {
        created: 1_700_000_100_200
      }
    })
  );

  const insertPart = db.prepare(
    `INSERT INTO part (
      id,
      message_id,
      session_id,
      time_created,
      time_updated,
      data
    ) VALUES (?, ?, ?, ?, ?, ?)`
  );

  insertPart.run(
    "prt_demo_user_text",
    "msg_demo_user",
    "ses_demo",
    1_700_000_001_100,
    1_700_000_001_100,
    JSON.stringify({
      type: "text",
      text: "你好，OpenCode"
    })
  );
  insertPart.run(
    "prt_demo_step_start",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_100,
    1_700_000_002_100,
    JSON.stringify({
      type: "step-start"
    })
  );
  insertPart.run(
    "prt_demo_reasoning",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_200,
    1_700_000_002_200,
    JSON.stringify({
      type: "reasoning",
      text: "先分析一下问题"
    })
  );
  insertPart.run(
    "prt_demo_tool_running",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_300,
    1_700_000_002_300,
    JSON.stringify({
      type: "tool",
      callID: "call-1",
      tool: "bash",
      state: {
        status: "running",
        input: {
          command: "ls"
        }
      }
    })
  );
  insertPart.run(
    "prt_demo_tool_done",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_400,
    1_700_000_002_400,
    JSON.stringify({
      type: "tool",
      callID: "call-1",
      tool: "bash",
      state: {
        status: "completed",
        input: {
          command: "ls"
        },
        output: "README.md\nsrc"
      }
    })
  );
  insertPart.run(
    "prt_demo_patch",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_500,
    1_700_000_002_500,
    JSON.stringify({
      type: "patch"
    })
  );
  insertPart.run(
    "prt_demo_step_finish",
    "msg_demo_assistant",
    "ses_demo",
    1_700_000_002_600,
    1_700_000_002_600,
    JSON.stringify({
      type: "step-finish",
      reason: "stop"
    })
  );
  insertPart.run(
    "prt_other_text",
    "msg_other_user",
    "ses_other",
    1_700_000_100_300,
    1_700_000_100_300,
    JSON.stringify({
      type: "text",
      text: "other"
    })
  );

  db.close();

  return {
    dbPath,
    dispose() {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

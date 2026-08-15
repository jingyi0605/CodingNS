import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KimiAdapter } from "../dist/providers/kimi.js";

function createKimiFixture() {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-kimi-provider-"));
  const workspaceDir = join(rootDir, "workspace-a");
  const otherWorkspaceDir = join(rootDir, "workspace-b");
  const homeDir = join(rootDir, "kimi-home");
  const sessionDir = join(homeDir, "sessions", "hash-a", "kimi-session-1");
  const otherSessionDir = join(homeDir, "sessions", "hash-b", "kimi-session-2");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(otherWorkspaceDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(otherSessionDir, { recursive: true });

  writeFileSync(
    join(sessionDir, "state.json"),
    JSON.stringify({
      sessionId: "kimi-session-1",
      title: "Kimi 主会话",
      cwd: workspaceDir,
      archived: false
    }),
    "utf8"
  );

  writeFileSync(
    join(sessionDir, "context.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-04-03T08:00:00.000Z",
        role: "user",
        content: [{ type: "text", text: "先看 context" }],
        cwd: workspaceDir
      }),
      JSON.stringify({
        timestamp: "2026-04-03T08:00:02.000Z",
        role: "assistant",
        content: [{ type: "text", text: "context 已读取" }],
        cwd: workspaceDir
      })
    ].join("\n"),
    "utf8"
  );

  writeFileSync(
    join(sessionDir, "wire.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-04-03T08:00:03.000Z",
        role: "assistant",
        content: [{ type: "thinking", text: "先分析事件" }]
      }),
      JSON.stringify({
        timestamp: "2026-04-03T08:00:04.000Z",
        role: "assistant",
        content: [
          {
            type: "tool_call",
            id: "call-1",
            name: "read_file",
            input: { path: "README.md" }
          }
        ]
      }),
      JSON.stringify({
        timestamp: "2026-04-03T08:00:05.000Z",
        role: "tool",
        content: [
          {
            type: "tool_result",
            call_id: "call-1",
            output: "README 内容"
          }
        ]
      })
    ].join("\n"),
    "utf8"
  );

  writeFileSync(
    join(otherSessionDir, "state.json"),
    JSON.stringify({
      sessionId: "kimi-session-2",
      title: "其他工作区会话",
      cwd: otherWorkspaceDir,
      archived: false
    }),
    "utf8"
  );

  writeFileSync(
    join(otherSessionDir, "context.jsonl"),
    JSON.stringify({
      timestamp: "2026-04-03T08:10:00.000Z",
      role: "user",
      content: [{ type: "text", text: "other" }],
      cwd: otherWorkspaceDir
    }),
    "utf8"
  );

  return {
    rootDir,
    workspaceDir,
    homeDir,
    sessionDir
  };
}

function createModernKimiFixture() {
  const rootDir = mkdtempSync(join(tmpdir(), "codingns-kimi-provider-modern-"));
  const workspaceDir = join(rootDir, "workspace-modern");
  const homeDir = join(rootDir, "kimi-home");
  const sessionId = "modern-session-1";
  const workDirHash = createHash("md5").update(workspaceDir).digest("hex");
  const sessionDir = join(homeDir, "sessions", workDirHash, sessionId);

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });

  writeFileSync(
    join(homeDir, "kimi.json"),
    JSON.stringify({
      work_dirs: [
        {
          path: workspaceDir,
          kaos: "local",
          last_session_id: sessionId
        }
      ]
    }),
    "utf8"
  );

  writeFileSync(
    join(sessionDir, "state.json"),
    JSON.stringify({
      custom_title: "新版 Kimi 会话",
      archived: false
    }),
    "utf8"
  );

  writeFileSync(
    join(sessionDir, "context.jsonl"),
    [
      JSON.stringify({
        role: "_system_prompt",
        content: "system prompt"
      }),
      JSON.stringify({
        timestamp: 1775659487.0,
        role: "user",
        content: "对话测试"
      }),
      JSON.stringify({
        timestamp: 1775659488.0,
        role: "assistant",
        content: "你好，Kimi 会话已经建立。"
      })
    ].join("\n"),
    "utf8"
  );

  return {
    rootDir,
    workspaceDir,
    homeDir,
    sessionId
  };
}

test("KimiAdapter 按工作区发现会话并保留原生 session id", async () => {
  const fixture = createKimiFixture();

  try {
    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir,
      defaultModel: "kimi-k2"
    });
    const sessions = await adapter.detectSessions(fixture.workspaceDir);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].provider, "kimi");
    assert.equal(sessions[0].providerSessionId, "kimi-session-1");
    assert.equal(sessions[0].rawStoreRef, "kimi://session/kimi-session-1");
    assert.equal(sessions[0].title, "Kimi 主会话");
    assert.equal(sessions[0].messageCount, 5);
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("KimiAdapter 支持通过 kimi.json work_dirs 识别新版会话工作区", async () => {
  const fixture = createModernKimiFixture();

  try {
    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir
    });
    const sessions = await adapter.detectSessions(fixture.workspaceDir);
    const history = await adapter.readSessionHistory(
      fixture.sessionId,
      `kimi://session/${fixture.sessionId}`,
      null,
      20
    );

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].providerSessionId, fixture.sessionId);
    assert.equal(sessions[0].workspacePath, fixture.workspaceDir);
    assert.equal(sessions[0].title, "新版 Kimi 会话");
    assert.equal(sessions[0].rawStoreRef, `kimi://session/${fixture.sessionId}`);
    assert.equal(sessions[0].lastMessageAt.startsWith("2026-04-08T"), true);
    assert.equal(sessions[0].messageCount, 2);
    assert.equal(history.messages[0]?.role, "user");
    assert.equal(history.messages[0]?.content, "对话测试");
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("KimiAdapter 读取历史时会归一化 text/thinking/tool", async () => {
  const fixture = createKimiFixture();

  try {
    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir
    });
    const page = await adapter.readSessionHistory(
      "kimi-session-1",
      "kimi://session/kimi-session-1",
      null,
      20
    );

    const kinds = new Set(page.messages.map((message) => message.kind));
    assert.equal(page.messages.length, 5);
    assert.equal(kinds.has("text"), true);
    assert.equal(kinds.has("thinking"), true);
    assert.equal(kinds.has("tool_call"), true);
    assert.equal(kinds.has("tool_result"), true);
    const toolCallMessage = page.messages.find((message) => message.kind === "tool_call");
    const toolResultMessage = page.messages.find((message) => message.kind === "tool_result");
    assert.equal(toolCallMessage?.toolCall?.callId, "call-1");
    assert.equal(toolCallMessage?.toolCall?.name, "read_file");
    assert.equal(toolCallMessage?.toolCall?.input.includes("README.md"), true);
    assert.equal(toolResultMessage?.toolCall?.callId, "call-1");
    assert.equal(toolResultMessage?.toolCall?.output, "README 内容");
    assert.equal(
      page.messages.every((message) => message.rawRef.startsWith("kimi://session/kimi-session-1/")),
      true
    );
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("KimiAdapter 在历史 JSONL 损坏时返回结构化解析错误", async () => {
  const fixture = createKimiFixture();

  try {
    writeFileSync(
      join(fixture.sessionDir, "context.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-04-03T09:00:00.000Z",
          role: "user",
          content: [{ type: "text", text: "ok" }],
          cwd: fixture.workspaceDir
        }),
        "{not-valid-json"
      ].join("\n"),
      "utf8"
    );

    const adapter = new KimiAdapter({ homeDir: fixture.homeDir });

    await assert.rejects(
      () =>
        adapter.readSessionHistory(
          "kimi-session-1",
          "kimi://session/kimi-session-1",
          null,
          20
        ),
      /KIMI_HISTORY_PARSE_ERROR session=kimi-session-1 file=context\.jsonl:2/
    );
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("KimiAdapter capability 会声明单轮命令模式与阶段限制", () => {
  const adapter = new KimiAdapter({
    homeDir: "/tmp/.kimi",
    defaultModel: "kimi-k2"
  });
  const capabilities = adapter.getProviderCapabilities();

  assert.equal(capabilities.inRunInputMode, "none");
  assert.equal(capabilities.canSendMessage, true);
  assert.equal(capabilities.supportsInterrupt, true);
  assert.equal(
    capabilities.limitations.some((item) => item.includes("单轮命令模式")),
    true
  );
});

test("KimiAdapter 在没有稳定 usage 协议前不提供会话统计", async () => {
  const adapter = new KimiAdapter({ homeDir: "/tmp/.kimi" });

  await assert.doesNotReject(async () => {
    assert.equal(await adapter.readSessionStats("kimi-session-1", "kimi://session/kimi-session-1"), null);
  });
});

test("KimiAdapter discovery 第二轮会复用 mtime/size 摘要缓存", async () => {
  const fixture = createKimiFixture();

  try {
    const adapter = new KimiAdapter({
      homeDir: fixture.homeDir
    });
    const firstSessions = await adapter.detectSessions(fixture.workspaceDir);

    assert.equal(firstSessions.length, 1);

    adapter.buildSessionSummary = () => {
      throw new Error("should not rebuild unchanged kimi summary");
    };

    const secondSessions = await adapter.detectSessions(fixture.workspaceDir);

    assert.equal(secondSessions.length, 1);
    assert.equal(secondSessions[0]?.providerSessionId, "kimi-session-1");
    assert.equal(secondSessions[0]?.title, "Kimi 主会话");
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

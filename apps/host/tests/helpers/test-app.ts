import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveHostConfig } from "../../src/config/env.js";
import { createServer } from "../../src/server/create-server.js";

export interface ProviderFixture {
  rootDir: string;
  workspaceDir: string;
  claudeHomeDir: string;
  codexHomeDir: string;
  claudeSessionFile: string;
  codexSessionFile: string;
}

export interface EmptyFixture {
  rootDir: string;
  workspaceDir: string;
  claudeHomeDir: string;
  codexHomeDir: string;
}

export function createProviderFixture(): ProviderFixture {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-spec002-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const claudeHomeDir = path.join(rootDir, "claude-home");
  const codexHomeDir = path.join(rootDir, "codex-home");
  const claudeProjectDir = path.join(claudeHomeDir, "projects", "c--Fixtures-Workspace");
  const codexSessionDir = path.join(codexHomeDir, "sessions", "2026", "03", "23");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(claudeProjectDir, { recursive: true });
  mkdirSync(codexSessionDir, { recursive: true });

  const claudeSessionFile = path.join(claudeProjectDir, "claude-session-1.jsonl");
  const codexSessionFile = path.join(codexSessionDir, "codex-session-1.jsonl");

  writeFileSync(
    claudeSessionFile,
    [
      JSON.stringify({
        type: "user",
        sessionId: "claude-session-1",
        cwd: workspaceDir,
        timestamp: "2026-03-23T08:00:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "请整理 spec002 的边界" }]
        }
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "claude-session-1",
        cwd: workspaceDir,
        timestamp: "2026-03-23T08:00:10.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "边界已经确认，只做会话同步核心。" }]
        }
      }),
      JSON.stringify({
        type: "ai-title",
        sessionId: "claude-session-1",
        aiTitle: "Claude 样本会话"
      })
    ].join("\n"),
    "utf8"
  );

  writeFileSync(
    codexSessionFile,
    [
      JSON.stringify({
        timestamp: "2026-03-23T09:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-session-1",
          timestamp: "2026-03-23T09:00:00.000Z",
          cwd: workspaceDir,
          originator: "Codex",
          source: "test"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T09:00:05.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "继续实现 spec002"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T09:00:08.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "已开始接入 provider registry。"
        }
      })
    ].join("\n"),
    "utf8"
  );

  return {
    rootDir,
    workspaceDir,
    claudeHomeDir,
    codexHomeDir,
    claudeSessionFile,
    codexSessionFile
  };
}

export function createEmptyFixture(): EmptyFixture {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-host-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const claudeHomeDir = path.join(rootDir, "claude-home");
  const codexHomeDir = path.join(rootDir, "codex-home");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(claudeHomeDir, { recursive: true });
  mkdirSync(codexHomeDir, { recursive: true });

  return {
    rootDir,
    workspaceDir,
    claudeHomeDir,
    codexHomeDir
  };
}

export function destroyFixture(context: { rootDir: string }): void {
  rmSync(context.rootDir, { recursive: true, force: true });
}

export function createTestApp(fixture: { claudeHomeDir: string; codexHomeDir: string }) {
  return createServer(
    resolveHostConfig({
      databasePath: ":memory:",
      accessTokenTtlSeconds: 2,
      refreshTokenTtlSeconds: 30,
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    })
  );
}

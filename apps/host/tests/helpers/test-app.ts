import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveHostConfig, type HostConfig } from "../../src/config/env.js";
import { createServer } from "../../src/server/create-server.js";
import { createId } from "../../src/shared/utils/id.js";

export interface ProviderFixture {
  rootDir: string;
  workspaceDir: string;
  claudeHomeDir: string;
  codexHomeDir: string;
  geminiHomeDir: string;
  kimiHomeDir: string;
  claudeSessionFile: string;
  codexSessionFile: string;
}

export interface EmptyFixture {
  rootDir: string;
  workspaceDir: string;
  claudeHomeDir: string;
  codexHomeDir: string;
  geminiHomeDir: string;
  kimiHomeDir: string;
}

export interface GitWorkspaceFixture extends EmptyFixture {
  workspaceId: string;
  repoDir: string;
  remoteDir?: string;
}

export function createProviderFixture(): ProviderFixture {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-spec002-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const claudeHomeDir = path.join(rootDir, "claude-home");
  const codexHomeDir = path.join(rootDir, "codex-home");
  const geminiHomeDir = path.join(rootDir, "gemini-home");
  const kimiHomeDir = path.join(rootDir, "kimi-home");
  const claudeProjectDir = path.join(claudeHomeDir, "projects", "c--Fixtures-Workspace");
  const codexSessionDir = path.join(codexHomeDir, "sessions", "2026", "03", "23");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(claudeProjectDir, { recursive: true });
  mkdirSync(codexSessionDir, { recursive: true });
  mkdirSync(geminiHomeDir, { recursive: true });
  mkdirSync(kimiHomeDir, { recursive: true });

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
        type: "progress",
        sessionId: "claude-session-1",
        cwd: workspaceDir,
        timestamp: "2026-03-23T08:00:12.000Z",
        data: {
          type: "agent_progress",
          message: {
            type: "assistant",
            timestamp: "2026-03-23T08:00:12.000Z",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_fixture_1",
                  name: "Read",
                  input: {
                    file_path: `${workspaceDir}\\README.md`
                  }
                }
              ]
            }
          }
        }
      }),
      JSON.stringify({
        type: "progress",
        sessionId: "claude-session-1",
        cwd: workspaceDir,
        timestamp: "2026-03-23T08:00:13.000Z",
        data: {
          type: "agent_progress",
          message: {
            type: "user",
            timestamp: "2026-03-23T08:00:13.000Z",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_fixture_1",
                  content: "README fixture content"
                }
              ]
            }
          }
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
          message: "已开始接入 provider registry"
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T09:00:10.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-shell-1",
          name: "shell_command",
          arguments: {
            command: "git status --short"
          }
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-23T09:00:12.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-shell-1",
          output: "Exit code: 0\nWall time: 0.2 seconds\nOutput:\nerror_code: 0\n M src/main.ts"
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
    geminiHomeDir,
    kimiHomeDir,
    claudeSessionFile,
    codexSessionFile
  };
}

export function createEmptyFixture(): EmptyFixture {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-host-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const claudeHomeDir = path.join(rootDir, "claude-home");
  const codexHomeDir = path.join(rootDir, "codex-home");
  const geminiHomeDir = path.join(rootDir, "gemini-home");
  const kimiHomeDir = path.join(rootDir, "kimi-home");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(claudeHomeDir, { recursive: true });
  mkdirSync(codexHomeDir, { recursive: true });
  mkdirSync(geminiHomeDir, { recursive: true });
  mkdirSync(kimiHomeDir, { recursive: true });

  return {
    rootDir,
    workspaceDir,
    claudeHomeDir,
    codexHomeDir,
    geminiHomeDir,
    kimiHomeDir
  };
}

export function createGitWorkspaceFixture(options: { withRemote?: boolean } = {}): GitWorkspaceFixture {
  const fixture = createEmptyFixture();
  const workspaceId = createId();
  const repoDir = fixture.workspaceDir;

  runGit(repoDir, ["init", "--initial-branch=main"]);
  runGit(repoDir, ["config", "user.name", "CodingNS Test"]);
  runGit(repoDir, ["config", "user.email", "codingns@example.com"]);
  writeFileSync(path.join(repoDir, "README.md"), "# 标题\n\n第一行\n", "utf8");
  runGit(repoDir, ["add", "README.md"]);
  runGit(repoDir, ["commit", "-m", "chore(init): 初始化仓库", "-m", "- 初始提交", "-m", "Refs: #1"]);
  writeFileSync(path.join(repoDir, "README.md"), "# 标题\n\n第一行\n第二行改动\n", "utf8");

  let remoteDir: string | undefined;

  if (options.withRemote) {
    remoteDir = path.join(fixture.rootDir, "remote.git");
    runGit(fixture.rootDir, ["init", "--bare", remoteDir]);
    runGit(repoDir, ["remote", "add", "origin", remoteDir]);
  }

  return {
    ...fixture,
    workspaceId,
    repoDir,
    remoteDir
  };
}

export function destroyFixture(context: { rootDir: string }): void {
  rmSync(context.rootDir, { recursive: true, force: true });
}

export function createTestApp(
  fixture: { claudeHomeDir: string; codexHomeDir: string; geminiHomeDir: string; kimiHomeDir: string },
  overrides: Partial<HostConfig> = {}
) {
  return createServer(
    resolveHostConfig({
      databasePath: ":memory:",
      accessTokenTtlSeconds: 2,
      refreshTokenTtlSeconds: 30,
      terminalIdleTimeoutSeconds: 900,
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir,
      geminiHomeDir: fixture.geminiHomeDir,
      kimiHomeDir: fixture.kimiHomeDir,
      ...overrides
    })
  );
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    env: process.env,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} 执行失败`);
  }
}

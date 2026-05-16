import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSessionRuntimeContextService } from "../../src/modules/sessions/workspace-session-runtime-context-service.js";

const tempDirs: string[] = [];

describe("WorkspaceSessionRuntimeContextService", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const target = tempDirs.pop();

      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  it("会为工作区会话生成组合说明文件、scoped 认证文件和专用 skill 副本", () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "codingns-workspace-session-runtime-"));
    const codexHomeDir = mkdtempSync(path.join(tmpdir(), "codingns-workspace-session-codex-home-"));
    const runtimeStorageRootDir = mkdtempSync(path.join(tmpdir(), "codingns-workspace-session-global-runtime-"));
    tempDirs.push(workspacePath);
    tempDirs.push(codexHomeDir);
    tempDirs.push(runtimeStorageRootDir);
    writeFileSync(
      path.join(workspacePath, "AGENTS.md"),
      "# 项目规则\n\n<INSTRUCTIONS>\n始终使用中文\n</INSTRUCTIONS>\n",
      "utf8"
    );
    mkdirSync(path.join(codexHomeDir, "skills", "demo"), { recursive: true });
    writeFileSync(path.join(codexHomeDir, "auth.json"), "{\n  \"openai\": true\n}\n", "utf8");
    writeFileSync(path.join(codexHomeDir, "config.toml"), "model = \"gpt-5-codex\"\n", "utf8");
    writeFileSync(path.join(codexHomeDir, "skills", "demo", "SKILL.md"), "# Demo\n", "utf8");

    const service = new WorkspaceSessionRuntimeContextService({
      ensureWorkspaceCredential: vi.fn(({ runtimeHomeDir }: { runtimeHomeDir: string }) => {
        const credential = {
          apiBaseUrl: "http://127.0.0.1:3002",
          accessToken: "workspace-token",
          issuedAt: "2026-05-16T10:00:00.000Z",
          expiresAt: "2026-05-23T10:00:00.000Z",
          userId: "user-1",
          workspaceId: "workspace-1",
          projectId: null,
          sessionId: "session-1",
          callerKind: "workspace_session" as const,
          capabilityProfile: "workspace-scoped" as const
        };

        return credential;
      }),
      getCredentialFilePath: vi.fn((runtimeHomeDir: string) =>
        path.join(runtimeHomeDir, "WORKSPACE_SESSION_AUTH.json")
      )
    }, {
      codexHomeDir,
      runtimeStorageRootDir
    });

    const result = service.prepareWorkspaceInstructionBundle({
      sessionId: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      workspacePath,
      provider: "codex",
      projectId: null
    });

    expect(result.instructionFilePath.replaceAll("\\", "/")).toContain("/workspace-session-runtime/workspace-1/session-1/");
    expect(result.runtimeHomeDir.replaceAll("\\", "/")).toContain("/workspace-session-runtime/workspace-1/session-1");
    expect(result.runtimeEnv).toMatchObject({
      CODINGNS_AUTH_FILE: result.authFilePath,
      WORKSPACE_SESSION_AUTH_FILE: result.authFilePath,
      WORKSPACE_SESSION_ASSISTANT_FILE: result.instructionFilePath,
      CODINGNS_OFFICE_MCP_AUTH_FILE: result.authFilePath
    });
    expect(existsSync(result.authFilePath)).toBe(true);
    expect(existsSync(result.instructionFilePath)).toBe(true);
    expect(
      existsSync(path.join(path.dirname(result.instructionFilePath), "skills", "codingns-workspace-session", "SKILL.md"))
    ).toBe(true);

    const instructionContent = readFileSync(result.instructionFilePath, "utf8");
    expect(instructionContent).toContain("始终使用中文");
    expect(instructionContent).toContain("工作区会话附加规则");
    expect(instructionContent).toContain("assistant office.browser.*");
    expect(instructionContent).toContain("codingns assistant office browser-profile-list");
    expect(instructionContent).toContain('{"startUrl":"https://example.invalid","actions":[{"type":"read_dom"}]}');
    expect(instructionContent).toContain("goto");
    expect(instructionContent).toContain("screenshot");
    expect(instructionContent).toContain("不要退回去翻源码");
    expect(instructionContent).toContain("不要回答“当前环境没有浏览器能力”");
    expect(instructionContent).toContain("localhost");
    const codexConfigPath = path.join(result.runtimeHomeDir, "config.toml");
    const codexConfig = readFileSync(codexConfigPath, "utf8");
    expect(readFileSync(path.join(result.runtimeHomeDir, "auth.json"), "utf8")).toContain("\"openai\": true");
    expect(codexConfig).toContain("[mcp_servers.codingns-workspace-office]");
    expect(codexConfig).toContain("workspace-office");
    expect(codexConfig).toContain("model_instructions_file");
    expect(codexConfig).toContain("model = \"gpt-5-codex\"");
    expect(
      existsSync(path.join(result.runtimeHomeDir, "skills", "demo", "SKILL.md"))
    ).toBe(true);

    const authContent = JSON.parse(readFileSync(result.authFilePath, "utf8")) as {
      callerKind: string;
      capabilityProfile: string;
      workspaceId: string;
      sessionId: string;
    };
    expect(authContent).toMatchObject({
      callerKind: "workspace_session",
      capabilityProfile: "workspace-scoped",
      workspaceId: "workspace-1",
      sessionId: "session-1"
    });
  });

  it("provider=opencode 时会写出可供托管 server 直接读取的 MCP 配置", () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "codingns-workspace-session-runtime-"));
    const runtimeStorageRootDir = mkdtempSync(path.join(tmpdir(), "codingns-workspace-session-global-runtime-"));
    tempDirs.push(workspacePath);
    tempDirs.push(runtimeStorageRootDir);

    const service = new WorkspaceSessionRuntimeContextService({
      ensureWorkspaceCredential: vi.fn(() => ({
        apiBaseUrl: "http://127.0.0.1:3002",
        accessToken: "workspace-token",
        issuedAt: "2026-05-16T10:00:00.000Z",
        expiresAt: "2026-05-23T10:00:00.000Z",
        userId: "user-1",
        workspaceId: "workspace-1",
        projectId: null,
        sessionId: "session-2",
        callerKind: "workspace_session" as const,
        capabilityProfile: "workspace-scoped" as const
      })),
      getCredentialFilePath: vi.fn((runtimeHomeDir: string) =>
        path.join(runtimeHomeDir, "WORKSPACE_SESSION_AUTH.json")
      )
    }, {
      runtimeStorageRootDir
    });

    const result = service.prepareWorkspaceInstructionBundle({
      sessionId: "session-2",
      userId: "user-1",
      workspaceId: "workspace-1",
      workspacePath,
      provider: "opencode",
      projectId: null
    });

    const openCodeConfig = JSON.parse(
      readFileSync(path.join(result.runtimeHomeDir, "opencode.json"), "utf8")
    ) as {
      mcp?: Record<string, { type?: string; command?: string[]; environment?: Record<string, string> }>;
    };
    expect(openCodeConfig.mcp?.["codingns-workspace-office"]?.type).toBe("local");
    expect(openCodeConfig.mcp?.["codingns-workspace-office"]?.command?.slice(1, 4)).toEqual([
      expect.stringContaining("codingns.mjs"),
      "mcp",
      "workspace-office"
    ]);
    expect(openCodeConfig.mcp?.["codingns-workspace-office"]?.environment).toMatchObject({
      CODINGNS_OFFICE_MCP_AUTH_FILE: result.authFilePath
    });
  });
});

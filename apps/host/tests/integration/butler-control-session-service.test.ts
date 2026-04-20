import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import type {
  ButlerControlSession,
  ButlerProfile,
  SessionListItem,
  Workspace
} from "../../src/types/domain.js";
import type { ButlerContextAggregator } from "../../src/modules/butler/context-aggregator.js";
import type { ButlerControlSessionRepository } from "../../src/storage/repositories/butler-control-session-repository.js";
import type { ButlerProfileService } from "../../src/modules/butler/butler-profile-service.js";
import { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import type { ButlerAuthService } from "../../src/modules/butler/butler-auth-service.js";
import type { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";
import type { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../../src/modules/sessions/session-live-runtime-service.js";
import type { SkillManagerService } from "../../src/modules/skills/skill-manager-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("ButlerControlSessionService", () => {
  it("启动控制会话时必须由用户提供首条消息", async () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-control-"));
    tempDirs.push(workspacePath);
    const profile: ButlerProfile = {
      id: "default",
      providerId: "codex",
      workspacePath,
      agentsMode: "inline",
      agentsFilePath: null,
      agentsContent: "# AGENTS.md\n你是代码助手",
      persona: {
        tone: "direct",
        language: "zh-CN",
        summaryStyle: "brief"
      },
      focus: {
        projectIds: [],
        riskPreference: "conservative",
        reportPriority: ["risk"]
      },
      initializedAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z"
    };

    const service = new ButlerControlSessionService(
      {
        ensureInitialized: vi.fn(() => profile)
      } as unknown as ButlerProfileService,
      {
        findLatestOpenByProvider: vi.fn(() => null),
        findLatestByProvider: vi.fn(() => null),
        create: vi.fn(),
        update: vi.fn()
      } as unknown as ButlerControlSessionRepository,
      {
        importWorkspace: vi.fn()
      } as unknown as Pick<WorkspaceService, "importWorkspace">,
      {
        getSession: vi.fn(),
        resumeSession: vi.fn()
      } as unknown as Pick<SessionHistoryService, "getSession" | "resumeSession">,
      {
        startLiveSession: vi.fn(),
        sendLiveMessage: vi.fn()
      } as unknown as Pick<SessionLiveRuntimeService, "startLiveSession" | "sendLiveMessage">,
      {
        resolvePromptContext: vi.fn(async () => ({
          version: "ctx-overview-v1",
          generatedAt: "2026-04-05T00:00:05.000Z",
          scope: "global",
          projectId: null,
          prompt: "# 代码助手当前上下文\n\n- 作用域：全局总览"
        }))
      } as unknown as Pick<ButlerContextAggregator, "resolvePromptContext">,
      {
        ensureWorkspaceCredential: vi.fn(() => ({
          apiBaseUrl: "http://127.0.0.1:3002",
          accessToken: "token-1",
          issuedAt: "2026-04-05T00:00:00.000Z",
          expiresAt: "2026-10-05T00:00:00.000Z",
          userId: "user-1"
        })),
        getCredentialFilePath: vi.fn(() => path.join(workspacePath, "BUTLER_AUTH.json"))
      } as unknown as Pick<ButlerAuthService, "ensureWorkspaceCredential" | "getCredentialFilePath">,
      createSkillManagerStub(),
      null
    );

    await expect(service.startSession("user-1", {})).rejects.toMatchObject({
      errorCode: "INVALID_INPUT",
      field: "content"
    });
  });

  it("启动控制会话时会复用真实 live runtime 并创建独立控制会话记录", async () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-control-"));
    tempDirs.push(workspacePath);
    const sandboxWorkspacePath = path.join(workspacePath, "sandboxes", "control-session-1");
    const codexHomeDir = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-codex-home-"));
    tempDirs.push(codexHomeDir);
    const claudeHomeDir = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-claude-home-"));
    tempDirs.push(claudeHomeDir);
    const defaultCodexHomeDir = mkdtempSync(path.join(os.tmpdir(), "codingns-default-codex-home-"));
    tempDirs.push(defaultCodexHomeDir);
    const managedSkillRootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-managed-skill-"));
    tempDirs.push(managedSkillRootDir);
    writeFileSync(
      path.join(defaultCodexHomeDir, "auth.json"),
      JSON.stringify({
        access_token: "token-123"
      }),
      "utf8"
    );
    mkdirSync(path.join(managedSkillRootDir, "codingns-assistant", "references"), {
      recursive: true
    });
    writeFileSync(
      path.join(managedSkillRootDir, "codingns-assistant", "SKILL.md"),
      "---\nname: codingns-assistant\ndescription: test\n---\n",
      "utf8"
    );
    writeFileSync(
      path.join(managedSkillRootDir, "codingns-assistant", "references", "cli-workflow.md"),
      "# test\n",
      "utf8"
    );
    writeFileSync(
      path.join(defaultCodexHomeDir, "config.toml"),
      [
        'model_provider = "gmn"',
        'approval_policy = "never"'
      ].join("\n"),
      "utf8"
    );
    mkdirSync(path.join(workspacePath, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(path.join(workspacePath, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    writeFileSync(
      path.join(workspacePath, ".git", "config"),
      "[core]\n\trepositoryformatversion = 0\n\tbare = false\n",
      "utf8"
    );
    const profile: ButlerProfile = {
      id: "default",
      providerId: "codex",
      workspacePath,
      agentsMode: "inline",
      agentsFilePath: null,
      agentsContent: "# AGENTS.md\n你是代码助手",
      persona: {
        tone: "direct",
        language: "zh-CN",
        summaryStyle: "brief"
      },
      focus: {
        projectIds: [],
        riskPreference: "conservative",
        reportPriority: ["risk"]
      },
      initializedAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z"
    };
    const workspace: Workspace = {
      id: "workspace-butler-sandbox",
      name: "请先介绍当前职责",
      path: sandboxWorkspacePath,
      repoRoot: sandboxWorkspacePath,
      favorite: false,
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      removedAt: null
    };
    const session: SessionListItem = {
      sessionId: "session-1",
      workspaceId: workspace.id,
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "raw-1",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: "代码助手",
      messageCount: 1,
      lastMessageAt: "2026-04-05T00:00:10.000Z",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:10.000Z",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-04-05T00:00:10.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "running",
      activitySource: "runtime",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      lastEventAt: "2026-04-05T00:00:10.000Z",
      completedAt: null,
      lastSeenAt: null,
      watchdogTriggeredAt: null,
      activityState: "running"
    };
    let savedControlSession: ButlerControlSession | null = null;
    const originRepository = {
      upsert: vi.fn()
    };
    const assistantSandboxService = {
      createSandbox: vi.fn(async () => ({
        id: "sandbox-1",
        userId: "user-1",
        workspaceId: workspace.id,
        controlSessionId: null,
        title: "请先介绍当前职责",
        description: "当前助手会话独占的临时工作区",
        sourceKind: "blank" as const,
        sourceRef: sandboxWorkspacePath,
        visibility: "assistant_only" as const,
        status: "active" as const,
        purpose: "butler_control_session",
        expiresAt: null,
        promotedAt: null,
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        workspace
      })),
      listSandboxes: vi.fn(() => []),
      markSandboxUsedByControlSession: vi.fn(),
      removeSandbox: vi.fn()
    };

    const service = new ButlerControlSessionService(
      {
        ensureInitialized: vi.fn(() => profile)
      } as unknown as ButlerProfileService,
      {
        findLatestOpenByProvider: vi.fn(() => null),
        findLatestByProvider: vi.fn(() => null),
        create: vi.fn((record: ButlerControlSession) => {
          savedControlSession = record;
          return record;
        }),
        update: vi.fn((record: ButlerControlSession) => record)
      } as unknown as ButlerControlSessionRepository,
      {
        importWorkspace: vi.fn(() => workspace)
      } as unknown as Pick<WorkspaceService, "importWorkspace">,
      {
        getSession: vi.fn(() => session),
        resumeSession: vi.fn()
      } as unknown as Pick<SessionHistoryService, "getSession" | "resumeSession">,
      {
        startLiveSession: vi.fn(async () => ({
          sessionId: session.sessionId,
          provider: "codex",
          providerSessionId: session.providerSessionId,
          acceptedAt: "2026-04-05T00:00:10.000Z",
          clientRequestId: null,
          message: {
            messageId: "msg-1",
            role: "user",
            content: "请先介绍当前职责",
            timestamp: "2026-04-05T00:00:10.000Z",
            sequence: 1,
            attachments: []
          }
        })),
        sendLiveMessage: vi.fn()
      } as unknown as Pick<SessionLiveRuntimeService, "startLiveSession" | "sendLiveMessage">,
      {
        resolvePromptContext: vi.fn(async () => ({
          version: "ctx-overview-v1",
          generatedAt: "2026-04-05T00:00:05.000Z",
          scope: "global",
          projectId: null,
          prompt: "# 代码助手当前上下文\n\n- 作用域：全局总览"
        }))
      } as unknown as Pick<ButlerContextAggregator, "resolvePromptContext">,
      {
        ensureWorkspaceCredential: vi.fn((targetWorkspacePath: string) => {
          const credential = {
            apiBaseUrl: "http://127.0.0.1:3002",
            accessToken: "token-1",
            issuedAt: "2026-04-05T00:00:00.000Z",
            expiresAt: "2026-10-05T00:00:00.000Z",
            userId: "user-1"
          };
          mkdirSync(targetWorkspacePath, { recursive: true });
          writeFileSync(
            path.join(targetWorkspacePath, "BUTLER_AUTH.json"),
            `${JSON.stringify(credential, null, 2)}\n`,
            "utf8"
          );
          return credential;
        }),
        getCredentialFilePath: vi.fn((targetWorkspacePath: string) => path.join(targetWorkspacePath, "BUTLER_AUTH.json"))
      } as unknown as Pick<ButlerAuthService, "ensureWorkspaceCredential" | "getCredentialFilePath">,
      createSkillManagerStub({
        overview: {
          summary: {
            managedSkillCount: 1,
            managedEntryCount: 1,
            unmanagedEntryCount: 0,
            conflictedEntryCount: 0,
            diagnosticCount: 0
          },
          managedSkills: [
            {
              skill: {
                id: "skill-1",
                name: "codingns-assistant",
                directoryName: "codingns-assistant",
                sourceType: "local-import",
                sourcePath: path.join(managedSkillRootDir, "codingns-assistant"),
                contentHash: "hash-1",
                managedState: "active",
                createdAt: "2026-04-05T00:00:00.000Z",
                updatedAt: "2026-04-05T00:00:00.000Z"
              },
              bindings: [
                {
                  skillId: "skill-1",
                  targetCli: "codex",
                  enabled: true,
                  syncStatus: "synced",
                  lastSyncedAt: "2026-04-05T00:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorDetail: null
                }
              ],
              ssotPath: path.join(managedSkillRootDir, "codingns-assistant")
            }
          ],
          managedEntries: [
            {
              targetCli: "codex",
              directoryPath: path.join(managedSkillRootDir, "codingns-assistant"),
              directoryName: "codingns-assistant",
              name: "codingns-assistant",
              contentHash: "hash-1",
              managementState: "managed",
              managedSkillId: "skill-1"
            }
          ],
          unmanagedEntries: [],
          conflictedEntries: [],
          diagnostics: [],
          scannedAt: "2026-04-05T00:00:00.000Z"
        }
      }),
      codexHomeDir,
      defaultCodexHomeDir,
      claudeHomeDir,
      null,
      originRepository,
      assistantSandboxService
    );

    const started = await service.startSession("user-1", {
      content: "请先介绍当前职责"
    });

    expect(started.providerId).toBe("codex");
    expect(started.session.sessionId).toBe("session-1");
    expect(savedControlSession?.sessionId).toBe("session-1");
    expect(savedControlSession?.lastContextVersion).toBe("ctx-overview-v1");
    expect(assistantSandboxService.createSandbox).toHaveBeenCalledTimes(1);
    expect(assistantSandboxService.markSandboxUsedByControlSession).toHaveBeenCalledWith(
      "sandbox-1",
      "user-1",
      savedControlSession?.id
    );
    expect(readFileSync(path.join(sandboxWorkspacePath, "BUTLER_CONTEXT.md"), "utf8")).toContain("作用域：全局总览");
    expect(readFileSync(path.join(sandboxWorkspacePath, "BUTLER_API.md"), "utf8")).toContain(
      "codingns assistant capabilities list"
    );
    expect(readFileSync(path.join(sandboxWorkspacePath, "BUTLER_API.md"), "utf8")).toContain(
      "codingns assistant help sessions"
    );
    expect(readFileSync(path.join(sandboxWorkspacePath, "BUTLER_API.md"), "utf8")).toContain(
      "BUTLER_AUTH.json"
    );
    expect(readFileSync(path.join(sandboxWorkspacePath, "BUTLER_API.md"), "utf8")).toContain(
      "当前目录就是当前助手会话自己的沙箱"
    );
    expect(readFileSync(path.join(sandboxWorkspacePath, "AGENTS.md"), "utf8")).toContain(
      "## Codex 增量覆盖"
    );
    expect(readFileSync(path.join(sandboxWorkspacePath, "CLAUDE.md"), "utf8")).toContain(
      "## Claude Code 增量覆盖"
    );
    expect(readFileSync(path.join(sandboxWorkspacePath, "BUTLER_RULES.md"), "utf8")).toContain(
      "共享规则源"
    );
    expect(readFileSync(path.join(sandboxWorkspacePath, "BUTLER_RULES.md"), "utf8")).toContain(
      "默认直接落在当前助手沙箱"
    );
    expect(JSON.parse(readFileSync(path.join(sandboxWorkspacePath, "BUTLER_AUTH.json"), "utf8")).accessToken).toBe(
      "token-1"
    );
    expect(execFileSync("git", ["-C", sandboxWorkspacePath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8"
    }).trim()).toBe(realpathSync.native(sandboxWorkspacePath));
    const codexConfig = readFileSync(path.join(codexHomeDir, "config.toml"), "utf8");
    expect(codexConfig).toContain('model_provider = "gmn"');
    expect(codexConfig).toContain('approval_policy = "never"');
    expect(codexConfig).toContain(`model_instructions_file = "${path.join(sandboxWorkspacePath, "AGENTS.md")}"`);
    expect(readFileSync(path.join(codexHomeDir, "auth.json"), "utf8")).toBe(
      readFileSync(path.join(defaultCodexHomeDir, "auth.json"), "utf8")
    );
    expect(readFileSync(path.join(codexHomeDir, "skills", "codingns-assistant", "SKILL.md"), "utf8")).toContain(
      "codingns-assistant"
    );
    expect(readFileSync(path.join(claudeHomeDir, "config.json"), "utf8")).toContain("primaryApiKey");
    expect(readFileSync(path.join(claudeHomeDir, "settings.json"), "utf8")).toContain("includeCoAuthoredBy");
    expect(readFileSync(path.join(claudeHomeDir, "skills", "codingns-assistant", "SKILL.md"), "utf8")).toContain(
      "codingns-assistant"
    );
    expect(existsSync(path.join(claudeHomeDir, "CLAUDE.md"))).toBe(false);
    expect(originRepository.upsert).toHaveBeenCalledTimes(1);
    expect(originRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      origin: "butler_proxy",
      content: "请先介绍当前职责",
      createdAt: "2026-04-05T00:00:10.000Z",
      updatedAt: "2026-04-05T00:00:10.000Z"
    }));
  });

  it("使用 claude-code 启动控制会话时会继承默认 Claude 配置并覆盖默认规则", async () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-claude-control-"));
    tempDirs.push(workspacePath);
    const claudeHomeDir = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-claude-home-"));
    tempDirs.push(claudeHomeDir);
    const defaultClaudeHomeDir = mkdtempSync(path.join(os.tmpdir(), "codingns-default-claude-home-"));
    tempDirs.push(defaultClaudeHomeDir);
    const managedSkillRootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-claude-skill-"));
    tempDirs.push(managedSkillRootDir);

    mkdirSync(path.join(managedSkillRootDir, "codingns-assistant", "references"), {
      recursive: true
    });
    writeFileSync(
      path.join(managedSkillRootDir, "codingns-assistant", "SKILL.md"),
      "---\nname: codingns-assistant\ndescription: claude test\n---\n",
      "utf8"
    );
    writeFileSync(
      path.join(managedSkillRootDir, "codingns-assistant", "references", "cli-workflow.md"),
      "# claude test\n",
      "utf8"
    );
    mkdirSync(path.join(workspacePath, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(path.join(workspacePath, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    writeFileSync(
      path.join(workspacePath, ".git", "config"),
      "[core]\n\trepositoryformatversion = 0\n\tbare = false\n",
      "utf8"
    );
    writeFileSync(
      path.join(defaultClaudeHomeDir, "config.json"),
      JSON.stringify({ primaryApiKey: "claude-default-key" }, null, 2),
      "utf8"
    );
    writeFileSync(
      path.join(defaultClaudeHomeDir, "settings.json"),
      JSON.stringify({ includeCoAuthoredBy: false }, null, 2),
      "utf8"
    );
    writeFileSync(
      path.join(defaultClaudeHomeDir, "project-config.json"),
      JSON.stringify({ project: { model: "sonnet" } }, null, 2),
      "utf8"
    );
    writeFileSync(
      path.join(defaultClaudeHomeDir, "CLAUDE.md"),
      "# default claude rules\n\n- should not leak into butler\n",
      "utf8"
    );
    mkdirSync(path.join(defaultClaudeHomeDir, "plugins"), { recursive: true });
    writeFileSync(
      path.join(defaultClaudeHomeDir, "plugins", "known_marketplaces.json"),
      "{}\n",
      "utf8"
    );

    const profile: ButlerProfile = {
      id: "default",
      providerId: "claude-code",
      workspacePath,
      agentsMode: "inline",
      agentsFilePath: null,
      agentsContent: "# AGENTS.md\n你是 Claude 代码助手",
      persona: {
        tone: "direct",
        language: "zh-CN",
        summaryStyle: "brief"
      },
      focus: {
        projectIds: [],
        riskPreference: "conservative",
        reportPriority: ["risk"]
      },
      initializedAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z"
    };
    const workspace: Workspace = {
      id: "workspace-butler-claude",
      name: "代码助手",
      path: workspacePath,
      repoRoot: workspacePath,
      favorite: false,
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      removedAt: null
    };
    const session: SessionListItem = {
      sessionId: "session-claude-1",
      workspaceId: workspace.id,
      provider: "claude-code",
      providerSessionId: "provider-claude-session-1",
      rawStoreRef: "raw-claude-1",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: "Claude 代码助手",
      messageCount: 1,
      lastMessageAt: "2026-04-05T00:00:10.000Z",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:10.000Z",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-04-05T00:00:10.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "running",
      activitySource: "runtime",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      lastEventAt: "2026-04-05T00:00:10.000Z",
      completedAt: null,
      lastSeenAt: null,
      watchdogTriggeredAt: null,
      activityState: "running"
    };

    const service = new ButlerControlSessionService(
      {
        ensureInitialized: vi.fn(() => profile)
      } as unknown as ButlerProfileService,
      {
        findLatestOpenByProvider: vi.fn(() => null),
        findLatestByProvider: vi.fn(() => null),
        create: vi.fn((record: ButlerControlSession) => record),
        update: vi.fn((record: ButlerControlSession) => record)
      } as unknown as ButlerControlSessionRepository,
      {
        importWorkspace: vi.fn(() => workspace)
      } as unknown as Pick<WorkspaceService, "importWorkspace">,
      {
        getSession: vi.fn(() => session),
        resumeSession: vi.fn()
      } as unknown as Pick<SessionHistoryService, "getSession" | "resumeSession">,
      {
        startLiveSession: vi.fn(async () => ({
          sessionId: session.sessionId,
          provider: "claude-code",
          providerSessionId: session.providerSessionId,
          acceptedAt: "2026-04-05T00:00:10.000Z",
          clientRequestId: null,
          message: {
            messageId: "msg-claude-1",
            role: "user",
            content: "请检查 Claude 助手规则",
            timestamp: "2026-04-05T00:00:10.000Z",
            sequence: 1,
            attachments: []
          }
        })),
        sendLiveMessage: vi.fn()
      } as unknown as Pick<SessionLiveRuntimeService, "startLiveSession" | "sendLiveMessage">,
      {
        resolvePromptContext: vi.fn(async () => ({
          version: "ctx-claude-v1",
          generatedAt: "2026-04-05T00:00:05.000Z",
          scope: "global",
          projectId: null,
          prompt: "# 代码助手当前上下文\n\n- 作用域：全局总览"
        }))
      } as unknown as Pick<ButlerContextAggregator, "resolvePromptContext">,
      {
        ensureWorkspaceCredential: vi.fn(() => {
          const credential = {
            apiBaseUrl: "http://127.0.0.1:3002",
            accessToken: "token-claude",
            issuedAt: "2026-04-05T00:00:00.000Z",
            expiresAt: "2026-10-05T00:00:00.000Z",
            userId: "user-1"
          };
          writeFileSync(
            path.join(workspacePath, "BUTLER_AUTH.json"),
            `${JSON.stringify(credential, null, 2)}\n`,
            "utf8"
          );
          return credential;
        }),
        getCredentialFilePath: vi.fn(() => path.join(workspacePath, "BUTLER_AUTH.json"))
      } as unknown as Pick<ButlerAuthService, "ensureWorkspaceCredential" | "getCredentialFilePath">,
      createSkillManagerStub({
        overview: {
          summary: {
            managedSkillCount: 1,
            managedEntryCount: 1,
            unmanagedEntryCount: 0,
            conflictedEntryCount: 0,
            diagnosticCount: 0
          },
          managedSkills: [
            {
              skill: {
                id: "skill-claude-1",
                name: "codingns-assistant",
                directoryName: "codingns-assistant",
                sourceType: "local-import",
                sourcePath: path.join(managedSkillRootDir, "codingns-assistant"),
                contentHash: "hash-claude-1",
                managedState: "active",
                createdAt: "2026-04-05T00:00:00.000Z",
                updatedAt: "2026-04-05T00:00:00.000Z"
              },
              bindings: [
                {
                  skillId: "skill-claude-1",
                  targetCli: "claude-code",
                  enabled: true,
                  syncStatus: "synced",
                  lastSyncedAt: "2026-04-05T00:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorDetail: null
                }
              ],
              ssotPath: path.join(managedSkillRootDir, "codingns-assistant")
            }
          ],
          managedEntries: [
            {
              targetCli: "claude-code",
              directoryPath: path.join(managedSkillRootDir, "codingns-assistant"),
              directoryName: "codingns-assistant",
              name: "codingns-assistant",
              contentHash: "hash-claude-1",
              managementState: "managed",
              managedSkillId: "skill-claude-1"
            }
          ],
          unmanagedEntries: [],
          conflictedEntries: [],
          diagnostics: [],
          scannedAt: "2026-04-05T00:00:00.000Z"
        }
      }),
      null,
      null,
      claudeHomeDir,
      defaultClaudeHomeDir,
      {
        upsert: vi.fn()
      }
    );

    const started = await service.startSession("user-1", {
      content: "请检查 Claude 助手规则"
    });

    expect(started.providerId).toBe("claude-code");
    expect(started.session.sessionId).toBe("session-claude-1");
    expect(readFileSync(path.join(workspacePath, "AGENTS.md"), "utf8")).toContain("## Codex 增量覆盖");
    expect(readFileSync(path.join(workspacePath, "CLAUDE.md"), "utf8")).toContain("## Claude Code 增量覆盖");
    expect(readFileSync(path.join(workspacePath, "BUTLER_RULES.md"), "utf8")).toContain("共享规则源");
    expect(JSON.parse(readFileSync(path.join(claudeHomeDir, "config.json"), "utf8"))).toEqual({
      primaryApiKey: "claude-default-key"
    });
    expect(JSON.parse(readFileSync(path.join(claudeHomeDir, "settings.json"), "utf8"))).toEqual({
      includeCoAuthoredBy: false
    });
    expect(JSON.parse(readFileSync(path.join(claudeHomeDir, "project-config.json"), "utf8"))).toEqual({
      project: { model: "sonnet" }
    });
    expect(readFileSync(path.join(claudeHomeDir, "plugins", "known_marketplaces.json"), "utf8")).toContain("{}");
    expect(readFileSync(path.join(claudeHomeDir, "skills", "codingns-assistant", "SKILL.md"), "utf8")).toContain(
      "codingns-assistant"
    );
    expect(existsSync(path.join(claudeHomeDir, "CLAUDE.md"))).toBe(false);
  });

  it("发送消息时会直接调用现有 session runtime", async () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-control-"));
    tempDirs.push(workspacePath);
    const sandboxWorkspacePath = path.join(workspacePath, "sandboxes", "control-session-2");
    const profile: ButlerProfile = {
      id: "default",
      providerId: "codex",
      workspacePath,
      agentsMode: "inline",
      agentsFilePath: null,
      agentsContent: "# AGENTS.md\n你是代码助手",
      persona: {
        tone: "direct",
        language: "zh-CN",
        summaryStyle: "brief"
      },
      focus: {
        projectIds: [],
        riskPreference: "conservative",
        reportPriority: ["risk"]
      },
      initializedAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z"
    };
    const currentSession: ButlerControlSession = {
      id: "control-1",
      providerId: "codex",
      sessionId: "session-1",
      purpose: "chat",
      title: null,
      sourceItemId: null,
      model: "gpt-5.4",
      reasoningLevel: "medium",
      permissionMode: "default",
      status: "idle",
      lastContextVersion: null,
      lastSummary: null,
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z"
    };
    const session: SessionListItem = {
      sessionId: "session-1",
      workspaceId: "workspace-butler",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "raw-1",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: "代码助手",
      messageCount: 2,
      lastMessageAt: "2026-04-05T00:00:20.000Z",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:20.000Z",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-04-05T00:00:20.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "running",
      activitySource: "runtime",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      lastEventAt: "2026-04-05T00:00:20.000Z",
      completedAt: null,
      lastSeenAt: null,
      watchdogTriggeredAt: null,
      activityState: "running"
    };
    let updatedControlSession: ButlerControlSession | null = null;
    const originRepository = {
      upsert: vi.fn()
    };

    const service = new ButlerControlSessionService(
      {
        ensureInitialized: vi.fn(() => profile)
      } as unknown as ButlerProfileService,
      {
        findLatestOpenByProvider: vi.fn(() => currentSession),
        findLatestByProvider: vi.fn(() => currentSession),
        create: vi.fn(),
        update: vi.fn((record: ButlerControlSession) => {
          updatedControlSession = record;
          return record;
        })
      } as unknown as ButlerControlSessionRepository,
      {
        importWorkspace: vi.fn()
      } as unknown as Pick<WorkspaceService, "importWorkspace">,
      {
        getSession: vi.fn(() => session),
        resumeSession: vi.fn()
      } as unknown as Pick<SessionHistoryService, "getSession" | "resumeSession">,
      {
        startLiveSession: vi.fn(),
        sendLiveMessage: vi.fn(async () => ({
          sessionId: "session-1",
          provider: "codex",
          providerSessionId: "provider-session-1",
          acceptedAt: "2026-04-05T00:01:00.000Z",
          clientRequestId: "req-1",
          message: {
            messageId: "msg-2",
            role: "user",
            content: "继续汇总当前风险",
            timestamp: "2026-04-05T00:01:00.000Z",
            sequence: 2,
            attachments: []
          }
        }))
      } as unknown as Pick<SessionLiveRuntimeService, "startLiveSession" | "sendLiveMessage">,
      {
        resolvePromptContext: vi.fn(async () => ({
          version: "ctx-project-v2",
          generatedAt: "2026-04-05T00:00:55.000Z",
          scope: "project",
          projectId: "project-1",
          prompt: "# 代码助手当前上下文\n\n- 作用域：项目 project-1"
        }))
      } as unknown as Pick<ButlerContextAggregator, "resolvePromptContext">,
      {
        ensureWorkspaceCredential: vi.fn(() => {
          const credential = {
            apiBaseUrl: "http://127.0.0.1:3002",
            accessToken: "token-2",
            issuedAt: "2026-04-05T00:00:00.000Z",
            expiresAt: "2026-10-05T00:00:00.000Z",
            userId: "user-1"
          };
          mkdirSync(sandboxWorkspacePath, { recursive: true });
          writeFileSync(
            path.join(sandboxWorkspacePath, "BUTLER_AUTH.json"),
            `${JSON.stringify(credential, null, 2)}\n`,
            "utf8"
          );
          return credential;
        }),
        getCredentialFilePath: vi.fn(() => path.join(sandboxWorkspacePath, "BUTLER_AUTH.json"))
      } as unknown as Pick<ButlerAuthService, "ensureWorkspaceCredential" | "getCredentialFilePath">,
      createSkillManagerStub(),
      null,
      null,
      null,
      null,
      originRepository,
      {
        createSandbox: vi.fn(),
        listSandboxes: vi.fn(() => [
          {
            id: "sandbox-2",
            userId: "user-1",
            workspaceId: "workspace-sandbox-2",
            controlSessionId: "control-1",
            title: "当前助手会话",
            description: null,
            sourceKind: "blank" as const,
            sourceRef: sandboxWorkspacePath,
            visibility: "assistant_only" as const,
            status: "active" as const,
            purpose: "butler_control_session",
            expiresAt: null,
            promotedAt: null,
            createdAt: "2026-04-05T00:00:00.000Z",
            updatedAt: "2026-04-05T00:00:00.000Z",
            workspace: {
              id: "workspace-sandbox-2",
              name: "当前助手会话",
              path: sandboxWorkspacePath,
              repoRoot: sandboxWorkspacePath,
              favorite: false,
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:00:00.000Z",
              removedAt: null
            }
          }
        ]),
        markSandboxUsedByControlSession: vi.fn(),
        removeSandbox: vi.fn()
      }
    );

    const sent = await service.sendMessage("user-1", {
      content: "继续汇总当前风险",
      clientRequestId: "req-1"
    });

    expect(sent.sessionId).toBe("session-1");
    expect(sent.controlSession.id).toBe("control-1");
    expect(updatedControlSession?.lastSummary).toContain("继续汇总当前风险");
    expect(updatedControlSession?.lastContextVersion).toBe("ctx-project-v2");
    expect(readFileSync(path.join(sandboxWorkspacePath, "BUTLER_CONTEXT.md"), "utf8")).toContain(
      "作用域：项目 project-1"
    );
    expect(originRepository.upsert).toHaveBeenCalledTimes(2);
    expect(originRepository.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: "session-1",
      clientRequestId: "req-1",
      messageId: null,
      origin: "butler_proxy",
      content: "继续汇总当前风险"
    }));
    expect(originRepository.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sessionId: "session-1",
      clientRequestId: "req-1",
      messageId: "msg-2",
      origin: "butler_proxy",
      content: "继续汇总当前风险",
      createdAt: "2026-04-05T00:01:00.000Z",
      updatedAt: "2026-04-05T00:01:00.000Z"
    }));
  });

  it("发送消息前如果检测到套餐限额冷却，会直接拒绝继续开工", async () => {
    const currentSession: ButlerControlSession = {
      id: "control-1",
      providerId: "codex",
      sessionId: "session-1",
      purpose: "chat",
      title: null,
      sourceItemId: null,
      model: "gpt-5.4",
      reasoningLevel: "medium",
      permissionMode: "default",
      status: "idle",
      lastContextVersion: null,
      lastSummary: null,
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z"
    };
    const blockedError = new AppError({
      statusCode: 429,
      errorCode: "PROVIDER_USAGE_LIMIT_EXCEEDED",
      detail: "助手控制会话检测到 provider 套餐限额，系统会在 2026-04-05T00:35:00.000Z 后再继续尝试。",
      data: {
        blockedUntil: "2026-04-05T00:35:00.000Z"
      }
    });
    const providerUsageLimitGuardService = {
      resolveBlockingInspection: vi.fn(async () => ({
        inspection: {
          sessionId: "session-1",
          providerId: "codex",
          sourceLabel: "助手控制会话",
          providerUsageLimit: {
            category: "usage_limit",
            providerId: "codex",
            source: "error_detail" as const,
            retryAt: "2026-04-05T00:30:00.000Z",
            retryAfterSeconds: null,
            rawText: "You've hit your usage limit.",
            summary: "检测到 provider 额度已达上限，系统会按下一次可用时机自动重试。"
          },
          detectedAt: "2026-04-05T00:20:00.000Z",
          blockedUntil: "2026-04-05T00:35:00.000Z"
        },
        blockedUntil: "2026-04-05T00:35:00.000Z"
      })),
      createBlockedAppError: vi.fn(() => blockedError)
    };

    const service = new ButlerControlSessionService(
      {
        ensureInitialized: vi.fn(() => ({
          id: "default",
          providerId: "codex",
          workspacePath: "/tmp/butler-workspace"
        }))
      } as unknown as ButlerProfileService,
      {
        findLatestOpenByProvider: vi.fn(() => currentSession),
        findLatestByProvider: vi.fn(() => currentSession),
        create: vi.fn(),
        update: vi.fn((record: ButlerControlSession) => record)
      } as unknown as ButlerControlSessionRepository,
      {
        importWorkspace: vi.fn()
      } as unknown as Pick<WorkspaceService, "importWorkspace">,
      {
        getSession: vi.fn(() => ({
          sessionId: "session-1"
        })),
        resumeSession: vi.fn()
      } as unknown as Pick<SessionHistoryService, "getSession" | "resumeSession">,
      {
        startLiveSession: vi.fn(),
        sendLiveMessage: vi.fn()
      } as unknown as Pick<SessionLiveRuntimeService, "startLiveSession" | "sendLiveMessage">,
      {
        resolvePromptContext: vi.fn()
      } as unknown as Pick<ButlerContextAggregator, "resolvePromptContext">,
      {
        ensureWorkspaceCredential: vi.fn(),
        getCredentialFilePath: vi.fn()
      } as unknown as Pick<ButlerAuthService, "ensureWorkspaceCredential" | "getCredentialFilePath">,
      createSkillManagerStub(),
      null,
      null,
      null,
      null,
      null,
      null,
      providerUsageLimitGuardService as any
    );

    await expect(service.sendMessage("user-1", {
      content: "继续推进"
    })).rejects.toMatchObject({
      errorCode: "PROVIDER_USAGE_LIMIT_EXCEEDED"
    });
  });
});

function createSkillManagerStub(
  options?: {
    overview?: Partial<ReturnType<Pick<SkillManagerService, "getOverview">["getOverview"]>>;
  }
) {
  const overview = {
    summary: {
      managedSkillCount: 0,
      managedEntryCount: 0,
      unmanagedEntryCount: 0,
      conflictedEntryCount: 0,
      diagnosticCount: 0
    },
    managedSkills: [],
    managedEntries: [],
    unmanagedEntries: [],
    conflictedEntries: [],
    diagnostics: [],
    scannedAt: "2026-04-05T00:00:00.000Z",
    ...(options?.overview ?? {})
  };

  return {
    getOverview: vi.fn(() => overview),
    importUnmanagedSkill: vi.fn(),
    listAssistantRuntimeSkillSources: vi.fn((targetClis?: string[]) => {
      const managedSkills = (overview.managedSkills ?? []).map((item: any) => ({
        name: item.skill.name,
        directoryName: item.skill.directoryName,
        sourcePath: item.ssotPath ?? item.skill.sourcePath,
        usedByTargetCli: targetClis?.length ? targetClis : ["codex", "claude-code"]
      }));

      if (managedSkills.length > 0) {
        return managedSkills;
      }

      return (overview.managedEntries ?? [])
        .filter((entry: any) => !targetClis?.length || targetClis.includes(entry.targetCli))
        .map((entry: any) => ({
          name: entry.name,
          directoryName: entry.directoryName,
          sourcePath: entry.directoryPath,
          usedByTargetCli: [entry.targetCli]
        }));
    })
  } as unknown as Pick<
    SkillManagerService,
    "getOverview" | "importUnmanagedSkill" | "listAssistantRuntimeSkillSources"
  >;
}

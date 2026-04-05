import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
import type { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";
import type { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../../src/modules/sessions/session-live-runtime-service.js";

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
  it("启动控制会话时会复用真实 live runtime 并创建独立控制会话记录", async () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-control-"));
    tempDirs.push(workspacePath);
    const codexHomeDir = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-codex-home-"));
    tempDirs.push(codexHomeDir);
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
      agentsContent: "# AGENTS.md\n你是代码管家",
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
      id: "workspace-butler",
      name: "代码管家",
      path: workspacePath,
      repoRoot: workspacePath,
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
      title: "代码管家",
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

    const service = new ButlerControlSessionService(
      {
        ensureInitialized: vi.fn(() => profile)
      } as unknown as ButlerProfileService,
      {
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
        resolvePromptContext: vi.fn(() => ({
          version: "ctx-overview-v1",
          generatedAt: "2026-04-05T00:00:05.000Z",
          scope: "global",
          projectId: null,
          prompt: "# 代码管家当前上下文\n\n- 作用域：全局总览"
        }))
      } as unknown as Pick<ButlerContextAggregator, "resolvePromptContext">,
      codexHomeDir
    );

    const started = await service.startSession("user-1", {
      content: "请先介绍当前职责"
    });

    expect(started.providerId).toBe("codex");
    expect(started.session.sessionId).toBe("session-1");
    expect(savedControlSession?.sessionId).toBe("session-1");
    expect(savedControlSession?.lastContextVersion).toBe("ctx-overview-v1");
    expect(readFileSync(path.join(workspacePath, "BUTLER_CONTEXT.md"), "utf8")).toContain("作用域：全局总览");
    expect(readFileSync(path.join(workspacePath, "BUTLER_API.md"), "utf8")).toContain(
      "GET /api/butler/overview"
    );
    expect(execFileSync("git", ["-C", workspacePath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8"
    }).trim()).toBe(realpathSync.native(workspacePath));
    expect(readFileSync(path.join(codexHomeDir, "config.toml"), "utf8")).toContain(
      `model_instructions_file = "${path.join(workspacePath, "AGENTS.md")}"`
    );
  });

  it("发送消息时会直接调用现有 session runtime", async () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-control-"));
    tempDirs.push(workspacePath);
    const profile: ButlerProfile = {
      id: "default",
      providerId: "codex",
      workspacePath,
      agentsMode: "inline",
      agentsFilePath: null,
      agentsContent: "# AGENTS.md\n你是代码管家",
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
      title: "代码管家",
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

    const service = new ButlerControlSessionService(
      {
        ensureInitialized: vi.fn(() => profile)
      } as unknown as ButlerProfileService,
      {
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
        resolvePromptContext: vi.fn(() => ({
          version: "ctx-project-v2",
          generatedAt: "2026-04-05T00:00:55.000Z",
          scope: "project",
          projectId: "project-1",
          prompt: "# 代码管家当前上下文\n\n- 作用域：项目 project-1"
        }))
      } as unknown as Pick<ButlerContextAggregator, "resolvePromptContext">
    );

    const sent = await service.sendMessage("user-1", {
      content: "继续汇总当前风险",
      clientRequestId: "req-1"
    });

    expect(sent.sessionId).toBe("session-1");
    expect(sent.controlSession.id).toBe("control-1");
    expect(updatedControlSession?.lastSummary).toContain("继续汇总当前风险");
    expect(updatedControlSession?.lastContextVersion).toBe("ctx-project-v2");
    expect(readFileSync(path.join(workspacePath, "BUTLER_CONTEXT.md"), "utf8")).toContain(
      "作用域：项目 project-1"
    );
  });
});

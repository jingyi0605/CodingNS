import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ButlerSessionSummaryService } from "../../src/modules/butler/butler-session-summary-service.js";
import { SessionSummaryInstructionAdapter } from "../../src/modules/butler/session-summary-instruction-adapter.js";
import { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import { ButlerSessionRepository } from "../../src/storage/repositories/butler-session-repository.js";
import { ButlerSessionSummaryStateRepository } from "../../src/storage/repositories/butler-session-summary-state-repository.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionCheckpointRepository } from "../../src/storage/repositories/session-checkpoint-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import type { ButlerProject, ButlerProjectSessionView, ButlerProfile, Workspace } from "../../src/types/domain.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();

    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

describe("ButlerSessionSummaryService", () => {
  it("会对发生变动的非归档会话做 5 分钟防抖并回写摘要", async () => {
    const database = createDatabaseClient(":memory:");
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-summary-"));
    tempDirs.push(workspacePath);
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const butlerProjectRepository = new ButlerProjectRepository(database.db);
    const butlerSessionRepository = new ButlerSessionRepository(database.db);
    const butlerSessionSummaryStateRepository = new ButlerSessionSummaryStateRepository(database.db);
    const sessionCheckpointRepository = new SessionCheckpointRepository(database.db);
    const workspace: Workspace = {
      id: "workspace-1",
      name: "repo-a",
      path: workspacePath,
      repoRoot: workspacePath,
      favorite: false,
      createdAt: "2026-04-06T10:00:00.000Z",
      updatedAt: "2026-04-06T10:00:00.000Z",
      removedAt: null
    };
    const project: ButlerProject = {
      id: "project-1",
      workspaceId: workspace.id,
      name: "repo-a",
      repoRoot: workspace.path,
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-06T10:00:00.000Z",
      updatedAt: "2026-04-06T10:00:00.000Z",
      archivedAt: null
    };
    const profile: ButlerProfile = {
      id: "default",
      displayName: "哆哆",
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
        reportPriority: ["risk", "blocker", "verification"],
        summaryDebounceSeconds: 300
      },
      initializedAt: "2026-04-06T10:00:00.000Z",
      updatedAt: "2026-04-06T10:00:00.000Z"
    };
    const sessionView: ButlerProjectSessionView = {
      id: "butler-session-1",
      projectId: project.id,
      sessionId: "session-1",
      provider: "codex",
      title: "修复 host 类型错误",
      role: "adhoc",
      ownershipMode: "observed",
      status: "idle",
      runningState: "completed",
      lastSummary: "已登记会话：修复 host 类型错误",
      lastCheckpointAt: "2026-04-06T10:00:00.000Z",
      createdAt: "2026-04-06T10:00:00.000Z",
      updatedAt: "2026-04-06T10:00:00.000Z"
    };
    let now = "2026-04-06T10:00:00.000Z";

    workspaceRepository.create(workspace);
    butlerProjectRepository.create(project);
    sessionBindingRepository.upsert({
      sessionId: sessionView.sessionId,
      workspaceId: workspace.id,
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "raw-1",
      createdAt: sessionView.createdAt,
      updatedAt: sessionView.updatedAt
    });
    sessionIndexRepository.upsert({
      sessionId: sessionView.sessionId,
      workspaceId: workspace.id,
      provider: "codex",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      title: sessionView.title ?? "未命名",
      messageCount: 12,
      isArchived: false,
      lastMessageAt: "2026-04-06T10:00:15.000Z",
      createdAt: sessionView.createdAt,
      updatedAt: "2026-04-06T10:00:15.000Z"
    });
    butlerSessionRepository.create({
      id: sessionView.id,
      projectId: sessionView.projectId,
      sessionId: sessionView.sessionId,
      role: sessionView.role,
      ownershipMode: sessionView.ownershipMode,
      status: sessionView.status,
      lastSummary: sessionView.lastSummary,
      lastCheckpointAt: sessionView.lastCheckpointAt,
      createdAt: sessionView.createdAt,
      updatedAt: sessionView.updatedAt
    });

    const adapter = {
      startPatrolSession: vi.fn(async () => ({
        sessionId: "summary-session-1",
        provider: "codex",
        providerSessionId: "summary-provider-session-1",
        acceptedAt: now
      })),
      waitForSessionTerminal: vi.fn(async () => {}),
      readPatrolResult: vi.fn(async () => ({
        assistantMessages: ["最近在修 host 类型错误，当前已定位根因。"],
        latestAssistantMessage: "最近在修 host 类型错误，当前已定位根因。",
        structured: {
          summary: "最近在修 host 类型错误，当前已定位根因，下一步是补修复并复跑类型检查。",
          riskLevel: "medium" as const,
          suggestions: ["补修复后复跑 host 类型检查"],
          progressState: "working" as const,
          riskFlags: ["host 类型检查曾失败"],
          nextActions: ["补修复后复跑 host 类型检查"],
          rawJson: null
        }
      }))
    };

    const service = new ButlerSessionSummaryService(
      {
        getProfile: vi.fn(() => profile)
      },
      {
        list: vi.fn(() => [project])
      },
      {
        ensureProjectSessionsSynced: vi.fn(async () => {}),
        listByProject: vi.fn(() => [sessionView])
      },
      butlerSessionRepository,
      butlerSessionSummaryStateRepository,
      sessionCheckpointRepository,
      sessionIndexRepository,
      {
        listIds: vi.fn(() => ["user-1"])
      },
      {
        importWorkspace: vi.fn(() => workspace)
      },
      {
        readSessionHistory: vi.fn(async () => ({
          messages: [
            {
              messageId: "msg-1",
              provider: "codex",
              providerSessionId: "provider-session-1",
              role: "user" as const,
              kind: "text" as const,
              content: "先看 host 为什么类型检查失败",
              toolCall: null,
              timestamp: "2026-04-06T10:00:10.000Z",
              sequence: 1,
              rawRef: "1"
            },
            {
              messageId: "msg-2",
              provider: "codex",
              providerSessionId: "provider-session-1",
              role: "assistant" as const,
              kind: "text" as const,
              content: "已经定位到 butler 模块新增字段未补类型。",
              toolCall: null,
              timestamp: "2026-04-06T10:00:15.000Z",
              sequence: 2,
              rawRef: "2"
            }
          ],
          cursor: null,
          nextCursor: null,
          total: 2
        }))
      },
      {
        get: vi.fn(() => adapter)
      } as never,
      new SessionSummaryInstructionAdapter(),
      {
        now: () => now
      }
    );

    await service.runOnce();

    const scheduledState = butlerSessionSummaryStateRepository.findByButlerSessionId(sessionView.id);

    expect(adapter.startPatrolSession).not.toHaveBeenCalled();
    expect(scheduledState).toMatchObject({
      butlerSessionId: sessionView.id,
      sourceMessageCount: 12,
      sourceLastMessageAt: "2026-04-06T10:00:15.000Z",
      status: "scheduled"
    });
    expect(scheduledState?.debounceUntil).toBe("2026-04-06T10:05:00.000Z");

    now = "2026-04-06T10:05:05.000Z";
    await service.runOnce();

    const finishedState = butlerSessionSummaryStateRepository.findByButlerSessionId(sessionView.id);
    const updatedSession = butlerSessionRepository.findById(sessionView.id);
    const checkpoints = sessionCheckpointRepository.listByButlerSessionId(sessionView.id, 5);

    expect(adapter.startPatrolSession).toHaveBeenCalledTimes(1);
    expect(updatedSession?.lastSummary).toContain("host 类型错误");
    expect(checkpoints[0]).toMatchObject({
      sourceKind: "summary",
      progressState: "working"
    });
    expect(finishedState).toMatchObject({
      butlerSessionId: sessionView.id,
      status: "idle",
      errorDetail: null,
      lastSummarizedSequence: 2
    });

    database.close();
  });

  it("已有摘要序号时只读取新增消息，并把旧摘要和增量合并成新摘要", async () => {
    const database = createDatabaseClient(":memory:");
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-summary-incremental-"));
    tempDirs.push(workspacePath);
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const butlerProjectRepository = new ButlerProjectRepository(database.db);
    const butlerSessionRepository = new ButlerSessionRepository(database.db);
    const butlerSessionSummaryStateRepository = new ButlerSessionSummaryStateRepository(database.db);
    const sessionCheckpointRepository = new SessionCheckpointRepository(database.db);
    const workspace: Workspace = {
      id: "workspace-1",
      name: "repo-a",
      path: workspacePath,
      repoRoot: workspacePath,
      favorite: false,
      createdAt: "2026-04-06T11:00:00.000Z",
      updatedAt: "2026-04-06T11:00:00.000Z",
      removedAt: null
    };
    const project: ButlerProject = {
      id: "project-1",
      workspaceId: workspace.id,
      name: "repo-a",
      repoRoot: workspace.path,
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-06T11:00:00.000Z",
      updatedAt: "2026-04-06T11:00:00.000Z",
      archivedAt: null
    };
    const sessionView: ButlerProjectSessionView = {
      id: "butler-session-2",
      projectId: project.id,
      sessionId: "session-2",
      provider: "codex",
      title: "修复摘要重复读取",
      role: "adhoc",
      ownershipMode: "observed",
      status: "idle",
      runningState: "completed",
      lastSummary: "旧摘要：已经定位到摘要重复读取的问题，正在准备修复。",
      lastCheckpointAt: "2026-04-06T11:00:00.000Z",
      createdAt: "2026-04-06T11:00:00.000Z",
      updatedAt: "2026-04-06T11:00:00.000Z"
    };
    let now = "2026-04-06T11:05:05.000Z";

    workspaceRepository.create(workspace);
    butlerProjectRepository.create(project);
    sessionBindingRepository.upsert({
      sessionId: sessionView.sessionId,
      workspaceId: workspace.id,
      provider: "codex",
      providerSessionId: "provider-session-2",
      rawStoreRef: "raw-2",
      createdAt: sessionView.createdAt,
      updatedAt: sessionView.updatedAt
    });
    sessionIndexRepository.upsert({
      sessionId: sessionView.sessionId,
      workspaceId: workspace.id,
      provider: "codex",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      title: sessionView.title ?? "未命名",
      messageCount: 4,
      isArchived: false,
      lastMessageAt: "2026-04-06T11:04:00.000Z",
      createdAt: sessionView.createdAt,
      updatedAt: "2026-04-06T11:04:00.000Z"
    });
    butlerSessionRepository.create({
      id: sessionView.id,
      projectId: sessionView.projectId,
      sessionId: sessionView.sessionId,
      role: sessionView.role,
      ownershipMode: sessionView.ownershipMode,
      status: sessionView.status,
      lastSummary: sessionView.lastSummary,
      lastCheckpointAt: sessionView.lastCheckpointAt,
      createdAt: sessionView.createdAt,
      updatedAt: sessionView.updatedAt
    });
    butlerSessionSummaryStateRepository.upsert({
      butlerSessionId: sessionView.id,
      sourceMessageCount: 4,
      sourceLastMessageAt: "2026-04-06T11:04:00.000Z",
      lastSummarizedAt: "2026-04-06T11:00:00.000Z",
      lastSummarizedSequence: 2,
      debounceUntil: "2026-04-06T11:05:00.000Z",
      status: "scheduled",
      errorDetail: null,
      updatedAt: "2026-04-06T11:00:00.000Z"
    });

    const adapter = {
      startPatrolSession: vi.fn(async () => ({
        sessionId: "summary-session-2",
        provider: "codex",
        providerSessionId: "summary-provider-session-2",
        acceptedAt: now
      })),
      waitForSessionTerminal: vi.fn(async () => {}),
      readPatrolResult: vi.fn(async () => ({
        assistantMessages: ["合并后的摘要"],
        latestAssistantMessage: "合并后的摘要",
        structured: {
          summary: "合并后的摘要：问题已经修复，并补跑了验证。",
          riskLevel: "low" as const,
          suggestions: ["继续观察后续回归结果"],
          progressState: "done" as const,
          riskFlags: [],
          nextActions: ["继续观察后续回归结果"],
          rawJson: null
        }
      }))
    };
    const readSessionHistory = vi.fn(async () => ({
      messages: [
        {
          messageId: "msg-3",
          provider: "codex",
          providerSessionId: "provider-session-2",
          role: "assistant" as const,
          kind: "text" as const,
          content: "已经完成修复，并开始补跑验证。",
          toolCall: null,
          timestamp: "2026-04-06T11:03:00.000Z",
          sequence: 3,
          rawRef: "3"
        },
        {
          messageId: "msg-4",
          provider: "codex",
          providerSessionId: "provider-session-2",
          role: "assistant" as const,
          kind: "text" as const,
          content: "验证通过，准备收尾。",
          toolCall: null,
          timestamp: "2026-04-06T11:04:00.000Z",
          sequence: 4,
          rawRef: "4"
        }
      ],
      cursor: null,
      nextCursor: null,
      total: 4
    }));

    const service = new ButlerSessionSummaryService(
      {
        getProfile: vi.fn(() => ({
          id: "default",
          displayName: "哆哆",
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
            reportPriority: ["risk", "blocker", "verification"],
            summaryDebounceSeconds: 300
          },
          initializedAt: "2026-04-06T11:00:00.000Z",
          updatedAt: "2026-04-06T11:00:00.000Z"
        }))
      },
      {
        list: vi.fn(() => [project])
      },
      {
        ensureProjectSessionsSynced: vi.fn(async () => {}),
        listByProject: vi.fn(() => [sessionView])
      },
      butlerSessionRepository,
      butlerSessionSummaryStateRepository,
      sessionCheckpointRepository,
      sessionIndexRepository,
      {
        listIds: vi.fn(() => ["user-1"])
      },
      {
        importWorkspace: vi.fn(() => workspace)
      },
      {
        readSessionHistory
      },
      {
        get: vi.fn(() => adapter)
      } as never,
      new SessionSummaryInstructionAdapter(),
      {
        now: () => now
      }
    );

    await service.runOnce();

    expect(readSessionHistory).toHaveBeenCalledTimes(1);
    expect(adapter.startPatrolSession).toHaveBeenCalledTimes(1);
    const startPayload = adapter.startPatrolSession.mock.calls[0]?.[0];
    expect(startPayload.prompt).toContain("上一版摘要：");
    expect(startPayload.prompt).toContain("旧摘要：已经定位到摘要重复读取的问题");
    expect(startPayload.prompt).toContain("sequence > 2");
    expect(startPayload.prompt).toContain("已经完成修复，并开始补跑验证。");
    expect(startPayload.prompt).toContain("验证通过，准备收尾。");

    const finishedState = butlerSessionSummaryStateRepository.findByButlerSessionId(sessionView.id);
    const updatedSession = butlerSessionRepository.findById(sessionView.id);

    expect(updatedSession?.lastSummary).toContain("合并后的摘要");
    expect(finishedState).toMatchObject({
      butlerSessionId: sessionView.id,
      status: "idle",
      lastSummarizedSequence: 4
    });

    database.close();
  });

  it("会跳过归档会话，不会给它安排摘要任务", async () => {
    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const butlerProjectRepository = new ButlerProjectRepository(database.db);
    const butlerSessionSummaryStateRepository = new ButlerSessionSummaryStateRepository(database.db);
    const sessionView: ButlerProjectSessionView = {
      id: "butler-session-archived",
      projectId: "project-1",
      sessionId: "session-archived",
      provider: "codex",
      title: "旧会话",
      role: "adhoc",
      ownershipMode: "observed",
      status: "idle",
      runningState: "completed",
      lastSummary: "旧摘要",
      lastCheckpointAt: "2026-04-06T09:00:00.000Z",
      createdAt: "2026-04-06T09:00:00.000Z",
      updatedAt: "2026-04-06T09:00:00.000Z"
    };
    const workspace: Workspace = {
      id: "workspace-1",
      name: "repo-a",
      path: "/tmp/repo-a",
      repoRoot: "/tmp/repo-a",
      favorite: false,
      createdAt: "2026-04-06T09:00:00.000Z",
      updatedAt: "2026-04-06T09:00:00.000Z",
      removedAt: null
    };
    const project: ButlerProject = {
      id: "project-1",
      workspaceId: workspace.id,
      name: "repo-a",
      repoRoot: workspace.path,
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-06T09:00:00.000Z",
      updatedAt: "2026-04-06T09:00:00.000Z",
      archivedAt: null
    };

    workspaceRepository.create(workspace);
    butlerProjectRepository.create(project);
    sessionBindingRepository.upsert({
      sessionId: sessionView.sessionId,
      workspaceId: workspace.id,
      provider: "codex",
      providerSessionId: "provider-session-archived",
      rawStoreRef: "raw-archived",
      createdAt: sessionView.createdAt,
      updatedAt: sessionView.updatedAt
    });

    sessionIndexRepository.upsert({
      sessionId: sessionView.sessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      title: "旧会话",
      messageCount: 3,
      isArchived: true,
      lastMessageAt: "2026-04-06T09:00:00.000Z",
      createdAt: "2026-04-06T09:00:00.000Z",
      updatedAt: "2026-04-06T09:00:00.000Z"
    });

    const service = new ButlerSessionSummaryService(
      {
        getProfile: vi.fn(() => ({
          id: "default",
          displayName: "哆哆",
          providerId: "codex",
          workspacePath: "/tmp/butler",
          agentsMode: "inline",
          agentsFilePath: null,
          agentsContent: "# AGENTS.md",
          persona: { tone: "direct", language: "zh-CN", summaryStyle: "brief" },
          focus: { projectIds: [], riskPreference: "conservative", reportPriority: ["risk"], summaryDebounceSeconds: 300 },
          initializedAt: "2026-04-06T09:00:00.000Z",
          updatedAt: "2026-04-06T09:00:00.000Z"
        }))
      },
      {
        list: vi.fn(() => [{
          id: "project-1",
          workspaceId: "workspace-1",
          name: "repo-a",
          repoRoot: "/tmp/repo-a",
          defaultProvider: "codex",
          instructionProfileId: null,
          approvalMode: "controlled",
          lifecycleStatus: "active",
          riskLevel: "low",
          config: {},
          lastPatrolAt: null,
          lastVerificationAt: null,
          createdAt: "2026-04-06T09:00:00.000Z",
          updatedAt: "2026-04-06T09:00:00.000Z",
          archivedAt: null
        }])
      },
      {
        ensureProjectSessionsSynced: vi.fn(async () => {}),
        listByProject: vi.fn(() => [sessionView])
      },
      {
        findById: vi.fn(() => null),
        update: vi.fn()
      },
      butlerSessionSummaryStateRepository,
      {
        create: vi.fn(),
        getLatestSeq: vi.fn(() => 0)
      },
      sessionIndexRepository,
      {
        listIds: vi.fn(() => ["user-1"])
      },
      {
        importWorkspace: vi.fn(() => ({
          id: "workspace-1",
          name: "代码助手",
          path: "/tmp/butler",
          repoRoot: "/tmp/butler",
          favorite: false,
          createdAt: "2026-04-06T09:00:00.000Z",
          updatedAt: "2026-04-06T09:00:00.000Z",
          removedAt: null
        }))
      },
      {
        readSessionHistory: vi.fn()
      },
      {
        get: vi.fn()
      } as never,
      new SessionSummaryInstructionAdapter(),
      {
        now: () => "2026-04-06T09:00:00.000Z"
      }
    );

    await service.runOnce();

    expect(butlerSessionSummaryStateRepository.findByButlerSessionId(sessionView.id)).toBeNull();

    database.close();
  });
});

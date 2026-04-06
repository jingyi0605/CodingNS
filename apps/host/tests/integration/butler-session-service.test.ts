import { describe, expect, it, vi } from "vitest";

import type {
  ButlerProject,
  ButlerSession,
  SessionBinding,
  SessionIndexRecord,
  SessionListItem,
  SessionStateRecord
} from "../../src/types/domain.js";
import type { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import type { ButlerSessionRepository } from "../../src/storage/repositories/butler-session-repository.js";
import type { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import type { SessionCheckpointRepository } from "../../src/storage/repositories/session-checkpoint-repository.js";
import type { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import type { SessionStateRepository } from "../../src/storage/repositories/session-state-repository.js";
import { ButlerSessionService } from "../../src/modules/butler/butler-session-service.js";

describe("ButlerSessionService", () => {
  it("可以把已有 session 纳入代码助手项目", () => {
    const project: ButlerProject = {
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
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      archivedAt: null
    };
    const binding: SessionBinding = {
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "raw-1",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };
    const index: SessionIndexRecord = {
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      title: "现有会话",
      messageCount: 3,
      isArchived: false,
      lastMessageAt: "2026-04-02T00:10:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:10:00.000Z"
    };
    const state: SessionStateRecord = {
      sessionId: "session-1",
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-04-02T00:10:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-04-02T00:10:00.000Z"
    };
    const createdSessions: ButlerSession[] = [];
    const createdCheckpoints: Array<{ summary: string; progressState: string; sourceKind: string }> = [];

    const butlerProjectRepository = {
      findById: vi.fn(() => project)
    } satisfies Pick<ButlerProjectRepository, "findById">;
    const butlerSessionRepository = {
      findBySessionId: vi.fn(() => null),
      listByProject: vi.fn(() => createdSessions),
      create: vi.fn((record: ButlerSession) => {
        createdSessions.push(record);
        return record;
      })
    } satisfies Pick<ButlerSessionRepository, "findBySessionId" | "listByProject" | "create">;
    const sessionCheckpointRepository = {
      getLatestSeq: vi.fn(() => createdCheckpoints.length),
      create: vi.fn((record) => {
        createdCheckpoints.push({
          summary: record.summary,
          progressState: record.progressState,
          sourceKind: record.sourceKind
        });
        return record;
      })
    } satisfies Pick<SessionCheckpointRepository, "getLatestSeq" | "create">;
    const sessionBindingRepository = {
      findBySessionId: vi.fn(() => binding)
    } satisfies Pick<SessionBindingRepository, "findBySessionId">;
    const sessionIndexRepository = {
      findIndexRecordBySessionId: vi.fn(() => index)
    } satisfies Pick<SessionIndexRepository, "findIndexRecordBySessionId">;
    const sessionStateRepository = {
      findBySessionAndUser: vi.fn(() => state)
    } satisfies Pick<SessionStateRepository, "findBySessionAndUser">;

    const service = new ButlerSessionService(
      butlerProjectRepository as unknown as ButlerProjectRepository,
      butlerSessionRepository as unknown as ButlerSessionRepository,
      sessionCheckpointRepository as unknown as SessionCheckpointRepository,
      sessionBindingRepository as unknown as SessionBindingRepository,
      sessionIndexRepository as unknown as SessionIndexRepository,
      sessionStateRepository as unknown as SessionStateRepository
    );

    const imported = service.importSession(
      project.id,
      {
        sessionId: "session-1",
        role: "adhoc",
        ownershipMode: "observed"
      },
      "user-1"
    );

    expect(imported.provider).toBe("codex");
    expect(imported.title).toBe("现有会话");
    expect(imported.status).toBe("running");
    expect(imported.lastCheckpointAt).not.toBeNull();
    expect(imported.lastSummary).toContain("已登记会话");
    expect(createdCheckpoints).toHaveLength(1);
    expect(createdCheckpoints[0]).toMatchObject({
      progressState: "working",
      sourceKind: "manual"
    });
    expect(service.listByProject(project.id, "user-1")).toHaveLength(1);
  });

  it("可以为已纳管会话采集后续快照并回写状态", () => {
    const project: ButlerProject = {
      id: "project-2",
      workspaceId: "workspace-1",
      name: "repo-b",
      repoRoot: "/tmp/repo-b",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      archivedAt: null
    };
    const binding: SessionBinding = {
      sessionId: "session-2",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-2",
      rawStoreRef: "raw-2",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };
    const index: SessionIndexRecord = {
      sessionId: "session-2",
      workspaceId: "workspace-1",
      provider: "codex",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      title: "巡视会话",
      messageCount: 10,
      isArchived: false,
      lastMessageAt: "2026-04-02T00:10:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:10:00.000Z"
    };
    const state: SessionStateRecord = {
      sessionId: "session-2",
      userId: "user-1",
      runningState: "failed",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-04-02T00:11:00.000Z",
      completedAt: "2026-04-02T00:11:00.000Z",
      lastSeenAt: null,
      updatedAt: "2026-04-02T00:11:00.000Z"
    };
    const butlerSession: ButlerSession = {
      id: "butler-session-2",
      projectId: project.id,
      sessionId: "session-2",
      role: "patrol",
      ownershipMode: "managed",
      status: "running",
      lastSummary: "旧摘要",
      lastCheckpointAt: "2026-04-02T00:05:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:05:00.000Z"
    };
    const createdCheckpoints: Array<{ summary: string; progressState: string; sourceKind: string }> = [];
    let persistedSession = butlerSession;

    const service = new ButlerSessionService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById"> as ButlerProjectRepository,
      {
        findById: vi.fn(() => persistedSession),
        update: vi.fn((record: ButlerSession) => {
          persistedSession = record;
          return record;
        })
      } satisfies Pick<ButlerSessionRepository, "findById" | "update"> as ButlerSessionRepository,
      {
        getLatestSeq: vi.fn(() => createdCheckpoints.length),
        create: vi.fn((record) => {
          createdCheckpoints.push({
            summary: record.summary,
            progressState: record.progressState,
            sourceKind: record.sourceKind
          });
          return record;
        })
      } satisfies Pick<SessionCheckpointRepository, "getLatestSeq" | "create"> as SessionCheckpointRepository,
      {
        findBySessionId: vi.fn(() => binding)
      } satisfies Pick<SessionBindingRepository, "findBySessionId"> as SessionBindingRepository,
      {
        findIndexRecordBySessionId: vi.fn(() => index)
      } satisfies Pick<SessionIndexRepository, "findIndexRecordBySessionId"> as SessionIndexRepository,
      {
        findBySessionAndUser: vi.fn(() => state)
      } satisfies Pick<SessionStateRepository, "findBySessionAndUser"> as SessionStateRepository
    );

    const snapshot = service.captureSessionSnapshot(project.id, butlerSession.id, "user-1", {
      sourceKind: "manual"
    });

    expect(snapshot.status).toBe("failed");
    expect(snapshot.lastSummary).toContain("状态快照");
    expect(snapshot.lastCheckpointAt).not.toBeNull();
    expect(createdCheckpoints).toHaveLength(1);
    expect(createdCheckpoints[0]).toMatchObject({
      progressState: "blocked",
      sourceKind: "manual"
    });
    expect(createdCheckpoints[0]?.summary).toContain("failed");
  });

  it("可以直接启动并登记托管会话", async () => {
    const project: ButlerProject = {
      id: "project-3",
      workspaceId: "workspace-3",
      name: "repo-c",
      repoRoot: "/tmp/repo-c",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      archivedAt: null
    };
    const createdCheckpoints: Array<{ summary: string; progressState: string; sourceKind: string }> = [];
    const createdSessions: ButlerSession[] = [];

    const service = new ButlerSessionService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById"> as ButlerProjectRepository,
      {
        create: vi.fn((record: ButlerSession) => {
          createdSessions.push(record);
          return record;
        })
      } satisfies Pick<ButlerSessionRepository, "create"> as ButlerSessionRepository,
      {
        getLatestSeq: vi.fn(() => createdCheckpoints.length),
        create: vi.fn((record) => {
          createdCheckpoints.push({
            summary: record.summary,
            progressState: record.progressState,
            sourceKind: record.sourceKind
          });
          return record;
        })
      } satisfies Pick<SessionCheckpointRepository, "getLatestSeq" | "create"> as SessionCheckpointRepository,
      {
        findBySessionId: vi.fn(() => null)
      } satisfies Pick<SessionBindingRepository, "findBySessionId"> as SessionBindingRepository,
      {
        findIndexRecordBySessionId: vi.fn(() => null)
      } satisfies Pick<SessionIndexRepository, "findIndexRecordBySessionId"> as SessionIndexRepository,
      {
        findBySessionAndUser: vi.fn(() => null)
      } satisfies Pick<SessionStateRepository, "findBySessionAndUser"> as SessionStateRepository,
      {
        startLiveSession: vi.fn(async () => ({
          sessionId: "session-created",
          provider: "codex",
          providerSessionId: "provider-session-created",
          acceptedAt: "2026-04-02T00:01:00.000Z"
        }))
      }
    );

    const started = await service.startSession(
      project.id,
      {
        role: "adhoc",
        ownershipMode: "managed",
        content: "请检查项目进度"
      },
      "user-1"
    );

    expect(started.sessionId).toBe("session-created");
    expect(started.provider).toBe("codex");
    expect(started.status).toBe("running");
    expect(started.lastSummary).toContain("已创建并启动托管会话");
    expect(createdSessions).toHaveLength(1);
    expect(createdCheckpoints).toHaveLength(1);
    expect(createdCheckpoints[0]).toMatchObject({
      progressState: "working",
      sourceKind: "manual"
    });
  });

  it("可以续接已纳管会话并回写快照", async () => {
    const project: ButlerProject = {
      id: "project-4",
      workspaceId: "workspace-4",
      name: "repo-d",
      repoRoot: "/tmp/repo-d",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      archivedAt: null
    };
    let persistedSession: ButlerSession = {
      id: "butler-session-4",
      projectId: project.id,
      sessionId: "session-4",
      role: "adhoc",
      ownershipMode: "managed",
      status: "idle",
      lastSummary: null,
      lastCheckpointAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };
    const createdCheckpoints: Array<{ summary: string; progressState: string; sourceKind: string }> = [];

    const service = new ButlerSessionService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById"> as ButlerProjectRepository,
      {
        findById: vi.fn(() => persistedSession),
        update: vi.fn((record: ButlerSession) => {
          persistedSession = record;
          return record;
        })
      } satisfies Pick<ButlerSessionRepository, "findById" | "update"> as ButlerSessionRepository,
      {
        getLatestSeq: vi.fn(() => createdCheckpoints.length),
        create: vi.fn((record) => {
          createdCheckpoints.push({
            summary: record.summary,
            progressState: record.progressState,
            sourceKind: record.sourceKind
          });
          return record;
        })
      } satisfies Pick<SessionCheckpointRepository, "getLatestSeq" | "create"> as SessionCheckpointRepository,
      {
        findBySessionId: vi.fn(() => ({
          sessionId: "session-4",
          workspaceId: project.workspaceId,
          provider: "codex",
          providerSessionId: "provider-session-4",
          rawStoreRef: "raw-4",
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:00:00.000Z"
        }))
      } satisfies Pick<SessionBindingRepository, "findBySessionId"> as SessionBindingRepository,
      {
        findIndexRecordBySessionId: vi.fn(() => ({
          sessionId: "session-4",
          workspaceId: project.workspaceId,
          provider: "codex",
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          title: "会话-4",
          messageCount: 8,
          isArchived: false,
          lastMessageAt: "2026-04-02T00:10:00.000Z",
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:10:00.000Z"
        }))
      } satisfies Pick<SessionIndexRepository, "findIndexRecordBySessionId"> as SessionIndexRepository,
      {
        findBySessionAndUser: vi.fn(() => ({
          sessionId: "session-4",
          userId: "user-1",
          runningState: "running",
          activitySource: "runtime",
          favorite: false,
          lastEventAt: "2026-04-02T00:11:00.000Z",
          completedAt: null,
          lastSeenAt: null,
          updatedAt: "2026-04-02T00:11:00.000Z"
        }))
      } satisfies Pick<SessionStateRepository, "findBySessionAndUser"> as SessionStateRepository,
      {
        startLiveSession: vi.fn(async () => ({
          sessionId: "unused",
          provider: "codex",
          providerSessionId: "unused",
          acceptedAt: "2026-04-02T00:01:00.000Z"
        }))
      },
      {
        resumeSession: vi.fn(async () => ({
          sessionId: "session-4",
          provider: "codex",
          providerSessionId: "provider-session-4",
          resumedAt: "2026-04-02T00:20:00.000Z"
        }))
      }
    );

    const resumed = await service.resumeSession(project.id, persistedSession.id, "user-1");

    expect(resumed.provider).toBe("codex");
    expect(resumed.providerSessionId).toBe("provider-session-4");
    expect(resumed.resumedAt).toBe("2026-04-02T00:20:00.000Z");
    expect(resumed.session.status).toBe("running");
    expect(createdCheckpoints).toHaveLength(1);
    expect(createdCheckpoints[0]).toMatchObject({
      progressState: "working",
      sourceKind: "manual"
    });
  });

  it("会把自动纳管工作区里的普通会话自动补进 Butler 视图", async () => {
    const project: ButlerProject = {
      id: "project-auto-1",
      workspaceId: "workspace-auto-1",
      name: "repo-auto",
      repoRoot: "/tmp/repo-auto",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {
        managedBy: "workspace-auto"
      },
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      archivedAt: null
    };
    const workspaceSession: SessionListItem = {
      sessionId: "session-auto-1",
      workspaceId: project.workspaceId,
      provider: "codex",
      providerSessionId: "provider-session-auto-1",
      rawStoreRef: "raw-auto-1",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: "自动发现的会话",
      messageCount: 12,
      lastMessageAt: "2026-04-02T00:10:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:10:00.000Z",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-04-02T00:10:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "running",
      activitySource: "runtime",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      lastEventAt: "2026-04-02T00:10:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      watchdogTriggeredAt: null,
      activityState: "running"
    };
    const binding: SessionBinding = {
      sessionId: workspaceSession.sessionId,
      workspaceId: project.workspaceId,
      provider: "codex",
      providerSessionId: workspaceSession.providerSessionId,
      rawStoreRef: workspaceSession.rawStoreRef,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };
    const index: SessionIndexRecord = {
      sessionId: workspaceSession.sessionId,
      workspaceId: project.workspaceId,
      provider: "codex",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      title: workspaceSession.title,
      messageCount: workspaceSession.messageCount,
      isArchived: false,
      lastMessageAt: workspaceSession.lastMessageAt,
      createdAt: workspaceSession.createdAt,
      updatedAt: workspaceSession.updatedAt
    };
    const state: SessionStateRecord = {
      sessionId: workspaceSession.sessionId,
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: workspaceSession.lastEventAt,
      completedAt: null,
      lastSeenAt: null,
      updatedAt: workspaceSession.updatedAt
    };
    const createdSessions: ButlerSession[] = [];
    const createdCheckpoints: Array<{ summary: string; sourceKind: string }> = [];
    const butlerSessionRepository = {
      listByProject: vi.fn(() => createdSessions),
      create: vi.fn((record: ButlerSession) => {
        createdSessions.push(record);
        return record;
      })
    } satisfies Pick<ButlerSessionRepository, "listByProject" | "create">;

    const service = new ButlerSessionService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById"> as ButlerProjectRepository,
      butlerSessionRepository as ButlerSessionRepository,
      {
        getLatestSeq: vi.fn(() => createdCheckpoints.length),
        create: vi.fn((record) => {
          createdCheckpoints.push({
            summary: record.summary,
            sourceKind: record.sourceKind
          });
          return record;
        })
      } satisfies Pick<SessionCheckpointRepository, "getLatestSeq" | "create"> as SessionCheckpointRepository,
      {
        findBySessionId: vi.fn(() => binding)
      } satisfies Pick<SessionBindingRepository, "findBySessionId"> as SessionBindingRepository,
      {
        findIndexRecordBySessionId: vi.fn(() => index)
      } satisfies Pick<SessionIndexRepository, "findIndexRecordBySessionId"> as SessionIndexRepository,
      {
        findBySessionAndUser: vi.fn(() => state)
      } satisfies Pick<SessionStateRepository, "findBySessionAndUser"> as SessionStateRepository,
      undefined,
      {
        discoverWorkspaceSessions: vi.fn(async () => [workspaceSession]),
        listWorkspaceSessions: vi.fn(() => [workspaceSession]),
        resumeSession: vi.fn()
      }
    );

    await service.ensureProjectSessionsSynced(project.id, "user-1");
    const result = service.listByProject(project.id, "user-1");

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("自动发现的会话");
    expect(result[0]?.status).toBe("running");
    expect(createdSessions).toHaveLength(1);
    expect(createdCheckpoints[0]?.sourceKind).toBe("snapshot");
  });

  it("默认不会返回归档会话，显式开启后才会包含", () => {
    const project: ButlerProject = {
      id: "project-archived",
      workspaceId: "workspace-archived",
      name: "repo-archived",
      repoRoot: "/tmp/repo-archived",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      archivedAt: null
    };
    const activeRecord: ButlerSession = {
      id: "butler-session-active",
      projectId: project.id,
      sessionId: "session-active",
      role: "adhoc",
      ownershipMode: "observed",
      status: "running",
      lastSummary: "活跃摘要",
      lastCheckpointAt: "2026-04-02T00:10:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:10:00.000Z"
    };
    const archivedRecord: ButlerSession = {
      ...activeRecord,
      id: "butler-session-archived",
      sessionId: "session-archived",
      lastSummary: "归档摘要"
    };

    const service = new ButlerSessionService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById"> as ButlerProjectRepository,
      {
        listByProject: vi.fn(() => [activeRecord, archivedRecord])
      } satisfies Pick<ButlerSessionRepository, "listByProject"> as ButlerSessionRepository,
      {} as SessionCheckpointRepository,
      {
        findBySessionId: vi.fn((sessionId: string) => ({
          sessionId,
          workspaceId: project.workspaceId,
          provider: "codex",
          providerSessionId: `provider-${sessionId}`,
          rawStoreRef: `raw-${sessionId}`,
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:10:00.000Z"
        }))
      } satisfies Pick<SessionBindingRepository, "findBySessionId"> as SessionBindingRepository,
      {
        findIndexRecordBySessionId: vi.fn((sessionId: string) => ({
          sessionId,
          workspaceId: project.workspaceId,
          provider: "codex",
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          title: sessionId,
          messageCount: 3,
          isArchived: sessionId === "session-archived",
          lastMessageAt: "2026-04-02T00:10:00.000Z",
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:10:00.000Z"
        }))
      } satisfies Pick<SessionIndexRepository, "findIndexRecordBySessionId"> as SessionIndexRepository,
      {
        findBySessionAndUser: vi.fn((sessionId: string) => ({
          sessionId,
          userId: "user-1",
          runningState: "idle",
          activitySource: "runtime",
          favorite: false,
          lastEventAt: "2026-04-02T00:10:00.000Z",
          completedAt: null,
          lastSeenAt: null,
          updatedAt: "2026-04-02T00:10:00.000Z"
        }))
      } satisfies Pick<SessionStateRepository, "findBySessionAndUser"> as SessionStateRepository
    );

    expect(service.listByProject(project.id, "user-1")).toHaveLength(1);
    expect(service.listByProject(project.id, "user-1")[0]?.sessionId).toBe("session-active");
    expect(service.listByProject(project.id, "user-1", { includeArchived: true })).toHaveLength(2);
  });
});

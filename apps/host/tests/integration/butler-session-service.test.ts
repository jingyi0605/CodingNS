import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
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
import type { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";

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
    const originRepository = {
      upsert: vi.fn()
    };

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
          acceptedAt: "2026-04-02T00:01:00.000Z",
          clientRequestId: "req-created",
          message: {
            messageId: "msg-created",
            role: "user",
            content: "请检查项目进度",
            timestamp: "2026-04-02T00:01:00.000Z",
            sequence: 1,
            attachments: []
          }
        }))
      },
      undefined,
      originRepository
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
    expect(originRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-created",
      clientRequestId: "req-created",
      messageId: "msg-created",
      origin: "butler_proxy",
      content: "请检查项目进度",
      createdAt: "2026-04-02T00:01:00.000Z",
      updatedAt: "2026-04-02T00:01:00.000Z"
    }));
  });

  it("startSession 遇到底层会话已创建但索引读取失败时，会自动回收并绑定托管会话", async () => {
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 1_000).toISOString();
    const project: ButlerProject = {
      id: "project-recover-1",
      workspaceId: "workspace-recover-1",
      name: "repo-recover",
      repoRoot: "/tmp/repo-recover",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    };
    const recoveredWorkspaceSession: SessionListItem = {
      sessionId: "session-recovered",
      workspaceId: project.workspaceId,
      provider: "codex",
      providerSessionId: "provider-session-recovered",
      rawStoreRef: "raw-session-recovered",
      parentSessionId: null,
      sessionKind: "default",
      annotationSourceMessageId: null,
      annotationSourceText: null,
      forkMethod: null,
      forkSourceType: null,
      forkSourceSessionId: null,
      forkSourceMessageId: null,
      inheritedPrefixMessageCount: null,
      isSubagent: false,
      subagentLabel: null,
      title: "请检查项目进度",
      isFavorite: false,
      messageCount: 1,
      lastMessageAt: later,
      createdAt: now,
      updatedAt: later,
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: later,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "running",
      activitySource: "runtime",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      lastEventAt: later,
      completedAt: null,
      lastSeenAt: null,
      watchdogTriggeredAt: null,
      activityState: "running"
    };
    const createdSessions: ButlerSession[] = [];
    const createdCheckpoints: Array<{ summary: string; progressState: string; sourceKind: string }> = [];

    const service = new ButlerSessionService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById"> as ButlerProjectRepository,
      {
        create: vi.fn((record: ButlerSession) => {
          createdSessions.push(record);
          return record;
        }),
        findBySessionId: vi.fn(() => null)
      } satisfies Pick<ButlerSessionRepository, "create" | "findBySessionId"> as ButlerSessionRepository,
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
        findBySessionId: vi.fn((sessionId: string) =>
          sessionId === "session-recovered"
            ? {
                sessionId: "session-recovered",
                workspaceId: project.workspaceId,
                provider: "codex",
                providerSessionId: "provider-session-recovered",
                rawStoreRef: "raw-session-recovered",
                createdAt: now,
                updatedAt: later
              }
            : null
        )
      } satisfies Pick<SessionBindingRepository, "findBySessionId"> as SessionBindingRepository,
      {
        findBySessionId: vi.fn((sessionId: string, _userId: string) =>
          sessionId === "session-recovered" ? recoveredWorkspaceSession : null
        ),
        findIndexRecordBySessionId: vi.fn((sessionId: string) =>
          sessionId === "session-recovered"
            ? {
                sessionId: "session-recovered",
                workspaceId: project.workspaceId,
                provider: "codex",
                parentSessionId: null,
                sessionKind: "default",
                annotationSourceMessageId: null,
                annotationSourceText: null,
                isSubagent: false,
                subagentLabel: null,
                title: "请检查项目进度",
                messageCount: 1,
                isArchived: false,
                lastMessageAt: later,
                createdAt: now,
                updatedAt: later
              }
            : null
        ),
        listByWorkspace: vi.fn(() => [recoveredWorkspaceSession])
      } satisfies Pick<SessionIndexRepository, "findBySessionId" | "findIndexRecordBySessionId" | "listByWorkspace"> as SessionIndexRepository,
      {
        findBySessionAndUser: vi.fn((sessionId: string) =>
          sessionId === "session-recovered"
            ? {
                sessionId,
                userId: "user-1",
                runningState: "running",
                activitySource: "runtime",
                favorite: false,
                lastEventAt: later,
                completedAt: null,
                lastSeenAt: null,
                updatedAt: later
              }
            : null
        )
      } satisfies Pick<SessionStateRepository, "findBySessionAndUser"> as SessionStateRepository,
      {
        startLiveSession: vi.fn(async () => {
          throw new AppError({
            statusCode: 500,
            errorCode: "SESSION_INDEX_MISSING",
            detail: "session 索引缺失"
          });
        })
      }
    );

    const started = await service.startSession(
      project.id,
      {
        role: "execution",
        ownershipMode: "managed",
        content: "请检查项目进度"
      },
      "user-1"
    );

    expect(started.sessionId).toBe("session-recovered");
    expect(started.ownershipMode).toBe("managed");
    expect(started.lastSummary).toContain("自动回收");
    expect(createdSessions).toHaveLength(1);
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

  it("恢复项目会话前如果命中套餐限额冷却，会直接拒绝续接", async () => {
    const project: ButlerProject = {
      id: "project-4",
      workspaceId: "workspace-1",
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
    const persistedSession: ButlerSession = {
      id: "butler-session-4",
      projectId: project.id,
      sessionId: "session-4",
      role: "adhoc",
      ownershipMode: "managed",
      status: "running",
      lastSummary: "旧摘要",
      lastCheckpointAt: "2026-04-02T00:05:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:05:00.000Z"
    };
    const blockedError = new AppError({
      statusCode: 429,
      errorCode: "PROVIDER_USAGE_LIMIT_EXCEEDED",
      detail: "工作区会话检测到 provider 套餐限额，系统会在 2026-04-02T00:35:00.000Z 后再继续尝试。"
    });
    const providerUsageLimitGuardService = {
      resolveBlockingInspection: vi.fn(async () => ({
        inspection: {
          sessionId: "session-4",
          providerId: "codex",
          sourceLabel: "工作区会话",
          providerUsageLimit: {
            category: "usage_limit",
            providerId: "codex",
            source: "error_detail" as const,
            retryAt: "2026-04-02T00:30:00.000Z",
            retryAfterSeconds: null,
            rawText: "You've hit your usage limit.",
            summary: "检测到 provider 额度已达上限，系统会按下一次可用时机自动重试。"
          },
          detectedAt: "2026-04-02T00:20:00.000Z",
          blockedUntil: "2026-04-02T00:35:00.000Z"
        },
        blockedUntil: "2026-04-02T00:35:00.000Z"
      })),
      createBlockedAppError: vi.fn(() => blockedError)
    };

    const service = new ButlerSessionService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById"> as ButlerProjectRepository,
      {
        findById: vi.fn(() => persistedSession)
      } satisfies Pick<ButlerSessionRepository, "findById"> as ButlerSessionRepository,
      {} as SessionCheckpointRepository,
      {
        findBySessionId: vi.fn(() => ({
          sessionId: "session-4",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider-session-4",
          rawStoreRef: "raw-session-4",
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:00:00.000Z"
        }))
      } as unknown as SessionBindingRepository,
      {
        findIndexRecordBySessionId: vi.fn(() => ({
          sessionId: "session-4",
          workspaceId: "workspace-1",
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
      } as unknown as SessionIndexRepository,
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
      } as unknown as SessionStateRepository,
      undefined,
      {
        resumeSession: vi.fn()
      } as unknown as Pick<SessionHistoryService, "resumeSession">,
      null,
      providerUsageLimitGuardService as any
    );

    await expect(service.resumeSession(project.id, persistedSession.id, "user-1")).rejects.toMatchObject({
      errorCode: "PROVIDER_USAGE_LIMIT_EXCEEDED"
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

  it("可以为当前普通会话解析出 Butler 动作目标", async () => {
    const project: ButlerProject = {
      id: "project-target",
      workspaceId: "workspace-target",
      name: "repo-target",
      repoRoot: "/tmp/repo-target",
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
    const binding: SessionBinding = {
      sessionId: "session-target",
      workspaceId: "workspace-target",
      provider: "codex",
      providerSessionId: "provider-session-target",
      rawStoreRef: "raw-session-target",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };
    const index: SessionIndexRecord = {
      sessionId: "session-target",
      workspaceId: "workspace-target",
      provider: "codex",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      title: "登录页开发",
      messageCount: 6,
      isArchived: false,
      lastMessageAt: "2026-04-02T00:10:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:10:00.000Z"
    };
    const state: SessionStateRecord = {
      sessionId: "session-target",
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

    const service = new ButlerSessionService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById"> as ButlerProjectRepository,
      {
        listByProject: vi.fn(() => createdSessions),
        findBySessionId: vi.fn((sessionId: string) =>
          createdSessions.find((item) => item.sessionId === sessionId) ?? null
        ),
        create: vi.fn((record: ButlerSession) => {
          createdSessions.push(record);
          return record;
        })
      } satisfies Pick<ButlerSessionRepository, "listByProject" | "findBySessionId" | "create"> as ButlerSessionRepository,
      {
        getLatestSeq: vi.fn(() => 0),
        create: vi.fn((record) => record)
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
        discoverWorkspaceSessions: vi.fn(async () => undefined),
        listWorkspaceSessions: vi.fn(() => [
          {
            sessionId: "session-target",
            workspaceId: "workspace-target",
            provider: "codex",
            providerSessionId: "provider-session-target",
            rawStoreRef: "raw-session-target",
            parentSessionId: null,
            isSubagent: false,
            subagentLabel: null,
            isArchived: false,
            isFavorite: false,
            title: "登录页开发",
            messageCount: 6,
            lastMessageAt: "2026-04-02T00:10:00.000Z",
            createdAt: "2026-04-02T00:00:00.000Z",
            updatedAt: "2026-04-02T00:10:00.000Z",
            syncStatus: null,
            syncCursor: null,
            lastSyncAt: null,
            lastErrorCode: null,
            lastErrorDetail: null,
            resumedAt: null,
            runningState: "running",
            activitySource: "runtime",
            lastEventAt: "2026-04-02T00:10:00.000Z",
            completedAt: null,
            lastSeenAt: null,
            activityState: "running"
          } satisfies SessionListItem
        ]),
        resumeSession: vi.fn()
      } as never
    );

    const target = await service.resolveActionTarget(project.id, "session-target", "user-1");

    expect(target.workspaceId).toBe("workspace-target");
    expect(target.session.sessionId).toBe("session-target");
    expect(target.session.ownershipMode).toBe("observed");
  });

  it("resolveActionTarget 会把已合并的 alias session 解析到真实 session", async () => {
    const project: ButlerProject = {
      id: "project-target-alias",
      workspaceId: "workspace-target",
      name: "repo-target",
      repoRoot: "/tmp/repo-target",
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
    const aliasBinding: SessionBinding = {
      sessionId: "session-alias",
      workspaceId: "workspace-target",
      provider: "codex",
      providerSessionId: "alias://codex/session-target/session-alias",
      rawStoreRef: "alias://codex/session-target/session-alias",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };
    const binding: SessionBinding = {
      sessionId: "session-target",
      workspaceId: "workspace-target",
      provider: "codex",
      providerSessionId: "provider-session-target",
      rawStoreRef: "raw-session-target",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };
    const index: SessionIndexRecord = {
      sessionId: "session-target",
      workspaceId: "workspace-target",
      provider: "codex",
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      title: "登录页开发",
      messageCount: 6,
      isArchived: false,
      lastMessageAt: "2026-04-02T00:10:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:10:00.000Z"
    };
    const state: SessionStateRecord = {
      sessionId: "session-target",
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-04-02T00:10:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-04-02T00:10:00.000Z"
    };
    const createdSessions: ButlerSession[] = [
      {
        id: "butler-session-alias",
        projectId: project.id,
        sessionId: "session-alias",
        role: "adhoc",
        ownershipMode: "observed",
        status: "running",
        lastSummary: "旧 alias 记录",
        lastCheckpointAt: "2026-04-02T00:10:00.000Z",
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:10:00.000Z"
      }
    ];

    const service = new ButlerSessionService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById"> as ButlerProjectRepository,
      {
        listByProject: vi.fn(() => createdSessions),
        findBySessionId: vi.fn((sessionId: string) =>
          createdSessions.find((item) => item.sessionId === sessionId) ?? null
        ),
        create: vi.fn((record: ButlerSession) => {
          createdSessions.push(record);
          return record;
        })
      } satisfies Pick<ButlerSessionRepository, "listByProject" | "findBySessionId" | "create"> as ButlerSessionRepository,
      {
        getLatestSeq: vi.fn(() => 0),
        create: vi.fn((record) => record)
      } satisfies Pick<SessionCheckpointRepository, "getLatestSeq" | "create"> as SessionCheckpointRepository,
      {
        findBySessionId: vi.fn((sessionId: string) => {
          if (sessionId === "session-alias") {
            return aliasBinding;
          }

          if (sessionId === "session-target") {
            return binding;
          }

          return null;
        })
      } satisfies Pick<SessionBindingRepository, "findBySessionId"> as SessionBindingRepository,
      {
        findIndexRecordBySessionId: vi.fn((sessionId: string) => {
          return sessionId === "session-target" ? index : null;
        })
      } satisfies Pick<SessionIndexRepository, "findIndexRecordBySessionId"> as SessionIndexRepository,
      {
        findBySessionAndUser: vi.fn((sessionId: string) => {
          return sessionId === "session-target" ? state : null;
        })
      } satisfies Pick<SessionStateRepository, "findBySessionAndUser"> as SessionStateRepository,
      undefined,
      {
        discoverWorkspaceSessions: vi.fn(async () => undefined),
        listWorkspaceSessions: vi.fn(() => [
          {
            sessionId: "session-target",
            workspaceId: "workspace-target",
            provider: "codex",
            providerSessionId: "provider-session-target",
            rawStoreRef: "raw-session-target",
            parentSessionId: null,
            isSubagent: false,
            subagentLabel: null,
            isArchived: false,
            isFavorite: false,
            title: "登录页开发",
            messageCount: 6,
            lastMessageAt: "2026-04-02T00:10:00.000Z",
            createdAt: "2026-04-02T00:00:00.000Z",
            updatedAt: "2026-04-02T00:10:00.000Z",
            syncStatus: null,
            syncCursor: null,
            lastSyncAt: null,
            lastErrorCode: null,
            lastErrorDetail: null,
            resumedAt: null,
            runningState: "running",
            activitySource: "runtime",
            lastEventAt: "2026-04-02T00:10:00.000Z",
            completedAt: null,
            lastSeenAt: null,
            activityState: "running"
          } satisfies SessionListItem
        ]),
        resumeSession: vi.fn()
      } as never
    );

    const target = await service.resolveActionTarget(project.id, "session-alias", "user-1");

    expect(target.workspaceId).toBe("workspace-target");
    expect(target.session.sessionId).toBe("session-target");
    expect(target.session.provider).toBe("codex");
  });
});

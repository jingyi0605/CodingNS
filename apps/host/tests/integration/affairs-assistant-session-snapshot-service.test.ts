import { describe, expect, it, vi } from "vitest";

import { AffairsAssistantSessionSnapshotService } from "../../src/modules/workbench/affairs-assistant-session-snapshot-service.js";
import type { AffairsAssistantSessionSnapshotRepository } from "../../src/storage/repositories/affairs-assistant-session-snapshot-repository.js";
import type { AffairsAssistantSessionSnapshotRecord, ButlerProject } from "../../src/types/domain.js";

describe("AffairsAssistantSessionSnapshotService", () => {
  it("刷新事务助手会话快照时保留已读状态", async () => {
    const records = new Map<string, AffairsAssistantSessionSnapshotRecord>();
    const repository = {
      findByWorkspaceAndUserId: vi.fn((workspaceId: string, userId: string) => (
        records.get(`${workspaceId}:${userId}`) ?? null
      )),
      upsert: vi.fn((record: AffairsAssistantSessionSnapshotRecord) => {
        records.set(`${record.workspaceId}:${record.userId}`, record);
        return record;
      })
    } satisfies Pick<AffairsAssistantSessionSnapshotRepository, "findByWorkspaceAndUserId" | "upsert">;

    const project: ButlerProject = {
      id: "project-1",
      workspaceId: "agent-workspace-1",
      name: "事务助手项目",
      repoRoot: "/Users/jackson/SynologyDrive/Obsidian",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      archivedAt: null
    };

    const service = new AffairsAssistantSessionSnapshotService(
      repository as unknown as AffairsAssistantSessionSnapshotRepository,
      {
        getBinding: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          enabled: true,
          rootDir: "/Users/jackson/SynologyDrive/Obsidian",
          mirrorRoot: null,
          createdAt: "2026-06-06T10:00:00.000Z",
          updatedAt: "2026-06-06T10:00:00.000Z"
        }))
      },
      {
        list: vi.fn(() => [project])
      },
      {
        ensureProjectSessionsSynced: vi.fn(async () => undefined),
        listByProject: vi.fn(() => [{
          id: "butler-session-1",
          projectId: project.id,
          sessionId: "session-1",
          provider: "codex",
          title: "已经读过的会话",
          isArchived: false,
          isFavorite: false,
          role: "adhoc",
          ownershipMode: "observed",
          status: "closed",
          runningState: "completed",
          lastEventAt: "2026-06-06T10:00:00.000Z",
          completedAt: "2026-06-06T10:00:00.000Z",
          lastSeenAt: "2026-06-06T10:05:00.000Z",
          lastSummary: null,
          lastCheckpointAt: null,
          createdAt: "2026-06-06T09:55:00.000Z",
          updatedAt: "2026-06-06T10:00:00.000Z"
        }])
      }
    );

    const snapshot = await service.refreshNow("workspace-1", "user-1", { force: true });

    expect(snapshot.sessions[0]).toMatchObject({
      sessionId: "session-1",
      completedAt: "2026-06-06T10:00:00.000Z",
      lastSeenAt: "2026-06-06T10:05:00.000Z",
      activityState: "idle"
    });
  });

  it("刷新事务助手会话快照时只安排后台同步，不阻塞等待 workspace discovery", async () => {
    const records = new Map<string, AffairsAssistantSessionSnapshotRecord>();
    const repository = {
      findByWorkspaceAndUserId: vi.fn((workspaceId: string, userId: string) => (
        records.get(`${workspaceId}:${userId}`) ?? null
      )),
      upsert: vi.fn((record: AffairsAssistantSessionSnapshotRecord) => {
        records.set(`${record.workspaceId}:${record.userId}`, record);
        return record;
      })
    } satisfies Pick<AffairsAssistantSessionSnapshotRepository, "findByWorkspaceAndUserId" | "upsert">;

    const project: ButlerProject = {
      id: "project-1",
      workspaceId: "agent-workspace-1",
      name: "事务助手项目",
      repoRoot: "/Users/jackson/SynologyDrive/Obsidian",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      archivedAt: null
    };

    const ensureProjectSessionsSynced = vi.fn(async () => undefined);
    const service = new AffairsAssistantSessionSnapshotService(
      repository as unknown as AffairsAssistantSessionSnapshotRepository,
      {
        getBinding: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          enabled: true,
          rootDir: "/Users/jackson/SynologyDrive/Obsidian",
          mirrorRoot: null,
          createdAt: "2026-06-06T10:00:00.000Z",
          updatedAt: "2026-06-06T10:00:00.000Z"
        }))
      },
      {
        list: vi.fn(() => [project])
      },
      {
        ensureProjectSessionsSynced,
        listByProject: vi.fn(() => [])
      }
    );

    await service.refreshNow("workspace-1", "user-1", { force: true });

    expect(ensureProjectSessionsSynced).toHaveBeenCalledWith(project.id, "user-1", {
      includeArchived: true,
      force: true,
      mode: "background",
      signal: expect.any(AbortSignal)
    });
  });
});

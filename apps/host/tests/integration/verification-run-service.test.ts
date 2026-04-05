import { describe, expect, it, vi } from "vitest";

import { VerificationRunService } from "../../src/modules/butler/verification-run-service.js";
import type { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import type { ButlerSessionRepository } from "../../src/storage/repositories/butler-session-repository.js";
import type { SessionCheckpointRepository } from "../../src/storage/repositories/session-checkpoint-repository.js";
import type {
  VerificationRunRecord,
  VerificationRunRepository
} from "../../src/storage/repositories/verification-run-repository.js";
import type { ButlerProject, ButlerSession } from "../../src/types/domain.js";

describe("VerificationRunService", () => {
  it("会执行 test 验证并把结果回写到项目与会话", async () => {
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
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      archivedAt: null
    };
    let session: ButlerSession = {
      id: "butler-session-1",
      projectId: project.id,
      sessionId: "session-1",
      role: "verification",
      ownershipMode: "managed",
      status: "idle",
      lastSummary: null,
      lastCheckpointAt: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z"
    };
    const checkpoints: string[] = [];
    let persistedProject = project;
    const runRecords = new Map<string, VerificationRunRecord>();

    const service = new VerificationRunService(
      {
        findById: vi.fn(() => persistedProject),
        update: vi.fn((record: ButlerProject) => {
          persistedProject = record;
          return record;
        })
      } satisfies Pick<ButlerProjectRepository, "findById" | "update"> as ButlerProjectRepository,
      {
        findById: vi.fn(() => session),
        update: vi.fn((record: ButlerSession) => {
          session = record;
          return record;
        })
      } satisfies Pick<ButlerSessionRepository, "findById" | "update"> as ButlerSessionRepository,
      {
        getLatestSeq: vi.fn(() => checkpoints.length),
        create: vi.fn((record) => {
          checkpoints.push(record.summary);
          return record;
        })
      } satisfies Pick<SessionCheckpointRepository, "getLatestSeq" | "create"> as SessionCheckpointRepository,
      {
        create: vi.fn((record: VerificationRunRecord) => {
          runRecords.set(record.id, record);
          return record;
        }),
        update: vi.fn((record: VerificationRunRecord) => {
          runRecords.set(record.id, record);
          return record;
        }),
        findById: vi.fn((id: string) => runRecords.get(id) ?? null),
        listRunningByProject: vi.fn(() => []),
        listByProject: vi.fn(() => Array.from(runRecords.values()))
      } satisfies Pick<
        VerificationRunRepository,
        "create" | "update" | "findById" | "listRunningByProject" | "listByProject"
      > as VerificationRunRepository,
      {
        now: () => "2026-04-03T01:00:00.000Z",
        runCommand: vi.fn(async () => ({
          exitCode: 0,
          stdout: "all green",
          stderr: ""
        }))
      }
    );

    const run = await service.startRun(project.id, {
      verificationType: "test",
      butlerSessionId: session.id,
      spec: {
        command: "pnpm",
        args: ["test", "--runInBand"]
      }
    });

    expect(run.status).toBe("passed");
    expect(run.summary).toContain("测试验证通过");
    expect(run.result).toMatchObject({
      exitCode: 0
    });
    expect(persistedProject.lastVerificationAt).toBe("2026-04-03T01:00:00.000Z");
    expect(checkpoints.at(-1)).toContain("测试验证通过");
    expect(session.lastSummary).toContain("测试验证通过");
  });

  it("会拒绝当前阶段不支持的 browser 验证类型", async () => {
    const project: ButlerProject = {
      id: "project-2",
      workspaceId: "workspace-1",
      name: "repo-b",
      repoRoot: "/tmp/repo-b",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "readonly",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      archivedAt: null
    };

    const service = new VerificationRunService(
      {
        findById: vi.fn(() => project)
      } satisfies Pick<ButlerProjectRepository, "findById"> as ButlerProjectRepository,
      {
        findById: vi.fn(() => null),
        update: vi.fn()
      } satisfies Pick<ButlerSessionRepository, "findById" | "update"> as ButlerSessionRepository,
      {
        getLatestSeq: vi.fn(() => 0),
        create: vi.fn()
      } satisfies Pick<SessionCheckpointRepository, "getLatestSeq" | "create"> as SessionCheckpointRepository,
      {
        create: vi.fn(),
        update: vi.fn(),
        findById: vi.fn(() => null),
        listRunningByProject: vi.fn(() => []),
        listByProject: vi.fn(() => [])
      } satisfies Pick<
        VerificationRunRepository,
        "create" | "update" | "findById" | "listRunningByProject" | "listByProject"
      > as VerificationRunRepository
    );

    await expect(
      service.startRun(project.id, {
        verificationType: "browser",
        targetRef: "http://127.0.0.1:3000"
      })
    ).rejects.toMatchObject({
      errorCode: "VERIFICATION_TYPE_UNSUPPORTED"
    });
  });
});

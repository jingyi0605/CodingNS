import { describe, expect, it, vi } from "vitest";

import type { ButlerProfileService } from "../../src/modules/butler/butler-profile-service.js";
import type { ButlerProjectService } from "../../src/modules/butler/butler-project-service.js";
import type { ButlerSessionService } from "../../src/modules/butler/butler-session-service.js";
import { ButlerContextAggregator } from "../../src/modules/butler/context-aggregator.js";
import type { ProjectMemoryService } from "../../src/modules/butler/project-memory-service.js";
import type { PatrolRunService } from "../../src/modules/butler/patrol-run-service.js";
import type { VerificationRunService } from "../../src/modules/butler/verification-run-service.js";
import type { SessionCheckpointRepository } from "../../src/storage/repositories/session-checkpoint-repository.js";
import type { ButlerProject } from "../../src/types/domain.js";

describe("ButlerContextAggregator", () => {
  it("会按摘要层聚合项目上下文，并优先命中用户当前提到的项目范围", async () => {
    const projectOne: ButlerProject = {
      id: "project-1",
      workspaceId: "workspace-1",
      name: "控制台",
      repoRoot: "/tmp/control-app",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "high",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T01:00:00.000Z",
      archivedAt: null
    };
    const projectTwo: ButlerProject = {
      ...projectOne,
      id: "project-2",
      name: "官网",
      repoRoot: "/tmp/site-app",
      riskLevel: "low",
      updatedAt: "2026-04-04T01:00:00.000Z"
    };
    const aggregator = new ButlerContextAggregator(
      {
        getProfile: vi.fn(() => ({
          focus: {
            projectIds: ["project-1"]
          }
        }))
      } as unknown as Pick<ButlerProfileService, "getProfile">,
      {
        list: vi.fn(() => [projectOne, projectTwo]),
        getById: vi.fn((projectId: string) =>
          projectId === "project-1" ? projectOne : projectId === "project-2" ? projectTwo : null
        )
      } as unknown as Pick<ButlerProjectService, "getById" | "list">,
      {
        ensureProjectSessionsSynced: vi.fn(async () => {}),
        listByProject: vi.fn((projectId: string) =>
          projectId === "project-1"
            ? [
                {
                  id: "butler-session-1",
                  projectId: "project-1",
                  sessionId: "session-1",
                  provider: "codex",
                  title: "修复控制台",
                  isArchived: false,
                  role: "execution",
                  ownershipMode: "managed",
                  status: "blocked",
                  runningState: "running",
                  lastSummary: "构建被类型错误卡住",
                  lastCheckpointAt: "2026-04-05T01:10:00.000Z",
                  createdAt: "2026-04-05T00:30:00.000Z",
                  updatedAt: "2026-04-05T01:10:00.000Z"
                }
              ]
            : []
        )
      } as unknown as Pick<ButlerSessionService, "ensureProjectSessionsSynced" | "listByProject">,
      {
        listItems: vi.fn((filters?: { projectId?: string }) =>
          filters?.projectId === "project-1"
            ? [
                {
                  id: "inbox-1",
                  projectId: "project-1",
                  workspaceId: "workspace-1",
                  projectName: "控制台",
                  projectLifecycleStatus: "active",
                  itemType: "bug",
                  title: "修复控制台类型错误",
                  content: "先把 host 里的 TypeScript 报错清掉。",
                  priority: "high",
                  status: "in_progress",
                  createdAt: "2026-04-05T00:20:00.000Z",
                  updatedAt: "2026-04-05T01:09:00.000Z",
                  closedAt: null
                }
              ]
            : []
        )
      } as never,
      {
        listMemories: vi.fn((projectId: string) =>
          projectId === "project-1"
            ? [
                {
                  id: "memory-1",
                  projectId: "project-1",
                  sourceButlerSessionId: null,
                  sourceCheckpointId: null,
                  memoryType: "decision",
                  title: "类型错误要先修",
                  scopePath: "apps/host/src",
                  content: "这里故意放正文，聚合结果不应该默认透出它。",
                  tags: ["typescript"],
                  confidence: 0.8,
                  status: "active",
                  evidence: {},
                  supersededBy: null,
                  createdAt: "2026-04-05T00:40:00.000Z",
                  updatedAt: "2026-04-05T00:40:00.000Z"
                }
              ]
            : []
        )
      } as unknown as Pick<ProjectMemoryService, "listMemories">,
      {
        listRuns: vi.fn((projectId: string) =>
          projectId === "project-1"
            ? [
                {
                  id: "patrol-1",
                  projectId: "project-1",
                  planId: null,
                  triggeredBy: "user",
                  triggerRef: null,
                  butlerSessionId: null,
                  status: "failed",
                  summary: "巡视发现 host 模块有未处理错误",
                  riskLevel: "high",
                  suggestions: ["先修复 host 模块错误"],
                  startedAt: "2026-04-05T01:05:00.000Z",
                  finishedAt: "2026-04-05T01:06:00.000Z",
                  createdAt: "2026-04-05T01:04:00.000Z"
                }
              ]
            : []
        )
      } as unknown as Pick<PatrolRunService, "listRuns">,
      {
        listRuns: vi.fn((projectId: string) =>
          projectId === "project-1"
            ? [
                {
                  id: "verification-1",
                  projectId: "project-1",
                  butlerSessionId: null,
                  sourcePatrolRunId: null,
                  verificationType: "test",
                  status: "failed",
                  targetRef: "apps/host",
                  spec: {},
                  artifactRefs: [],
                  result: {},
                  summary: "host 类型检查失败",
                  startedAt: "2026-04-05T01:07:00.000Z",
                  finishedAt: "2026-04-05T01:08:00.000Z",
                  createdAt: "2026-04-05T01:07:00.000Z"
                }
              ]
            : []
        )
      } as unknown as Pick<VerificationRunService, "listRuns">,
      {
        listByButlerSessionId: vi.fn(() => [
          {
            id: "checkpoint-1",
            butlerSessionId: "butler-session-1",
            checkpointSeq: 1,
            sourceKind: "manual",
            progressState: "blocked",
            summary: "类型错误阻塞",
            riskFlags: ["TypeScript 编译失败"],
            nextActions: ["先修复 TypeScript 编译错误"],
            capturedAt: "2026-04-05T01:10:00.000Z"
          }
        ])
      } as unknown as Pick<SessionCheckpointRepository, "listByButlerSessionId">
    );

    const snapshot = await aggregator.getSnapshot("user-1");
    const promptContext = await aggregator.resolvePromptContext("user-1", "这个项目现在卡在哪");
    const searchResult = await aggregator.searchSummaries("user-1", "类型错误");

    expect(snapshot.global.blockedProjectCount).toBe(1);
    expect(snapshot.global.highRiskProjectCount).toBe(1);
    expect(snapshot.projects[0]?.id).toBe("project-1");
    expect(snapshot.projects[0]?.topRisks.join(" ")).toContain("TypeScript 编译失败");
    expect("content" in snapshot.memories[0]!).toBe(false);
    expect(promptContext.scope).toBe("project");
    expect(promptContext.projectId).toBe("project-1");
    expect(promptContext.prompt).toContain("项目 控制台");
    expect(promptContext.prompt).toContain("摘要命中");
    expect(searchResult.items.length).toBeGreaterThan(0);
    expect(searchResult.items.some((item) => item.kind === "session")).toBe(true);
    expect(searchResult.items.some((item) => item.summary.includes("类型错误"))).toBe(true);
    expect(searchResult.items.find((item) => item.kind === "session")?.sessionId).toBe("session-1");
    expect(searchResult.items.find((item) => item.kind === "session")?.isArchived).toBe(false);
  });
});

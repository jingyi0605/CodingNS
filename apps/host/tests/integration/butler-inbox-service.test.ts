import { describe, expect, it, vi } from "vitest";

import type { ButlerInboxItem, ButlerProject } from "../../src/types/domain.js";
import type { ButlerInboxItemRepository } from "../../src/storage/repositories/butler-inbox-item-repository.js";
import type { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import { ButlerInboxService } from "../../src/modules/butler/butler-inbox-service.js";

async function waitForAsyncTask(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("ButlerInboxService", () => {
  it("可以创建、筛选并更新收件箱事项", () => {
    const projectA: ButlerProject = {
      id: "project-a",
      workspaceId: "workspace-1",
      name: "项目甲",
      repoRoot: "/tmp/project-a",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:00:00.000Z",
      archivedAt: null
    };
    const projectB: ButlerProject = {
      ...projectA,
      id: "project-b",
      workspaceId: "workspace-2",
      name: "项目乙"
    };
    const items: ButlerInboxItem[] = [];

    const projectRepository = {
      findById: vi.fn((id: string) => [projectA, projectB].find((project) => project.id === id) ?? null),
      list: vi.fn(() => [projectA, projectB])
    } satisfies Pick<ButlerProjectRepository, "findById" | "list">;
    const inboxItemRepository = {
      create: vi.fn((record: ButlerInboxItem) => {
        items.push(record);
        return record;
      }),
      list: vi.fn((filters?: { projectId?: string; status?: string; itemType?: string }) =>
        items.filter((item) => {
          if (filters?.projectId && item.projectId !== filters.projectId) {
            return false;
          }

          if (filters?.status && item.status !== filters.status) {
            return false;
          }

          if (filters?.itemType && item.itemType !== filters.itemType) {
            return false;
          }

          return true;
        })
      ),
      findById: vi.fn((id: string) => items.find((item) => item.id === id) ?? null),
      update: vi.fn((record: ButlerInboxItem) => {
        const index = items.findIndex((item) => item.id === record.id);

        if (index >= 0) {
          items[index] = record;
        }

        return record;
      }),
      delete: vi.fn((id: string) => {
        const index = items.findIndex((item) => item.id === id);

        if (index >= 0) {
          items.splice(index, 1);
        }
      })
    } satisfies Pick<ButlerInboxItemRepository, "create" | "list" | "findById" | "update" | "delete">;

    const service = new ButlerInboxService(
      projectRepository as unknown as ButlerProjectRepository,
      inboxItemRepository as unknown as ButlerInboxItemRepository
    );

    const created = service.createItem({
      projectId: projectA.id,
      itemType: "bug",
      title: "登录失败",
      content: "用户反馈验证码通过后仍然无法登录",
      priority: "high"
    });

    expect(created.projectName).toBe("项目甲");
    expect(created.workspaceId).toBe("workspace-1");

    const filtered = service.listItems({
      workspaceId: "workspace-1"
    });
    expect(filtered).toHaveLength(1);

    const updated = service.updateItem(created.id, {
      status: "closed"
    });
    expect(updated.status).toBe("closed");
    expect(updated.closedAt).not.toBeNull();
    expect(updated.assistantState.lifecycleStage).toBe("completed");

    service.deleteItem(created.id);
    expect(service.listItems()).toHaveLength(0);
  });

  it("代办分析会进入后台任务，并在完成后写入助手分析结果", async () => {
    const project: ButlerProject = {
      id: "project-a",
      workspaceId: "workspace-1",
      name: "项目甲",
      repoRoot: "/tmp/project-a",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:00:00.000Z",
      archivedAt: null
    };
    const initialItem: ButlerInboxItem = {
      id: "todo-1",
      projectId: project.id,
      itemType: "task",
      title: "验证码收尾",
      content: "登录错误三次以后显示图形验证码",
      priority: "high",
      status: "pending",
      assistantState: {
        lifecycleStage: "pending",
        analysisSummary: null,
        generatedPrompt: null,
        analysisControlSessionId: null,
        analysisSessionId: null,
        linkedButlerSessionId: null,
        linkedSessionId: null,
        linkedFollowUpTaskId: null,
        lastError: null,
        lastAnalyzedAt: null,
        lastSessionCreatedAt: null,
        lastFollowUpAt: null
      },
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:00:00.000Z",
      closedAt: null
    };
    const items: ButlerInboxItem[] = [initialItem];

    const projectRepository = {
      findById: vi.fn(() => project),
      list: vi.fn(() => [project])
    } satisfies Pick<ButlerProjectRepository, "findById" | "list">;
    const inboxItemRepository = {
      create: vi.fn(),
      list: vi.fn(() => items),
      findById: vi.fn((id: string) => items.find((item) => item.id === id) ?? null),
      update: vi.fn((record: ButlerInboxItem) => {
        const index = items.findIndex((item) => item.id === record.id);
        items[index] = record;
        return record;
      }),
      delete: vi.fn()
    } satisfies Pick<ButlerInboxItemRepository, "create" | "list" | "findById" | "update" | "delete">;
    const butlerInboxAnalysisService = {
      prepareTodoAnalysisSession: vi.fn(async () => ({
        providerId: "codex",
        title: "分析代办：验证码收尾",
        prompt: "请分析当前代办",
        model: "gpt-5.1-codex-mini",
        reasoningLevel: "medium",
        permissionMode: "default"
      })),
      readTodoAnalysisResult: vi.fn(async () => ({
        analysisSummary: "助手通过 codingns assistant 查到当前代办直接关联登录验证码流程。",
        prompt: "请先定位登录失败计数与图形验证码触发逻辑，再用最小改动补齐验证码收尾，并执行必要验证。",
        followUpObjective: "围绕验证码收尾代办补齐登录失败三次后的图形验证码流程。",
        completionCriteria: "登录失败三次后会触发图形验证码，且相关验证结果已经说明清楚。"
      }))
    };
    const butlerControlSessionService = {
      getSession: vi.fn(),
      startSession: vi.fn(async () => ({
        id: "control-1",
        providerId: "codex",
        sessionId: "analysis-session-1",
        purpose: "todo_analysis",
        title: "分析代办：验证码收尾",
        sourceItemId: "todo-1",
        status: "running",
        lastContextVersion: null,
        lastSummary: "分析代办：验证码收尾",
        createdAt: "2026-04-07T00:00:01.000Z",
        updatedAt: "2026-04-07T00:00:01.000Z",
        session: {
          sessionId: "analysis-session-1"
        }
      })),
      updateSessionStatusBySessionId: vi.fn()
    };

    const service = new ButlerInboxService(
      projectRepository as unknown as ButlerProjectRepository,
      inboxItemRepository as unknown as ButlerInboxItemRepository
    );
    service.configureLifecycleServices({
      butlerInboxAnalysisService: butlerInboxAnalysisService as never,
      butlerControlSessionService: butlerControlSessionService as never,
      butlerSessionService: {
        startSession: vi.fn()
      } as never,
      butlerFollowUpService: {
        createTask: vi.fn()
      } as never
    });

    const queued = await service.analyzeItem("todo-1", "user-1");

    expect(queued.item.assistantState.lifecycleStage).toBe("analyzing");
    expect(queued.item.assistantState.generatedPrompt).toBeNull();
    expect(queued.controlSession.sessionId).toBe("analysis-session-1");

    await waitForAsyncTask();

    expect(butlerInboxAnalysisService.prepareTodoAnalysisSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "todo-1",
        projectId: project.id,
        title: "验证码收尾"
      }),
      project,
      "user-1"
    );
    expect(butlerInboxAnalysisService.readTodoAnalysisResult).toHaveBeenCalledWith(
      "analysis-session-1",
      "codex",
      "user-1"
    );
    expect(butlerControlSessionService.updateSessionStatusBySessionId).toHaveBeenCalledWith({
      sessionId: "analysis-session-1",
      status: "idle",
      lastSummary: "助手通过 codingns assistant 查到当前代办直接关联登录验证码流程。"
    });

    const latest = items[0];
    expect(latest.assistantState.analysisSummary).toBe("助手通过 codingns assistant 查到当前代办直接关联登录验证码流程。");
    expect(latest.assistantState.generatedPrompt).toContain("图形验证码触发逻辑");
    expect(latest.assistantState.lifecycleStage).toBe("analyzed");
  });

  it("读取代办列表时会收口已经结束但遗留为 analyzing 的分析状态", () => {
    const project: ButlerProject = {
      id: "project-a",
      workspaceId: "workspace-1",
      name: "项目甲",
      repoRoot: "/tmp/project-a",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:00:00.000Z",
      archivedAt: null
    };
    const items: ButlerInboxItem[] = [{
      id: "todo-1",
      projectId: project.id,
      itemType: "task",
      title: "验证码收尾",
      content: "登录错误三次以后显示图形验证码",
      priority: "high",
      status: "pending",
      assistantState: {
        lifecycleStage: "analyzing",
        analysisSummary: "旧的分析摘要",
        generatedPrompt: "旧的开发提示词",
        analysisControlSessionId: "control-1",
        analysisSessionId: "session-1",
        linkedButlerSessionId: null,
        linkedSessionId: null,
        linkedFollowUpTaskId: null,
        lastError: null,
        lastAnalyzedAt: "2026-04-07T00:10:00.000Z",
        lastSessionCreatedAt: null,
        lastFollowUpAt: null
      },
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:20:00.000Z",
      closedAt: null
    }];

    const projectRepository = {
      findById: vi.fn(() => project),
      list: vi.fn(() => [project])
    } satisfies Pick<ButlerProjectRepository, "findById" | "list">;
    const inboxItemRepository = {
      create: vi.fn(),
      list: vi.fn(() => items),
      findById: vi.fn((id: string) => items.find((item) => item.id === id) ?? null),
      update: vi.fn((record: ButlerInboxItem) => {
        const index = items.findIndex((item) => item.id === record.id);
        items[index] = record;
        return record;
      }),
      delete: vi.fn()
    } satisfies Pick<ButlerInboxItemRepository, "create" | "list" | "findById" | "update" | "delete">;
    const butlerControlSessionService = {
      getSession: vi.fn(() => ({
        id: "control-1",
        providerId: "codex",
        sessionId: "session-1",
        purpose: "todo_analysis",
        title: "分析代办：验证码收尾",
        sourceItemId: "todo-1",
        status: "running",
        lastContextVersion: null,
        lastSummary: "分析代办：验证码收尾",
        createdAt: "2026-04-07T00:20:00.000Z",
        updatedAt: "2026-04-07T00:20:00.000Z",
        session: {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider-session-1",
          rawStoreRef: "raw-store-1",
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "分析代办：验证码收尾",
          messageCount: 0,
          lastMessageAt: null,
          createdAt: "2026-04-07T00:20:00.000Z",
          updatedAt: "2026-04-07T00:20:00.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-04-07T00:21:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "idle",
          activitySource: "runtime",
          activityResolutionSource: "authoritative_runtime",
          activityConfidence: "authoritative",
          runId: null,
          lastEventAt: "2026-04-07T00:21:00.000Z",
          completedAt: "2026-04-07T00:21:00.000Z",
          lastSeenAt: null,
          watchdogTriggeredAt: null,
          activityState: "completed"
        }
      })),
      startSession: vi.fn(),
      updateSessionStatusBySessionId: vi.fn()
    };

    const service = new ButlerInboxService(
      projectRepository as unknown as ButlerProjectRepository,
      inboxItemRepository as unknown as ButlerInboxItemRepository
    );
    service.configureLifecycleServices({
      butlerInboxAnalysisService: {
        prepareTodoAnalysisSession: vi.fn(),
        readTodoAnalysisResult: vi.fn()
      } as never,
      butlerControlSessionService: butlerControlSessionService as never,
      butlerSessionService: {
        startSession: vi.fn()
      } as never,
      butlerFollowUpService: {
        createTask: vi.fn()
      } as never
    });

    const listed = service.listItems({
      workspaceId: "workspace-1",
      userId: "user-1"
    });

    expect(listed).toHaveLength(1);
    expect(listed[0].assistantState.lifecycleStage).toBe("analyzed");
    expect(items[0].assistantState.lifecycleStage).toBe("analyzed");
    expect(butlerControlSessionService.getSession).toHaveBeenCalledWith("control-1", "user-1");
    expect(butlerControlSessionService.updateSessionStatusBySessionId).toHaveBeenCalledWith({
      sessionId: "session-1",
      status: "idle",
      lastSummary: "分析代办：验证码收尾"
    });
  });

  it("再次开始执行时，会优先回收上次失败但底层已存在的会话", async () => {
    const project: ButlerProject = {
      id: "project-a",
      workspaceId: "workspace-1",
      name: "项目甲",
      repoRoot: "/tmp/project-a",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:00:00.000Z",
      archivedAt: null
    };
    const items: ButlerInboxItem[] = [{
      id: "todo-1",
      projectId: project.id,
      itemType: "task",
      title: "验证码收尾",
      content: "登录错误三次以后显示图形验证码",
      priority: "high",
      status: "pending",
      assistantState: {
        lifecycleStage: "failed",
        analysisSummary: "旧分析",
        generatedPrompt: "请检查项目进度",
        analysisControlSessionId: "control-1",
        analysisSessionId: "analysis-session-1",
        linkedButlerSessionId: null,
        linkedSessionId: null,
        linkedFollowUpTaskId: null,
        lastError: "session 索引缺失",
        lastAnalyzedAt: "2026-04-07T00:10:00.000Z",
        lastSessionCreatedAt: null,
        lastFollowUpAt: null
      },
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:20:00.000Z",
      closedAt: null
    }];

    const projectRepository = {
      findById: vi.fn(() => project),
      list: vi.fn(() => [project])
    } satisfies Pick<ButlerProjectRepository, "findById" | "list">;
    const inboxItemRepository = {
      create: vi.fn(),
      list: vi.fn(() => items),
      findById: vi.fn((id: string) => items.find((item) => item.id === id) ?? null),
      update: vi.fn((record: ButlerInboxItem) => {
        const index = items.findIndex((item) => item.id === record.id);
        items[index] = record;
        return record;
      }),
      delete: vi.fn()
    } satisfies Pick<ButlerInboxItemRepository, "create" | "list" | "findById" | "update" | "delete">;
    const recoveredSession = {
      id: "butler-session-1",
      projectId: project.id,
      sessionId: "session-recovered",
      provider: "codex",
      title: "请检查项目进度",
      isArchived: false,
      role: "execution" as const,
      ownershipMode: "managed" as const,
      status: "running" as const,
      runningState: "running" as const,
      lastSummary: "检测到底层会话已存在，已自动回收并重新绑定托管会话，provider=codex",
      lastCheckpointAt: "2026-04-07T00:21:00.000Z",
      createdAt: "2026-04-07T00:20:00.000Z",
      updatedAt: "2026-04-07T00:21:00.000Z"
    };
    const butlerSessionService = {
      recoverManagedSession: vi.fn(() => recoveredSession),
      startSession: vi.fn()
    };
    const butlerFollowUpService = {
      createTask: vi.fn(async () => ({
        id: "follow-up-1",
        projectId: project.id,
        butlerSessionId: recoveredSession.id,
        sessionId: recoveredSession.sessionId,
        createdByUserId: "user-1",
        objective: "围绕代办推进实现",
        completionCriteria: "完成实现",
        maxAutoContinueCount: 5,
        status: "active",
        checkIntervalSeconds: 120,
        lastCheckedAt: null,
        nextCheckAt: null,
        lastObservedRunningState: null,
        lastObservedMessageAt: null,
        lastObservedMessageCount: 0,
        lastAutomationSummary: null,
        lastAutomationAt: null,
        autoContinueCount: 0,
        waitingReason: null,
        rounds: [],
        createdAt: "2026-04-07T00:21:00.000Z",
        updatedAt: "2026-04-07T00:21:00.000Z",
        completedAt: null
      }))
    };

    const service = new ButlerInboxService(
      projectRepository as unknown as ButlerProjectRepository,
      inboxItemRepository as unknown as ButlerInboxItemRepository
    );
    service.configureLifecycleServices({
      butlerInboxAnalysisService: {
        prepareTodoAnalysisSession: vi.fn(),
        readTodoAnalysisResult: vi.fn()
      } as never,
      butlerControlSessionService: {
        getSession: vi.fn(),
        startSession: vi.fn(),
        updateSessionStatusBySessionId: vi.fn()
      } as never,
      butlerSessionService: butlerSessionService as never,
      butlerFollowUpService: butlerFollowUpService as never
    });

    const result = await service.startExecution("todo-1", "user-1");

    expect(butlerSessionService.recoverManagedSession).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({
        role: "execution",
        ownershipMode: "managed",
        content: "请检查项目进度"
      }),
      "user-1",
      expect.objectContaining({
        recoveryReferenceAt: "2026-04-07T00:20:00.000Z"
      })
    );
    expect(butlerSessionService.startSession).not.toHaveBeenCalled();
    expect(result.session.sessionId).toBe("session-recovered");
    expect(items[0].assistantState.linkedButlerSessionId).toBe("butler-session-1");
    expect(items[0].assistantState.linkedSessionId).toBe("session-recovered");
    expect(items[0].assistantState.lifecycleStage).toBe("follow_up_active");
  });
});

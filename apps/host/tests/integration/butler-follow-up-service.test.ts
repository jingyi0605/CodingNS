import { describe, expect, it, vi } from "vitest";

import { ButlerFollowUpEvaluationInstructionAdapter } from "../../src/modules/butler/butler-follow-up-evaluation-instruction-adapter.js";
import { ButlerFollowUpService } from "../../src/modules/butler/butler-follow-up-service.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import type { ProviderAdapterRegistry } from "../../src/modules/butler/provider-adapter-registry.js";
import type { ButlerFollowUpTask, ButlerProject, ButlerSession } from "../../src/types/domain.js";
import type { ButlerProfileService } from "../../src/modules/butler/butler-profile-service.js";
import type { ButlerProjectService } from "../../src/modules/butler/butler-project-service.js";
import type { ButlerSessionService } from "../../src/modules/butler/butler-session-service.js";
import type { ButlerFollowUpTaskRepository } from "../../src/storage/repositories/butler-follow-up-task-repository.js";
import type { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import type { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import type { SessionLiveRuntimeService } from "../../src/modules/sessions/session-live-runtime-service.js";
import type { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";
import type { SessionMessageOriginRepository } from "../../src/storage/repositories/session-message-origin-repository.js";

describe("ButlerFollowUpService", () => {
  function createService(options: {
    latestAssistantText?: string;
    runningState?: "completed" | "failed" | "interrupted" | "running";
    sendLiveMessageError?: Error;
    enqueueLiveMessageError?: Error;
    evaluationJson: {
      decision: "continue" | "waiting_user" | "completed" | "failed";
      summary: string;
      waitingReason?: string | null;
      continuePrompt?: string | null;
      riskLevel?: "low" | "medium" | "high";
    };
  }) {
    const project: ButlerProject = {
      id: "project-1",
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
    const butlerSession: ButlerSession = {
      id: "butler-session-1",
      projectId: "project-1",
      sessionId: "session-1",
      role: "adhoc",
      ownershipMode: "observed",
      status: "running",
      lastSummary: "上一轮已经收尾，但还有遗漏。",
      lastCheckpointAt: "2026-04-07T00:05:00.000Z",
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:05:00.000Z"
    };
    const records = new Map<string, ButlerFollowUpTask>();
    const taskRepository = {
      create: vi.fn((record: ButlerFollowUpTask) => {
        records.set(record.id, record);
        return record;
      }),
      findById: vi.fn((id: string) => records.get(id) ?? null),
      findActiveByButlerSessionId: vi.fn(() => null),
      list: vi.fn(() => Array.from(records.values())),
      update: vi.fn((record: ButlerFollowUpTask) => {
        records.set(record.id, record);
        return record;
      })
    } as unknown as ButlerFollowUpTaskRepository;
    const sendLiveMessage = vi.fn(async (input: { clientRequestId: string | null }) => {
      if (options.sendLiveMessageError) {
        throw options.sendLiveMessageError;
      }

      return {
        sessionId: "session-1",
        acceptedAt: "2026-04-07T00:06:00.000Z",
        clientRequestId: input.clientRequestId,
        provider: "codex",
        providerSessionId: "provider-session-1",
        message: {
          messageId: "message-1",
          provider: "codex",
          providerSessionId: "provider-session-1",
          role: "user",
          content: options.evaluationJson.continuePrompt ?? "继续推进",
          timestamp: "2026-04-07T00:06:00.000Z",
          sequence: 13,
          rawRef: "raw-1"
        }
      };
    });
    const enqueueLiveMessage = vi.fn(async (input: { clientRequestId: string | null; content: string }) => {
      if (options.enqueueLiveMessageError) {
        throw options.enqueueLiveMessageError;
      }

      return {
        id: "queue-1",
        sessionId: "session-1",
        content: input.content,
        clientRequestId: input.clientRequestId,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        status: "queued",
        orderIndex: 1,
        errorDetail: null,
        createdAt: "2026-04-07T00:06:00.000Z",
        updatedAt: "2026-04-07T00:06:00.000Z"
      };
    });
    const startPatrolSession = vi.fn(async () => ({
      sessionId: "follow-up-eval-session-1",
      provider: "codex",
      providerSessionId: "provider-follow-up-1",
      acceptedAt: "2026-04-07T00:05:30.000Z"
    }));
    const waitForSessionTerminal = vi.fn(async () => {});
    const readPatrolResult = vi.fn(async () => ({
      assistantMessages: [
        `${options.evaluationJson.summary}\n\`\`\`json\n${JSON.stringify(options.evaluationJson, null, 2)}\n\`\`\``
      ],
      latestAssistantMessage:
        `${options.evaluationJson.summary}\n\`\`\`json\n${JSON.stringify(options.evaluationJson, null, 2)}\n\`\`\``,
      structured: {
        summary: options.evaluationJson.summary,
        riskLevel: options.evaluationJson.riskLevel ?? "medium",
        suggestions: [],
        progressState: "working",
        riskFlags: [],
        nextActions: [],
        rawJson: JSON.stringify(options.evaluationJson)
      }
    }));
    const providerAdapterRegistry = {
      get: vi.fn(() => ({
        startPatrolSession,
        waitForSessionTerminal,
        readPatrolResult
      }))
    } as unknown as ProviderAdapterRegistry;
    const workspaceService = {
      importWorkspace: vi.fn(() => ({
        id: "workspace-follow-up",
        name: "代码助手",
        path: "/tmp/butler-follow-up",
        repoRoot: "/tmp/butler-follow-up",
        favorite: false,
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:00:00.000Z"
      }))
    } as unknown as Pick<WorkspaceService, "importWorkspace">;
    const sessionMessageOriginRepository = {
      upsert: vi.fn()
    } as unknown as Pick<SessionMessageOriginRepository, "upsert">;
    const sessionHistoryService = {
      getSession: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "provider-session-1",
        rawStoreRef: "raw-session-1",
        title: "登录页开发",
        messageCount: 12,
        lastMessageAt: "2026-04-07T00:05:00.000Z",
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:05:00.000Z",
        syncStatus: null,
        syncCursor: null,
        lastSyncAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: options.runningState ?? "completed",
        activitySource: "runtime",
        lastEventAt: null,
        completedAt: "2026-04-07T00:05:00.000Z",
        lastSeenAt: null,
        activityState: "completed_unread"
      })),
      readRecentHistoryEnvelope: vi.fn(async () => ({
        type: "session.delta",
        sessionId: "session-1",
        cursor: "cursor-1",
        messages: [
          {
            messageId: "assistant-1",
            provider: "codex",
            providerSessionId: "provider-session-1",
            role: "assistant",
            kind: "text",
            content: options.latestAssistantText ?? "登录页验证码已经接通，但 spec 还有收尾项没有完成。",
            timestamp: "2026-04-07T00:05:00.000Z",
            sequence: 12,
            rawRef: "raw-1"
          }
        ]
      }))
    } as unknown as Pick<SessionHistoryService, "getSession" | "readRecentHistoryEnvelope">;
    const sessionLiveRuntimeService = {
      getSessionRuntime: vi.fn(async () => ({
        sessionId: "session-1",
        runningState: options.runningState ?? "completed"
      })),
      sendLiveMessage,
      enqueueLiveMessage
    } as unknown as Pick<
      SessionLiveRuntimeService,
      "getSessionRuntime" | "sendLiveMessage" | "enqueueLiveMessage"
    >;
    const service = new ButlerFollowUpService(
      {
        ensureInitialized: vi.fn(() => ({
          id: "default",
          displayName: "哆哆",
          providerId: "codex",
          workspacePath: "/tmp/butler-workspace"
        }))
      } as unknown as Pick<ButlerProfileService, "ensureInitialized">,
      {
        getById: vi.fn(() => project)
      } as unknown as Pick<ButlerProjectService, "getById">,
      {
        captureSessionSnapshot: vi.fn(() => ({
          ...butlerSession,
          provider: "codex",
          title: "登录页开发",
          isArchived: false,
          runningState: options.runningState ?? "completed"
        }))
      } as unknown as Pick<ButlerSessionService, "captureSessionSnapshot">,
      taskRepository,
      sessionHistoryService,
      {
        findIndexRecordBySessionId: vi.fn(() => ({
          sessionId: "session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          title: "登录页开发",
          messageCount: 12,
          isArchived: false,
          lastMessageAt: "2026-04-07T00:05:00.000Z",
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:05:00.000Z"
        }))
      } as unknown as Pick<SessionIndexRepository, "findIndexRecordBySessionId">,
      sessionLiveRuntimeService,
      workspaceService,
      providerAdapterRegistry,
      new ButlerFollowUpEvaluationInstructionAdapter(),
      "/tmp/butler-follow-up-codex-home",
      "/tmp/codex-home",
      sessionMessageOriginRepository
    );

    return {
      service,
      sendLiveMessage,
      enqueueLiveMessage,
      startPatrolSession,
      waitForSessionTerminal,
      readPatrolResult,
      workspaceService,
      providerAdapterRegistry,
      sessionMessageOriginRepository,
      sessionHistoryService,
      sessionLiveRuntimeService
    };
  }

  it("会把 spec 约束写进评估提示，并在需要继续推进时自动补发消息", async () => {
    const { service, sendLiveMessage, readPatrolResult, providerAdapterRegistry, startPatrolSession, sessionMessageOriginRepository } = createService({
      evaluationJson: {
        decision: "continue",
        summary: "目标还没做完，继续推进当前 spec 的剩余开发。",
        waitingReason: null,
        continuePrompt: "继续未完成的开发工作，先核对当前 spec 还有哪些收尾项没做完，再直接补齐。",
        riskLevel: "medium"
      }
    });

    const created = await service.createTask(
      {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "把这个功能真正做完"
      },
      "user-1"
    );

    expect(created.status).toBe("active");
    expect(created.autoContinueCount).toBe(1);
    expect(created.lastAutomationSummary).toContain("继续推进当前 spec");
    expect(sendLiveMessage).toHaveBeenCalledTimes(1);
    expect(sendLiveMessage.mock.calls[0]?.[0].content).toBe(
      "继续未完成的开发工作，先核对当前 spec 还有哪些收尾项没做完，再直接补齐。"
    );
    expect(sendLiveMessage.mock.calls[0]?.[0].clientRequestId).toMatch(/^butler-follow-up:/);
    expect((sessionMessageOriginRepository.upsert as any).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        origin: "butler_proxy",
        originRef: expect.any(String),
        messageId: expect.any(String)
      })
    );
    expect((providerAdapterRegistry.get as any).mock.calls[0][0]).toBe("codex");
    expect(readPatrolResult).toHaveBeenCalledTimes(1);
    expect(startPatrolSession.mock.calls[0]?.[0].prompt).toContain("只围绕这个核心任务判断是否完成");
    expect(startPatrolSession.mock.calls[0]?.[0].prompt).toContain("不要把“建议下一步”");
    expect(startPatrolSession.mock.calls[0]?.[0].prompt).toContain("预设结束条件");
    expect(created.maxAutoContinueCount).toBe(5);
    expect(created.rounds).toHaveLength(2);
    expect(created.rounds[0]).toEqual(
      expect.objectContaining({
        roundNumber: 1,
        kind: "started"
      })
    );
    expect(created.rounds[1]).toEqual(
      expect.objectContaining({
        roundNumber: 2,
        kind: "continue",
        autoContinueCount: 1
      })
    );
  });

  it("运行时追加受限时会自动降级入队，而不是把跟进任务判成失败", async () => {
    const { service, sendLiveMessage, enqueueLiveMessage, sessionMessageOriginRepository } = createService({
      sendLiveMessageError: new AppError({
        statusCode: 409,
        errorCode: "IN_RUN_INPUT_NOT_SUPPORTED",
        detail: "当前会话正在运行，但当前 provider 还不支持在运行中继续输入"
      }),
      evaluationJson: {
        decision: "continue",
        summary: "目标还没做完，继续推进当前 spec 的剩余开发。",
        waitingReason: null,
        continuePrompt: "继续未完成的开发工作，保持故事推进，不要停在总结。",
        riskLevel: "medium"
      }
    });

    const created = await service.createTask(
      {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "帮我把这个会话的故事继续写完"
      },
      "user-1"
    );

    expect(created.status).toBe("active");
    expect(created.autoContinueCount).toBe(1);
    expect(created.lastAutomationSummary).toContain("已转入消息队列");
    expect(sendLiveMessage).toHaveBeenCalledTimes(1);
    expect(enqueueLiveMessage).toHaveBeenCalledTimes(1);
    expect((sessionMessageOriginRepository.upsert as any).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        origin: "butler_proxy",
        originRef: expect.any(String),
        messageId: null
      })
    );
  });

  it("会在会话进入终态时立刻触发重评，而不是继续等下一轮轮询", async () => {
    const { service, sessionHistoryService, sessionLiveRuntimeService } = createService({
      runningState: "running",
      evaluationJson: {
        decision: "completed",
        summary: "当前目标已经完成，跟进任务可以结束。",
        waitingReason: null,
        continuePrompt: null,
        riskLevel: "low"
      }
    });

    const created = await service.createTask(
      {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "把这个功能真正做完"
      },
      "user-1"
    );

    expect(created.status).toBe("active");
    expect(created.nextCheckAt).not.toBeNull();

    (sessionHistoryService.getSession as any).mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "raw-session-1",
      title: "登录页开发",
      messageCount: 13,
      lastMessageAt: "2026-04-07T00:06:30.000Z",
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:06:30.000Z",
      syncStatus: null,
      syncCursor: null,
      lastSyncAt: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "completed",
      activitySource: "runtime",
      lastEventAt: "2026-04-07T00:06:30.000Z",
      completedAt: "2026-04-07T00:06:30.000Z",
      lastSeenAt: null,
      activityState: "completed_unread"
    });
    (sessionLiveRuntimeService.getSessionRuntime as any).mockResolvedValue({
      sessionId: "session-1",
      runningState: "completed"
    });

    await service.handleSessionTerminal("session-1", "2026-04-07T00:06:30.000Z");

    const updated = service.getTask(created.id);
    expect(updated.status).toBe("completed");
    expect(updated.completedAt).toBe("2026-04-07T00:06:30.000Z");
  });

  it("达到自动跟进轮数上限后会停止自动续接，并转成 waiting_user", async () => {
    const { service } = createService({
      evaluationJson: {
        decision: "continue",
        summary: "目标还没做完，继续推进当前 spec 的剩余开发。",
        waitingReason: null,
        continuePrompt: "继续未完成的开发工作。",
        riskLevel: "medium"
      }
    });

    const created = await service.createTask(
      {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "把这个功能真正做完",
        maxAutoContinueCount: 1
      },
      "user-1"
    );

    expect(created.status).toBe("active");
    expect(created.autoContinueCount).toBe(1);

    const afterLimit = await service.processTask(created.id, "2026-04-07T00:07:00.000Z");

    expect(afterLimit.status).toBe("waiting_user");
    expect(afterLimit.nextCheckAt).toBeNull();
    expect(afterLimit.waitingReason).toContain("自动跟进轮数上限");
  });

  it("支持手动终止当前跟进任务", async () => {
    const { service } = createService({
      evaluationJson: {
        decision: "continue",
        summary: "目标还没做完，继续推进当前 spec 的剩余开发。",
        waitingReason: null,
        continuePrompt: "继续未完成的开发工作。",
        riskLevel: "medium"
      }
    });

    const created = await service.createTask(
      {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "把这个功能真正做完"
      },
      "user-1"
    );

    const cancelled = service.cancelTask(created.id, "user-1");

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.nextCheckAt).toBeNull();
    expect(cancelled.lastAutomationSummary).toContain("已手动终止");
  });

  it("会在评估结果要求用户决定时转成 waiting_user", async () => {
    const { service, sendLiveMessage } = createService({
      evaluationJson: {
        decision: "waiting_user",
        summary: "当前需要你决定验证码失败后是锁定账号还是只做重试限制。",
        waitingReason: "需要你确认失败策略。",
        continuePrompt: null,
        riskLevel: "medium"
      }
    });

    const created = await service.createTask(
      {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "把这个功能真正做完"
      },
      "user-1"
    );

    expect(created.status).toBe("waiting_user");
    expect(created.waitingReason).toBe("需要你确认失败策略。");
    expect(created.nextCheckAt).toBeNull();
    expect(sendLiveMessage).not.toHaveBeenCalled();
  });

  it("会在评估结果确认完成时直接收尾", async () => {
    const { service, sendLiveMessage } = createService({
      evaluationJson: {
        decision: "completed",
        summary: "当前目标已经完成，跟进任务可以结束。",
        waitingReason: null,
        continuePrompt: null,
        riskLevel: "low"
      }
    });

    const created = await service.createTask(
      {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "把这个功能真正做完"
      },
      "user-1"
    );

    expect(created.status).toBe("completed");
    expect(created.completedAt).not.toBeNull();
    expect(created.nextCheckAt).toBeNull();
    expect(sendLiveMessage).not.toHaveBeenCalled();
  });

  it("会把 ACTIVE_RUN_EXISTS 降级成入队等待，而不是直接失败", async () => {
    const { service } = createService({
      sendLiveMessageError: Object.assign(new Error("ACTIVE_RUN_EXISTS"), {
        errorCode: "ACTIVE_RUN_EXISTS"
      }),
      evaluationJson: {
        decision: "continue",
        summary: "目标还没做完，继续推进当前 spec 的剩余开发。",
        waitingReason: null,
        continuePrompt: "继续未完成的开发工作。",
        riskLevel: "medium"
      }
    });

    const created = await service.createTask(
      {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "把这个功能真正做完"
      },
      "user-1"
    );

    expect(created.status).toBe("active");
    expect(created.lastAutomationSummary).toContain("已转入消息队列");
    expect(created.waitingReason).toBeNull();
  });
});

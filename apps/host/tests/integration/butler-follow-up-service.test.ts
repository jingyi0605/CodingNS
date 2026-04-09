import { describe, expect, it, vi } from "vitest";

import { ButlerFollowUpEvaluationInstructionAdapter } from "../../src/modules/butler/butler-follow-up-evaluation-instruction-adapter.js";
import { ButlerFollowUpService } from "../../src/modules/butler/butler-follow-up-service.js";
import type { ProviderAdapterRegistry } from "../../src/modules/butler/provider-adapter-registry.js";
import type { ButlerProfileService } from "../../src/modules/butler/butler-profile-service.js";
import type { ButlerProjectService } from "../../src/modules/butler/butler-project-service.js";
import type { ButlerSessionService } from "../../src/modules/butler/butler-session-service.js";
import type { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import type { SessionPermissionRequestView } from "../../src/modules/sessions/session-permission-request-service.js";
import type { SessionLiveRuntimeService } from "../../src/modules/sessions/session-live-runtime-service.js";
import type { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import type { ButlerFollowUpTaskRepository } from "../../src/storage/repositories/butler-follow-up-task-repository.js";
import type { SessionMessageOriginRepository } from "../../src/storage/repositories/session-message-origin-repository.js";
import type { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import type { ButlerFollowUpTask, ButlerProject, ButlerSession } from "../../src/types/domain.js";

describe("ButlerFollowUpService", () => {
  function createService(options: {
    latestAssistantText?: string;
    runningState?: "completed" | "failed" | "interrupted" | "running";
    sendLiveMessageError?: Error;
    enqueueLiveMessageError?: Error;
    permissionRequests?: Array<{
      id: string;
      provider?: "codex" | "claude-code" | "opencode";
      kind?: SessionPermissionRequestView["kind"];
      status?: SessionPermissionRequestView["status"];
      actions?: string[];
    }>;
    initialTasks?: ButlerFollowUpTask[];
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
      name: "登录项目",
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
      lastSummary: "上一次会话已经推进了一半",
      lastCheckpointAt: "2026-04-07T00:05:00.000Z",
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:05:00.000Z"
    };
    const records = new Map<string, ButlerFollowUpTask>();

    for (const task of options.initialTasks ?? []) {
      records.set(task.id, task);
    }

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

    const enqueueLiveMessage = vi.fn(
      async (input: { clientRequestId: string | null; content: string }) => {
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
      }
    );

    const permissionRequests = (options.permissionRequests ?? []).map((request) =>
      createPermissionRequestView(request)
    );
    const listPermissionRequests = vi.fn(async () =>
      permissionRequests.map(clonePermissionRequestView)
    );
    const replyPermissionRequest = vi.fn(
      async (_sessionId: string, _userId: string, requestId: string, input: { action: string }) => {
        const target = permissionRequests.find((request) => request.id === requestId);

        if (target) {
          target.status =
            input.action === "deny" || input.action === "decline" || input.action === "cancel"
              ? "declined"
              : "approved";
        }

        return clonePermissionRequestView(
          target ?? createPermissionRequestView({ id: requestId })
        );
      }
    );

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
            content:
              options.latestAssistantText ??
              "登录页验证码已经接通，但 spec 里还有收尾项没有完成。",
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
      listPermissionRequests,
      replyPermissionRequest,
      sendLiveMessage,
      enqueueLiveMessage
    } as unknown as Pick<
      SessionLiveRuntimeService,
      | "getSessionRuntime"
      | "listPermissionRequests"
      | "replyPermissionRequest"
      | "sendLiveMessage"
      | "enqueueLiveMessage"
    >;

    const service = new ButlerFollowUpService(
      {
        ensureInitialized: vi.fn(() => ({
          id: "default",
          displayName: "代码助手",
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
      listPermissionRequests,
      replyPermissionRequest,
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
    const {
      service,
      sendLiveMessage,
      readPatrolResult,
      providerAdapterRegistry,
      startPatrolSession,
      sessionMessageOriginRepository
    } = createService({
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
    expect(created.rounds).toHaveLength(1);
    expect(created.rounds[0]).toEqual(
      expect.objectContaining({
        roundNumber: 1,
        kind: "continue",
        autoContinueCount: 1
      })
    );
  });

  it("旧 started 轮次不会再占掉第 1 轮", async () => {
    const { service } = createService({
      initialTasks: [createLegacyStartedTask()],
      evaluationJson: {
        decision: "continue",
        summary: "继续真正的跟进动作",
        waitingReason: null,
        continuePrompt: "继续补齐剩余工作",
        riskLevel: "medium"
      }
    });

    expect(service.getTask("task-legacy").rounds).toEqual([]);

    const updated = await service.processTask("task-legacy", "2026-04-07T00:06:00.000Z");

    expect(updated.rounds).toHaveLength(1);
    expect(updated.rounds[0]).toEqual(
      expect.objectContaining({
        roundNumber: 1,
        kind: "continue",
        autoContinueCount: 1
      })
    );
  });

  it("运行时追加受限时会自动降级入队，而不是把跟进任务判成失败", async () => {
    const { service, sendLiveMessage, enqueueLiveMessage, sessionMessageOriginRepository } =
      createService({
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
    expect(cancelled.lastAutomationSummary).toContain("手动终止");
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

  it("会在评估结果确认完成时直接收口", async () => {
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

  it("会每隔 10 秒自动放行当前会话的权限申请", async () => {
    const {
      service,
      listPermissionRequests,
      replyPermissionRequest,
      sendLiveMessage
    } = createService({
      runningState: "running",
      permissionRequests: [
        {
          id: "perm-codex-command",
          provider: "codex",
          kind: "command",
          actions: ["accept", "acceptForSession", "decline", "cancel"]
        },
        {
          id: "perm-claude-file",
          provider: "claude-code",
          kind: "file_change",
          actions: ["allow", "allow_session", "deny"]
        },
        {
          id: "perm-opencode-file",
          provider: "opencode",
          kind: "file_change",
          actions: ["once", "always", "reject"]
        },
        {
          id: "perm-user-input",
          provider: "codex",
          kind: "user_input",
          actions: ["submit"]
        }
      ],
      evaluationJson: {
        decision: "completed",
        summary: "先等权限自动放行",
        waitingReason: null,
        continuePrompt: null,
        riskLevel: "low"
      }
    });

    const created = await service.createTask(
      {
        projectId: "project-1",
        butlerSessionId: "butler-session-1",
        objective: "自动处理当前会话的权限申请"
      },
      "user-1"
    );

    expect(created.status).toBe("active");
    expect(created.rounds).toEqual([]);
    expect(sendLiveMessage).not.toHaveBeenCalled();

    await service.runDueTasks("2026-04-07T00:06:00.000Z");

    expect(listPermissionRequests).toHaveBeenCalledTimes(1);
    expect(replyPermissionRequest.mock.calls).toEqual([
      ["session-1", "user-1", "perm-codex-command", { action: "acceptForSession" }],
      ["session-1", "user-1", "perm-claude-file", { action: "allow_session" }],
      ["session-1", "user-1", "perm-opencode-file", { action: "once" }]
    ]);

    await service.runDueTasks("2026-04-07T00:06:05.000Z");

    expect(listPermissionRequests).toHaveBeenCalledTimes(1);
    expect(replyPermissionRequest).toHaveBeenCalledTimes(3);

    await service.runDueTasks("2026-04-07T00:06:10.000Z");

    expect(listPermissionRequests).toHaveBeenCalledTimes(2);
    expect(replyPermissionRequest).toHaveBeenCalledTimes(3);
  });
});

function createPermissionRequestView(input: {
  id: string;
  provider?: "codex" | "claude-code" | "opencode";
  kind?: SessionPermissionRequestView["kind"];
  status?: SessionPermissionRequestView["status"];
  actions?: string[];
}): SessionPermissionRequestView {
  return {
    id: input.id,
    sessionId: "session-1",
    provider: input.provider ?? "codex",
    providerSessionId: "provider-session-1",
    requestKey: input.id,
    kind: input.kind ?? "command",
    status: input.status ?? "pending",
    title: input.id,
    summary: input.id,
    detail: null,
    reason: null,
    toolName: null,
    command: null,
    cwd: null,
    paths: [],
    permissionProfile: null,
    questions: [],
    actions: (input.actions ?? ["accept"]).map((value) => ({
      value,
      label: value,
      tone: "neutral" as const,
      description: null
    })),
    rawPayload: null,
    createdAt: "2026-04-07T00:06:00.000Z",
    updatedAt: "2026-04-07T00:06:00.000Z",
    resolvedAt: null
  };
}

function clonePermissionRequestView(request: SessionPermissionRequestView): SessionPermissionRequestView {
  return {
    ...request,
    paths: [...request.paths],
    permissionProfile: request.permissionProfile
      ? {
          readPaths: [...request.permissionProfile.readPaths],
          writePaths: [...request.permissionProfile.writePaths],
          networkEnabled: request.permissionProfile.networkEnabled
        }
      : null,
    questions: request.questions.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option }))
    })),
    actions: request.actions.map((action) => ({ ...action }))
  };
}

function createLegacyStartedTask(): ButlerFollowUpTask {
  return {
    id: "task-legacy",
    projectId: "project-1",
    butlerSessionId: "butler-session-1",
    sessionId: "session-1",
    createdByUserId: "user-1",
    objective: "清理 started 轮次",
    completionCriteria: "第一次真正跟进必须显示为第 1 轮",
    maxAutoContinueCount: 5,
    status: "active",
    checkIntervalSeconds: 300,
    lastCheckedAt: null,
    nextCheckAt: null,
    lastObservedRunningState: "completed",
    lastObservedMessageAt: "2026-04-07T00:05:00.000Z",
    lastObservedMessageCount: 12,
    lastAutomationSummary: "开始跟进",
    lastAutomationAt: null,
    autoContinueCount: 0,
    waitingReason: null,
    rounds: [
      {
        roundNumber: 1,
        kind: "started",
        status: "active",
        summary: "开始跟进",
        waitingReason: null,
        continuePrompt: null,
        observedRunningState: "completed",
        autoContinueCount: 0,
        createdAt: "2026-04-07T00:05:00.000Z"
      }
    ],
    createdAt: "2026-04-07T00:05:00.000Z",
    updatedAt: "2026-04-07T00:05:00.000Z",
    completedAt: null
  };
}

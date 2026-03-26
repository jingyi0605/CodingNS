import { describe, expect, it, vi } from "vitest";

import { SessionLiveRuntimeService } from "../../src/modules/sessions/session-live-runtime-service.js";

function createService() {
  const sessionHistoryService = {
    getSession: vi.fn(),
    refreshRuntimeFallbackSession: vi.fn(),
    getSessionCapabilities: vi.fn(),
    getSessionContextUsage: vi.fn(),
    getBindingOrThrow: vi.fn(),
    findLatestUserMessage: vi.fn(),
    persistSessionBinding: vi.fn(),
    syncSessionTitle: vi.fn()
  };
  const sessionMessageAttachmentService = {
    persistImageAttachments: vi.fn(() => ({
      messageAttachments: [],
      runtimeAttachments: []
    })),
    getRuntimeAttachments: vi.fn(() => []),
    deletePendingAttachments: vi.fn(),
    buildProviderPrompt: vi.fn(() => null),
    buildAcceptedContentCandidates: vi.fn((content: string) => [content]),
    bindClientRequestToMessage: vi.fn(() => [])
  };
  const workspaceService = {
    getWorkspaceOrThrow: vi.fn(),
    findWorkspaceByPath: vi.fn()
  };
  const sessionBindingRepository = {
    findByProviderSession: vi.fn(),
    findByRawStoreRef: vi.fn()
  };
  const authUserRepository = {
    listIds: vi.fn(() => ["user-1"])
  };
  const sessionChangedFileService = {
    recordMessages: vi.fn()
  };
  const sessionSendQueueRepository = {
    listBySessionAndUser: vi.fn(() => []),
    getNextOrderIndex: vi.fn(() => 1),
    insert: vi.fn(),
    findBySessionUserAndId: vi.fn(),
    delete: vi.fn(),
    findNextQueued: vi.fn(() => null),
    markDispatching: vi.fn(() => true),
    markQueued: vi.fn(),
    markFailed: vi.fn()
  };
  const sessionIndexRepository = {
    findIndexRecordBySessionId: vi.fn(),
    upsert: vi.fn()
  };
  const sessionStateRepository = {
    findBySessionAndUser: vi.fn(),
    upsert: vi.fn()
  };
  const sessionStatusSnapshotRepository = {
    findBySessionId: vi.fn(),
    upsert: vi.fn()
  };

  const service = new SessionLiveRuntimeService(
    sessionHistoryService as never,
    sessionMessageAttachmentService as never,
    workspaceService as never,
    sessionChangedFileService as never,
    sessionBindingRepository as never,
    authUserRepository as never,
    sessionSendQueueRepository as never,
    sessionIndexRepository as never,
    sessionStateRepository as never,
    sessionStatusSnapshotRepository as never,
    {
      host: "127.0.0.1",
      port: 3002,
      databasePath: "/tmp/codingns-host.sqlite",
      releaseChannel: "stable",
      releaseManifestRoot: "/tmp/releases",
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 3600,
      terminalIdleTimeoutSeconds: 900,
      claudeCodeHomeDir: "/tmp/.claude",
      codexHomeDir: "/tmp/.codex",
      codexCliPath: "codex",
      claudeHookBridgeToken: "hook-token"
    }
  );

  return {
    service,
    sessionHistoryService,
    sessionMessageAttachmentService,
    workspaceService,
    sessionBindingRepository,
    authUserRepository,
    sessionChangedFileService,
    sessionSendQueueRepository,
    sessionIndexRepository,
    sessionStateRepository,
    sessionStatusSnapshotRepository
  };
}

describe("SessionLiveRuntimeService", () => {
  it("sendLiveMessage 在 active run 存在时会优先走 submitToActiveRun", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        rawStoreRef: "/tmp/.claude/projects/workspace/claude-session-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-03-26T10:00:00.000Z",
        lastEventAt: "2026-03-26T10:00:01.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      submitToActiveRun: vi.fn(async () => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        rawStoreRef: "/tmp/.claude/projects/workspace/claude-session-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-03-26T10:00:00.000Z",
        lastEventAt: "2026-03-26T10:00:02.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/workspace/claude-session-1.jsonl",
      messageCount: 3
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "claude-code",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "streaming_guidance",
      supportsSubagents: true,
      supportsInterrupt: false,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      limitations: []
    });
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      providerSessionId: "claude-session-1"
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionMessageAttachmentService.bindClientRequestToMessage.mockReturnValue([]);

    const result = await service.sendLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "继续补充这轮任务的要求",
      clientRequestId: null
    });

    expect(providerRuntimeService.submitToActiveRun).toHaveBeenCalledTimes(1);
    expect(providerRuntimeService.submitToActiveRun).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        content: "继续补充这轮任务的要求",
        providerPrompt: null
      })
    );
    expect(result.providerSessionId).toBe("claude-session-1");
    expect(result.message?.content).toBe("继续补充这轮任务的要求");
  });

  it("getSessionRuntime 在 active run 下仍然返回能力层的 inRunInputMode", async () => {
    const { service, sessionHistoryService } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-03-26T10:00:00.000Z",
        lastEventAt: "2026-03-26T10:00:01.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      runningState: "running",
      updatedAt: "2026-03-26T10:00:00.000Z",
      lastEventAt: "2026-03-26T10:00:01.000Z"
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "queued_guidance",
      supportsSubagents: true,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      limitations: []
    });
    sessionHistoryService.getSessionContextUsage.mockResolvedValue(null);

    const runtime = await service.getSessionRuntime("session-1", "user-1");

    expect(runtime.hasActiveRun).toBe(true);
    expect(runtime.inRunInputMode).toBe("queued_guidance");
  });

  it("getSessionRuntime 在 active run 结束后会回传持久化的错误详情", async () => {
    const { service, sessionHistoryService } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => null)
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.refreshRuntimeFallbackSession.mockResolvedValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/workspace/claude-session-1.jsonl",
      runningState: "failed",
      lastErrorCode: "CLAUDE_CLI_EXIT_NON_ZERO",
      lastErrorDetail: "npm ERR! missing script: dev",
      updatedAt: "2026-03-26T10:00:12.000Z",
      lastEventAt: "2026-03-26T10:00:12.000Z"
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "claude-code",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "streaming_guidance",
      supportsSubagents: true,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      limitations: []
    });
    sessionHistoryService.getSessionContextUsage.mockResolvedValue(null);

    const runtime = await service.getSessionRuntime("session-1", "user-1");

    expect(runtime.hasActiveRun).toBe(false);
    expect(runtime.runningState).toBe("failed");
    expect(runtime.errorCode).toBe("CLAUDE_CLI_EXIT_NON_ZERO");
    expect(runtime.errorDetail).toBe("npm ERR! missing script: dev");
    expect(runtime.detail).toBe("npm ERR! missing script: dev");
  });

  it("运行中会话可以把新消息加入项目队列", async () => {
    const {
      service,
      sessionHistoryService,
      sessionSendQueueRepository
    } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-03-26T10:00:00.000Z",
        lastEventAt: "2026-03-26T10:00:01.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      messageCount: 3
    });

    const queued = await service.enqueueLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "排队处理下一条",
      clientRequestId: "client-queue-1"
    });

    expect(sessionSendQueueRepository.insert).toHaveBeenCalledTimes(1);
    expect(queued.content).toBe("排队处理下一条");
    expect(providerRuntimeService.getSnapshot).toHaveBeenCalledWith("session-1");
  });

  it("dispatchNextQueuedMessage 会在空闲时自动发送下一条并删除队列项", async () => {
    const {
      service,
      sessionSendQueueRepository,
      sessionMessageAttachmentService
    } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => null)
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });
    Object.defineProperty(service, "sendLiveMessageDirect", {
      value: vi.fn().mockResolvedValue({
        sessionId: "session-1",
        provider: "codex",
        providerSessionId: "thread-1",
        acceptedAt: "2026-03-26T10:00:02.000Z",
        clientRequestId: "client-queue-1",
        message: null
      }),
      configurable: true
    });

    sessionSendQueueRepository.findNextQueued.mockReturnValue({
      id: "queue-1",
      sessionId: "session-1",
      userId: "user-1",
      content: "下一条自动续跑",
      clientRequestId: "client-queue-1",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      status: "queued",
      orderIndex: 1,
      errorDetail: null,
      createdAt: "2026-03-26T10:00:00.000Z",
      updatedAt: "2026-03-26T10:00:00.000Z",
      dispatchedAt: null
    });
    sessionMessageAttachmentService.getRuntimeAttachments.mockReturnValue([]);

    await (service as any).dispatchNextQueuedMessage("session-1");

    expect(sessionSendQueueRepository.markDispatching).toHaveBeenCalledWith(
      "queue-1",
      expect.any(String)
    );
    expect((service as any).sendLiveMessageDirect).toHaveBeenCalledTimes(1);
    expect(sessionSendQueueRepository.delete).toHaveBeenCalledWith("queue-1");
  });

  it("deleteQueuedMessage 会拒绝删除已经开始发送的队列项", async () => {
    const { service, sessionHistoryService, sessionSendQueueRepository } = createService();

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      messageCount: 3
    });
    sessionSendQueueRepository.findBySessionUserAndId.mockReturnValue({
      id: "queue-1",
      sessionId: "session-1",
      userId: "user-1",
      content: "不能删",
      clientRequestId: null,
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      status: "dispatching",
      orderIndex: 1,
      errorDetail: null,
      createdAt: "2026-03-26T10:00:00.000Z",
      updatedAt: "2026-03-26T10:00:00.000Z",
      dispatchedAt: "2026-03-26T10:00:01.000Z"
    });

    await expect(
      service.deleteQueuedMessage("session-1", "user-1", "queue-1")
    ).rejects.toMatchObject({
      errorCode: "QUEUE_ITEM_NOT_DELETABLE"
    });
  });

  it("persistRuntimeEvent 在终态后收到迟到错误时不会把会话打回 failed", async () => {
    const {
      service,
      sessionHistoryService,
      sessionStateRepository,
      sessionStatusSnapshotRepository
    } = createService();

    sessionStateRepository.findBySessionAndUser.mockReturnValue({
      sessionId: "session-1",
      userId: "user-1",
      runningState: "completed",
      completedAt: "2026-03-26T10:00:10.000Z",
      lastSeenAt: null
    });
    sessionStatusSnapshotRepository.findBySessionId.mockReturnValue({
      sessionId: "session-1",
      syncCursor: "cursor-1",
      resumedAt: null
    });

    await (service as any).persistRuntimeEvent("session-1", "workspace-1", "user-1", {
      type: "error",
      sessionId: "session-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "claude://raw-1",
      message: null,
      status: "failed",
      errorCode: "CLAUDE_CLI_EXIT_NON_ZERO",
      detail: "late provider error",
      rawEventRef: null,
      timestamp: "2026-03-26T10:00:11.000Z"
    });

    expect(sessionHistoryService.persistSessionBinding).toHaveBeenCalledTimes(1);
    expect(sessionStateRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        runningState: "completed",
        completedAt: "2026-03-26T10:00:10.000Z",
        lastEventAt: "2026-03-26T10:00:11.000Z"
      })
    );
    expect(sessionStatusSnapshotRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        syncStatus: "idle",
        lastErrorCode: null,
        lastErrorDetail: null
      })
    );
  });

  it("persistRuntimeEvent 在终态后收到迟到消息时不会把会话抬回 running", async () => {
    const {
      service,
      sessionHistoryService,
      workspaceService,
      sessionBindingRepository,
      authUserRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionStateRepository,
      sessionStatusSnapshotRepository
    } = createService();

    sessionHistoryService.syncSessionTitle.mockResolvedValue(undefined);
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionIndexRepository.findIndexRecordBySessionId.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "Claude 会话",
      messageCount: 4,
      isArchived: false,
      lastMessageAt: "2026-03-26T10:00:10.000Z",
      createdAt: "2026-03-26T09:00:00.000Z",
      updatedAt: "2026-03-26T10:00:10.000Z"
    });
    sessionStateRepository.findBySessionAndUser.mockReturnValue({
      sessionId: "session-1",
      userId: "user-1",
      runningState: "completed",
      completedAt: "2026-03-26T10:00:10.000Z",
      lastSeenAt: null
    });
    sessionStatusSnapshotRepository.findBySessionId.mockReturnValue({
      sessionId: "session-1",
      syncCursor: "cursor-1",
      resumedAt: null
    });

    await (service as any).persistRuntimeEvent("session-1", "workspace-1", "user-1", {
      type: "message",
      sessionId: "session-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "claude://raw-1",
      message: {
        messageId: "assistant-5",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        role: "assistant",
        kind: "text",
        content: "补充说明已经应用",
        toolCall: null,
        attachments: [],
        timestamp: "2026-03-26T10:00:10.100Z",
        sequence: 5,
        rawRef: "claude://raw#line=5"
      },
      status: null,
      detail: null,
      rawEventRef: null,
      timestamp: "2026-03-26T10:00:10.100Z"
    });

    expect(sessionChangedFileService.recordMessages).toHaveBeenCalledTimes(1);
    expect(sessionStateRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        runningState: "completed",
        completedAt: "2026-03-26T10:00:10.000Z",
        lastEventAt: "2026-03-26T10:00:10.100Z"
      })
    );
  });

  it("Claude hook bridge 配置会导出本地脚本命令", () => {
    const { service } = createService();

    const config = service.getClaudeHookBridgeConfig();

    expect(config.bridgeUrl).toContain("/api/providers/claude-code/hook-bridge/events");
    expect(config.command).toContain("claude-hook-bridge.cjs");
    expect(config.supportedEvents).toContain("UserPromptSubmit");
  });

  it("Claude 外部 hook 事件会建立真状态 active run 视图", async () => {
    const {
      service,
      sessionHistoryService,
      workspaceService,
      sessionBindingRepository,
      sessionIndexRepository,
      sessionStateRepository,
      sessionStatusSnapshotRepository
    } = createService();

    workspaceService.findWorkspaceByPath.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionBindingRepository.findByProviderSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-1.jsonl",
      createdAt: "2026-03-26T09:00:00.000Z",
      updatedAt: "2026-03-26T09:00:00.000Z"
    });
    sessionIndexRepository.findIndexRecordBySessionId.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      title: "Claude 会话",
      messageCount: 3,
      isArchived: false,
      lastMessageAt: "2026-03-26T09:00:00.000Z",
      createdAt: "2026-03-26T09:00:00.000Z",
      updatedAt: "2026-03-26T09:00:00.000Z"
    });
    sessionStatusSnapshotRepository.findBySessionId.mockReturnValue({
      sessionId: "session-1",
      syncCursor: "cursor-1",
      resumedAt: null
    });
    sessionStateRepository.findBySessionAndUser.mockReturnValue(null);

    await service.ingestClaudeHookEvent({
      hook_event_name: "UserPromptSubmit",
      session_id: "claude-session-1",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/.claude/projects/tmp-workspace/claude-session-1.jsonl"
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-1.jsonl",
      runningState: "running",
      updatedAt: "2026-03-26T10:00:00.000Z",
      lastEventAt: "2026-03-26T10:00:00.000Z"
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "claude-code",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "streaming_guidance",
      supportsSubagents: true,
      supportsInterrupt: false,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      limitations: []
    });
    sessionHistoryService.getSessionContextUsage.mockResolvedValue(null);

    const runtime = await service.getSessionRuntime("session-1", "user-1");

    expect(runtime).toMatchObject({
      sessionId: "session-1",
      hasActiveRun: true,
      canAttach: false,
      canInterrupt: false,
      runningState: "running",
      provider: "claude-code",
      providerSessionId: "claude-session-1"
    });
    expect(sessionStateRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        runningState: "running",
        activitySource: "runtime"
      })
    );
  });
});

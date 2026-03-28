import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionLiveRuntimeService } from "../../src/modules/sessions/session-live-runtime-service.js";

function createService() {
  const sessionHistoryService = {
    getSession: vi.fn(),
    getProviderCapabilitiesSnapshot: vi.fn(),
    refreshRuntimeFallbackSession: vi.fn(),
    getSessionCapabilities: vi.fn(),
    getSessionContextUsage: vi.fn(),
    getBindingOrThrow: vi.fn(),
    findLatestUserMessage: vi.fn(),
    persistSessionBinding: vi.fn(),
    syncSessionTitle: vi.fn(),
    readRecentHistoryEnvelope: vi.fn()
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("startLiveSession 会把 provider 启动失败映射成稳定的 AppError", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const providerRuntimeService = {
      startSession: vi.fn(async () => {
        throw new Error("SERVER_UNAVAILABLE");
      })
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.getProviderCapabilitiesSnapshot = vi.fn(() => ({
      provider: "opencode",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: false,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      limitations: []
    }));
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);

    await expect(
      service.startLiveSession({
        workspaceId: "workspace-1",
        userId: "user-1",
        provider: "opencode",
        content: "启动 OpenCode 会话",
        clientRequestId: null
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "PROVIDER_RUNTIME_UNAVAILABLE",
      message: expect.stringContaining("OpenCode server 已启动")
    });
  });

  it("Claude 托管 active run 续发消息时会清理外部运行态快照，避免退回灰色不可中止", async () => {
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

    (service as any).externalRuntimeSnapshots.set("session-1", {
      sessionId: "session-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "claude://raw-1",
      runningState: "running",
      detail: "stale external runtime",
      updatedAt: "2026-03-26T10:00:01.000Z"
    });

    await service.sendLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "继续补充这轮任务的要求",
      clientRequestId: null
    });

    expect((service as any).externalRuntimeSnapshots.has("session-1")).toBe(false);
    expect(providerRuntimeService.submitToActiveRun).toHaveBeenCalledTimes(1);
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

  it("Claude 会话仍标记为运行中时，加入队列不会立刻偷发", async () => {
    const { service, sessionHistoryService, sessionSendQueueRepository } = createService();

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/workspace/claude-session-1.jsonl",
      messageCount: 3,
      runningState: "running"
    });

    await service.enqueueLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "排队给 Claude",
      clientRequestId: "client-queue-claude"
    });

    expect(sessionSendQueueRepository.markDispatching).not.toHaveBeenCalled();
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

  it("stale 的 Claude running 状态会先回刷成空闲，再继续派发队列", async () => {
    const { service, sessionHistoryService, sessionSendQueueRepository } = createService();
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
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        acceptedAt: "2026-03-26T10:00:02.000Z",
        clientRequestId: "client-queue-claude",
        message: null
      }),
      configurable: true
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/workspace/claude-session-1.jsonl",
      messageCount: 3,
      runningState: "running"
    });
    sessionHistoryService.refreshRuntimeFallbackSession.mockResolvedValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/workspace/claude-session-1.jsonl",
      messageCount: 3,
      runningState: "completed"
    });
    sessionSendQueueRepository.findNextQueued.mockReturnValue({
      id: "queue-claude-1",
      sessionId: "session-1",
      userId: "user-1",
      content: "Claude stale running 后也要继续发",
      clientRequestId: "client-queue-claude",
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

    await (service as any).dispatchNextQueuedMessage("session-1");

    expect(sessionHistoryService.refreshRuntimeFallbackSession).toHaveBeenCalledWith(
      "session-1",
      "user-1"
    );
    expect((service as any).sendLiveMessageDirect).toHaveBeenCalledTimes(1);
    expect(sessionSendQueueRepository.delete).toHaveBeenCalledWith("queue-claude-1");
  });

  it("steerQueuedMessage 会原子地发送并移除等待项", async () => {
    const {
      service,
      sessionHistoryService,
      sessionSendQueueRepository,
      sessionMessageAttachmentService
    } = createService();
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
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });
    Object.defineProperty(service, "sendLiveMessageDirect", {
      value: vi.fn().mockResolvedValue({
        sessionId: "session-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        acceptedAt: "2026-03-26T10:00:03.000Z",
        clientRequestId: "client-queue-1",
        message: null
      }),
      configurable: true
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/workspace/claude-session-1.jsonl",
      messageCount: 3,
      runningState: "running"
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
    sessionSendQueueRepository.findBySessionUserAndId.mockReturnValue({
      id: "queue-1",
      sessionId: "session-1",
      userId: "user-1",
      content: "立刻引导这条消息",
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

    const result = await service.steerQueuedMessage("session-1", "user-1", "queue-1");

    expect(sessionSendQueueRepository.markDispatching).toHaveBeenCalledWith(
      "queue-1",
      expect.any(String)
    );
    expect((service as any).sendLiveMessageDirect).toHaveBeenCalledTimes(1);
    expect(sessionSendQueueRepository.delete).toHaveBeenCalledWith("queue-1");
    expect(result.queueItemId).toBe("queue-1");
  });

  it("Claude 外部运行态存在时不会提前调度队列", async () => {
    const { service, sessionSendQueueRepository } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => null)
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });
    Object.defineProperty(service, "sendLiveMessageDirect", {
      value: vi.fn(),
      configurable: true
    });

    (service as any).externalRuntimeSnapshots.set("session-1", {
      sessionId: "session-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "claude://raw-1",
      runningState: "running",
      detail: null,
      updatedAt: "2026-03-26T10:00:01.000Z"
    });

    await (service as any).dispatchNextQueuedMessage("session-1");

    expect(sessionSendQueueRepository.findNextQueued).not.toHaveBeenCalled();
    expect((service as any).sendLiveMessageDirect).not.toHaveBeenCalled();
  });

  it("Claude 外部运行态存在时会拒绝直发，避免假装送进当前会话", async () => {
    const { service, sessionHistoryService, workspaceService } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => null)
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
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-1.jsonl",
      messageCount: 3,
      runningState: "running"
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
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });

    (service as any).externalRuntimeSnapshots.set("session-1", {
      sessionId: "session-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "claude://raw-1",
      runningState: "running",
      detail: null,
      updatedAt: "2026-03-26T10:00:01.000Z"
    });

    await expect(
      service.sendLiveMessage({
        sessionId: "session-1",
        userId: "user-1",
        content: "这条不能假装直发",
        clientRequestId: "client-1"
      })
    ).rejects.toMatchObject({
      errorCode: "SESSION_EXTERNAL_RUN_ACTIVE"
    });
  });

  it("dispatchNextQueuedMessage 遇到 ACTIVE_RUN_EXISTS 时会回到等待并安排重试", async () => {
    vi.useFakeTimers();
    const { service, sessionHistoryService, sessionSendQueueRepository } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => null)
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });
    Object.defineProperty(service, "sendLiveMessageDirect", {
      value: vi.fn().mockRejectedValue(new Error("ACTIVE_RUN_EXISTS")),
      configurable: true
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      messageCount: 3,
      runningState: "completed"
    });
    sessionSendQueueRepository.findNextQueued.mockReturnValue({
      id: "queue-1",
      sessionId: "session-1",
      userId: "user-1",
      content: "继续续跑",
      clientRequestId: null,
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

    await (service as any).dispatchNextQueuedMessage("session-1");

    expect(sessionSendQueueRepository.markQueued).toHaveBeenCalledWith(
      "queue-1",
      expect.any(String)
    );
    expect(sessionSendQueueRepository.markFailed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect((service as any).sendLiveMessageDirect).toHaveBeenCalledTimes(2);
  });

  it("终态 runtime 快照不会阻塞 Codex 队列续跑", async () => {
    const { service, sessionSendQueueRepository } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "completed",
        attachedClients: 0,
        startedAt: "2026-03-26T10:00:00.000Z",
        lastEventAt: "2026-03-26T10:00:02.000Z",
        completedAt: "2026-03-26T10:00:02.000Z",
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      }))
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
        acceptedAt: "2026-03-26T10:00:03.000Z",
        clientRequestId: null,
        message: null
      }),
      configurable: true
    });

    sessionSendQueueRepository.findNextQueued.mockReturnValue({
      id: "queue-terminal",
      sessionId: "session-1",
      userId: "user-1",
      content: "终态后应立即续跑",
      clientRequestId: null,
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

    await (service as any).dispatchNextQueuedMessage("session-1");

    expect((service as any).sendLiveMessageDirect).toHaveBeenCalledTimes(1);
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

  it("Claude 托管 active run 存在时会忽略 hook 推断的外部运行态", async () => {
    const {
      service,
      workspaceService,
      sessionBindingRepository,
      sessionStateRepository
    } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "claude-code",
        providerSessionId: "claude-session-1",
        rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-03-26T09:00:00.000Z",
        lastEventAt: "2026-03-26T09:00:01.000Z",
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

    const result = await service.ingestClaudeHookEvent({
      hook_event_name: "UserPromptSubmit",
      session_id: "claude-session-1",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/.claude/projects/tmp-workspace/claude-session-1.jsonl"
    });

    expect(result).toEqual({
      accepted: true,
      ignored: true,
      sessionId: "session-1"
    });
    expect(sessionStateRepository.upsert).not.toHaveBeenCalled();
    expect((service as any).externalRuntimeSnapshots.has("session-1")).toBe(false);
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

  it("subscribeRuntime 会把 runtime message 映射成 session.runtime_message", async () => {
    const { service } = createService();
    const runtimeListeners: Array<(event: Record<string, unknown>) => Promise<void>> = [];
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => null),
      subscribe: vi.fn((_sessionId: string, listener: (event: Record<string, unknown>) => Promise<void>) => {
        runtimeListeners.push(listener);
        return {
          close: vi.fn()
        };
      })
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    const envelopes: Array<Record<string, unknown>> = [];
    const subscription = service.subscribeRuntime("session-1", (envelope) => {
      envelopes.push(envelope as Record<string, unknown>);
    });

    await runtimeListeners[0]?.({
      type: "message",
      sessionId: "session-1",
      provider: "opencode",
      providerSessionId: "provider-session-1",
      rawStoreRef: "opencode://session/provider-session-1",
      timestamp: "2026-03-28T10:00:00.000Z",
      detail: null,
      errorCode: null,
      rawEventRef: "opencode://session/provider-session-1/message/msg-1/part/text-1",
      status: null,
      message: {
        messageId: "msg-1",
        provider: "opencode",
        providerSessionId: "provider-session-1",
        role: "assistant",
        kind: "text",
        content: "第一段",
        toolCall: null,
        timestamp: "2026-03-28T10:00:00.000Z",
        sequence: 1,
        rawRef: "opencode://session/provider-session-1/message/msg-1/part/text-1"
      }
    });

    expect(envelopes).toEqual([
      {
        type: "session.runtime_message",
        sessionId: "session-1",
        source: "runtime",
        message: expect.objectContaining({
          messageId: "msg-1",
          content: "第一段"
        })
      }
    ]);

    subscription.close();
  });
});

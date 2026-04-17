import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { SessionLiveRuntimeService } from "../../src/modules/sessions/session-live-runtime-service.js";

function createService() {
  const sessionHistoryService = {
    getSession: vi.fn(),
    listWorkspaceSessions: vi.fn(() => []),
    getProviderCapabilitiesSnapshot: vi.fn(),
    refreshRuntimeFallbackSession: vi.fn(),
    getSessionCapabilities: vi.fn(),
    getSessionContextUsage: vi.fn(),
    getBindingOrThrow: vi.fn(),
    findLatestUserMessage: vi.fn(),
    readAllTextHistoryMessages: vi.fn(),
    persistSessionBinding: vi.fn(),
    syncSessionTitle: vi.fn(async () => undefined),
    readRecentHistoryEnvelope: vi.fn(),
    resolveMessageOrigin: vi.fn((_: string, message: Record<string, unknown>) => ({
      ...message,
      origin: null,
      originRef: null
    })),
    resolveMessageOriginByClientRequestId: vi.fn()
  };
  const sessionMessageAttachmentService = {
    persistAttachments: vi.fn(() => ({
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
    findBySessionId: vi.fn(),
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
      geminiHomeDir: "/tmp/.gemini",
      geminiCliPath: "gemini",
      kimiHomeDir: "/tmp/.kimi",
      kimiCliPath: "kimi",
      kimiConfigPath: "/tmp/.kimi/config.toml",
      kimiDefaultModel: null,
      webUiDir: null,
      opencodeBaseUrl: "",
      opencodeCliPath: "opencode",
      opencodeDataDir: "/tmp/.opencode",
      opencodeDbPath: "/tmp/.opencode/opencode.db",
      releaseChannel: "stable",
      releaseManifestRoot: "/tmp/releases",
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 3600,
      terminalIdleTimeoutSeconds: 900,
      claudeCodeHomeDir: "/tmp/.claude",
      codexHomeDir: "/tmp/.codex",
      codexCliPath: "codex",
      claudeHookBridgeToken: "hook-token",
      serverUpdatePackageName: "@codingns/test",
      npmRegistryBaseUrl: "https://registry.npmjs.org"
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

  it("sendLiveMessage 拿到真实用户消息后会按 clientRequestId 回填来源绑定", async () => {
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
    sessionHistoryService.findLatestUserMessage.mockResolvedValue({
      messageId: "message-1",
      role: "user",
      content: "继续推进",
      timestamp: "2026-03-26T10:00:03.000Z",
      sequence: 4,
      rawRef: "claude://message-1",
      attachments: []
    });
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionMessageAttachmentService.bindClientRequestToMessage.mockReturnValue([]);

    await service.sendLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "继续推进",
      clientRequestId: "butler-follow-up:task-1:123"
    });

    expect(sessionHistoryService.resolveMessageOriginByClientRequestId).toHaveBeenCalledWith(
      "session-1",
      "butler-follow-up:task-1:123",
      "message-1",
      "2026-03-26T10:00:03.000Z"
    );
  });

  it("sendLiveMessage 在终态后立即续跑时会用最近历史修正下一条用户 sequence，避免插到上一条 AI 回复前面", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const continueSession = vi.fn(async () => ({
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-03-26T10:00:10.000Z",
        lastEventAt: "2026-03-26T10:00:10.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      attach: vi.fn()
    }));
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => null),
      continueSession
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
      messageCount: 10
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: true,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: true,
      limitations: []
    });
    sessionHistoryService.readRecentHistoryEnvelope.mockResolvedValue({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-1",
      messages: [
        {
          messageId: "assistant-11",
          provider: "codex",
          providerSessionId: "thread-1",
          role: "assistant",
          kind: "text",
          content: "<turn_aborted>previous turn aborted</turn_aborted>",
          toolCall: null,
          timestamp: "2026-03-26T10:00:09.000Z",
          sequence: 11,
          rawRef: "codex://thread-1/msg-11"
        }
      ]
    });
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      providerSessionId: "thread-1"
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
      content: "继续这一轮 follow-up",
      clientRequestId: "butler-follow-up:task-1:123"
    });

    expect(continueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceBase: 12
      })
    );
    expect(result.message?.sequence).toBe(12);
  });

  it("重建型 Codex rollout 会话的首条真实消息会重新 start，并把 synthetic rawStoreRef 交给 runtime 重建上下文", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const startSession = vi.fn(async () => ({
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "8f9d1c54-0a23-4c39-9b9d-bfd2a3958d78",
        rawStoreRef: "/tmp/.codex/runtime-thread.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-04-11T12:00:00.000Z",
        lastEventAt: "2026-04-11T12:00:00.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      attach: vi.fn()
    }));
    const continueSession = vi.fn(async () => {
      throw new Error("should not continue synthetic rollout session");
    });
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => null),
      startSession,
      continueSession
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "rollout-2026-04-11T11-09-16-019d7a83-e12a-",
      rawStoreRef: "/tmp/.codex/rollout-session.jsonl",
      messageCount: 1,
      forkMethod: "reconstructed_message_fork",
      forkSourceType: "message"
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: true,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: true,
      limitations: []
    });
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      providerSessionId: "8f9d1c54-0a23-4c39-9b9d-bfd2a3958d78"
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionMessageAttachmentService.bindClientRequestToMessage.mockReturnValue([]);

    await service.sendLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "继续拆这条分支的实现方案",
      clientRequestId: null
    });

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(continueSession).not.toHaveBeenCalled();
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSessionId: null,
        rawStoreRef: "/tmp/.codex/rollout-session.jsonl",
        options: expect.objectContaining({
          content: "继续拆这条分支的实现方案",
          providerPrompt: null
        })
      })
    );
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

  it("startLiveSession 会先创建基础会话记录再挂载 runtime 持久化监听", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const order: string[] = [];
    const runtimeSnapshot = {
      sessionId: "runtime-session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "019d9025-e575-7fa1-84e2-9e797a2d61df",
      rawStoreRef: "/Users/test/runtime/codex/019d9025-e575-7fa1-84e2-9e797a2d61df.stream",
      runningState: "starting",
      attachedClients: 0,
      startedAt: "2026-04-16T10:00:00.000Z",
      lastEventAt: null,
      completedAt: null,
      detail: null,
      errorCode: null,
      supportsInterrupt: true
    };
    const handle = {
      getSnapshot: vi.fn(() => ({ ...runtimeSnapshot })),
      attach: vi.fn(() => ({
        close() {
          return;
        }
      }))
    };
    const providerRuntimeService = {
      startSession: vi.fn(async () => handle)
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.getProviderCapabilitiesSnapshot = vi.fn(() => ({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      limitations: []
    }));
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      provider: "codex",
      providerSessionId: "019d9025-e575-7fa1-84e2-9e797a2d61df",
      rawStoreRef: "/Users/test/runtime/codex/019d9025-e575-7fa1-84e2-9e797a2d61df.stream"
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);
    sessionHistoryService.getSession.mockImplementation((sessionId: string) => ({
      sessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "019d9025-e575-7fa1-84e2-9e797a2d61df",
      rawStoreRef: "/Users/test/runtime/codex/019d9025-e575-7fa1-84e2-9e797a2d61df.stream",
      messageCount: 0
    }));

    const originalCreateRuntimeBackedSession =
      (service as unknown as { createRuntimeBackedSession: (...args: unknown[]) => void })
        .createRuntimeBackedSession.bind(service);
    const originalAttachRuntimePersistence =
      (service as unknown as { attachRuntimePersistence: (...args: unknown[]) => void })
        .attachRuntimePersistence.bind(service);

    vi
      .spyOn(
        service as unknown as { createRuntimeBackedSession: (...args: unknown[]) => void },
        "createRuntimeBackedSession"
      )
      .mockImplementation((...args: unknown[]) => {
        order.push("create");
        originalCreateRuntimeBackedSession(...args);
      });
    vi
      .spyOn(
        service as unknown as { attachRuntimePersistence: (...args: unknown[]) => void },
        "attachRuntimePersistence"
      )
      .mockImplementation((...args: unknown[]) => {
        order.push("attach");
        originalAttachRuntimePersistence(...args);
      });

    await service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "Codex 快速启动时也要先落基础记录",
      clientRequestId: null
    });

    expect(order).toEqual(["create", "attach"]);
  });

  it("startLiveSession 首次读取 session 索引缺失时会重建基础记录并重试一次", async () => {
    const {
      service,
      sessionHistoryService,
      sessionMessageAttachmentService,
      workspaceService,
      sessionIndexRepository,
      sessionStateRepository,
      sessionStatusSnapshotRepository
    } = createService();
    const runtimeSnapshot = {
      sessionId: "runtime-session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/.codex/provider-session-1.jsonl",
      runningState: "starting",
      attachedClients: 1,
      startedAt: "2026-04-16T10:00:00.000Z",
      lastEventAt: null,
      completedAt: null,
      detail: null,
      errorCode: null,
      supportsInterrupt: true
    };
    const providerRuntimeService = {
      startSession: vi.fn(async () => ({
        getSnapshot: vi.fn(() => ({ ...runtimeSnapshot })),
        attach: vi.fn()
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.getProviderCapabilitiesSnapshot = vi.fn(() => ({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      limitations: []
    }));
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/.codex/provider-session-1.jsonl"
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);
    sessionHistoryService.getSession
      .mockImplementationOnce(() => {
        throw new AppError({
          statusCode: 500,
          errorCode: "SESSION_INDEX_MISSING",
          detail: "session 索引缺失"
        });
      })
      .mockImplementation((sessionId: string) => ({
        sessionId,
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "provider-session-1",
        rawStoreRef: "/tmp/.codex/provider-session-1.jsonl",
        messageCount: 0
      }));

    const result = await service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "启动后如果索引缺失要自动补齐",
      clientRequestId: null
    });

    expect(result.sessionId).toEqual(expect.any(String));
    expect(sessionHistoryService.getSession).toHaveBeenCalledTimes(2);
    expect(sessionIndexRepository.upsert).toHaveBeenCalledTimes(2);
    expect(sessionStateRepository.upsert).toHaveBeenCalledTimes(2);
    expect(sessionStatusSnapshotRepository.upsert).toHaveBeenCalledTimes(2);
  });

  it("startLiveSession 在写入首条图片附件前会先创建 pending session binding", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const providerRuntimeService = {
      startSession: vi.fn(async () => ({
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
        attach: vi.fn()
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.getProviderCapabilitiesSnapshot = vi.fn(() => ({
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
    }));
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      providerSessionId: "claude-session-1"
    });
    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/workspace/claude-session-1.jsonl",
      messageCount: 0
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);

    await service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "claude-code",
      content: "请结合图片说明问题",
      clientRequestId: "client-start-1",
      runtimeOptions: {
        attachments: [
          {
            fileName: "error.png",
            mimeType: "image/png",
            fileSize: 128,
            contentBase64: "dGVzdA=="
          }
        ]
      }
    });

    expect(sessionHistoryService.persistSessionBinding).toHaveBeenCalled();
    expect(sessionMessageAttachmentService.persistAttachments).toHaveBeenCalledTimes(1);
    expect(
      sessionHistoryService.persistSessionBinding.mock.invocationCallOrder[0]
    ).toBeLessThan(
      sessionMessageAttachmentService.persistAttachments.mock.invocationCallOrder[0]
    );
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
    expect(runtime.activityResolutionSource).toBe("authoritative_runtime");
    expect(runtime.activityConfidence).toBe("authoritative");
    expect(runtime.runId).toBe("runtime:session-1:2026-03-26T10:00:00.000Z");
    expect(runtime.watchdogTriggeredAt).toBeNull();
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
    expect(runtime.activityResolutionSource).toBe("unknown");
    expect(runtime.activityConfidence).toBe("weak");
    expect(runtime.runId).toBeNull();
  });

  it("getSessionRuntime 遇到终态 runtime snapshot 时，不应再标记 hasActiveRun", async () => {
    const { service, sessionHistoryService } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "completed",
        attachedClients: 1,
        startedAt: "2026-03-26T10:00:00.000Z",
        lastEventAt: "2026-03-26T10:00:08.000Z",
        completedAt: "2026-03-26T10:00:08.000Z",
        detail: "run completed",
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
      runningState: "completed",
      updatedAt: "2026-03-26T10:00:08.000Z",
      lastEventAt: "2026-03-26T10:00:08.000Z",
      completedAt: "2026-03-26T10:00:08.000Z",
      lastErrorCode: null,
      lastErrorDetail: null
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

    expect(runtime).toMatchObject({
      sessionId: "session-1",
      runningState: "completed",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "strong",
      detail: "run completed"
    });
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

  it("dispatchNextQueuedMessage 遇到运行时追加受限时会回到等待并自动重试", async () => {
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
      value: vi
        .fn()
        .mockRejectedValueOnce(new Error("IN_RUN_INPUT_NOT_SUPPORTED"))
        .mockResolvedValueOnce({
          sessionId: "session-1",
          provider: "codex",
          providerSessionId: "thread-1",
          acceptedAt: "2026-03-26T10:00:02.000Z",
          clientRequestId: null,
          message: null
        }),
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
    expect(sessionSendQueueRepository.delete).toHaveBeenCalledWith("queue-1");
  });

  it("运行态进入终态时会发出 terminal 事件回调", async () => {
    const { service, sessionHistoryService, sessionStateRepository, sessionStatusSnapshotRepository } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => null)
    };
    const terminalListener = vi.fn(async () => {});
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionStateRepository.findBySessionAndUser.mockReturnValue({
      sessionId: "session-1",
      userId: "user-1",
      runningState: "running",
      activitySource: "runtime",
      favorite: false,
      lastEventAt: "2026-03-26T10:00:01.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-26T10:00:01.000Z"
    });
    sessionStatusSnapshotRepository.findBySessionId.mockReturnValue({
      sessionId: "session-1",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-03-26T10:00:01.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      updatedAt: "2026-03-26T10:00:01.000Z"
    });

    const subscription = service.registerTerminalStateListener(terminalListener);

    await (service as any).persistRuntimeEvent("session-1", "workspace-1", "user-1", {
      type: "status",
      sessionId: "session-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      status: "completed",
      detail: "本轮已完成",
      timestamp: "2026-03-26T10:00:02.000Z"
    });

    expect(terminalListener).toHaveBeenCalledWith({
      sessionId: "session-1",
      status: "completed",
      timestamp: "2026-03-26T10:00:02.000Z",
      detail: "本轮已完成",
      source: "runtime"
    });

    subscription.close();
    expect(sessionHistoryService.persistSessionBinding).toHaveBeenCalled();
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
      sessionId: "session-1",
      bridgeResponse: null
    });
    expect(sessionStateRepository.upsert).not.toHaveBeenCalled();
    expect((service as any).externalRuntimeSnapshots.has("session-1")).toBe(false);
  });

  it("Claude PreToolUse 先于真实 binding 到达时，会回退认领当前 active run 会话", async () => {
    const {
      service,
      workspaceService,
      sessionBindingRepository,
      sessionHistoryService
    } = createService();

    workspaceService.findWorkspaceByPath.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionBindingRepository.findByProviderSession.mockReturnValue(null);
    sessionBindingRepository.findByRawStoreRef.mockReturnValue(null);

    const providerRuntimeService = {
      getSnapshot: vi.fn(() => null),
      listSnapshots: vi.fn(() => [
        {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          provider: "claude-code",
          providerSessionId: "pending://claude-code/session-1",
          rawStoreRef: "pending://claude-code/session-1",
          runningState: "running",
          attachedClients: 0,
          startedAt: "2026-03-30T15:00:00.000Z",
          lastEventAt: "2026-03-30T15:00:00.000Z",
          completedAt: null,
          detail: null,
          errorCode: null,
          supportsInterrupt: false
        }
      ])
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });
    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "pending://claude-code/session-1",
      rawStoreRef: "pending://claude-code/session-1",
      runningState: "running",
      updatedAt: "2026-03-30T15:00:00.000Z",
      lastEventAt: "2026-03-30T15:00:00.000Z"
    });
    sessionHistoryService.listWorkspaceSessions.mockReturnValue([
      {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "claude-code",
        providerSessionId: "pending://claude-code/session-1",
        rawStoreRef: "pending://claude-code/session-1",
        runningState: "running",
        updatedAt: "2026-03-30T15:00:00.000Z",
        lastEventAt: "2026-03-30T15:00:00.000Z"
      }
    ]);

    const resultPromise = service.ingestClaudeHookEvent({
      hook_event_name: "PreToolUse",
      session_id: "claude-session-real-1",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/workspace/story.md",
        content: "hello"
      }
    });
    let requests = await service.listPermissionRequests("session-1", "user-1");

    if (requests.length === 0) {
      await Promise.resolve();
      requests = await service.listPermissionRequests("session-1", "user-1");
    }

    expect(requests).toHaveLength(1);
    await service.replyPermissionRequest("session-1", "user-1", requests[0].id, {
      action: "allow"
    });
    const result = await resultPromise;

    expect(result.accepted).toBe(true);
    expect(result.ignored).toBe(false);
    expect(result.sessionId).toBe("session-1");
    expect(result.bridgeResponse).not.toBeNull();
    expect(sessionHistoryService.persistSessionBinding).toHaveBeenCalledWith("session-1", "workspace-1", {
      provider: "claude-code",
      providerSessionId: "claude-session-real-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl"
    });
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

  it("subscribeRuntime 会把 runtime message 映射成带来源信息的 session.runtime_message", async () => {
    const { service, sessionHistoryService } = createService();
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
    sessionHistoryService.resolveMessageOrigin.mockImplementation(
      (_sessionId: string, message: Record<string, unknown>) => ({
        ...message,
        origin: "butler_proxy",
        originRef: "follow-up-1"
      })
    );

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
          content: "第一段",
          origin: "butler_proxy",
          originRef: "follow-up-1"
        })
      }
    ]);

    subscription.close();
  });

  it("subscribeRuntime 会先推送统一的 session.activity 裁决事件", () => {
    const { service } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "codex-session-1",
        rawStoreRef: "codex://session/codex-session-1",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-03-28T10:00:00.000Z",
        lastEventAt: "2026-03-28T10:00:05.000Z",
        completedAt: null,
        detail: "still working",
        errorCode: null,
        supportsInterrupt: true
      })),
      subscribe: vi.fn(() => ({
        close: vi.fn()
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    const envelopes: Array<Record<string, unknown>> = [];
    const subscription = service.subscribeRuntime("session-1", (envelope) => {
      envelopes.push(envelope as Record<string, unknown>);
    });

    expect(envelopes).toContainEqual({
      type: "session.activity",
      sessionId: "session-1",
      runningState: "running",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: "runtime:session-1:2026-03-28T10:00:00.000Z",
      detail: "still working",
      errorCode: null,
      errorDetail: "still working",
      hasActiveRun: true,
      canInterrupt: true,
      updatedAt: "2026-03-28T10:00:05.000Z",
      watchdogTriggeredAt: null
    });

    subscription.close();
  });

  it("subscribeRuntime 遇到终态 runtime snapshot 时，session.activity 不应再宣称 hasActiveRun", () => {
    const { service } = createService();
    const providerRuntimeService = {
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "codex-session-1",
        rawStoreRef: "codex://session/codex-session-1",
        runningState: "completed",
        attachedClients: 1,
        startedAt: "2026-03-28T10:00:00.000Z",
        lastEventAt: "2026-03-28T10:00:05.000Z",
        completedAt: "2026-03-28T10:00:05.000Z",
        detail: "run completed",
        errorCode: null,
        supportsInterrupt: true
      })),
      subscribe: vi.fn(() => ({
        close: vi.fn()
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    const envelopes: Array<Record<string, unknown>> = [];
    const subscription = service.subscribeRuntime("session-1", (envelope) => {
      envelopes.push(envelope as Record<string, unknown>);
    });

    expect(envelopes).toContainEqual({
      type: "session.activity",
      sessionId: "session-1",
      runningState: "completed",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "strong",
      runId: "runtime:session-1:2026-03-28T10:00:00.000Z",
      detail: "run completed",
      errorCode: null,
      errorDetail: "run completed",
      hasActiveRun: false,
      canInterrupt: false,
      updatedAt: "2026-03-28T10:00:05.000Z",
      watchdogTriggeredAt: null
    });

    subscription.close();
  });

  it("startLiveSession 不会等待 Gemini 真实 session id 回填才返回，而是后台持久化 binding", async () => {
    vi.useFakeTimers();
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const runtimeSnapshot = {
      sessionId: "runtime-session-1",
      workspaceId: "workspace-1",
      provider: "gemini",
      providerSessionId: "pending://gemini/runtime-session-1",
      rawStoreRef: "pending://gemini/runtime-session-1",
      runningState: "starting",
      attachedClients: 1,
      startedAt: "2026-03-26T10:00:00.000Z",
      lastEventAt: null,
      completedAt: null,
      detail: null,
      errorCode: null,
      supportsInterrupt: true
    };
    const providerRuntimeService = {
      startSession: vi.fn(async () => ({
        getSnapshot: vi.fn(() => ({ ...runtimeSnapshot })),
        attach: vi.fn()
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.getProviderCapabilitiesSnapshot = vi.fn(() => ({
      provider: "gemini",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      limitations: []
    }));
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      provider: "gemini",
      providerSessionId: "pending://gemini/runtime-session-1",
      rawStoreRef: "pending://gemini/runtime-session-1"
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);
    sessionHistoryService.getSession.mockImplementation((sessionId: string) => ({
      sessionId,
      workspaceId: "workspace-1",
      provider: "gemini",
      providerSessionId: "pending://gemini/runtime-session-1",
      rawStoreRef: "pending://gemini/runtime-session-1",
      messageCount: 0
    }));

    setTimeout(() => {
      runtimeSnapshot.providerSessionId = "gemini-session-real-1";
      runtimeSnapshot.rawStoreRef = "gemini://session/gemini-session-real-1";
      runtimeSnapshot.runningState = "running";
      runtimeSnapshot.lastEventAt = "2026-03-26T10:00:00.200Z";
    }, 100);

    const resultPromise = service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "gemini",
      content: "Gemini 启动后先回填真实 session id",
      clientRequestId: null
    });

    const result = await resultPromise;

    expect(result.providerSessionId).toBe("pending://gemini/runtime-session-1");

    await vi.advanceTimersByTimeAsync(200);

    const createdSessionId = sessionHistoryService.persistSessionBinding.mock.calls[0]?.[0];

    expect(createdSessionId).toEqual(expect.any(String));
    expect(sessionHistoryService.persistSessionBinding).toHaveBeenLastCalledWith(
      createdSessionId,
      "workspace-1",
      {
        provider: "gemini",
        providerSessionId: "gemini-session-real-1",
        rawStoreRef: "gemini://session/gemini-session-real-1"
      }
    );
  });

  it("startLiveSession 会在后台把 Codex synthetic binding 回填成真实 rollout 路径", async () => {
    vi.useFakeTimers();
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const runtimeSnapshot = {
      sessionId: "runtime-session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "019d9025-e575-7fa1-84e2-9e797a2d61df",
      rawStoreRef: "/Users/test/runtime/codex/019d9025-e575-7fa1-84e2-9e797a2d61df.stream",
      runningState: "starting",
      attachedClients: 1,
      startedAt: "2026-04-15T07:58:15.000Z",
      lastEventAt: null,
      completedAt: null,
      detail: null,
      errorCode: null,
      supportsInterrupt: true
    };
    const providerRuntimeService = {
      startSession: vi.fn(async () => ({
        getSnapshot: vi.fn(() => ({ ...runtimeSnapshot })),
        attach: vi.fn()
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionHistoryService.getProviderCapabilitiesSnapshot = vi.fn(() => ({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      limitations: []
    }));
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      provider: "codex",
      providerSessionId: "019d9025-e575-7fa1-84e2-9e797a2d61df",
      rawStoreRef: "/Users/test/runtime/codex/019d9025-e575-7fa1-84e2-9e797a2d61df.stream"
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);
    sessionHistoryService.getSession.mockImplementation((sessionId: string) => ({
      sessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "019d9025-e575-7fa1-84e2-9e797a2d61df",
      rawStoreRef: runtimeSnapshot.rawStoreRef,
      messageCount: 0
    }));

    setTimeout(() => {
      runtimeSnapshot.rawStoreRef =
        "/Users/test/butler-runtime/codex-home/sessions/2026/04/15/rollout-2026-04-15T15-58-15-019d9025-e575-7fa1-84e2-9e797a2d61df.jsonl";
      runtimeSnapshot.runningState = "running";
      runtimeSnapshot.lastEventAt = "2026-04-15T07:58:16.000Z";
    }, 100);

    const resultPromise = service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "Codex 启动后应回填真实 rollout 路径",
      clientRequestId: null
    });

    const result = await resultPromise;

    expect(result.providerSessionId).toBe("019d9025-e575-7fa1-84e2-9e797a2d61df");

    await vi.advanceTimersByTimeAsync(200);

    const createdSessionId = sessionHistoryService.persistSessionBinding.mock.calls[0]?.[0];

    expect(createdSessionId).toEqual(expect.any(String));
    expect(sessionHistoryService.persistSessionBinding).toHaveBeenLastCalledWith(
      createdSessionId,
      "workspace-1",
      {
        provider: "codex",
        providerSessionId: "019d9025-e575-7fa1-84e2-9e797a2d61df",
        rawStoreRef:
          "/Users/test/butler-runtime/codex-home/sessions/2026/04/15/rollout-2026-04-15T15-58-15-019d9025-e575-7fa1-84e2-9e797a2d61df.jsonl"
      }
    );
  });

  it("getSessionRuntime 会把 Gemini 真实会话映射到正在运行的 pending runtime", async () => {
    const { service, sessionHistoryService, sessionBindingRepository } = createService();
    const aliasRuntimeSnapshot = {
      sessionId: "session-alias-1",
      workspaceId: "workspace-1",
      provider: "gemini",
      providerSessionId: "gemini-session-real-1",
      rawStoreRef: "gemini://session/gemini-session-real-1",
      runningState: "running",
      attachedClients: 1,
      startedAt: "2026-03-26T10:00:00.000Z",
      lastEventAt: "2026-03-26T10:00:02.000Z",
      completedAt: null,
      detail: "running",
      errorCode: null,
      supportsInterrupt: true
    };
    const providerRuntimeService = {
      getSnapshot: vi.fn((sessionId: string) => (sessionId === "session-alias-1" ? aliasRuntimeSnapshot : null)),
      listSnapshots: vi.fn(() => [aliasRuntimeSnapshot])
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionBindingRepository.findBySessionId.mockImplementation((sessionId: string) => {
      if (sessionId === "session-alias-1") {
        return {
          sessionId,
          workspaceId: "workspace-1",
          provider: "gemini",
          providerSessionId: "pending://gemini/session-real-1",
          rawStoreRef: "pending://gemini/session-real-1"
        };
      }

      return null;
    });
    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-real-1",
      workspaceId: "workspace-1",
      provider: "gemini",
      providerSessionId: "gemini-session-real-1",
      rawStoreRef: "gemini://session/gemini-session-real-1",
      runningState: "idle",
      lastErrorCode: null,
      lastErrorDetail: null
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "gemini",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      limitations: []
    });
    sessionHistoryService.getSessionContextUsage.mockResolvedValue(null);

    const runtime = await service.getSessionRuntime("session-real-1", "user-1");

    expect(runtime.sessionId).toBe("session-real-1");
    expect(runtime.hasActiveRun).toBe(true);
    expect(runtime.canInterrupt).toBe(true);
    expect(runtime.providerSessionId).toBe("gemini-session-real-1");
  });

  it("subscribeRuntime 会把 Gemini alias runtime 事件转发给真实会话", async () => {
    const { service, sessionBindingRepository } = createService();
    const listeners = new Map<string, (event: Record<string, unknown>) => Promise<void>>();
    const providerRuntimeService = {
      getSnapshot: vi.fn((sessionId: string) =>
        sessionId === "session-alias-1"
          ? {
              sessionId,
              workspaceId: "workspace-1",
              provider: "gemini",
              providerSessionId: "gemini-session-real-1",
              rawStoreRef: "gemini://session/gemini-session-real-1",
              runningState: "running",
              attachedClients: 1,
              startedAt: "2026-03-26T10:00:00.000Z",
              lastEventAt: "2026-03-26T10:00:02.000Z",
              completedAt: null,
              detail: "running",
              errorCode: null,
              supportsInterrupt: true
            }
          : null
      ),
      listSnapshots: vi.fn(() => [
        {
          sessionId: "session-alias-1",
          workspaceId: "workspace-1",
          provider: "gemini",
          providerSessionId: "gemini-session-real-1",
          rawStoreRef: "gemini://session/gemini-session-real-1",
          runningState: "running",
          attachedClients: 1,
          startedAt: "2026-03-26T10:00:00.000Z",
          lastEventAt: "2026-03-26T10:00:02.000Z",
          completedAt: null,
          detail: "running",
          errorCode: null,
          supportsInterrupt: true
        }
      ]),
      subscribe: vi.fn((sessionId: string, listener: (event: Record<string, unknown>) => Promise<void>) => {
        listeners.set(sessionId, listener);
        return {
          close() {
            listeners.delete(sessionId);
          }
        };
      })
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    sessionBindingRepository.findBySessionId.mockImplementation((sessionId: string) => {
      if (sessionId === "session-alias-1") {
        return {
          sessionId,
          workspaceId: "workspace-1",
          provider: "gemini",
          providerSessionId: "pending://gemini/session-real-1",
          rawStoreRef: "pending://gemini/session-real-1"
        };
      }

      return null;
    });

    const received: Array<Record<string, unknown>> = [];
    const subscription = service.subscribeRuntime("session-real-1", async (envelope) => {
      received.push(envelope as Record<string, unknown>);
    });
    const runtimeListener = listeners.get("session-alias-1");

    expect(runtimeListener).toBeTruthy();

    await runtimeListener?.({
      type: "message",
      provider: "gemini",
      providerSessionId: "gemini-session-real-1",
      rawStoreRef: "gemini://session/gemini-session-real-1",
      message: {
        messageId: "msg-1",
        provider: "gemini",
        providerSessionId: "gemini-session-real-1",
        role: "assistant",
        kind: "text",
        content: "hello",
        toolCall: null,
        timestamp: "2026-03-26T10:00:03.000Z",
        sequence: 2,
        rawRef: "gemini://message/1"
      },
      status: null,
      detail: null,
      errorCode: null,
      rawEventRef: null,
      timestamp: "2026-03-26T10:00:03.000Z"
    });

    expect(received.some((item) => item.type === "session.runtime_message" && item.sessionId === "session-real-1")).toBe(true);
    subscription.close();
  });

  it("startLiveSession 会在 Kimi 首轮等待真实 binding 并优先返回权威 user 消息", async () => {
    vi.useFakeTimers();
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const runtimeSnapshot = {
      sessionId: "runtime-session-1",
      workspaceId: "workspace-1",
      provider: "kimi",
      providerSessionId: "pending://kimi/runtime-session-1",
      rawStoreRef: "pending://kimi/runtime-session-1",
      runningState: "starting",
      attachedClients: 1,
      startedAt: "2026-04-09T10:00:00.000Z",
      lastEventAt: null,
      completedAt: null,
      detail: null,
      errorCode: null,
      supportsInterrupt: true
    };
    const providerRuntimeService = {
      startSession: vi.fn(async () => ({
        getSnapshot: vi.fn(() => ({ ...runtimeSnapshot })),
        attach: vi.fn()
      }))
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });

    let currentBinding = {
      provider: "kimi",
      providerSessionId: "pending://kimi/runtime-session-1",
      rawStoreRef: "pending://kimi/runtime-session-1"
    };

    sessionHistoryService.persistSessionBinding.mockImplementation(
      (_sessionId: string, _workspaceId: string, binding: typeof currentBinding) => {
        currentBinding = binding;
      }
    );
    sessionHistoryService.getProviderCapabilitiesSnapshot = vi.fn(() => ({
      provider: "kimi",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: false,
      supportsAttachments: false,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      limitations: []
    }));
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionMessageAttachmentService.buildAcceptedContentCandidates.mockReturnValue(["首条 Kimi 用户消息"]);
    sessionMessageAttachmentService.bindClientRequestToMessage.mockReturnValue([]);
    sessionHistoryService.getBindingOrThrow.mockImplementation(() => currentBinding);
    sessionHistoryService.findLatestUserMessage.mockImplementation(async () => {
      if (currentBinding.providerSessionId !== "kimi-session-real-1") {
        return null;
      }

      return {
        messageId: "kimi-user-1",
        provider: "kimi",
        providerSessionId: "kimi-session-real-1",
        role: "user",
        kind: "text",
        content: "首条 Kimi 用户消息",
        toolCall: null,
        timestamp: "2020-01-01T00:00:03.000Z",
        sequence: 1,
        rawRef: "kimi://session/kimi-session-real-1/context#line=3"
      };
    });
    sessionHistoryService.getSession.mockImplementation((sessionId: string) => ({
      sessionId,
      workspaceId: "workspace-1",
      provider: "kimi",
      providerSessionId: currentBinding.providerSessionId,
      rawStoreRef: currentBinding.rawStoreRef,
      messageCount: 0
    }));

    setTimeout(() => {
      runtimeSnapshot.providerSessionId = "kimi-session-real-1";
      runtimeSnapshot.rawStoreRef = "kimi://session/kimi-session-real-1";
      runtimeSnapshot.runningState = "running";
      runtimeSnapshot.lastEventAt = "2026-04-09T10:00:00.200Z";
    }, 100);

    const resultPromise = service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "kimi",
      content: "首条 Kimi 用户消息",
      clientRequestId: "client-kimi-1"
    });

    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    expect(result.providerSessionId).toBe("kimi-session-real-1");
    expect(result.message.messageId).toBe("kimi-user-1");
    expect(result.message.rawRef).toBe("kimi://session/kimi-session-real-1/context#line=3");
    expect(result.message.content).toBe("首条 Kimi 用户消息");
  });
});

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { SessionLiveRuntimeService } from "../../src/modules/sessions/session-live-runtime-service.js";
import { CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV } from "../../src/modules/sessions/workspace-office-mcp-config.js";

const tempDirs: string[] = [];

function createService(
  configOverrides: Partial<ConstructorParameters<typeof SessionLiveRuntimeService>[11]> = {},
  openCliSessionPromptService: { buildPrompt: ReturnType<typeof vi.fn> } | null = null,
  workspaceSessionRuntimeContextService: {
    prepareWorkspaceInstructionBundle: ReturnType<typeof vi.fn>;
  } | null = null
) {
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
    findBySessionId: vi.fn((sessionId: string) => ({
      sessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-03-26T10:00:00.000Z",
      updatedAt: "2026-03-26T10:00:00.000Z"
    })),
    findByProviderSession: vi.fn(),
    findByRawStoreRef: vi.fn(),
    upsert: vi.fn()
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
  const sessionProviderConfigService = {
    prepareSessionBinding: vi.fn((input: { providerConfigMode?: string; providerPresetId?: string | null }) => ({
      providerConfigMode: input.providerConfigMode ?? "global-default",
      providerPresetId: input.providerPresetId ?? null,
      runtimeHomeDir: null
    })),
    resolveLaunchContext: vi.fn((binding: { runtimeHomeDir?: string | null }) => ({
      runtimeHomeDir: binding.runtimeHomeDir ?? null,
      runtimeEnv: {}
    })),
    resolveSessionBinding: vi.fn((input: {
      existingBinding?: {
        providerConfigMode?: string;
        providerPresetId?: string | null;
        runtimeHomeDir?: string | null;
      } | null;
      providerConfigMode?: string;
      providerPresetId?: string | null;
    }) => ({
      providerConfigMode:
        input.providerConfigMode
        ?? input.existingBinding?.providerConfigMode
        ?? "global-default",
      providerPresetId:
        input.providerPresetId
        ?? input.existingBinding?.providerPresetId
        ?? null,
      runtimeHomeDir: input.existingBinding?.runtimeHomeDir ?? null
    })),
    describeBinding: vi.fn(() => null)
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
    sessionProviderConfigService as never,
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
      npmRegistryBaseUrl: "https://registry.npmjs.org",
      ...configOverrides
    },
    undefined,
    openCliSessionPromptService as never,
    workspaceSessionRuntimeContextService as never
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
    sessionStatusSnapshotRepository,
    sessionProviderConfigService
  };
}

function useFakeNow(iso?: string) {
  vi.useFakeTimers();

  if (iso) {
    vi.setSystemTime(new Date(iso));
  }
}

function scheduleSnapshotUpdate<T extends object>(target: T, patch: Partial<T>, delayMs = 100) {
  setTimeout(() => {
    Object.assign(target, patch);
  }, delayMs);
}

async function advanceBackgroundTimers(ms = 200) {
  await vi.advanceTimersByTimeAsync(ms);
}

async function flushRuntimePersistence(service: SessionLiveRuntimeService, sessionId = "session-1") {
  await ((service as any).runtimePersistenceQueues.get(sessionId) ?? Promise.resolve());
}

describe("SessionLiveRuntimeService", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    while (tempDirs.length > 0) {
      const target = tempDirs.pop();

      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  it("sendLiveMessage 在 active run 存在时会优先走 submitToActiveRun", async () => {
    const openCliSessionPromptService = {
      buildPrompt: vi.fn(() => [
        "## OpenCLI CLI技能",
        "- 当前会话已经注入 CodingNS 管理的裁剪版 OpenCLI 运行时，可以直接在 shell 里使用 `opencli`。"
      ].join("\n"))
    };
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService, sessionBindingRepository } =
      createService({}, openCliSessionPromptService);
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
    expect(openCliSessionPromptService.buildPrompt).not.toHaveBeenCalled();
    expect(result.providerSessionId).toBe("claude-session-1");
    expect(result.message?.content).toBe("继续补充这轮任务的要求");
  });

  it("Claude active run 存在时切换 preset 会直接拒绝，且不会污染会话 binding", async () => {
    const { service, sessionHistoryService, workspaceService, sessionBindingRepository } = createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      submitToActiveRun: vi.fn()
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
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: "/tmp/workspace"
    });

    await expect(service.sendLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "切到新 preset 后继续执行",
      clientRequestId: null,
      providerConfigMode: "cc-switch-preset",
      providerPresetId: "preset-2"
    })).rejects.toMatchObject({
      errorCode: "SESSION_PROVIDER_CONFIG_CHANGE_REQUIRES_NEW_RUN"
    });

    expect(providerRuntimeService.submitToActiveRun).not.toHaveBeenCalled();
    expect(sessionBindingRepository.upsert).not.toHaveBeenCalled();
  });

  it("Codex 运行中时会优先走 steer 提交，而不是回退项目队列", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-04-18T10:00:00.000Z",
        lastEventAt: "2026-04-18T10:00:01.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      submitToActiveRun: vi.fn(async () => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-04-18T10:00:00.000Z",
        lastEventAt: "2026-04-18T10:00:02.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      abandonRun: vi.fn(async () => undefined)
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
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "codex",
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
      content: "继续修正这轮 Codex 输出",
      clientRequestId: null
    });

    expect(providerRuntimeService.submitToActiveRun).toHaveBeenCalledTimes(1);
    expect(providerRuntimeService.submitToActiveRun).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        content: "继续修正这轮 Codex 输出"
      })
    );
    expect(result.providerSessionId).toBe("thread-1");
  });

  it("sendLiveMessage 在权威 user 尚未回流时，会用请求发起时间作为 synthetic 时间锚点", async () => {
    useFakeNow("2026-04-26T21:00:57.997Z");
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-04-26T21:00:58.100Z",
        lastEventAt: "2026-04-26T21:00:58.200Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      submitToActiveRun: vi.fn(async () => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-04-26T21:00:58.100Z",
        lastEventAt: "2026-04-26T21:00:58.200Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      abandonRun: vi.fn(async () => undefined)
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
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "codex",
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
      content: "继续修复这轮顺序问题",
      clientRequestId: null
    });

    expect(result.acceptedAt).toBe("2026-04-26T21:00:57.997Z");
    expect(result.message.timestamp).toBe("2026-04-26T21:00:57.997Z");
  });

  it("Codex steer 撞上陈旧 active run 时会丢弃旧句柄并重启本轮", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-04-18T10:00:00.000Z",
        lastEventAt: "2026-04-18T10:00:01.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      submitToActiveRun: vi.fn(async () => {
        throw new Error("SESSION_NOT_RUNNING");
      }),
      abandonRun: vi.fn(async () => undefined)
    };
    Object.defineProperty(service, "providerRuntimeService", {
      value: providerRuntimeService,
      configurable: true
    });
    Object.defineProperty(service, "startRuntimeRun", {
      value: vi.fn(async () => undefined),
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
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "codex",
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

    await service.sendLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "turn 结束边缘也别把这条消息丢了",
      clientRequestId: null
    });

    expect(providerRuntimeService.submitToActiveRun).toHaveBeenCalledTimes(1);
    expect(providerRuntimeService.abandonRun).toHaveBeenCalledWith("session-1");
    expect((service as any).startRuntimeRun).toHaveBeenCalledTimes(1);
  });

  it("sendLiveMessage 拿到真实用户消息后会按 clientRequestId 回填来源绑定", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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

  it("sendLiveMessage 在 Claude 会话里会优先使用最近历史 sequence，而不是被污染的 messageCount", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const continueSession = vi.fn(async () => ({
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "claude-code",
        providerSessionId: "claude-thread-1",
        rawStoreRef: "/tmp/.claude/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-04-25T13:48:12.000Z",
        lastEventAt: "2026-04-25T13:48:12.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      attach: vi.fn()
    }));
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      provider: "claude-code",
      providerSessionId: "claude-thread-1",
      rawStoreRef: "/tmp/.claude/thread-1.jsonl",
      messageCount: 1386
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "claude-code",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: false,
      supportsTokenUsage: false,
      supportsAttachments: false,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      limitations: []
    });
    sessionHistoryService.readRecentHistoryEnvelope.mockResolvedValue({
      type: "session.delta",
      sessionId: "session-1",
      cursor: "cursor-1",
      messages: [
        {
          messageId: "assistant-18",
          provider: "claude-code",
          providerSessionId: "claude-thread-1",
          role: "assistant",
          kind: "text",
          content: "678",
          toolCall: null,
          timestamp: "2026-04-25T13:48:03.636Z",
          sequence: 18,
          rawRef: "claude-code://message/message%3Aassistant%3A1%3Atype%3Atext"
        }
      ]
    });
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      providerSessionId: "claude-thread-1"
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
      content: "回复789",
      clientRequestId: "client-789"
    });

    expect(continueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceBase: 19
      })
    );
    expect(result.message?.sequence).toBe(19);
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
      isRunHealthy: vi.fn(() => true),
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

  it("Codex 原始 rollout 文件丢失时，会改用 Host 文本历史生成 synthetic transcript 继续会话", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService, sessionBindingRepository } =
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
        startedAt: "2026-04-25T15:10:00.000Z",
        lastEventAt: "2026-04-25T15:10:00.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      attach: vi.fn()
    }));
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      rawStoreRef: "/tmp/.codex/missing-rollout.jsonl",
      messageCount: 6
    });
    sessionBindingRepository.findBySessionId.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/missing-rollout.jsonl",
      providerConfigMode: "cc-switch-preset",
      providerPresetId: "preset-api",
      runtimeHomeDir: "/tmp/codingns-runtime-home",
      createdAt: "2026-04-25T15:00:00.000Z",
      updatedAt: "2026-04-25T15:00:00.000Z"
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
    sessionHistoryService.readAllTextHistoryMessages.mockResolvedValue([
      {
        role: "user",
        kind: "text",
        content: "上一轮用户问题",
        timestamp: "2026-04-25T15:00:01.000Z"
      },
      {
        role: "assistant",
        kind: "text",
        content: "上一轮助手回答",
        timestamp: "2026-04-25T15:00:03.000Z"
      }
    ]);
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

    await service.sendLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "切换部署后继续这一轮对话",
      clientRequestId: null
    });

    expect(continueSession).toHaveBeenCalledTimes(1);
    expect(continueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        rawStoreRef: "/tmp/codingns-runtime-home/.codingns-synthetic-resume/session-1.jsonl"
      })
    );
  });

  it("startLiveSession 会把 provider 启动失败映射成稳定的 AppError", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      message: expect.stringContaining("provider 运行时已启动")
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
      isRunHealthy: vi.fn(() => true),
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

  it("startLiveSession 在首条权威 user 尚未落库时，会用请求发起时间作为 synthetic 时间锚点", async () => {
    useFakeNow("2026-04-26T21:00:57.997Z");
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const runtimeSnapshot = {
      sessionId: "runtime-session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      runningState: "starting",
      attachedClients: 1,
      startedAt: "2026-04-26T21:00:58.100Z",
      lastEventAt: null,
      completedAt: null,
      detail: null,
      errorCode: null,
      supportsInterrupt: true
    };
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl"
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);
    sessionHistoryService.getSession.mockImplementation((sessionId: string) => ({
      sessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      messageCount: 0
    }));

    const result = await service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "请继续分析这个顺序问题",
      clientRequestId: null
    });

    expect(result.acceptedAt).toBe("2026-04-26T21:00:57.997Z");
    expect(result.message.timestamp).toBe("2026-04-26T21:00:57.997Z");
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
      isRunHealthy: vi.fn(() => true),
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

  it("startLiveSession 会把事务轻量会话可见性写入 session index", async () => {
    const {
      service,
      sessionHistoryService,
      sessionMessageAttachmentService,
      workspaceService,
      sessionIndexRepository
    } = createService();
    const runtimeSnapshot = {
      sessionId: "runtime-session-1",
      workspaceId: "workspace-1",
      provider: "gemini",
      providerSessionId: "provider-session-1",
      rawStoreRef: "synthetic://gemini/provider-session-1",
      runningState: "starting",
      attachedClients: 1,
      startedAt: "2026-06-02T10:00:00.000Z",
      lastEventAt: null,
      completedAt: null,
      detail: null,
      errorCode: null,
      supportsInterrupt: false
    };
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      supportsInterrupt: false,
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
      providerSessionId: "provider-session-1",
      rawStoreRef: "synthetic://gemini/provider-session-1"
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);
    sessionHistoryService.getSession.mockImplementation((sessionId: string) => ({
      sessionId,
      workspaceId: "workspace-1",
      provider: "gemini",
      providerSessionId: "provider-session-1",
      rawStoreRef: "synthetic://gemini/provider-session-1",
      messageCount: 0
    }));

    await service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "gemini",
      content: "做一条事务轻量会话",
      clientRequestId: null,
      sessionVisibility: "affairs_lightweight"
    });

    expect(sessionIndexRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionVisibility: "affairs_lightweight"
      })
    );
  });

  it("startLiveSession 会为工作区会话显式注入工作区说明和 scoped 认证环境", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codingns-workspace-instruction-start-"));
    const workspaceInstructionFilePath = path.join(
      workspaceRoot,
      ".codingns",
      "workspace-session-runtime",
      "session-1",
      "WORKSPACE_SESSION_COMPOSED.md"
    );
    const workspaceAuthFilePath = path.join(
      workspaceRoot,
      ".codingns",
      "workspace-session-runtime",
      "session-1",
      "WORKSPACE_SESSION_AUTH.json"
    );
    tempDirs.push(workspaceRoot);
    mkdirSync(path.dirname(workspaceInstructionFilePath), { recursive: true });
    writeFileSync(workspaceInstructionFilePath, "# workspace instruction\n", "utf8");
    const workspaceSessionRuntimeContextService = {
      prepareWorkspaceInstructionBundle: vi.fn(() => ({
        instructionFilePath: workspaceInstructionFilePath,
        authFilePath: workspaceAuthFilePath,
        runtimeHomeDir: path.dirname(workspaceInstructionFilePath),
        runtimeEnv: {
          CODINGNS_AUTH_FILE: workspaceAuthFilePath,
          WORKSPACE_SESSION_AUTH_FILE: workspaceAuthFilePath,
          CODINGNS_OFFICE_MCP_AUTH_FILE: workspaceAuthFilePath,
          [CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV]: "1"
        }
      }))
    };
    const {
      service,
      sessionHistoryService,
      sessionMessageAttachmentService,
      workspaceService
    } = createService({}, null, workspaceSessionRuntimeContextService);
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
      startSession: vi.fn(async () => ({
        getSnapshot: vi.fn(() => ({
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
        })),
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
      path: workspaceRoot
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/.codex/provider-session-1.jsonl"
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);
    sessionHistoryService.getSession.mockImplementation((sessionId: string) => ({
      sessionId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/.codex/provider-session-1.jsonl",
      messageCount: 0
    }));

    await service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "请继续处理这个工作区任务",
      clientRequestId: null
    });

    expect(workspaceSessionRuntimeContextService.prepareWorkspaceInstructionBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        userId: "user-1",
        workspaceId: "workspace-1",
        workspacePath: workspaceRoot,
        projectId: null,
        provider: "codex",
        instructionOverlay: null
      })
    );
    expect(providerRuntimeService.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeEnv: expect.objectContaining({
          CODINGNS_AUTH_FILE: workspaceAuthFilePath,
          WORKSPACE_SESSION_AUTH_FILE: workspaceAuthFilePath,
          CODINGNS_OFFICE_MCP_AUTH_FILE: workspaceAuthFilePath,
          [CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV]: "1"
        }),
        runtimeHomeDir: null,
        options: expect.objectContaining({
          providerInstructionFilePath: workspaceInstructionFilePath
        })
      })
    );
  });

  it("startLiveSession 在写入首条图片附件前会先创建 pending session binding", async () => {
    const {
      service,
      sessionHistoryService,
      sessionMessageAttachmentService,
      workspaceService,
      sessionBindingRepository
    } = createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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

    expect(sessionBindingRepository.upsert).toHaveBeenCalled();
    expect(sessionMessageAttachmentService.persistAttachments).toHaveBeenCalledTimes(1);
    expect(
      sessionBindingRepository.upsert.mock.invocationCallOrder[0]
    ).toBeLessThan(
      sessionMessageAttachmentService.persistAttachments.mock.invocationCallOrder[0]
    );
  });

  it("sendLiveMessage 会为工作区会话续写显式注入工作区说明和 scoped 认证环境", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codingns-workspace-instruction-send-"));
    const workspaceInstructionFilePath = path.join(
      workspaceRoot,
      ".codingns",
      "workspace-session-runtime",
      "session-1",
      "WORKSPACE_SESSION_COMPOSED.md"
    );
    const workspaceAuthFilePath = path.join(
      workspaceRoot,
      ".codingns",
      "workspace-session-runtime",
      "session-1",
      "WORKSPACE_SESSION_AUTH.json"
    );
    tempDirs.push(workspaceRoot);
    mkdirSync(path.dirname(workspaceInstructionFilePath), { recursive: true });
    writeFileSync(workspaceInstructionFilePath, "# workspace instruction\n", "utf8");
    const workspaceSessionRuntimeContextService = {
      prepareWorkspaceInstructionBundle: vi.fn(() => ({
        instructionFilePath: workspaceInstructionFilePath,
        authFilePath: workspaceAuthFilePath,
        runtimeHomeDir: path.dirname(workspaceInstructionFilePath),
        runtimeEnv: {
          CODINGNS_AUTH_FILE: workspaceAuthFilePath,
          WORKSPACE_SESSION_AUTH_FILE: workspaceAuthFilePath,
          CODINGNS_OFFICE_MCP_AUTH_FILE: workspaceAuthFilePath,
          [CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV]: "1"
        }
      }))
    };
    const {
      service,
      sessionHistoryService,
      sessionMessageAttachmentService,
      workspaceService
    } = createService({}, null, workspaceSessionRuntimeContextService);
    const continueSession = vi.fn(async () => ({
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-04-25T13:48:12.000Z",
        lastEventAt: "2026-04-25T13:48:12.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      attach: vi.fn()
    }));
    Object.defineProperty(service, "providerRuntimeService", {
      value: {
        isRunHealthy: vi.fn(() => true),
        getSnapshot: vi.fn(() => null),
        continueSession
      },
      configurable: true
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      messageCount: 8
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
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
    });
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: workspaceRoot
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionMessageAttachmentService.bindClientRequestToMessage.mockReturnValue([]);
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);

    await service.sendLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "继续处理浏览器任务",
      clientRequestId: null
    });

    expect(workspaceSessionRuntimeContextService.prepareWorkspaceInstructionBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        workspacePath: workspaceRoot,
        projectId: null,
        provider: "codex",
        instructionOverlay: null
      })
    );
    expect(continueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeEnv: expect.objectContaining({
          CODINGNS_AUTH_FILE: workspaceAuthFilePath,
          WORKSPACE_SESSION_AUTH_FILE: workspaceAuthFilePath,
          CODINGNS_OFFICE_MCP_AUTH_FILE: workspaceAuthFilePath,
          [CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV]: "1"
        }),
        runtimeHomeDir: null,
        options: expect.objectContaining({
          providerInstructionFilePath: workspaceInstructionFilePath
        })
      })
    );
  });

  it("命中登录态浏览器任务时，会额外注入本轮浏览器临时规则", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codingns-workspace-browser-overlay-"));
    const workspaceInstructionFilePath = path.join(
      workspaceRoot,
      ".codingns",
      "workspace-session-runtime",
      "session-1",
      "WORKSPACE_SESSION_COMPOSED.md"
    );
    const workspaceAuthFilePath = path.join(
      workspaceRoot,
      ".codingns",
      "workspace-session-runtime",
      "session-1",
      "WORKSPACE_SESSION_AUTH.json"
    );
    tempDirs.push(workspaceRoot);
    mkdirSync(path.dirname(workspaceInstructionFilePath), { recursive: true });
    const workspaceSessionRuntimeContextService = {
      prepareWorkspaceInstructionBundle: vi.fn((input?: { instructionOverlay?: string | null }) => {
        const overlay = input?.instructionOverlay?.trim() ?? "";
        const content = [
          "# workspace instruction",
          overlay ? `\n# 工作区会话临时规则\n\n${overlay}` : ""
        ].join("\n");
        writeFileSync(workspaceInstructionFilePath, `${content}\n`, "utf8");
        return {
          instructionFilePath: workspaceInstructionFilePath,
          authFilePath: workspaceAuthFilePath,
          runtimeHomeDir: path.dirname(workspaceInstructionFilePath),
          runtimeEnv: {
            CODINGNS_AUTH_FILE: workspaceAuthFilePath,
            WORKSPACE_SESSION_AUTH_FILE: workspaceAuthFilePath,
            CODINGNS_OFFICE_MCP_AUTH_FILE: workspaceAuthFilePath,
            [CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV]: "1"
          }
        };
      })
    };
    const {
      service,
      sessionHistoryService,
      sessionMessageAttachmentService,
      workspaceService
    } = createService({}, null, workspaceSessionRuntimeContextService);
    const continueSession = vi.fn(async () => ({
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-04-25T13:48:12.000Z",
        lastEventAt: "2026-04-25T13:48:12.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      attach: vi.fn()
    }));
    Object.defineProperty(service, "providerRuntimeService", {
      value: {
        isRunHealthy: vi.fn(() => true),
        getSnapshot: vi.fn(() => null),
        continueSession
      },
      configurable: true
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      messageCount: 8
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
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
    });
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: workspaceRoot
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionMessageAttachmentService.bindClientRequestToMessage.mockReturnValue([]);
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);

    await service.sendLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "请用 Edge 当前已登录窗口打开淘宝待收货页面并截图",
      clientRequestId: null
    });

    expect(workspaceSessionRuntimeContextService.prepareWorkspaceInstructionBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        instructionOverlay: expect.stringContaining("浏览器任务临时规则（本轮生效）")
      })
    );
    const injectedInstruction = readFileSync(workspaceInstructionFilePath, "utf8");
    expect(injectedInstruction).toContain("浏览器任务临时规则（本轮生效）");
    expect(injectedInstruction).toContain("executionBackend=opencli_bridge");
    expect(injectedInstruction).toContain("不要自动切到 `playwright`");
    expect(continueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          providerInstructionFilePath: workspaceInstructionFilePath
        })
      })
    );
  });

  it("普通非浏览器消息不会注入本轮浏览器临时规则", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codingns-workspace-browser-overlay-none-"));
    const workspaceInstructionFilePath = path.join(
      workspaceRoot,
      ".codingns",
      "workspace-session-runtime",
      "session-1",
      "WORKSPACE_SESSION_COMPOSED.md"
    );
    const workspaceAuthFilePath = path.join(
      workspaceRoot,
      ".codingns",
      "workspace-session-runtime",
      "session-1",
      "WORKSPACE_SESSION_AUTH.json"
    );
    tempDirs.push(workspaceRoot);
    mkdirSync(path.dirname(workspaceInstructionFilePath), { recursive: true });
    const workspaceSessionRuntimeContextService = {
      prepareWorkspaceInstructionBundle: vi.fn((input?: { instructionOverlay?: string | null }) => {
        writeFileSync(workspaceInstructionFilePath, "# workspace instruction\n", "utf8");
        return {
          instructionFilePath: workspaceInstructionFilePath,
          authFilePath: workspaceAuthFilePath,
          runtimeHomeDir: path.dirname(workspaceInstructionFilePath),
          runtimeEnv: {
            CODINGNS_AUTH_FILE: workspaceAuthFilePath,
            WORKSPACE_SESSION_AUTH_FILE: workspaceAuthFilePath,
            CODINGNS_OFFICE_MCP_AUTH_FILE: workspaceAuthFilePath,
            [CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV]: "1"
          }
        };
      })
    };
    const {
      service,
      sessionHistoryService,
      sessionMessageAttachmentService,
      workspaceService
    } = createService({}, null, workspaceSessionRuntimeContextService);
    const continueSession = vi.fn(async () => ({
      getSnapshot: vi.fn(() => ({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "thread-1",
        rawStoreRef: "/tmp/.codex/thread-1.jsonl",
        runningState: "running",
        attachedClients: 1,
        startedAt: "2026-04-25T13:48:12.000Z",
        lastEventAt: "2026-04-25T13:48:12.000Z",
        completedAt: null,
        detail: null,
        errorCode: null,
        supportsInterrupt: true
      })),
      attach: vi.fn()
    }));
    Object.defineProperty(service, "providerRuntimeService", {
      value: {
        isRunHealthy: vi.fn(() => true),
        getSnapshot: vi.fn(() => null),
        continueSession
      },
      configurable: true
    });

    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      messageCount: 8
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
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
    });
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: workspaceRoot
    });
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionMessageAttachmentService.bindClientRequestToMessage.mockReturnValue([]);
    sessionHistoryService.getBindingOrThrow.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null
    });
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);

    await service.sendLiveMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "请继续整理这次 spec 的任务拆分",
      clientRequestId: null
    });

    expect(workspaceSessionRuntimeContextService.prepareWorkspaceInstructionBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        instructionOverlay: null
      })
    );
  });

  it("Claude 托管 active run 续发消息时会清理外部运行态快照，避免退回灰色不可中止", async () => {
    const { service, sessionHistoryService, sessionMessageAttachmentService, workspaceService } =
      createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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

  it("getSessionRuntime 遇到过期的 Claude external runtime snapshot 时，会清理快照并回退到 fallback 状态", async () => {
    useFakeNow("2026-03-26T10:05:00.000Z");

    const { service, sessionHistoryService } = createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      runningState: "idle",
      activitySource: "inferred",
      lastEventAt: "2026-03-26T10:00:12.000Z",
      completedAt: "2026-03-26T10:00:12.000Z",
      updatedAt: "2026-03-26T10:00:12.000Z",
      lastErrorCode: null,
      lastErrorDetail: null
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

    (service as any).externalRuntimeSnapshots.set("session-1", {
      sessionId: "session-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "claude://raw-1",
      runningState: "running",
      detail: "stale external runtime",
      updatedAt: "2026-03-26T10:00:01.000Z"
    });

    const runtime = await service.getSessionRuntime("session-1", "user-1");

    expect(sessionHistoryService.refreshRuntimeFallbackSession).toHaveBeenCalledWith(
      "session-1",
      "user-1"
    );
    expect(runtime.runningState).toBe("idle");
    expect(runtime.hasActiveRun).toBe(false);
    expect(runtime.canInterrupt).toBe(false);
    expect(runtime.activityResolutionSource).toBe("inferred_log");
    expect((service as any).externalRuntimeSnapshots.has("session-1")).toBe(false);
  });

  it("getSessionRuntime 遇到终态 runtime snapshot 时，不应再标记 hasActiveRun", async () => {
    const { service, sessionHistoryService } = createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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

  it("Codex 空闲时也可以手动引导指定队列项，并立即起新一轮发送", async () => {
    const {
      service,
      sessionHistoryService,
      sessionSendQueueRepository,
      sessionMessageAttachmentService
    } = createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
        acceptedAt: "2026-04-18T10:00:03.000Z",
        clientRequestId: "client-queue-codex-1",
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
      runningState: "idle"
    });
    sessionHistoryService.getSessionCapabilities.mockResolvedValue({
      provider: "codex",
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
    sessionSendQueueRepository.findBySessionUserAndId.mockReturnValue({
      id: "queue-codex-1",
      sessionId: "session-1",
      userId: "user-1",
      content: "这条不要继续等，立刻发给 Codex 会话",
      clientRequestId: "client-queue-codex-1",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      status: "failed",
      orderIndex: 2,
      errorDetail: "上次 runtime 边界抖动",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
      dispatchedAt: null
    });
    sessionMessageAttachmentService.getRuntimeAttachments.mockReturnValue([]);

    const result = await service.steerQueuedMessage("session-1", "user-1", "queue-codex-1");

    expect(sessionSendQueueRepository.markDispatching).toHaveBeenCalledWith(
      "queue-codex-1",
      expect.any(String)
    );
    expect((service as any).sendLiveMessageDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        content: "这条不要继续等，立刻发给 Codex 会话"
      }),
      expect.any(Object)
    );
    expect(sessionSendQueueRepository.delete).toHaveBeenCalledWith("queue-codex-1");
    expect(result.queueItemId).toBe("queue-codex-1");
  });

  it("Claude 外部运行态存在时不会提前调度队列", async () => {
    useFakeNow("2026-03-26T10:00:30.000Z");

    const { service, sessionSendQueueRepository } = createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
    useFakeNow("2026-03-26T10:00:30.000Z");

    const { service, sessionHistoryService, workspaceService } = createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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

  it("Claude 外部运行态存在时，中断接口会强制清理本地运行态，避免把用户卡死", async () => {
    useFakeNow("2026-03-26T10:00:30.000Z");

    const {
      service,
      sessionHistoryService,
      sessionStateRepository,
      sessionStatusSnapshotRepository
    } = createService();
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
    sessionHistoryService.refreshRuntimeFallbackSession.mockResolvedValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-1.jsonl",
      messageCount: 3,
      runningState: "running"
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
      syncCursor: "cursor-1",
      lastSyncAt: "2026-03-26T10:00:01.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      updatedAt: "2026-03-26T10:00:01.000Z"
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

    await expect(service.interruptSession("session-1", "user-1")).resolves.toMatchObject({
      sessionId: "session-1",
      interrupted: true,
      detail: "Claude 外部运行当前无法直接中断，已强制清理本地运行状态"
    });
    expect(sessionHistoryService.refreshRuntimeFallbackSession).toHaveBeenCalledWith(
      "session-1",
      "user-1"
    );
    expect(sessionStateRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        userId: "user-1",
        runningState: "interrupted",
        activitySource: "runtime"
      })
    );
  });

  it("stale running 会话点击中断时会先回刷状态并直接成功返回", async () => {
    const { service, sessionHistoryService } = createService();
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
    sessionHistoryService.refreshRuntimeFallbackSession.mockResolvedValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-1.jsonl",
      messageCount: 3,
      runningState: "completed"
    });

    await expect(service.interruptSession("session-1", "user-1")).resolves.toMatchObject({
      sessionId: "session-1",
      interrupted: true,
      detail: "当前会话已停止，已自动同步状态"
    });
    expect(sessionHistoryService.refreshRuntimeFallbackSession).toHaveBeenCalledWith(
      "session-1",
      "user-1"
    );
  });

  it("stale running 会话回刷后仍未收口时，会直接把数据库状态修正为 interrupted", async () => {
    const {
      service,
      sessionHistoryService,
      sessionStateRepository,
      sessionStatusSnapshotRepository
    } = createService();
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
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      messageCount: 3,
      runningState: "running"
    });
    sessionHistoryService.refreshRuntimeFallbackSession.mockResolvedValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      messageCount: 3,
      runningState: "running"
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
      syncCursor: "cursor-1",
      lastSyncAt: "2026-03-26T10:00:01.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      updatedAt: "2026-03-26T10:00:01.000Z"
    });

    await expect(service.interruptSession("session-1", "user-1")).resolves.toMatchObject({
      sessionId: "session-1",
      interrupted: true,
      detail: "当前会话已停止，已自动修正残留运行状态"
    });
    expect(sessionStateRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        userId: "user-1",
        runningState: "interrupted",
        activitySource: "runtime"
      })
    );
  });

  it("dispatchNextQueuedMessage 遇到 ACTIVE_RUN_EXISTS 时会回到等待并安排重试", async () => {
    useFakeNow();
    const { service, sessionHistoryService, sessionSendQueueRepository } = createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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

    await advanceBackgroundTimers(1200);

    expect((service as any).sendLiveMessageDirect).toHaveBeenCalledTimes(2);
  });

  it("dispatchNextQueuedMessage 遇到运行时追加受限时会回到等待并自动重试", async () => {
    useFakeNow();
    const { service, sessionHistoryService, sessionSendQueueRepository } = createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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

    await advanceBackgroundTimers(1200);

    expect((service as any).sendLiveMessageDirect).toHaveBeenCalledTimes(2);
    expect(sessionSendQueueRepository.delete).toHaveBeenCalledWith("queue-1");
  });

  it("运行态进入终态时会发出 terminal 事件回调", async () => {
    const { service, sessionHistoryService, sessionStateRepository, sessionStatusSnapshotRepository } = createService();
    const providerRuntimeService = {
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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

  it("persistRuntimeEvent 遇到 SQLITE_BUSY 会退避重试，避免 active run listener 直接丢事件", async () => {
    useFakeNow("2026-03-26T10:00:00.000Z");
    const {
      service,
      sessionHistoryService,
      sessionStateRepository,
      sessionStatusSnapshotRepository
    } = createService();
    const busyError = new Error("database is locked") as Error & { code: string };
    busyError.code = "SQLITE_BUSY";

    sessionHistoryService.persistSessionBinding
      .mockImplementationOnce(() => {
        throw busyError;
      })
      .mockImplementationOnce(() => undefined);
    sessionStateRepository.findBySessionAndUser.mockReturnValue({
      sessionId: "session-1",
      userId: "user-1",
      runningState: "running",
      completedAt: null,
      lastSeenAt: null
    });
    sessionStatusSnapshotRepository.findBySessionId.mockReturnValue({
      sessionId: "session-1",
      syncCursor: "cursor-1",
      resumedAt: null
    });

    const persistPromise = (service as any).persistRuntimeEvent("session-1", "workspace-1", "user-1", {
      type: "status",
      sessionId: "session-1",
      provider: "codex",
      providerSessionId: "thread-1",
      rawStoreRef: "/tmp/.codex/thread-1.jsonl",
      status: "completed",
      detail: null,
      timestamp: "2026-03-26T10:00:02.000Z"
    });

    expect(sessionHistoryService.persistSessionBinding).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    await persistPromise;

    expect(sessionHistoryService.persistSessionBinding).toHaveBeenCalledTimes(2);
    expect(sessionStateRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        runningState: "completed",
        completedAt: "2026-03-26T10:00:02.000Z"
      })
    );
    expect(sessionStatusSnapshotRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        syncStatus: "idle",
        lastSyncAt: "2026-03-26T10:00:02.000Z"
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
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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
    await flushRuntimePersistence(service);
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
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      userId: null
    });
  });

  it("Claude 对只读 codingns assistant 命令会自动放行，不再挂起 Bash 审批", async () => {
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
    sessionBindingRepository.findByProviderSession.mockReturnValue({
      sessionId: "session-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl"
    });
    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-real-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      runningState: "running",
      updatedAt: "2026-03-30T15:00:00.000Z",
      lastEventAt: "2026-03-30T15:00:00.000Z"
    });

    const result = await service.ingestClaudeHookEvent({
      hook_event_name: "PreToolUse",
      session_id: "claude-session-real-1",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      tool_name: "Bash",
      tool_input: {
        command: "codingns assistant sessions list --project project-1"
      }
    });

    expect(result).toMatchObject({
      accepted: true,
      ignored: false,
      sessionId: "session-1"
    });
    expect(result.bridgeResponse).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "CodingNS 已自动放行只读的助手 CLI 查询命令"
      }
    });
    await expect(service.listPermissionRequests("session-1", "user-1")).resolves.toEqual([]);
  });

  it("Claude 对受控的 codingns assistant 写操作也会自动放行", async () => {
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
    sessionBindingRepository.findByProviderSession.mockReturnValue({
      sessionId: "session-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl"
    });
    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-real-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      runningState: "running",
      updatedAt: "2026-03-30T15:00:00.000Z",
      lastEventAt: "2026-03-30T15:00:00.000Z"
    });

    const result = await service.ingestClaudeHookEvent({
      hook_event_name: "PreToolUse",
      session_id: "claude-session-real-1",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      tool_name: "Bash",
      tool_input: {
        command: "codingns assistant automations create --trigger interval --every-hours 1 --message \"继续推进\""
      }
    });

    expect(result.accepted).toBe(true);
    expect(result.ignored).toBe(false);
    expect(result.sessionId).toBe("session-1");
    expect(result.bridgeResponse).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "CodingNS 已自动放行受控的助手 CLI 执行命令"
      }
    });
    await expect(service.listPermissionRequests("session-1", "user-1")).resolves.toEqual([]);
  });

  it("Claude 对拼接了 shell 控制符的 assistant 命令仍然保留人工审批", async () => {
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
    sessionBindingRepository.findByProviderSession.mockReturnValue({
      sessionId: "session-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl"
    });
    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-real-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      runningState: "running",
      updatedAt: "2026-03-30T15:00:00.000Z",
      lastEventAt: "2026-03-30T15:00:00.000Z"
    });

    const resultPromise = service.ingestClaudeHookEvent({
      hook_event_name: "PreToolUse",
      session_id: "claude-session-real-1",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      tool_name: "Bash",
      tool_input: {
        command: "codingns assistant automations create --message \"继续推进\" && rm -rf /tmp/demo"
      }
    });
    let requests = await service.listPermissionRequests("session-1", "user-1");

    if (requests.length === 0) {
      await Promise.resolve();
      requests = await service.listPermissionRequests("session-1", "user-1");
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.command).toBe(
      "codingns assistant automations create --message \"继续推进\" && rm -rf /tmp/demo"
    );
    await service.replyPermissionRequest("session-1", "user-1", requests[0]!.id, {
      action: "allow"
    });
    const result = await resultPromise;

    expect(result.accepted).toBe(true);
    expect(result.ignored).toBe(false);
    expect(result.sessionId).toBe("session-1");
  });

  it("Claude 对同一路径的 Read 在本会话默认允许后会自动放行", async () => {
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
    sessionBindingRepository.findByProviderSession.mockReturnValue({
      sessionId: "session-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl"
    });
    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-real-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      runningState: "running",
      updatedAt: "2026-03-30T15:00:00.000Z",
      lastEventAt: "2026-03-30T15:00:00.000Z"
    });

    const firstResultPromise = service.ingestClaudeHookEvent({
      hook_event_name: "PreToolUse",
      session_id: "claude-session-real-1",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      tool_name: "Read",
      tool_input: {
        file_path: "/tmp/workspace/references/cli-workflow.md"
      }
    });
    let requests = await service.listPermissionRequests("session-1", "user-1");

    if (requests.length === 0) {
      await Promise.resolve();
      requests = await service.listPermissionRequests("session-1", "user-1");
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.actions.map((action) => action.value)).toEqual([
      "allow",
      "allow_session",
      "deny"
    ]);
    await service.replyPermissionRequest("session-1", "user-1", requests[0]!.id, {
      action: "allow_session"
    });
    const firstResult = await firstResultPromise;

    expect(firstResult.accepted).toBe(true);
    expect(firstResult.ignored).toBe(false);
    expect(firstResult.bridgeResponse).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow"
      }
    });

    const secondResult = await service.ingestClaudeHookEvent({
      hook_event_name: "PreToolUse",
      session_id: "claude-session-real-1",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      tool_name: "Read",
      tool_input: {
        file_path: "/tmp/workspace/references/cli-workflow.md"
      }
    });

    expect(secondResult.accepted).toBe(true);
    expect(secondResult.ignored).toBe(false);
    expect(secondResult.bridgeResponse).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow"
      }
    });
  });

  it("Claude PermissionRequest 对同一路径的 Read 在本会话默认允许后会自动放行", async () => {
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
    sessionBindingRepository.findByProviderSession.mockReturnValue({
      sessionId: "session-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl"
    });
    sessionHistoryService.getSession.mockReturnValue({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerSessionId: "claude-session-real-1",
      rawStoreRef: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      runningState: "running",
      updatedAt: "2026-03-30T15:00:00.000Z",
      lastEventAt: "2026-03-30T15:00:00.000Z"
    });

    const firstResultPromise = service.ingestClaudeHookEvent({
      hook_event_name: "PermissionRequest",
      session_id: "claude-session-real-1",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      tool_name: "Read",
      tool_input: {
        file_path: "/tmp/workspace/references/cli-workflow.md"
      }
    });
    let requests = await service.listPermissionRequests("session-1", "user-1");

    if (requests.length === 0) {
      await Promise.resolve();
      requests = await service.listPermissionRequests("session-1", "user-1");
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.actions.map((action) => action.value)).toEqual([
      "allow",
      "allow_session",
      "deny"
    ]);
    await service.replyPermissionRequest("session-1", "user-1", requests[0]!.id, {
      action: "allow_session"
    });
    const firstResult = await firstResultPromise;

    expect(firstResult.accepted).toBe(true);
    expect(firstResult.ignored).toBe(false);
    expect(firstResult.bridgeResponse).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow"
        }
      }
    });

    const secondResult = await service.ingestClaudeHookEvent({
      hook_event_name: "PermissionRequest",
      session_id: "claude-session-real-1",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/.claude/projects/tmp-workspace/claude-session-real-1.jsonl",
      tool_name: "Read",
      tool_input: {
        file_path: "/tmp/workspace/references/cli-workflow.md"
      }
    });

    expect(secondResult.accepted).toBe(true);
    expect(secondResult.ignored).toBe(false);
    expect(secondResult.bridgeResponse).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow"
        }
      }
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
      canInterrupt: true,
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
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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
    useFakeNow();
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
      isRunHealthy: vi.fn(() => true),
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

    scheduleSnapshotUpdate(runtimeSnapshot, {
      providerSessionId: "gemini-session-real-1",
      rawStoreRef: "gemini://session/gemini-session-real-1",
      runningState: "running",
      lastEventAt: "2026-03-26T10:00:00.200Z"
    });

    const resultPromise = service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "gemini",
      content: "Gemini 启动后先回填真实 session id",
      clientRequestId: null
    });

    const result = await resultPromise;

    expect(result.providerSessionId).toBe("pending://gemini/runtime-session-1");

    await advanceBackgroundTimers();

    const createdSessionId = sessionHistoryService.persistSessionBinding.mock.calls[0]?.[0];

    expect(createdSessionId).toEqual(expect.any(String));
    expect(sessionHistoryService.persistSessionBinding).toHaveBeenLastCalledWith(
      createdSessionId,
      "workspace-1",
      {
        provider: "gemini",
        providerSessionId: "gemini-session-real-1",
        rawStoreRef: "gemini://session/gemini-session-real-1",
        userId: null
      }
    );
  });

  it("startLiveSession 会在后台把 Codex synthetic binding 回填成真实 rollout 路径", async () => {
    useFakeNow();
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
      isRunHealthy: vi.fn(() => true),
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

    scheduleSnapshotUpdate(runtimeSnapshot, {
      rawStoreRef:
        "/Users/test/butler-runtime/codex-home/sessions/2026/04/15/rollout-2026-04-15T15-58-15-019d9025-e575-7fa1-84e2-9e797a2d61df.jsonl",
      runningState: "running",
      lastEventAt: "2026-04-15T07:58:16.000Z"
    });

    const resultPromise = service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "Codex 启动后应回填真实 rollout 路径",
      clientRequestId: null
    });

    const result = await resultPromise;

    expect(result.providerSessionId).toBe("019d9025-e575-7fa1-84e2-9e797a2d61df");

    await advanceBackgroundTimers();

    const createdSessionId = sessionHistoryService.persistSessionBinding.mock.calls[0]?.[0];

    expect(createdSessionId).toEqual(expect.any(String));
    expect(sessionHistoryService.persistSessionBinding).toHaveBeenLastCalledWith(
      createdSessionId,
      "workspace-1",
      {
        provider: "codex",
        providerSessionId: "019d9025-e575-7fa1-84e2-9e797a2d61df",
        rawStoreRef:
          "/Users/test/butler-runtime/codex-home/sessions/2026/04/15/rollout-2026-04-15T15-58-15-019d9025-e575-7fa1-84e2-9e797a2d61df.jsonl",
        userId: null
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
      isRunHealthy: vi.fn(() => true),
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
      isRunHealthy: vi.fn(() => true),
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

  it("Gemini stream-json 在输出 result 后即使进程尚未退出，Host 也应把会话切到 completed", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codingns-gemini-host-runtime-"));
    const cliPath = path.join(tempDir, "fake-gemini");
    writeFileSync(
      cliPath,
      `#!/usr/bin/env node
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  console.log(JSON.stringify({ type: "init", session_id: "gemini-session-e2e", model: "flash" }));
  await sleep(40);
  console.log(JSON.stringify({ type: "message", role: "assistant", content: "第一段", delta: true }));
  await sleep(40);
  console.log(JSON.stringify({ type: "result", status: "success" }));
  await sleep(4000);
  process.exit(0);
})().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
`,
      "utf8"
    );
    chmodSync(cliPath, 0o755);

    const {
      service,
      sessionHistoryService,
      sessionMessageAttachmentService,
      workspaceService
    } = createService({
      geminiCliPath: cliPath,
      geminiHomeDir: path.join(tempDir, "gemini-home")
    });

    let currentBinding: {
      provider: string;
      providerSessionId: string | null;
      rawStoreRef: string | null;
    } | null = null;

    sessionHistoryService.persistSessionBinding.mockImplementation(
      (_sessionId: string, _workspaceId: string, binding: typeof currentBinding) => {
        currentBinding = binding;
      }
    );
    sessionHistoryService.getBindingOrThrow.mockImplementation(() => {
      if (!currentBinding) {
        throw new Error("BINDING_NOT_FOUND");
      }

      return currentBinding;
    });
    sessionHistoryService.getProviderCapabilitiesSnapshot.mockReturnValue({
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
    sessionHistoryService.findLatestUserMessage.mockResolvedValue(null);
    sessionHistoryService.getSession.mockImplementation((sessionId: string) => ({
      sessionId,
      workspaceId: "workspace-1",
      provider: "gemini",
      providerSessionId: currentBinding?.providerSessionId ?? "pending://gemini/unknown",
      rawStoreRef: currentBinding?.rawStoreRef ?? "pending://gemini/unknown",
      messageCount: 0
    }));
    sessionMessageAttachmentService.buildProviderPrompt.mockReturnValue(null);
    sessionMessageAttachmentService.bindClientRequestToMessage.mockReturnValue([]);
    workspaceService.getWorkspaceOrThrow.mockReturnValue({
      id: "workspace-1",
      path: tempDir
    });

    try {
      const accepted = await service.startLiveSession({
        workspaceId: "workspace-1",
        userId: "user-1",
        provider: "gemini",
        content: "请输出一句测试文本后结束",
        clientRequestId: null
      });
      const envelopes: Array<Record<string, unknown>> = [];
      const subscription = service.subscribeRuntime(accepted.sessionId, async (envelope) => {
        envelopes.push(envelope as Record<string, unknown>);
      });

      let runtime = await service.getSessionRuntime(accepted.sessionId, "user-1");

      for (let attempt = 0; attempt < 30 && runtime.runningState !== "completed"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        runtime = await service.getSessionRuntime(accepted.sessionId, "user-1");
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      const activityEnvelopes = envelopes.filter((item) => item.type === "session.activity");
      const lastActivity = activityEnvelopes.at(-1) ?? null;
      const runtimeSnapshot = (
        service as unknown as {
          providerRuntimeService: { getSnapshot(sessionId: string): Record<string, unknown> | null };
        }
      ).providerRuntimeService.getSnapshot(accepted.sessionId);

      expect(runtime.runningState).toBe("completed");
      expect(runtime.hasActiveRun).toBe(false);
      expect(runtimeSnapshot).not.toBeNull();
      expect(
        envelopes.some(
          (item) => item.type === "session.runtime_status" && item.status === "completed"
        )
      ).toBe(true);
      expect(lastActivity).toMatchObject({
        type: "session.activity",
        runningState: "completed",
        hasActiveRun: false,
        canInterrupt: false
      });

      subscription.close();
    } finally {
      await service.dispose();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("startLiveSession 会在 Kimi 首轮等待真实 binding 并优先返回权威 user 消息", async () => {
    useFakeNow();
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
      isRunHealthy: vi.fn(() => true),
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

    scheduleSnapshotUpdate(runtimeSnapshot, {
      providerSessionId: "kimi-session-real-1",
      rawStoreRef: "kimi://session/kimi-session-real-1",
      runningState: "running",
      lastEventAt: "2026-04-09T10:00:00.200Z"
    });

    const resultPromise = service.startLiveSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "kimi",
      content: "首条 Kimi 用户消息",
      clientRequestId: "client-kimi-1"
    });

    await advanceBackgroundTimers();
    const result = await resultPromise;

    expect(result.providerSessionId).toBe("kimi-session-real-1");
    expect(result.message.messageId).toBe("kimi-user-1");
    expect(result.message.rawRef).toBe("kimi://session/kimi-session-real-1/context#line=3");
    expect(result.message.content).toBe("首条 Kimi 用户消息");
  });
});

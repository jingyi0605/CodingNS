import { describe, expect, it, vi } from "vitest";

import { AssistantCapabilityService } from "../../src/modules/assistant-capability/assistant-capability-service.js";

describe("AssistantCapabilityService", () => {
  it("新建项目会话时会默认继承当前助手控制会话的 provider 与模型配置", async () => {
    const service = new AssistantCapabilityService(
      {
        list: vi.fn(),
        getById: vi.fn(),
        getOverview: vi.fn()
      } as any,
      {
        listByProject: vi.fn(),
        ensureProjectSessionsSynced: vi.fn(),
        startSession: vi.fn(async (_projectId: string, input: Record<string, unknown>) => ({
          id: "butler-session-1",
          sessionId: "session-1",
          provider: input.providerId
        }))
      } as any,
      {
        getCurrentSession: vi.fn(() => ({
          id: "control-1",
          providerId: "codex",
          sessionId: "assistant-session-1",
          purpose: "chat",
          title: null,
          sourceItemId: null,
          model: "gpt-5.4",
          reasoningLevel: "high",
          permissionMode: "acceptEdits",
          status: "running",
          lastContextVersion: null,
          lastSummary: null,
          createdAt: "2026-04-16T12:00:00.000Z",
          updatedAt: "2026-04-16T12:00:00.000Z",
          session: {
            sessionId: "assistant-session-1"
          }
        }))
      } as any,
      {
        listTasks: vi.fn(),
        getTask: vi.fn(),
        createTask: vi.fn(),
        cancelTask: vi.fn(),
        listRuns: vi.fn()
      } as any,
      {
        listTimers: vi.fn(),
        getTimer: vi.fn(),
        createTimer: vi.fn(),
        cancelTimer: vi.fn()
      } as any,
      {
        getSession: vi.fn(),
        readSessionHistory: vi.fn(),
        forkSession: vi.fn()
      } as any,
      {
        startLiveSession: vi.fn(),
        getSessionRuntime: vi.fn(),
        sendLiveMessage: vi.fn()
      } as any,
      {
        listTerminals: vi.fn(),
        readTerminalHistory: vi.fn(),
        writeInput: vi.fn(),
        closeTerminal: vi.fn()
      } as any,
      {
        analyze: vi.fn(),
        getFrameworkAnalysis: vi.fn(),
        refreshFrameworkAnalysis: vi.fn(),
        createLaunchPlan: vi.fn(),
        run: vi.fn(),
        getLatestRuntimeDetail: vi.fn(),
        getRecentRuntimeDetails: vi.fn(),
        getRuntimeDetail: vi.fn(),
        getCompatibilityMatrix: vi.fn()
      } as any,
      {
        list: vi.fn(),
        browseDirectories: vi.fn(),
        createDirectory: vi.fn(),
        importWorkspace: vi.fn(),
        cloneWorkspace: vi.fn(),
        reorderWorkspaces: vi.fn(),
        getManagementSummary: vi.fn(),
        removeWorkspace: vi.fn(),
        updateNavigationState: vi.fn()
      } as any,
      {
        findByWorkspaceId: vi.fn()
      } as any,
      {
        getTree: vi.fn(),
        create: vi.fn()
      } as any,
      {
        syncRoot: vi.fn()
      } as any,
      {
        preview: vi.fn(),
        apply: vi.fn()
      } as any,
      {
        cleanup: vi.fn()
      } as any,
      {
        upsert: vi.fn()
      } as any
    );

    const receipt = await service.startProjectSession({
      projectId: "project-1",
      userId: "user-1",
      content: "请在新会话里继续推进"
    });

    expect(receipt.capability).toBe("projects.sessions.start");
    expect((service as any).butlerSessionService.startSession).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        providerId: "codex",
        model: "gpt-5.4",
        reasoningLevel: "high",
        permissionMode: "acceptEdits"
      }),
      "user-1"
    );
  });

  it("控制会话默认 provider 已被禁用时，会拒绝启动新的助手会话", async () => {
    const service = new AssistantCapabilityService(
      {
        list: vi.fn(),
        getById: vi.fn(),
        getOverview: vi.fn()
      } as any,
      {
        listByProject: vi.fn(),
        ensureProjectSessionsSynced: vi.fn(),
        startSession: vi.fn()
      } as any,
      {
        getCurrentSession: vi.fn(() => ({
          id: "control-1",
          providerId: "codex",
          sessionId: "assistant-session-1",
          purpose: "chat",
          title: null,
          sourceItemId: null,
          model: "gpt-5.4",
          reasoningLevel: "high",
          permissionMode: "acceptEdits",
          status: "running",
          lastContextVersion: null,
          lastSummary: null,
          createdAt: "2026-04-16T12:00:00.000Z",
          updatedAt: "2026-04-16T12:00:00.000Z",
          session: {
            sessionId: "assistant-session-1"
          }
        }))
      } as any,
      {
        listTasks: vi.fn(),
        getTask: vi.fn(),
        createTask: vi.fn(),
        cancelTask: vi.fn(),
        listRuns: vi.fn()
      } as any,
      {
        listTimers: vi.fn(),
        getTimer: vi.fn(),
        createTimer: vi.fn(),
        cancelTimer: vi.fn()
      } as any,
      {
        getSession: vi.fn(),
        readSessionHistory: vi.fn(),
        forkSession: vi.fn(),
        deleteSession: vi.fn()
      } as any,
      {
        startLiveSession: vi.fn(),
        getSessionRuntime: vi.fn(),
        sendLiveMessage: vi.fn()
      } as any,
      {
        listTerminals: vi.fn(),
        readTerminalHistory: vi.fn(),
        writeInput: vi.fn(),
        closeTerminal: vi.fn()
      } as any,
      {
        analyze: vi.fn(),
        getFrameworkAnalysis: vi.fn(),
        refreshFrameworkAnalysis: vi.fn(),
        createLaunchPlan: vi.fn(),
        run: vi.fn(),
        getLatestRuntimeDetail: vi.fn(),
        getRecentRuntimeDetails: vi.fn(),
        getRuntimeDetail: vi.fn(),
        getCompatibilityMatrix: vi.fn()
      } as any,
      {
        list: vi.fn(),
        browseDirectories: vi.fn(),
        createDirectory: vi.fn(),
        importWorkspace: vi.fn(),
        cloneWorkspace: vi.fn(),
        reorderWorkspaces: vi.fn(),
        getManagementSummary: vi.fn(),
        removeWorkspace: vi.fn(),
        updateNavigationState: vi.fn()
      } as any,
      {
        findByWorkspaceId: vi.fn()
      } as any,
      {
        getTree: vi.fn(),
        create: vi.fn()
      } as any,
      {
        syncRoot: vi.fn()
      } as any,
      {
        preview: vi.fn(),
        apply: vi.fn()
      } as any,
      {
        cleanup: vi.fn()
      } as any,
      {
        upsert: vi.fn()
      } as any,
      null,
      {
        get: vi.fn(() => ({
          providerId: "codex",
          enabled: false,
          updatedAt: "2026-04-26T10:00:00.000Z"
        }))
      } as any
    );

    await expect(service.startProjectSession({
      projectId: "project-1",
      userId: "user-1",
      content: "请在新会话里继续推进"
    })).rejects.toMatchObject({
      errorCode: "PROVIDER_DISABLED",
      field: "providerId"
    });
  });

  it("向真实会话发送消息时会记录代理发送来源", async () => {
    const originRepository = {
      upsert: vi.fn()
    };
    const service = new AssistantCapabilityService(
      {
        list: vi.fn(),
        getById: vi.fn(),
        getOverview: vi.fn()
      } as any,
      {
        listByProject: vi.fn(),
        ensureProjectSessionsSynced: vi.fn(),
        startSession: vi.fn()
      } as any,
      {
        getCurrentSession: vi.fn()
      } as any,
      {
        listTasks: vi.fn(),
        getTask: vi.fn(),
        createTask: vi.fn(),
        cancelTask: vi.fn(),
        listRuns: vi.fn()
      } as any,
      {
        listTimers: vi.fn(),
        getTimer: vi.fn(),
        createTimer: vi.fn(),
        cancelTimer: vi.fn()
      } as any,
      {
        getSession: vi.fn(),
        readSessionHistory: vi.fn(),
        forkSession: vi.fn()
      } as any,
      {
        startLiveSession: vi.fn(),
        getSessionRuntime: vi.fn(),
        sendLiveMessage: vi.fn(async () => ({
          sessionId: "session-1",
          provider: "codex",
          providerSessionId: "provider-session-1",
          acceptedAt: "2026-04-16T12:10:00.000Z",
          clientRequestId: null,
          message: {
            messageId: "message-1",
            role: "user",
            content: "请继续推进",
            timestamp: "2026-04-16T12:10:00.000Z",
            sequence: 3,
            attachments: []
          }
        }))
      } as any,
      {
        listTerminals: vi.fn(),
        readTerminalHistory: vi.fn(),
        writeInput: vi.fn(),
        closeTerminal: vi.fn()
      } as any,
      {
        analyze: vi.fn(),
        getFrameworkAnalysis: vi.fn(),
        refreshFrameworkAnalysis: vi.fn(),
        createLaunchPlan: vi.fn(),
        run: vi.fn(),
        getLatestRuntimeDetail: vi.fn(),
        getRecentRuntimeDetails: vi.fn(),
        getRuntimeDetail: vi.fn(),
        getCompatibilityMatrix: vi.fn()
      } as any,
      {
        list: vi.fn(),
        browseDirectories: vi.fn(),
        createDirectory: vi.fn(),
        importWorkspace: vi.fn(),
        cloneWorkspace: vi.fn(),
        reorderWorkspaces: vi.fn(),
        getManagementSummary: vi.fn(),
        removeWorkspace: vi.fn(),
        updateNavigationState: vi.fn()
      } as any,
      {
        findByWorkspaceId: vi.fn()
      } as any,
      {
        getTree: vi.fn(),
        create: vi.fn()
      } as any,
      {
        syncRoot: vi.fn()
      } as any,
      {
        preview: vi.fn(),
        apply: vi.fn()
      } as any,
      {
        cleanup: vi.fn()
      } as any,
      originRepository as any
    );

    await service.sendSessionMessage({
      sessionId: "session-1",
      userId: "user-1",
      content: "请继续推进"
    });

    expect(originRepository.upsert).toHaveBeenCalledTimes(2);
    expect(originRepository.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: "session-1",
        messageId: null,
        origin: "butler_proxy",
        originRef: null,
        content: "请继续推进"
      })
    );
    expect(originRepository.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionId: "session-1",
        messageId: "message-1",
        origin: "butler_proxy",
        originRef: null,
        content: "请继续推进"
      })
    );
  });

  it("按 workspace 目标启动真实会话时会直接走 live session，并继承当前控制会话配置", async () => {
    const startLiveSession = vi.fn(async () => ({
      sessionId: "session-2",
      provider: "codex",
      providerSessionId: "provider-session-2",
      acceptedAt: "2026-04-16T12:20:00.000Z",
      clientRequestId: null,
      message: {
        messageId: "message-2",
        role: "user",
        content: "请在临时工作区开始处理这个问题",
        timestamp: "2026-04-16T12:20:00.000Z",
        sequence: 1,
        attachments: []
      },
      session: {
        sessionId: "session-2",
        workspaceId: "workspace-1"
      }
    }));
    const service = new AssistantCapabilityService(
      {
        list: vi.fn(),
        getById: vi.fn(),
        getOverview: vi.fn()
      } as any,
      {
        listByProject: vi.fn(),
        ensureProjectSessionsSynced: vi.fn(),
        startSession: vi.fn()
      } as any,
      {
        getCurrentSession: vi.fn(() => ({
          id: "control-1",
          providerId: "codex",
          sessionId: "assistant-session-1",
          purpose: "chat",
          title: null,
          sourceItemId: null,
          model: "gpt-5.4",
          reasoningLevel: "high",
          permissionMode: "acceptEdits",
          status: "running",
          lastContextVersion: null,
          lastSummary: null,
          createdAt: "2026-04-16T12:00:00.000Z",
          updatedAt: "2026-04-16T12:00:00.000Z",
          session: {
            sessionId: "assistant-session-1"
          }
        }))
      } as any,
      {
        listTasks: vi.fn(),
        getTask: vi.fn(),
        createTask: vi.fn(),
        cancelTask: vi.fn(),
        listRuns: vi.fn()
      } as any,
      {
        listTimers: vi.fn(),
        getTimer: vi.fn(),
        createTimer: vi.fn(),
        cancelTimer: vi.fn()
      } as any,
      {
        getSession: vi.fn(),
        readSessionHistory: vi.fn(),
        forkSession: vi.fn()
      } as any,
      {
        startLiveSession,
        getSessionRuntime: vi.fn(),
        sendLiveMessage: vi.fn()
      } as any,
      {
        listTerminals: vi.fn(),
        readTerminalHistory: vi.fn(),
        writeInput: vi.fn(),
        closeTerminal: vi.fn()
      } as any,
      {
        analyze: vi.fn(),
        getFrameworkAnalysis: vi.fn(),
        refreshFrameworkAnalysis: vi.fn(),
        createLaunchPlan: vi.fn(),
        run: vi.fn(),
        getLatestRuntimeDetail: vi.fn(),
        getRecentRuntimeDetails: vi.fn(),
        getRuntimeDetail: vi.fn(),
        getCompatibilityMatrix: vi.fn()
      } as any,
      {
        list: vi.fn(),
        browseDirectories: vi.fn(),
        createDirectory: vi.fn(),
        importWorkspace: vi.fn(),
        cloneWorkspace: vi.fn(),
        reorderWorkspaces: vi.fn(),
        getManagementSummary: vi.fn(),
        removeWorkspace: vi.fn(),
        updateNavigationState: vi.fn()
      } as any,
      {
        findByWorkspaceId: vi.fn()
      } as any,
      {
        getTree: vi.fn(),
        create: vi.fn()
      } as any,
      {
        syncRoot: vi.fn()
      } as any,
      {
        preview: vi.fn(),
        apply: vi.fn()
      } as any,
      {
        cleanup: vi.fn()
      } as any,
      {
        upsert: vi.fn()
      } as any
    );

    const receipt = await service.startSession({
      target: {
        kind: "workspace",
        workspaceId: "workspace-1"
      },
      userId: "user-1",
      content: "请在临时工作区开始处理这个问题"
    });

    expect(receipt.capability).toBe("sessions.start");
    expect(startLiveSession).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      provider: "codex",
      runtimeOptions: expect.objectContaining({
        model: "gpt-5.4",
        reasoningLevel: "high",
        permissionMode: "acceptEdits"
      })
    }));
  });

  it("未显式指定 target 时会拒绝启动真实会话", async () => {
    const service = new AssistantCapabilityService(
      {
        list: vi.fn(),
        getById: vi.fn(),
        getOverview: vi.fn()
      } as any,
      {
        listByProject: vi.fn(),
        ensureProjectSessionsSynced: vi.fn(),
        startSession: vi.fn()
      } as any,
      {
        getCurrentSession: vi.fn(() => ({
          id: "control-1",
          providerId: "codex",
          sessionId: "assistant-session-1",
          purpose: "chat",
          title: "排查缓存异常",
          sourceItemId: null,
          model: "gpt-5.4",
          reasoningLevel: "high",
          permissionMode: "acceptEdits",
          status: "running",
          lastContextVersion: null,
          lastSummary: "继续处理缓存异常",
          createdAt: "2026-04-16T12:00:00.000Z",
          updatedAt: "2026-04-16T12:00:00.000Z",
          session: {
            sessionId: "assistant-session-1"
          }
        }))
      } as any,
      {
        listTasks: vi.fn(),
        getTask: vi.fn(),
        createTask: vi.fn(),
        cancelTask: vi.fn(),
        listRuns: vi.fn()
      } as any,
      {
        listTimers: vi.fn(),
        getTimer: vi.fn(),
        createTimer: vi.fn(),
        cancelTimer: vi.fn()
      } as any,
      {
        getSession: vi.fn(),
        readSessionHistory: vi.fn(),
        forkSession: vi.fn()
      } as any,
      {
        startLiveSession: vi.fn(),
        getSessionRuntime: vi.fn(),
        sendLiveMessage: vi.fn()
      } as any,
      {
        listTerminals: vi.fn(),
        readTerminalHistory: vi.fn(),
        writeInput: vi.fn(),
        closeTerminal: vi.fn()
      } as any,
      {
        analyze: vi.fn(),
        getFrameworkAnalysis: vi.fn(),
        refreshFrameworkAnalysis: vi.fn(),
        createLaunchPlan: vi.fn(),
        run: vi.fn(),
        getLatestRuntimeDetail: vi.fn(),
        getRecentRuntimeDetails: vi.fn(),
        getRuntimeDetail: vi.fn(),
        getCompatibilityMatrix: vi.fn()
      } as any,
      {
        list: vi.fn(),
        browseDirectories: vi.fn(),
        createDirectory: vi.fn(),
        importWorkspace: vi.fn(),
        cloneWorkspace: vi.fn(),
        reorderWorkspaces: vi.fn(),
        getManagementSummary: vi.fn(),
        removeWorkspace: vi.fn(),
        updateNavigationState: vi.fn()
      } as any,
      {
        findByWorkspaceId: vi.fn()
      } as any,
      {
        getTree: vi.fn(),
        create: vi.fn()
      } as any,
      {
        syncRoot: vi.fn()
      } as any,
      {
        preview: vi.fn(),
        apply: vi.fn()
      } as any,
      {
        cleanup: vi.fn()
      } as any,
      {
        upsert: vi.fn()
      } as any
    );

    await expect(service.startSession({
      userId: "user-1",
      content: "请继续处理这个问题，并把需要的文件落下来"
    })).rejects.toMatchObject({
      errorCode: "INVALID_INPUT",
      field: "projectId"
    });
  });

  it.each([
    {
      providerId: "codex" as const,
      model: "gpt-5.4",
      reasoningLevel: "high",
      permissionMode: "acceptEdits"
    },
    {
      providerId: "claude-code" as const,
      model: "claude-sonnet-4-5",
      reasoningLevel: "medium",
      permissionMode: "default"
    }
  ])("按 workspace 目标启动真实会话时支持 $providerId", async (scenario) => {
    const startLiveSession = vi.fn(async () => ({
      sessionId: `session-${scenario.providerId}`,
      provider: scenario.providerId,
      providerSessionId: `provider-session-${scenario.providerId}`,
      acceptedAt: "2026-04-16T12:30:00.000Z",
      clientRequestId: null,
      message: {
        messageId: `message-${scenario.providerId}`,
        role: "user",
        content: "请在工作区里继续处理这个问题",
        timestamp: "2026-04-16T12:30:00.000Z",
        sequence: 1,
        attachments: []
      },
      session: {
        sessionId: `session-${scenario.providerId}`,
        workspaceId: "workspace-1"
      }
    }));
    const service = new AssistantCapabilityService(
      {
        list: vi.fn(),
        getById: vi.fn(),
        getOverview: vi.fn()
      } as any,
      {
        listByProject: vi.fn(),
        ensureProjectSessionsSynced: vi.fn(),
        startSession: vi.fn()
      } as any,
      {
        getCurrentSession: vi.fn(() => ({
          id: "control-1",
          providerId: scenario.providerId,
          sessionId: "assistant-session-1",
          purpose: "chat",
          title: null,
          sourceItemId: null,
          model: scenario.model,
          reasoningLevel: scenario.reasoningLevel,
          permissionMode: scenario.permissionMode,
          status: "running",
          lastContextVersion: null,
          lastSummary: null,
          createdAt: "2026-04-16T12:00:00.000Z",
          updatedAt: "2026-04-16T12:00:00.000Z",
          session: {
            sessionId: "assistant-session-1"
          }
        }))
      } as any,
      {
        listTasks: vi.fn(),
        getTask: vi.fn(),
        createTask: vi.fn(),
        cancelTask: vi.fn(),
        listRuns: vi.fn()
      } as any,
      {
        listTimers: vi.fn(),
        getTimer: vi.fn(),
        createTimer: vi.fn(),
        cancelTimer: vi.fn()
      } as any,
      {
        getSession: vi.fn(),
        readSessionHistory: vi.fn(),
        forkSession: vi.fn()
      } as any,
      {
        startLiveSession,
        getSessionRuntime: vi.fn(),
        sendLiveMessage: vi.fn()
      } as any,
      {
        listTerminals: vi.fn(),
        readTerminalHistory: vi.fn(),
        writeInput: vi.fn(),
        closeTerminal: vi.fn()
      } as any,
      {
        analyze: vi.fn(),
        getFrameworkAnalysis: vi.fn(),
        refreshFrameworkAnalysis: vi.fn(),
        createLaunchPlan: vi.fn(),
        run: vi.fn(),
        getLatestRuntimeDetail: vi.fn(),
        getRecentRuntimeDetails: vi.fn(),
        getRuntimeDetail: vi.fn(),
        getCompatibilityMatrix: vi.fn()
      } as any,
      {
        list: vi.fn(),
        browseDirectories: vi.fn(),
        createDirectory: vi.fn(),
        importWorkspace: vi.fn(),
        cloneWorkspace: vi.fn(),
        reorderWorkspaces: vi.fn(),
        getManagementSummary: vi.fn(),
        removeWorkspace: vi.fn(),
        updateNavigationState: vi.fn()
      } as any,
      {
        findByWorkspaceId: vi.fn()
      } as any,
      {
        getTree: vi.fn(),
        create: vi.fn()
      } as any,
      {
        syncRoot: vi.fn()
      } as any,
      {
        preview: vi.fn(),
        apply: vi.fn()
      } as any,
      {
        cleanup: vi.fn()
      } as any,
      {
        upsert: vi.fn()
      } as any
    );

    const receipt = await service.startSession({
      target: {
        kind: "workspace",
        workspaceId: "workspace-1"
      },
      userId: "user-1",
      content: "请在工作区里继续处理这个问题"
    });

    expect(receipt.capability).toBe("sessions.start");
    expect(receipt.targetRef).toEqual({
      kind: "workspace",
      id: "workspace-1"
    });
    expect(receipt.payload.target).toEqual({
      kind: "workspace",
      id: "workspace-1",
      workspaceId: "workspace-1"
    });
    expect(startLiveSession).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      provider: scenario.providerId,
      runtimeOptions: expect.objectContaining({
        model: scenario.model,
        reasoningLevel: scenario.reasoningLevel,
        permissionMode: scenario.permissionMode
      })
    }));
  });

  it("创建 condition 自动化时会把正式触发器参数映射到自动化服务", () => {
    const assistantAutomationService = {
      listTasks: vi.fn(),
      getTask: vi.fn(),
      createTask: vi.fn(() => ({
        id: "automation-1"
      })),
      cancelTask: vi.fn(),
      listRuns: vi.fn(),
      listRecentRuns: vi.fn()
    };
    const service = new AssistantCapabilityService(
      {
        list: vi.fn(),
        getById: vi.fn(),
        getOverview: vi.fn()
      } as any,
      {
        listByProject: vi.fn(),
        ensureProjectSessionsSynced: vi.fn(),
        startSession: vi.fn()
      } as any,
      {
        getCurrentSession: vi.fn()
      } as any,
      assistantAutomationService as any,
      {
        listTimers: vi.fn(),
        getTimer: vi.fn(),
        createTimer: vi.fn(),
        cancelTimer: vi.fn()
      } as any,
      {
        getSession: vi.fn(),
        readSessionHistory: vi.fn(),
        forkSession: vi.fn()
      } as any,
      {
        startLiveSession: vi.fn(),
        getSessionRuntime: vi.fn(),
        sendLiveMessage: vi.fn()
      } as any,
      {
        listTerminals: vi.fn(),
        readTerminalHistory: vi.fn(),
        writeInput: vi.fn(),
        closeTerminal: vi.fn()
      } as any,
      {
        analyze: vi.fn(),
        getFrameworkAnalysis: vi.fn(),
        refreshFrameworkAnalysis: vi.fn(),
        createLaunchPlan: vi.fn(),
        run: vi.fn(),
        getLatestRuntimeDetail: vi.fn(),
        getRecentRuntimeDetails: vi.fn(),
        getRuntimeDetail: vi.fn(),
        getCompatibilityMatrix: vi.fn()
      } as any,
      {
        list: vi.fn(),
        browseDirectories: vi.fn(),
        createDirectory: vi.fn(),
        importWorkspace: vi.fn(),
        cloneWorkspace: vi.fn(),
        reorderWorkspaces: vi.fn(),
        getManagementSummary: vi.fn(),
        removeWorkspace: vi.fn(),
        updateNavigationState: vi.fn()
      } as any,
      {
        findByWorkspaceId: vi.fn()
      } as any,
      {
        getTree: vi.fn(),
        create: vi.fn()
      } as any,
      {
        syncRoot: vi.fn()
      } as any,
      {
        preview: vi.fn(),
        apply: vi.fn()
      } as any,
      {
        cleanup: vi.fn()
      } as any,
      {
        upsert: vi.fn()
      } as any
    );

    service.createAutomation({
      userId: "user-1",
      title: "监控 tag",
      content: "发现新 tag 后通知我",
      triggerType: "condition",
      conditionKind: "git.remote_tag_changed",
      repositoryUrl: "https://github.com/jingyi0605/codingns.git",
      pollIntervalSeconds: 3600
    });

    expect(assistantAutomationService.createTask).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      title: "监控 tag",
      trigger: {
        type: "condition",
        conditionKind: "git.remote_tag_changed",
        repositoryUrl: "https://github.com/jingyi0605/codingns.git",
        pollIntervalSeconds: 3600,
        expiresAt: null,
        maxChecks: null
      },
      action: expect.objectContaining({
        content: "发现新 tag 后通知我",
        includeTriggerContext: true
      })
    }));
  });

  it("follow-ups continue 会调用正式跟进服务回写结构化结果", async () => {
    const continueTask = vi.fn(async () => ({
      id: "follow-up-1",
      status: "active",
      autoContinueCount: 2
    }));
    const service = new AssistantCapabilityService(
      {
        list: vi.fn(),
        getById: vi.fn(),
        getOverview: vi.fn()
      } as any,
      {
        listByProject: vi.fn(),
        ensureProjectSessionsSynced: vi.fn(),
        startSession: vi.fn()
      } as any,
      {
        getCurrentSession: vi.fn()
      } as any,
      {
        listTasks: vi.fn(),
        getTask: vi.fn(),
        createTask: vi.fn(),
        cancelTask: vi.fn(),
        listRuns: vi.fn()
      } as any,
      {
        listTimers: vi.fn(),
        getTimer: vi.fn(),
        createTimer: vi.fn(),
        cancelTimer: vi.fn()
      } as any,
      {
        getSession: vi.fn(),
        readSessionHistory: vi.fn(),
        forkSession: vi.fn(),
        deleteSession: vi.fn()
      } as any,
      {
        startLiveSession: vi.fn(),
        getSessionRuntime: vi.fn(),
        sendLiveMessage: vi.fn()
      } as any,
      {
        listTerminals: vi.fn(),
        readTerminalHistory: vi.fn(),
        writeInput: vi.fn(),
        closeTerminal: vi.fn()
      } as any,
      {
        analyze: vi.fn(),
        getFrameworkAnalysis: vi.fn(),
        refreshFrameworkAnalysis: vi.fn(),
        createLaunchPlan: vi.fn(),
        run: vi.fn(),
        getLatestRuntimeDetail: vi.fn(),
        getRecentRuntimeDetails: vi.fn(),
        getRuntimeDetail: vi.fn(),
        getCompatibilityMatrix: vi.fn()
      } as any,
      {
        list: vi.fn(),
        browseDirectories: vi.fn(),
        createDirectory: vi.fn(),
        importWorkspace: vi.fn(),
        cloneWorkspace: vi.fn(),
        reorderWorkspaces: vi.fn(),
        getManagementSummary: vi.fn(),
        removeWorkspace: vi.fn(),
        updateNavigationState: vi.fn()
      } as any,
      {
        findByWorkspaceId: vi.fn()
      } as any,
      {
        getTree: vi.fn(),
        create: vi.fn()
      } as any,
      {
        syncRoot: vi.fn()
      } as any,
      {
        preview: vi.fn(),
        apply: vi.fn()
      } as any,
      {
        cleanup: vi.fn()
      } as any,
      {
        upsert: vi.fn()
      } as any,
      {
        listTasks: vi.fn(),
        getTask: vi.fn(),
        createTask: vi.fn(),
        continueTask,
        markTaskWaitingUser: vi.fn(),
        completeTask: vi.fn(),
        failTask: vi.fn()
      } as any
    );

    const receipt = await service.continueFollowUp({
      userId: "user-1",
      taskId: "follow-up-1",
      summary: "目标还没完成，已经补发继续推进消息。",
      continuePrompt: "继续补齐剩余实现，不要停在总结。"
    });

    expect(receipt.capability).toBe("follow-ups.continue");
    expect(receipt.targetRef).toEqual({
      kind: "follow_up",
      id: "follow-up-1"
    });
    expect(continueTask).toHaveBeenCalledWith(
      "follow-up-1",
      {
        summary: "目标还没完成，已经补发继续推进消息。",
        continuePrompt: "继续补齐剩余实现，不要停在总结。"
      },
      "user-1"
    );
  });
});

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
});

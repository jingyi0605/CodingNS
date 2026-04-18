import { describe, expect, it, vi } from "vitest";

import { SessionLiveRuntimeRouterService, type SessionRuntimeRouterServiceContract } from "../../src/modules/sessions/session-live-runtime-router-service.js";

function createObservation(sessionId: string) {
  return {
    sessionId,
    runId: "run-1",
    runningState: "running" as const,
    source: "authoritative_runtime" as const,
    confidence: "authoritative" as const,
    detail: null,
    interruptSource: null,
    errorCode: null,
    observedAt: "2026-04-18T00:00:00.000Z"
  };
}

function createRuntimeServiceStub(
  overrides: Partial<SessionRuntimeRouterServiceContract> = {}
): SessionRuntimeRouterServiceContract {
  return {
    startLiveSession: vi.fn(async () => {
      throw new Error("unexpected startLiveSession");
    }),
    sendLiveMessage: vi.fn(async () => {
      throw new Error("unexpected sendLiveMessage");
    }),
    enqueueLiveMessage: vi.fn(async () => {
      throw new Error("unexpected enqueueLiveMessage");
    }),
    getSessionRuntime: vi.fn(async () => ({
      sessionId: "session-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      runningState: "idle",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: "none",
      activityResolutionSource: "persisted_state",
      activityConfidence: "derived",
      runId: null,
      detail: null,
      interruptSource: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-04-18T00:00:00.000Z",
      watchdogTriggeredAt: null,
      contextUsage: null
    })),
    interruptSession: vi.fn(async () => ({
      sessionId: "session-1",
      interrupted: true,
      detail: "interrupt requested"
    })),
    subscribeRuntime: vi.fn(() => ({
      close: vi.fn()
    })),
    listPermissionRequests: vi.fn(async () => []),
    replyPermissionRequest: vi.fn(async () => {
      throw new Error("unexpected replyPermissionRequest");
    }),
    listQueuedMessages: vi.fn(async () => []),
    deleteQueuedMessage: vi.fn(async () => undefined),
    steerQueuedMessage: vi.fn(async () => ({
      sessionId: "session-1",
      queueItemId: "queue-1",
      dispatched: true
    })),
    getClaudeHookBridgeConfig: vi.fn(() => ({
      enabled: true,
      token: "token-1",
      endpoint: "http://127.0.0.1:3000/api/providers/claude-code/hook",
      installDir: "/tmp/claude-hook"
    })),
    ingestClaudeHookEvent: vi.fn(async () => ({
      accepted: true,
      ignored: true,
      sessionId: null,
      bridgeResponse: null
    })),
    resolveLiveActivityObservation: vi.fn(() => null),
    ...overrides
  };
}

describe("SessionLiveRuntimeRouterService", () => {
  it("活动会话在 Butler runtime 上时，中断会路由到持有句柄的实例", async () => {
    const primary = createRuntimeServiceStub();
    const butler = createRuntimeServiceStub({
      resolveLiveActivityObservation: vi.fn(() => createObservation("session-1"))
    });
    const router = new SessionLiveRuntimeRouterService(primary, [butler]);

    await router.interruptSession("session-1", "user-1");

    expect(primary.interruptSession).not.toHaveBeenCalled();
    expect(butler.interruptSession).toHaveBeenCalledWith("session-1", "user-1");
  });

  it("活动会话在 Butler runtime 上时，运行态查询会读取正确实例", async () => {
    const primary = createRuntimeServiceStub({
      getSessionRuntime: vi.fn(async () => ({
        sessionId: "session-1",
        provider: "codex",
        providerSessionId: "provider-session-1",
        runningState: "idle",
        hasActiveRun: false,
        canAttach: false,
        canInterrupt: false,
        inRunInputMode: "none",
        activityResolutionSource: "persisted_state",
        activityConfidence: "derived",
        runId: null,
        detail: null,
        interruptSource: null,
        errorCode: null,
        errorDetail: null,
        updatedAt: "2026-04-18T00:00:00.000Z",
        watchdogTriggeredAt: null,
        contextUsage: null
      }))
    });
    const butler = createRuntimeServiceStub({
      resolveLiveActivityObservation: vi.fn(() => createObservation("session-1")),
      getSessionRuntime: vi.fn(async () => ({
        sessionId: "session-1",
        provider: "codex",
        providerSessionId: "provider-session-1",
        runningState: "running",
        hasActiveRun: true,
        canAttach: true,
        canInterrupt: true,
        inRunInputMode: "none",
        activityResolutionSource: "authoritative_runtime",
        activityConfidence: "authoritative",
        runId: "run-1",
        detail: null,
        interruptSource: null,
        errorCode: null,
        errorDetail: null,
        updatedAt: "2026-04-18T00:00:00.000Z",
        watchdogTriggeredAt: null,
        contextUsage: null
      }))
    });
    const router = new SessionLiveRuntimeRouterService(primary, [butler]);

    const runtime = await router.getSessionRuntime("session-1", "user-1");

    expect(primary.getSessionRuntime).not.toHaveBeenCalled();
    expect(butler.getSessionRuntime).toHaveBeenCalledWith("session-1", "user-1");
    expect(runtime.hasActiveRun).toBe(true);
    expect(runtime.canInterrupt).toBe(true);
  });

  it("订阅运行态时会绑定到真正持有活动观察的 runtime 实例", () => {
    const primary = createRuntimeServiceStub();
    const butlerClose = vi.fn();
    const butler = createRuntimeServiceStub({
      resolveLiveActivityObservation: vi.fn(() => createObservation("session-1")),
      subscribeRuntime: vi.fn(() => ({
        close: butlerClose
      }))
    });
    const router = new SessionLiveRuntimeRouterService(primary, [butler]);

    const subscription = router.subscribeRuntime("session-1", () => undefined);
    subscription.close();

    expect(primary.subscribeRuntime).not.toHaveBeenCalled();
    expect(butler.subscribeRuntime).toHaveBeenCalledWith("session-1", expect.any(Function));
    expect(butlerClose).toHaveBeenCalledTimes(1);
  });

  it("Claude hook 事件在主实例忽略后会继续尝试 Butler runtime", async () => {
    const primary = createRuntimeServiceStub({
      ingestClaudeHookEvent: vi.fn(async () => ({
        accepted: true,
        ignored: true,
        sessionId: null,
        bridgeResponse: null
      }))
    });
    const butler = createRuntimeServiceStub({
      ingestClaudeHookEvent: vi.fn(async () => ({
        accepted: true,
        ignored: false,
        sessionId: "session-1",
        bridgeResponse: { ok: true }
      }))
    });
    const router = new SessionLiveRuntimeRouterService(primary, [butler]);

    const result = await router.ingestClaudeHookEvent({
      hook_event_name: "Stop",
      session_id: "provider-session-1",
      cwd: "/tmp/workspace"
    });

    expect(primary.ingestClaudeHookEvent).toHaveBeenCalledTimes(1);
    expect(butler.ingestClaudeHookEvent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      accepted: true,
      ignored: false,
      sessionId: "session-1",
      bridgeResponse: { ok: true }
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import { TerminalService } from "../../src/modules/terminal/terminal-service.js";

function createTerminalServiceHarness() {
  const terminal = {
    id: "terminal-1",
    runtimeSessionId: "runtime-1",
    status: "running"
  };
  const runtimeSession = {
    id: "runtime-1",
    runtimeType: "tmux"
  };
  const terminalRepository = {
    findById: vi.fn((terminalId: string) => (terminalId === terminal.id ? terminal : null)),
    listRecoverable: vi.fn(() => [])
  };
  const runtimeRepository = {
    findById: vi.fn((runtimeSessionId: string) =>
      runtimeSessionId === runtimeSession.id ? runtimeSession : null
    )
  };
  const service = new TerminalService(
    {
      transaction: (callback: () => void) => callback
    } as never,
    terminalRepository as never,
    runtimeRepository as never,
    {} as never,
    900
  );
  const detach = vi.fn();

  (service as any).runtimeManager = {
    detach,
    closeAllAttachments: vi.fn()
  };
  (service as any).ensureTerminalAttachedForSubscription = vi.fn(async () => terminal);

  return {
    service,
    detach
  };
}

function createSubscriptionCallbacks() {
  return {
    onStatus: vi.fn(async () => undefined),
    onBackfill: vi.fn(async () => undefined),
    onOutput: vi.fn(async () => undefined),
    onExit: vi.fn(async () => undefined)
  };
}

describe("TerminalService 订阅 detach 宽限", () => {
  it("最后一个订阅关闭后不会立刻 detach，而是在宽限期结束后再 detach", async () => {
    vi.useFakeTimers();

    const { service, detach } = createTerminalServiceHarness();
    const subscription = await service.subscribeTerminal(
      "terminal-1",
      null,
      createSubscriptionCallbacks()
    );

    subscription.close();

    expect(detach).not.toHaveBeenCalled();

    vi.advanceTimersByTime(9_999);
    expect(detach).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(detach).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("宽限期内重新订阅会取消旧 detach 计时，避免切后台后立刻重挂载", async () => {
    vi.useFakeTimers();

    const { service, detach } = createTerminalServiceHarness();
    const firstSubscription = await service.subscribeTerminal(
      "terminal-1",
      null,
      createSubscriptionCallbacks()
    );

    firstSubscription.close();
    vi.advanceTimersByTime(5_000);

    const secondSubscription = await service.subscribeTerminal(
      "terminal-1",
      null,
      createSubscriptionCallbacks()
    );

    vi.advanceTimersByTime(6_000);
    expect(detach).not.toHaveBeenCalled();

    secondSubscription.close();
    vi.advanceTimersByTime(10_000);
    expect(detach).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

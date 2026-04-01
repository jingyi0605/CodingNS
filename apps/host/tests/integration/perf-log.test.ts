import { afterEach, describe, expect, it, vi } from "vitest";

async function importPerfLogModule() {
  vi.resetModules();
  return await import("../../src/shared/utils/perf-log.js");
}

describe("perf-log", () => {
  afterEach(() => {
    delete process.env.CODINGNS_PERF_DEBUG;
    vi.restoreAllMocks();
  });

  it("默认不会输出 perf 日志", async () => {
    delete process.env.CODINGNS_PERF_DEBUG;
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const module = await importPerfLogModule();

    expect(module.isPerfDebugEnabled()).toBe(false);
    module.logPerformance("workbench.refresh_snapshot", 1200, {
      workspaceCount: 2
    });

    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("显式开启后会输出超过阈值的 perf 日志", async () => {
    process.env.CODINGNS_PERF_DEBUG = "true";
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const module = await importPerfLogModule();

    expect(module.isPerfDebugEnabled()).toBe(true);
    module.logPerformance("workbench.refresh_snapshot", 1200, {
      workspaceCount: 2
    });

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
  });
});

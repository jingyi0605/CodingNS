import { afterEach, describe, expect, it, vi } from "vitest";

async function importPermissionDebugModule() {
  vi.resetModules();
  return await import("../../src/shared/utils/permission-debug-log.js");
}

describe("permission-debug-log", () => {
  afterEach(() => {
    delete process.env.CODINGNS_PERMISSION_DEBUG;
    vi.restoreAllMocks();
  });

  it("默认不会输出 permission-debug 日志", async () => {
    delete process.env.CODINGNS_PERMISSION_DEBUG;
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const module = await importPermissionDebugModule();

    expect(module.isPermissionDebugEnabled()).toBe(false);
    module.logPermissionDebug("opencode_permission.event", {
      eventType: "server.heartbeat"
    });

    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("显式开启后才会输出 permission-debug 日志", async () => {
    process.env.CODINGNS_PERMISSION_DEBUG = "1";
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const module = await importPermissionDebugModule();

    expect(module.isPermissionDebugEnabled()).toBe(true);
    module.logPermissionDebug("opencode_permission.event", {
      eventType: "server.heartbeat"
    });

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
  });
});

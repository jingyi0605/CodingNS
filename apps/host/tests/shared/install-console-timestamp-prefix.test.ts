import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installConsoleTimestampPrefix } from "../../src/shared/utils/install-console-timestamp-prefix.js";

const INSTALLED_FLAG = Symbol.for("codingns.host.consoleTimestampPrefixInstalled");

const originalConsole = {
  debug: console.debug,
  info: console.info,
  log: console.log,
  warn: console.warn,
  error: console.error
};

describe("installConsoleTimestampPrefix", () => {
  beforeEach(() => {
    restoreConsole();
    clearInstalledFlag();
  });

  afterEach(() => {
    restoreConsole();
    clearInstalledFlag();
  });

  it("会给字符串 host 日志补时间戳前缀", () => {
    const infoSpy = vi.fn();
    console.info = infoSpy as typeof console.info;

    installConsoleTimestampPrefix();
    console.info("[host] 监听中 http://127.0.0.1:3000");

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[\d{4}-\d{2}-\d{2}T.*Z\] \[host\] 监听中 http:\/\/127\.0\.0\.1:3000$/)
    );
  });

  it("对象作为首个参数时也会补时间戳前缀", () => {
    const warnSpy = vi.fn();
    console.warn = warnSpy as typeof console.warn;
    const payload = { message: "boom" };

    installConsoleTimestampPrefix();
    console.warn(payload);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[\d{4}-\d{2}-\d{2}T.*Z\]$/),
      payload
    );
  });

  it("重复安装不会把同一条日志前缀两次", () => {
    const errorSpy = vi.fn();
    console.error = errorSpy as typeof console.error;

    installConsoleTimestampPrefix();
    installConsoleTimestampPrefix();
    console.error("[host-error] boom");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[\d{4}-\d{2}-\d{2}T.*Z\] \[host-error\] boom$/)
    );
  });
});

function restoreConsole(): void {
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}

function clearInstalledFlag(): void {
  delete (globalThis as typeof globalThis & Record<symbol, boolean | undefined>)[INSTALLED_FLAG];
}

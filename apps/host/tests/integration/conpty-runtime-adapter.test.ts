import os from "node:os";

import { describe, expect, it } from "vitest";

import { ConptyRuntimeAdapter } from "../../src/modules/terminal/runtime/adapters/conpty-runtime-adapter.js";

describe("ConptyRuntimeAdapter", () => {
  it("在 Windows 下可以创建、检查并结束持久化会话", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const sessionKey = `conpty-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const shell = process.env.COMSPEC ?? "C:\\Windows\\System32\\cmd.exe";
    const adapter = new ConptyRuntimeAdapter("conpty-cmd");
    const terminal = {
      id: "terminal-conpty-test",
      shell,
      cwd: os.tmpdir()
    } as never;
    const session = {
      id: sessionKey,
      sessionKey
    } as never;
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );

    try {
      const created = await adapter.createPersistentSession({
        terminal,
        session,
        env
      });
      expect(created.alive).toBe(true);
      expect(created.shellPid).toEqual(expect.any(Number));

      const inspected = await adapter.inspectPersistentSession({
        terminal,
        session
      });
      expect(inspected.alive).toBe(true);
      expect(inspected.shellPid).toEqual(expect.any(Number));
    } finally {
      await adapter.terminatePersistentSession({
        terminal,
        session
      });
    }

    await waitFor(async () => {
      const inspected = await adapter.inspectPersistentSession({
        terminal,
        session
      });
      expect(inspected.alive).toBe(false);
    });
  }, 15000);
});

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("等待断言成功超时");
}

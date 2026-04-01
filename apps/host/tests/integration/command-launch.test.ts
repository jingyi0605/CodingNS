import { describe, expect, it, vi } from "vitest";

import { resolveCommandLaunch } from "../../src/shared/utils/command-launch.js";

describe("resolveCommandLaunch", () => {
  it("遇到 Node 脚本时会改用当前 node 进程启动", () => {
    const launch = resolveCommandLaunch("/tmp/mock-codex.cjs", ["app-server"]);

    expect(launch).toEqual({
      command: process.execPath,
      args: ["/tmp/mock-codex.cjs", "app-server"],
      shell: false
    });
  });

  it("Windows 的 cmd 包装脚本会保留 shell 启动", () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    try {
      const launch = resolveCommandLaunch("C:\\Users\\jackson\\AppData\\Roaming\\npm\\codex.cmd", [
        "app-server"
      ]);

      expect(launch).toEqual({
        command: "C:\\Users\\jackson\\AppData\\Roaming\\npm\\codex.cmd",
        args: ["app-server"],
        shell: true
      });
    } finally {
      platformSpy.mockRestore();
    }
  });
});

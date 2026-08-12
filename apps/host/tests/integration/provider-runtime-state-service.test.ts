import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveProviderVersion } from "../../src/modules/provider/provider-runtime-state-service.js";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn()
}));

const mockedSpawnSync = vi.mocked(spawnSync);

afterEach(() => {
  vi.restoreAllMocks();
  mockedSpawnSync.mockReset();
});

describe("resolveProviderVersion", () => {
  it("Windows 的 cmd 包装脚本会通过 shell 查询版本", () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    mockedSpawnSync.mockReturnValue({
      stdout: "codex-cli 0.146.0\n",
      stderr: ""
    } as ReturnType<typeof spawnSync>);

    try {
      expect(resolveProviderVersion("C:\\Users\\jackson\\AppData\\Roaming\\npm\\codex.cmd")).toBe("0.146.0");
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        "C:\\Users\\jackson\\AppData\\Roaming\\npm\\codex.cmd",
        ["--version"],
        expect.objectContaining({
          shell: true,
          windowsHide: true
        })
      );
    } finally {
      platformSpy.mockRestore();
    }
  });
});

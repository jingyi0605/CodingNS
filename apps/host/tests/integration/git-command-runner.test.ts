import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GitCommandRunner } from "../../src/modules/git/git-command-runner.js";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

class MockChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn();
}

describe("GitCommandRunner", () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("执行 git 命令时会关闭 quotepath 转义", async () => {
    const child = new MockChildProcess();

    spawnMock.mockReturnValue(child);

    const runner = new GitCommandRunner();
    const resultPromise = runner.run("C:/repo", ["status", "--porcelain=1", "--branch"]);

    child.stdout.write("## main\n");
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      stdout: "## main\n",
      stderr: "",
      exitCode: 0
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["-c", "core.quotepath=false", "status", "--porcelain=1", "--branch"],
      expect.objectContaining({
        cwd: "C:/repo",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      })
    );
  });
});

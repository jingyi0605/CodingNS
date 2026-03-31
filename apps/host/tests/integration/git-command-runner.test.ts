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
    vi.useRealTimers();
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

  it("Git 命令超时时会输出包含上下文的日志", async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const child = new MockChildProcess();

    spawnMock.mockReturnValue(child);

    const runner = new GitCommandRunner();
    const resultPromise = runner.run("/repo", ["rev-parse", "--show-toplevel"], {
      timeoutMs: 50,
      workspaceId: "workspace-1",
      operation: "workspace.readGitSummary"
    });
    const rejectionAssertion = expect(resultPromise).rejects.toMatchObject({
      errorCode: "GIT_COMMAND_TIMEOUT"
    });

    await vi.advanceTimersByTimeAsync(50);

    await rejectionAssertion;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[git-command-timeout]",
      expect.objectContaining({
        workspaceId: "workspace-1",
        operation: "workspace.readGitSummary",
        repoRoot: "/repo",
        args: ["rev-parse", "--show-toplevel"],
        command: "git rev-parse --show-toplevel",
        timeoutMs: 50,
        durationMs: 50
      })
    );
  });

  it("Git 慢命令在未超时时会输出告警日志", async () => {
    vi.useFakeTimers();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const child = new MockChildProcess();

    spawnMock.mockReturnValue(child);

    const runner = new GitCommandRunner();
    const resultPromise = runner.run("/repo", ["status", "--porcelain=1"], {
      workspaceId: "workspace-1",
      operation: "gitRead.getStatus"
    });

    await vi.advanceTimersByTimeAsync(3_100);
    child.stdout.write("ok\n");
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[git-command-slow]",
      expect.objectContaining({
        workspaceId: "workspace-1",
        operation: "gitRead.getStatus",
        repoRoot: "/repo",
        args: ["status", "--porcelain=1"],
        command: "git status --porcelain=1",
        slowThresholdMs: 3000,
        durationMs: 3100,
        exitCode: 0
      })
    );
  });

  it("spawn 返回 EBADF 时会自动重试一次", async () => {
    vi.useFakeTimers();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failedChild = new MockChildProcess();
    const successChild = new MockChildProcess();

    spawnMock
      .mockReturnValueOnce(failedChild)
      .mockReturnValueOnce(successChild);

    const runner = new GitCommandRunner();
    const resultPromise = runner.run("/repo", ["status", "--porcelain=1"], {
      workspaceId: "workspace-1",
      operation: "gitRead.getStatus"
    });

    failedChild.emit(
      "error",
      Object.assign(new Error("spawn EBADF"), {
        code: "EBADF"
      })
    );

    await vi.advanceTimersByTimeAsync(50);
    successChild.stdout.write("ok\n");
    successChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[git-command-retry]",
      expect.objectContaining({
        workspaceId: "workspace-1",
        operation: "gitRead.getStatus",
        repoRoot: "/repo",
        args: ["status", "--porcelain=1"],
        command: "git status --porcelain=1",
        retryAttempt: 1,
        retryLimit: 1,
        retryDelayMs: 50,
        errorCode: "EBADF",
        reason: "spawn EBADF"
      })
    );
  });

  it("spawn 同步抛出 EBADF 时也会自动重试一次", async () => {
    vi.useFakeTimers();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const successChild = new MockChildProcess();

    spawnMock
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("spawn EBADF"), {
          code: "EBADF"
        });
      })
      .mockReturnValueOnce(successChild);

    const runner = new GitCommandRunner();
    const resultPromise = runner.run("/repo", ["status", "--porcelain=1"], {
      workspaceId: "workspace-1",
      operation: "gitRead.getStatus"
    });

    await vi.advanceTimersByTimeAsync(50);
    successChild.stdout.write("sync-ok\n");
    successChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      stdout: "sync-ok\n",
      stderr: "",
      exitCode: 0
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[git-command-retry]",
      expect.objectContaining({
        workspaceId: "workspace-1",
        operation: "gitRead.getStatus",
        repoRoot: "/repo",
        args: ["status", "--porcelain=1"],
        command: "git status --porcelain=1",
        retryAttempt: 1,
        retryLimit: 1,
        retryDelayMs: 50,
        errorCode: "EBADF",
        reason: "spawn EBADF"
      })
    );
  });
});

import { spawn } from "node:child_process";
import readline from "node:readline";

const GIT_COMMAND_SPAWN_RETRY_LIMIT = 1;
const GIT_COMMAND_SPAWN_RETRY_DELAY_MS = 50;

interface GitCommandOptions {
  allowNonZeroExit?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  workspaceId?: string;
  operation?: string;
}

interface HelperRunRequest {
  type: "run";
  id: string;
  repoRoot: string;
  args: string[];
  options: GitCommandOptions;
}

interface HelperCancelRequest {
  type: "cancel";
  id: string;
  targetId: string;
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

type HelperRequest = HelperRunRequest | HelperCancelRequest;

const activeRequests = new Map<string, AbortController>();

const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

stdinReader.on("line", (line) => {
  void handleRequestLine(line);
});

async function handleRequestLine(line: string): Promise<void> {
  let request: HelperRequest;

  try {
    request = JSON.parse(line) as HelperRequest;
  } catch (error) {
    logHelperError("无法解析请求", error);
    return;
  }

  if (request.type === "cancel") {
    activeRequests.get(request.targetId)?.abort(createGitCommandCancelledError());
    return;
  }

  const controller = new AbortController();
  activeRequests.set(request.id, controller);

  try {
    const result = await runGitCommand(request.repoRoot, request.args, request.options, 0, controller.signal);

    process.stdout.write(
      `${JSON.stringify({
        type: "result",
        id: request.id,
        ok: true,
        result
      })}\n`
    );
  } catch (error) {
    const appError = normalizeHelperError(error);

    process.stdout.write(
      `${JSON.stringify({
        type: "result",
        id: request.id,
        ok: false,
        error: {
          statusCode: appError.statusCode,
          errorCode: appError.errorCode,
          detail: appError.message
        }
      })}\n`
    );
  } finally {
    activeRequests.delete(request.id);
  }
}

async function runGitCommand(
  repoRoot: string,
  args: string[],
  options: GitCommandOptions = {},
  retryAttempt = 0,
  signal?: AbortSignal
): Promise<GitCommandResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const effectiveArgs = ["-c", "core.quotepath=false", ...args];
  const env = {
    ...process.env,
    ...(options.env ?? {})
  };

  return await new Promise<GitCommandResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createGitCommandCancelledError(signal.reason));
      return;
    }

    let child;

    try {
      child = spawn("git", effectiveArgs, {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      if (shouldRetryGitSpawn(error) && retryAttempt < GIT_COMMAND_SPAWN_RETRY_LIMIT) {
        const nextAttempt = retryAttempt + 1;
        logHelperWarn("git-command-retry", {
          workspaceId: options.workspaceId ?? null,
          operation: options.operation ?? null,
          repoRoot,
          args,
          command: `git ${args.join(" ")}`,
          retryAttempt: nextAttempt,
          retryLimit: GIT_COMMAND_SPAWN_RETRY_LIMIT,
          retryDelayMs: GIT_COMMAND_SPAWN_RETRY_DELAY_MS,
          errorCode: getErrnoCode(error),
          reason: getErrorMessage(error)
        });
        waitForRetryDelay(signal).then(() => {
          resolve(runGitCommand(repoRoot, args, options, nextAttempt, signal));
        }, reject);
        return;
      }

      reject(createGitCommandFailedError(error));
      return;
    }

    let stdout = "";
    let stderr = "";
    let completed = false;
    let onAbort: (() => void) | null = null;

    const finish = (callback: () => void) => {
      if (completed) {
        return;
      }

      completed = true;
      clearTimeout(timer);

      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }

      callback();
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => {
        logHelperWarn("git-command-timeout", {
          workspaceId: options.workspaceId ?? null,
          operation: options.operation ?? null,
          repoRoot,
          args,
          command: `git ${args.join(" ")}`,
          timeoutMs,
          durationMs: Date.now() - startedAt,
          pid: child.pid ?? null,
          stdoutLength: stdout.length,
          stderrLength: stderr.length
        });
        reject({
          statusCode: 504,
          errorCode: "GIT_COMMAND_TIMEOUT",
          detail: `Git 命令执行超时：git ${args.join(" ")}`
        });
      });
    }, timeoutMs);

    if (signal) {
      onAbort = () => {
        if (!child.killed) {
          child.kill("SIGTERM");
        }

        finish(() => {
          reject(createGitCommandCancelledError(signal.reason));
        });
      };

      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      finish(() => {
        if (shouldRetryGitSpawn(error) && retryAttempt < GIT_COMMAND_SPAWN_RETRY_LIMIT) {
          const nextAttempt = retryAttempt + 1;
          logHelperWarn("git-command-retry", {
            workspaceId: options.workspaceId ?? null,
            operation: options.operation ?? null,
            repoRoot,
            args,
            command: `git ${args.join(" ")}`,
            retryAttempt: nextAttempt,
            retryLimit: GIT_COMMAND_SPAWN_RETRY_LIMIT,
            retryDelayMs: GIT_COMMAND_SPAWN_RETRY_DELAY_MS,
            errorCode: getErrnoCode(error),
            reason: getErrorMessage(error)
          });
          waitForRetryDelay(signal).then(() => {
            resolve(runGitCommand(repoRoot, args, options, nextAttempt, signal));
          }, reject);
          return;
        }

        reject(createGitCommandFailedError(error));
      });
    });

    child.on("close", (exitCode) => {
      finish(() => {
        const code = exitCode ?? 1;

        if (code !== 0 && !options.allowNonZeroExit) {
          reject({
            statusCode: 500,
            errorCode: "GIT_COMMAND_FAILED",
            detail: stderr.trim() || stdout.trim() || `Git 命令失败：git ${args.join(" ")}`
          });
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode: code
        });
      });
    });
  });
}

function shouldRetryGitSpawn(error: unknown): boolean {
  return getErrnoCode(error) === "EBADF";
}

function normalizeHelperError(error: unknown): {
  statusCode: number;
  errorCode: string;
  message: string;
} {
  if (isHelperErrorLike(error)) {
    return {
      statusCode: error.statusCode,
      errorCode: error.errorCode,
      message: error.detail
    };
  }

  return {
    statusCode: 500,
    errorCode: "GIT_COMMAND_FAILED",
    message: getErrorMessage(error)
  };
}

function isHelperErrorLike(error: unknown): error is {
  statusCode: number;
  errorCode: string;
  detail: string;
} {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as Record<string, unknown>;

  return (
    typeof candidate.statusCode === "number"
    && typeof candidate.errorCode === "string"
    && typeof candidate.detail === "string"
  );
}

function createGitCommandFailedError(error: unknown) {
  return {
    statusCode: 500,
    errorCode: "GIT_COMMAND_FAILED",
    detail: `Git 命令启动失败：${getErrorMessage(error)}`
  };
}

function createGitCommandCancelledError(reason?: unknown) {
  return {
    statusCode: 499,
    errorCode: "GIT_COMMAND_CANCELLED",
    detail: reason instanceof Error ? reason.message : "Git 命令已取消"
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrnoCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as Record<string, unknown>;
  return typeof candidate.code === "string" ? candidate.code : null;
}

function logHelperWarn(scope: string, payload: Record<string, unknown>): void {
  console.warn(`[${scope}]`, payload);
}

function logHelperError(message: string, error: unknown): void {
  console.error(`[git-helper] ${message}`, error);
}

async function waitForRetryDelay(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw createGitCommandCancelledError(signal.reason);
  }

  let onAbort: (() => void) | null = null;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, GIT_COMMAND_SPAWN_RETRY_DELAY_MS);

    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        reject(createGitCommandCancelledError(signal.reason));
      };

      signal.addEventListener("abort", onAbort, { once: true });
    }
  }).finally(() => {
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  });
}

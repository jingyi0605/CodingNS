import { spawn } from "node:child_process";
import readline from "node:readline";

const GIT_COMMAND_SLOW_THRESHOLD_MS = 3_000;
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

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

stdinReader.on("line", (line) => {
  void handleRequestLine(line);
});

async function handleRequestLine(line: string): Promise<void> {
  let request: HelperRunRequest;

  try {
    request = JSON.parse(line) as HelperRunRequest;
  } catch (error) {
    logHelperError("无法解析请求", error);
    return;
  }

  if (request.type !== "run") {
    return;
  }

  try {
    const result = await runGitCommand(request.repoRoot, request.args, request.options);

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
  }
}

async function runGitCommand(
  repoRoot: string,
  args: string[],
  options: GitCommandOptions = {},
  retryAttempt = 0
): Promise<GitCommandResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const effectiveArgs = ["-c", "core.quotepath=false", ...args];
  const env = {
    ...process.env,
    ...(options.env ?? {})
  };

  return await new Promise<GitCommandResult>((resolve, reject) => {
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
        setTimeout(() => {
          resolve(runGitCommand(repoRoot, args, options, nextAttempt));
        }, GIT_COMMAND_SPAWN_RETRY_DELAY_MS);
        return;
      }

      reject(createGitCommandFailedError(error));
      return;
    }

    let stdout = "";
    let stderr = "";
    let completed = false;

    const finish = (callback: () => void) => {
      if (completed) {
        return;
      }

      completed = true;
      clearTimeout(timer);
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
          setTimeout(() => {
            resolve(runGitCommand(repoRoot, args, options, nextAttempt));
          }, GIT_COMMAND_SPAWN_RETRY_DELAY_MS);
          return;
        }

        reject(createGitCommandFailedError(error));
      });
    });

    child.on("close", (exitCode) => {
      finish(() => {
        const code = exitCode ?? 1;
        const durationMs = Date.now() - startedAt;

        if (durationMs >= GIT_COMMAND_SLOW_THRESHOLD_MS) {
          logHelperWarn("git-command-slow", {
            workspaceId: options.workspaceId ?? null,
            operation: options.operation ?? null,
            repoRoot,
            args,
            command: `git ${args.join(" ")}`,
            timeoutMs,
            slowThresholdMs: GIT_COMMAND_SLOW_THRESHOLD_MS,
            durationMs,
            exitCode: code,
            pid: child.pid ?? null,
            stdoutLength: stdout.length,
            stderrLength: stderr.length
          });
        }

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

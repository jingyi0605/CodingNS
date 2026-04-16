import { spawn } from "node:child_process";

import { AppError } from "../../shared/errors/app-error.js";
import { GitCommandHelperClient } from "./git-command-helper-client.js";

const GIT_COMMAND_SLOW_THRESHOLD_MS = 3_000;
const GIT_COMMAND_SPAWN_RETRY_LIMIT = 1;
const GIT_COMMAND_SPAWN_RETRY_DELAY_MS = 50;

interface GitCommandOptions {
  allowNonZeroExit?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  workspaceId?: string;
  operation?: string;
  signal?: AbortSignal;
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface GitCommandRunnerOptions {
  preferHelperProcess?: boolean;
}

export class GitCommandRunner {
  private readonly helperClient: GitCommandHelperClient | null;

  constructor(options: GitCommandRunnerOptions = {}) {
    this.helperClient = options.preferHelperProcess ? new GitCommandHelperClient() : null;
  }

  async run(
    repoRoot: string,
    args: string[],
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    if (this.helperClient) {
      return this.helperClient.run(repoRoot, args, options);
    }

    return this.runDirect(repoRoot, args, options, 0);
  }

  dispose(): void {
    this.helperClient?.dispose();
  }

  private async runDirect(
    repoRoot: string,
    args: string[],
    options: GitCommandOptions,
    retryAttempt: number
  ): Promise<GitCommandResult> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? 15_000;
    const effectiveArgs = ["-c", "core.quotepath=false", ...args];
    const env = {
      ...process.env,
      ...(options.env ?? {})
    };
    const signal = options.signal;

    return await new Promise<GitCommandResult>((resolve, reject) => {
      let child;
      let onAbort: (() => void) | null = null;

      try {
        child = spawn("git", effectiveArgs, {
          cwd: repoRoot,
          env,
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        if (this.retrySpawnIfNeeded(error, repoRoot, args, options, retryAttempt, resolve)) {
          return;
        }

        reject(
          new AppError({
            statusCode: 500,
            errorCode: "GIT_COMMAND_FAILED",
            detail: `Git 命令启动失败：${getErrorMessage(error)}`
          })
        );
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

        if (signal && onAbort) {
          signal.removeEventListener("abort", onAbort);
        }

        callback();
      };

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(() => {
          console.error("[git-command-timeout]", {
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
          reject(
            new AppError({
              statusCode: 504,
              errorCode: "GIT_COMMAND_TIMEOUT",
              detail: `Git 命令执行超时：git ${args.join(" ")}`
            })
          );
        });
      }, timeoutMs);

      if (signal) {
        onAbort = () => {
          if (!child.killed) {
            child.kill("SIGTERM");
          }

          finish(() => {
            reject(
              signal.reason
              ?? new AppError({
                statusCode: 499,
                errorCode: "GIT_COMMAND_CANCELLED",
                detail: `Git 命令已取消：git ${args.join(" ")}`
              })
            );
          });
        };

        if (signal.aborted) {
          onAbort();
          return;
        }

        signal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        finish(() => {
          if (this.retrySpawnIfNeeded(error, repoRoot, args, options, retryAttempt, resolve)) {
            return;
          }

          reject(
            new AppError({
              statusCode: 500,
              errorCode: "GIT_COMMAND_FAILED",
              detail: `Git 命令启动失败：${error.message}`
            })
          );
        });
      });

      child.on("close", (exitCode) => {
        finish(() => {
          const code = exitCode ?? 1;
          const durationMs = Date.now() - startedAt;

          if (durationMs >= GIT_COMMAND_SLOW_THRESHOLD_MS) {
            console.warn("[git-command-slow]", {
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
            reject(
              new AppError({
                statusCode: 500,
                errorCode: "GIT_COMMAND_FAILED",
                detail: stderr.trim() || stdout.trim() || `Git 命令失败：git ${args.join(" ")}`
              })
            );
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

  private retrySpawnIfNeeded(
    error: unknown,
    repoRoot: string,
    args: string[],
    options: GitCommandOptions,
    retryAttempt: number,
    resolve: (value: GitCommandResult | PromiseLike<GitCommandResult>) => void
  ): boolean {
    const normalizedError = toErrnoException(error);

    if (!shouldRetryGitSpawn(normalizedError) || retryAttempt >= GIT_COMMAND_SPAWN_RETRY_LIMIT) {
      return false;
    }

    const nextAttempt = retryAttempt + 1;

    console.warn("[git-command-retry]", {
      workspaceId: options.workspaceId ?? null,
      operation: options.operation ?? null,
      repoRoot,
      args,
      command: `git ${args.join(" ")}`,
      retryAttempt: nextAttempt,
      retryLimit: GIT_COMMAND_SPAWN_RETRY_LIMIT,
      retryDelayMs: GIT_COMMAND_SPAWN_RETRY_DELAY_MS,
      errorCode: normalizedError.code ?? null,
      reason: normalizedError.message
    });

    setTimeout(() => {
      resolve(this.runDirect(repoRoot, args, options, nextAttempt));
    }, GIT_COMMAND_SPAWN_RETRY_DELAY_MS);

    return true;
  }
}

function shouldRetryGitSpawn(error: NodeJS.ErrnoException): boolean {
  return error.code === "EBADF";
}

function toErrnoException(error: unknown): NodeJS.ErrnoException {
  if (error instanceof Error) {
    return error as NodeJS.ErrnoException;
  }

  return new Error(String(error)) as NodeJS.ErrnoException;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

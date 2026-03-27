import { spawn } from "node:child_process";

import { AppError } from "../../shared/errors/app-error.js";

const GIT_COMMAND_SLOW_THRESHOLD_MS = 3_000;

interface GitCommandOptions {
  allowNonZeroExit?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  workspaceId?: string;
  operation?: string;
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitCommandRunner {
  async run(
    repoRoot: string,
    args: string[],
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? 15_000;
    const effectiveArgs = ["-c", "core.quotepath=false", ...args];
    const env = options.env ? { ...process.env, ...options.env } : process.env;

    return await new Promise<GitCommandResult>((resolve, reject) => {
      const child = spawn("git", effectiveArgs, {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });

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

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        finish(() => {
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
}

import { spawn } from "node:child_process";

import { AppError } from "../../shared/errors/app-error.js";

interface GitCommandOptions {
  allowNonZeroExit?: boolean;
  timeoutMs?: number;
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
    const timeoutMs = options.timeoutMs ?? 15_000;

    return await new Promise<GitCommandResult>((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: repoRoot,
        env: process.env,
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

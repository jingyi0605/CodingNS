import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { AppError } from "../../shared/errors/app-error.js";

interface GitCommandOptions {
  allowNonZeroExit?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  workspaceId?: string;
  operation?: string;
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface HelperRunRequest {
  type: "run";
  id: string;
  repoRoot: string;
  args: string[];
  options: GitCommandOptions;
}

interface HelperRunSuccessResponse {
  type: "result";
  id: string;
  ok: true;
  result: GitCommandResult;
}

interface HelperRunErrorResponse {
  type: "result";
  id: string;
  ok: false;
  error: {
    statusCode: number;
    errorCode: string;
    detail: string;
  };
}

type HelperResponse = HelperRunSuccessResponse | HelperRunErrorResponse;

interface PendingRequest {
  resolve: (value: GitCommandResult) => void;
  reject: (reason?: unknown) => void;
}

export class GitCommandHelperClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutReader: readline.Interface;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private nextRequestId = 1;
  private disposed = false;

  constructor() {
    const launch = resolveHelperLaunch();
    this.child = spawn(launch.command, launch.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.stdoutReader = readline.createInterface({
      input: this.child.stdout
    });

    this.stdoutReader.on("line", (line) => {
      this.handleResponseLine(line);
    });
    this.child.stderr.on("data", (chunk) => {
      const content = String(chunk).trim();

      if (!content) {
        return;
      }

      console.warn(`[git-helper] ${content}`);
    });
    this.child.on("error", (error) => {
      this.rejectAllPending(
        new AppError({
          statusCode: 500,
          errorCode: "GIT_COMMAND_FAILED",
          detail: `Git helper 启动失败：${error.message}`
        })
      );
    });
    this.child.on("exit", (code, signal) => {
      if (this.disposed && (code === 0 || signal === "SIGTERM")) {
        return;
      }

      this.rejectAllPending(
        new AppError({
          statusCode: 500,
          errorCode: "GIT_COMMAND_FAILED",
          detail: `Git helper 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`
        })
      );
    });
  }

  run(repoRoot: string, args: string[], options: GitCommandOptions = {}): Promise<GitCommandResult> {
    if (this.disposed) {
      return Promise.reject(
        new AppError({
          statusCode: 500,
          errorCode: "GIT_COMMAND_FAILED",
          detail: "Git helper 已关闭"
        })
      );
    }

    const id = String(this.nextRequestId++);
    const payload: HelperRunRequest = {
      type: "run",
      id,
      repoRoot,
      args,
      options
    };

    return new Promise<GitCommandResult>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject
      });

      this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) {
          return;
        }

        this.pendingRequests.delete(id);
        reject(
          new AppError({
            statusCode: 500,
            errorCode: "GIT_COMMAND_FAILED",
            detail: `写入 Git helper 失败：${error.message}`
          })
        );
      });
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stdoutReader.close();
    this.child.kill("SIGTERM");
    this.rejectAllPending(
      new AppError({
        statusCode: 500,
        errorCode: "GIT_COMMAND_FAILED",
        detail: "Git helper 已关闭"
      })
    );
  }

  private handleResponseLine(line: string): void {
    let payload: HelperResponse;

    try {
      payload = JSON.parse(line) as HelperResponse;
    } catch (error) {
      console.warn("[git-helper] 无法解析响应", error);
      return;
    }

    const pending = this.pendingRequests.get(payload.id);

    if (!pending) {
      return;
    }

    this.pendingRequests.delete(payload.id);

    if (payload.ok) {
      pending.resolve(payload.result);
      return;
    }

    pending.reject(
      new AppError({
        statusCode: payload.error.statusCode,
        errorCode: payload.error.errorCode,
        detail: payload.error.detail
      })
    );
  }

  private rejectAllPending(error: AppError): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }
}

function resolveHelperLaunch(): { command: string; args: string[] } {
  const currentFilePath = fileURLToPath(import.meta.url);
  const extension = path.extname(currentFilePath);
  const helperPath = currentFilePath.replace(
    /git-command-helper-client\.(ts|js)$/,
    `git-command-helper-process${extension}`
  );

  if (extension === ".ts") {
    return {
      command: process.execPath,
      args: ["--import", "tsx", helperPath]
    };
  }

  return {
    command: process.execPath,
    args: [helperPath]
  };
}

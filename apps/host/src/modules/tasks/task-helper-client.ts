import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import type { TaskHelperProcessHandlerName } from "./task-helper-process-handlers.js";

interface PendingRequest<TResult> {
  resolve: (value: TResult) => void;
  reject: (reason?: unknown) => void;
}

type HelperResponse =
  | {
      type: "result";
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      type: "result";
      id: string;
      ok: false;
      error: string;
    };

const GLOBAL_TASK_HELPER_PROCESS_CLIENT_KEY = "__codingnsTaskHelperProcessClient__";

let sharedTaskHelperProcessClient: TaskHelperProcessClient | null = null;

export class TaskHelperProcessClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: readline.Interface | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>();
  private nextRequestId = 1;
  private disposed = false;

  constructor() {
    this.ensureChild();
  }

  async execute<TResult>(
    handler: TaskHelperProcessHandlerName,
    input: unknown,
    signal?: AbortSignal
  ): Promise<TResult> {
    let attempt = 0;

    while (true) {
      try {
        return await this.executeOnce<TResult>(handler, input, signal);
      } catch (error) {
        if (
          attempt >= 1 ||
          this.disposed ||
          signal?.aborted ||
          !isRetryableHelperClientError(error)
        ) {
          throw error;
        }

        attempt += 1;
        this.handleChildTermination(
          error instanceof Error
            ? error
            : new Error("task helper pipe 已断开")
        );
      }
    }
  }

  private async executeOnce<TResult>(
    handler: TaskHelperProcessHandlerName,
    input: unknown,
    signal?: AbortSignal
  ): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(new Error("task helper 已关闭"));
    }

    const child = this.ensureChild();
    const id = String(this.nextRequestId++);

    return await new Promise<TResult>((resolve, reject) => {
      let aborted = false;
      let onAbort: (() => void) | null = null;

      if (signal) {
        onAbort = () => {
          aborted = true;
          this.pendingRequests.delete(id);
          void this.sendCancel(id);
          reject(signal.reason ?? new Error("helper task aborted"));
        };

        if (signal.aborted) {
          onAbort();
          return;
        }

        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.pendingRequests.set(id, {
        resolve: (value) => {
          if (onAbort && signal) {
            signal.removeEventListener("abort", onAbort);
          }

          if (!aborted) {
            resolve(value as TResult);
          }
        },
        reject: (error) => {
          if (onAbort && signal) {
            signal.removeEventListener("abort", onAbort);
          }

          if (!aborted) {
            reject(error);
          }
        }
      });

      child.stdin.write(
        `${JSON.stringify({
          id,
          type: "run",
          handler,
          input
        })}\n`,
        (error) => {
          if (!error) {
            return;
          }

          if (onAbort && signal) {
            signal.removeEventListener("abort", onAbort);
          }

          this.pendingRequests.delete(id);
          reject(error);
        }
      );
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stdoutReader?.close();

    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }

    this.rejectAll(new Error("task helper 已关闭"));
    this.child = null;
    this.stdoutReader = null;
  }

  private handleResponseLine(line: string): void {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{")) {
      return;
    }

    let payload: HelperResponse;

    try {
      payload = JSON.parse(trimmed) as HelperResponse;
    } catch {
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

    pending.reject(new Error(payload.error));
  }

  private rejectAll(error: unknown): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }

  private async sendCancel(targetId: string): Promise<void> {
    if (
      this.disposed ||
      !this.child ||
      this.child.killed ||
      this.child.stdin.destroyed
    ) {
      return;
    }
    const child = this.child;

    await new Promise<void>((resolve) => {
      try {
        child.stdin.write(
          `${JSON.stringify({
            id: `cancel:${targetId}`,
            type: "cancel",
            targetId
          })}\n`,
          () => {
            resolve();
          }
        );
      } catch {
        resolve();
      }
    });
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && this.stdoutReader && !this.child.killed && !this.child.stdin.destroyed) {
      return this.child;
    }

    const launch = resolveHelperLaunch();
    const child = spawn(launch.command, launch.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdoutReader = readline.createInterface({
      input: child.stdout
    });

    stdoutReader.on("line", (line) => {
      this.handleResponseLine(line);
    });
    child.stderr.on("data", (chunk) => {
      const content = String(chunk).trim();

      if (content) {
        console.warn(`[task-helper] ${content}`);
      }
    });
    child.stdin.on("error", (error) => {
      this.handleChildTermination(
        error instanceof Error
          ? error
          : new Error("task helper stdin 已断开")
      );
    });
    child.on("error", (error) => {
      this.handleChildTermination(error);
    });
    child.on("exit", (code, signal) => {
      this.handleChildTermination(
        new Error(
          `task helper 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`
        )
      );
    });

    this.child = child;
    this.stdoutReader = stdoutReader;
    return child;
  }

  private handleChildTermination(error: Error): void {
    const child = this.child;

    if (this.stdoutReader) {
      this.stdoutReader.close();
    }

    if (child && !child.killed) {
      child.kill("SIGTERM");
    }

    this.child = null;
    this.stdoutReader = null;
    this.rejectAll(error);
  }
}

function isRetryableHelperClientError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : null;

  if (code === "EPIPE" || code === "ECONNRESET") {
    return true;
  }

  const message = "message" in error ? String(error.message ?? "") : "";
  return message.includes("task helper 已退出");
}

export function getSharedTaskHelperProcessClient(): TaskHelperProcessClient {
  const scope = globalThis as typeof globalThis & {
    [GLOBAL_TASK_HELPER_PROCESS_CLIENT_KEY]?: TaskHelperProcessClient | null;
  };
  const globalClient = scope[GLOBAL_TASK_HELPER_PROCESS_CLIENT_KEY];

  if (globalClient) {
    sharedTaskHelperProcessClient = globalClient;
    return globalClient;
  }

  if (!sharedTaskHelperProcessClient) {
    sharedTaskHelperProcessClient = new TaskHelperProcessClient();
  }

  scope[GLOBAL_TASK_HELPER_PROCESS_CLIENT_KEY] = sharedTaskHelperProcessClient;
  return sharedTaskHelperProcessClient;
}

export function disposeSharedTaskHelperProcessClient(): void {
  const scope = globalThis as typeof globalThis & {
    [GLOBAL_TASK_HELPER_PROCESS_CLIENT_KEY]?: TaskHelperProcessClient | null;
  };
  const sharedClient =
    scope[GLOBAL_TASK_HELPER_PROCESS_CLIENT_KEY] ?? sharedTaskHelperProcessClient;

  if (!sharedClient) {
    return;
  }

  sharedClient.dispose();
  scope[GLOBAL_TASK_HELPER_PROCESS_CLIENT_KEY] = null;
  sharedTaskHelperProcessClient = null;
}

function resolveHelperLaunch(): { command: string; args: string[] } {
  const currentFilePath = fileURLToPath(import.meta.url);
  const extension = path.extname(currentFilePath);
  const helperPath = currentFilePath.replace(
    /task-helper-client\.(ts|js)$/,
    `task-helper-process${extension}`
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

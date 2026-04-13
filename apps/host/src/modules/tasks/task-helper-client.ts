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

export class TaskHelperProcessClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutReader: readline.Interface;
  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>();
  private nextRequestId = 1;

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

      if (content) {
        console.warn(`[task-helper] ${content}`);
      }
    });
    this.child.on("error", (error) => {
      this.rejectAll(error);
    });
    this.child.on("exit", (code, signal) => {
      this.rejectAll(
        new Error(
          `task helper 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`
        )
      );
    });
  }

  async execute<TResult>(
    handler: TaskHelperProcessHandlerName,
    input: unknown,
    signal?: AbortSignal
  ): Promise<TResult> {
    const id = String(this.nextRequestId++);

    return await new Promise<TResult>((resolve, reject) => {
      let aborted = false;
      let onAbort: (() => void) | null = null;

      if (signal) {
        onAbort = () => {
          aborted = true;
          this.pendingRequests.delete(id);
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

      this.child.stdin.write(
        `${JSON.stringify({
          id,
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

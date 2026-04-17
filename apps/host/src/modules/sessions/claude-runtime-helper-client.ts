import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import type {
  ProviderRuntimeAdapter,
  ProviderRuntimeEventSink,
  ProviderRuntimeLaunchResult,
  ProviderRuntimeRunRequest,
  RuntimeEventInput,
  RuntimeSendOptions,
  RuntimeSessionBinding
} from "@codingns/session-sync-core";

interface ClaudeRuntimeHelperClientOptions {
  homeDir: string;
  commandPath?: string;
  hookBridge?: {
    url: string;
    token: string;
    scriptPath: string;
  } | null;
}

interface PendingLaunch {
  resolve: (value: ProviderRuntimeLaunchResult) => void;
  reject: (reason?: unknown) => void;
  sink: ProviderRuntimeEventSink;
}

interface ActiveRunRecord {
  sink: ProviderRuntimeEventSink;
  resolveCompleted: () => void;
  rejectCompleted: (reason?: unknown) => void;
  completed: Promise<void>;
  submitDuringRun: ((options: RuntimeSendOptions) => Promise<void>) | null;
  interrupt: (() => Promise<void>) | null;
}

type ParentToHelperMessage =
  | {
      type: "start" | "continue";
      requestId: string;
      request: ProviderRuntimeRunRequest;
    }
  | {
      type: "submit";
      sessionId: string;
      options: RuntimeSendOptions;
    }
  | {
      type: "interrupt";
      sessionId: string;
    };

type HelperToParentMessage =
  | {
      type: "launch";
      requestId: string;
      sessionId: string;
      providerSessionId: string;
      rawStoreRef: string | null;
      supportsSubmitDuringRun: boolean;
      supportsInterrupt: boolean;
    }
  | {
      type: "binding";
      sessionId: string;
      binding: RuntimeSessionBinding;
    }
  | {
      type: "event";
      sessionId: string;
      event: RuntimeEventInput;
    }
  | {
      type: "completed";
      sessionId: string;
    }
  | {
      type: "error";
      requestId?: string;
      sessionId?: string;
      detail: string;
    };

export class ClaudeRuntimeHelperAdapter implements ProviderRuntimeAdapter {
  readonly providerId = "claude-code" as const;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutReader: readline.Interface;
  private readonly pendingLaunches = new Map<string, PendingLaunch>();
  private readonly activeRuns = new Map<string, ActiveRunRecord>();
  private nextRequestId = 1;
  private disposed = false;

  constructor(options: ClaudeRuntimeHelperClientOptions) {
    const launch = resolveHelperLaunch(options.homeDir);
    if (options.commandPath) {
      launch.args.push("--command-path", options.commandPath);
    }
    if (options.hookBridge) {
      launch.args.push("--hook-bridge", JSON.stringify(options.hookBridge));
    }
    const helperEnv = buildClaudeHelperEnv(options.homeDir);
    this.child = spawn(launch.command, launch.args, {
      cwd: process.cwd(),
      env: helperEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.stdoutReader = readline.createInterface({
      input: this.child.stdout
    });

    this.stdoutReader.on("line", (line) => {
      void this.handleMessageLine(line);
    });
    this.child.stderr.on("data", (chunk) => {
      const content = String(chunk).trim();

      if (!content) {
        return;
      }

      console.warn(`[claude-runtime-helper] ${content}`);
    });
    this.child.on("error", (error) => {
      this.failAll(error);
    });
    this.child.on("exit", (code, signal) => {
      if (this.disposed && (code === 0 || signal === "SIGTERM")) {
        return;
      }

      this.failAll(new Error(`Claude runtime helper 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  }

  startSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    return this.launch("start", request, sink);
  }

  continueSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    return this.launch("continue", request, sink);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stdoutReader.close();
    this.child.kill("SIGTERM");
    this.failAll(new Error("Claude runtime helper 已关闭"));
  }

  private launch(
    type: "start" | "continue",
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    if (this.disposed) {
      return Promise.reject(new Error("Claude runtime helper 已关闭"));
    }

    const requestId = String(this.nextRequestId++);

    return new Promise<ProviderRuntimeLaunchResult>((resolve, reject) => {
      this.pendingLaunches.set(requestId, {
        resolve,
        reject,
        sink
      });

      this.sendMessage({
        type,
        requestId,
        request
      }).catch((error) => {
        this.pendingLaunches.delete(requestId);
        reject(error);
      });
    });
  }

  private async handleMessageLine(line: string): Promise<void> {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{")) {
      console.warn(`[claude-runtime-helper] 忽略非协议输出: ${trimmed}`);
      return;
    }

    let message: HelperToParentMessage;

    try {
      message = JSON.parse(trimmed) as HelperToParentMessage;
    } catch (error) {
      console.warn("[claude-runtime-helper] 无法解析响应", error);
      return;
    }

    switch (message.type) {
      case "launch": {
        const pending = this.pendingLaunches.get(message.requestId);

        if (!pending) {
          return;
        }

        this.pendingLaunches.delete(message.requestId);
        let resolveCompleted!: () => void;
        let rejectCompleted!: (reason?: unknown) => void;
        const completed = new Promise<void>((resolve, reject) => {
          resolveCompleted = resolve;
          rejectCompleted = reject;
        });
        const submitDuringRun = message.supportsSubmitDuringRun
          ? async (options: RuntimeSendOptions) => {
              await this.sendMessage({
                type: "submit",
                sessionId: message.sessionId,
                options
              });
            }
          : null;
        const interrupt = message.supportsInterrupt
          ? async () => {
              await this.sendMessage({
                type: "interrupt",
                sessionId: message.sessionId
              });
            }
          : null;

        this.activeRuns.set(message.sessionId, {
          sink: pending.sink,
          resolveCompleted,
          rejectCompleted,
          completed,
          submitDuringRun,
          interrupt
        });

        pending.resolve({
          providerSessionId: message.providerSessionId,
          rawStoreRef: message.rawStoreRef,
          completed,
          submitDuringRun,
          interrupt
        });
        return;
      }
      case "binding": {
        const run = this.activeRuns.get(message.sessionId);
        if (!run) {
          return;
        }

        run.sink.updateSessionBinding(message.binding);
        return;
      }
      case "event": {
        const run = this.activeRuns.get(message.sessionId);
        if (!run) {
          return;
        }

        await run.sink.emit(message.event);
        return;
      }
      case "completed": {
        const run = this.activeRuns.get(message.sessionId);
        if (!run) {
          return;
        }

        this.activeRuns.delete(message.sessionId);
        run.resolveCompleted();
        return;
      }
      case "error": {
        if (message.requestId) {
          const pending = this.pendingLaunches.get(message.requestId);

          if (pending) {
            this.pendingLaunches.delete(message.requestId);
            pending.reject(new Error(message.detail));
          }
        }

        if (message.sessionId) {
          const run = this.activeRuns.get(message.sessionId);

          if (run) {
            this.activeRuns.delete(message.sessionId);
            run.rejectCompleted(new Error(message.detail));
          }
        }
      }
    }
  }

  private async sendMessage(message: ParentToHelperMessage): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private failAll(error: unknown): void {
    for (const pending of this.pendingLaunches.values()) {
      pending.reject(error);
    }
    this.pendingLaunches.clear();

    for (const run of this.activeRuns.values()) {
      run.rejectCompleted(error);
    }
    this.activeRuns.clear();
  }
}

function resolveHelperLaunch(homeDir: string): { command: string; args: string[] } {
  const currentFilePath = fileURLToPath(import.meta.url);
  const extension = path.extname(currentFilePath);
  const helperPath = currentFilePath.replace(
    /claude-runtime-helper-client\.(ts|js)$/,
    `claude-runtime-helper-process${extension}`
  );
  const baseArgs = extension === ".ts" ? ["--import", "tsx", helperPath] : [helperPath];

  return {
    command: process.execPath,
    args: [...baseArgs, "--home-dir", homeDir]
  };
}

function buildClaudeHelperEnv(homeDir: string): NodeJS.ProcessEnv {
  const resolvedHomeDir = path.resolve(homeDir);
  const xdgConfigHome = path.join(resolvedHomeDir, "xdg-config");
  const xdgDataHome = path.join(resolvedHomeDir, "xdg-data");
  const xdgStateHome = path.join(resolvedHomeDir, "xdg-state");
  const xdgCacheHome = path.join(resolvedHomeDir, "xdg-cache");
  const appDataHome = path.join(resolvedHomeDir, "appdata");
  const localAppDataHome = path.join(resolvedHomeDir, "localappdata");

  return {
    ...process.env,
    CLAUDE_CONFIG_DIR: resolvedHomeDir,
    HOME: resolvedHomeDir,
    USERPROFILE: resolvedHomeDir,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: xdgDataHome,
    XDG_STATE_HOME: xdgStateHome,
    XDG_CACHE_HOME: xdgCacheHome,
    APPDATA: appDataHome,
    LOCALAPPDATA: localAppDataHome
  };
}

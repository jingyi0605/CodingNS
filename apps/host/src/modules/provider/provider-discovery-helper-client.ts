import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import type {
  ProviderSessionDiscovery,
  ProviderSessionSummary
} from "@codingns/session-sync-core";

interface PendingRequest<T> {
  resolve: (value: T) => void;
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

interface HelperCancelRequest {
  type: "cancel";
  id: string;
  targetId: string;
}

let sharedProviderDiscoveryHelperClient: ProviderDiscoveryHelperClient | null = null;

export class ProviderDiscoveryHelperClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutReader: readline.Interface;
  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>();
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

      if (content) {
        console.warn(`[provider-discovery-helper] ${content}`);
      }
    });
    this.child.on("error", (error) => {
      this.rejectAll(error);
    });
    this.child.on("exit", (code, signal) => {
      this.rejectAll(
        new Error(
          `provider discovery helper 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`
        )
      );
    });
  }

  async readCodexAppServerState(input: {
    commandPath: string;
    timeoutMs: number;
  }, signal?: AbortSignal): Promise<{
    config: {
      model: string | null;
      modelReasoningEffort: string | null;
    };
    models: Array<Record<string, unknown>>;
  }> {
    const result = await this.sendRequest({
      type: "codex_app_server_state",
      ...input
    }, signal);

    return result as {
      config: {
        model: string | null;
        modelReasoningEffort: string | null;
      };
      models: Array<Record<string, unknown>>;
    };
  }

  async readOpenCodeCliModels(input: {
    commandPath: string;
    workspacePath: string | null;
    timeoutMs: number;
  }, signal?: AbortSignal): Promise<string[]> {
    const result = await this.sendRequest({
      type: "opencode_cli_models",
      ...input
    }, signal);

    return result as string[];
  }

  async discoverWorkspaceSessions(input: {
    config: ProviderSessionDiscoveryHelperConfig;
    workspacePath: string;
    knownSessions: ProviderSessionSummary[];
  }, signal?: AbortSignal): Promise<ProviderSessionDiscovery> {
    const result = await this.sendRequest({
      type: "workspace_session_discovery",
      ...input
    }, signal);

    return result as ProviderSessionDiscovery;
  }

  async readSessionTitle(input: {
    config: ProviderSessionDiscoveryHelperConfig;
    provider: string;
    providerSessionId: string;
    rawStoreRef: string;
  }, signal?: AbortSignal): Promise<string> {
    const result = await this.sendRequest({
      type: "session_title_read",
      ...input
    }, signal);

    return result as string;
  }

  private async sendRequest(payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("provider discovery helper 已关闭"));
    }

    const id = String(this.nextRequestId++);

    return await new Promise((resolve, reject) => {
      let aborted = false;
      let onAbort: (() => void) | null = null;

      if (signal) {
        onAbort = () => {
          aborted = true;
          this.pendingRequests.delete(id);
          void this.sendCancel(id);
          reject(signal.reason ?? new Error("provider discovery helper aborted"));
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
            resolve(value);
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
          ...payload
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
    this.stdoutReader.close();

    if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }

    this.rejectAll(new Error("provider discovery helper 已关闭"));
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
    if (this.disposed || this.child.killed || this.child.stdin.destroyed) {
      return;
    }

    const payload: HelperCancelRequest = {
      type: "cancel",
      id: `cancel:${targetId}`,
      targetId
    };

    await new Promise<void>((resolve) => {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, () => {
        resolve();
      });
    });
  }
}

export function getSharedProviderDiscoveryHelperClient(): ProviderDiscoveryHelperClient {
  if (!sharedProviderDiscoveryHelperClient) {
    sharedProviderDiscoveryHelperClient = new ProviderDiscoveryHelperClient();
  }

  return sharedProviderDiscoveryHelperClient;
}

export function disposeSharedProviderDiscoveryHelperClient(): void {
  if (!sharedProviderDiscoveryHelperClient) {
    return;
  }

  sharedProviderDiscoveryHelperClient.dispose();
  sharedProviderDiscoveryHelperClient = null;
}

export interface ProviderSessionDiscoveryHelperConfig {
  claudeCodeHomeDir: string;
  codexCliPath: string;
  codexHomeDir: string;
  geminiCliPath: string;
  geminiHomeDir: string;
  kimiDefaultModel: string | null;
  kimiHomeDir: string;
  opencodeBaseUrl: string;
  opencodeDataDir: string;
  opencodeDbPath: string;
}

function resolveHelperLaunch(): { command: string; args: string[] } {
  const currentFilePath = fileURLToPath(import.meta.url);
  const extension = path.extname(currentFilePath);
  const helperPath = currentFilePath.replace(
    /provider-discovery-helper-client\.(ts|js)$/,
    `provider-discovery-helper-process${extension}`
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

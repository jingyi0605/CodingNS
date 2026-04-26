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

const GLOBAL_PROVIDER_DISCOVERY_HELPER_CLIENT_KEY =
  "__codingnsProviderDiscoveryHelperClient__";

let sharedProviderDiscoveryHelperClient: ProviderDiscoveryHelperClient | null = null;

export class ProviderDiscoveryHelperClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: readline.Interface | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>();
  private nextRequestId = 1;
  private disposed = false;

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
    let attempt = 0;

    while (true) {
      try {
        return await this.sendRequestOnce(payload, signal);
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
            : new Error("provider discovery helper pipe 已断开")
        );
      }
    }
  }

  private async sendRequestOnce(
    payload: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("provider discovery helper 已关闭"));
    }

    const child = this.ensureChild();
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

      try {
        child.stdin.write(
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
      } catch (error) {
        if (onAbort && signal) {
          signal.removeEventListener("abort", onAbort);
        }

        this.pendingRequests.delete(id);
        reject(error);
      }
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

    this.rejectAll(new Error("provider discovery helper 已关闭"));
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

    const payload: HelperCancelRequest = {
      type: "cancel",
      id: `cancel:${targetId}`,
      targetId
    };
    const child = this.child;

    await new Promise<void>((resolve) => {
      try {
        child.stdin.write(
          `${JSON.stringify(payload)}\n`,
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
        console.warn(`[provider-discovery-helper] ${content}`);
      }
    });
    child.stdin.on("error", (error) => {
      this.handleChildTermination(
        error instanceof Error
          ? error
          : new Error("provider discovery helper stdin 已断开")
      );
    });
    child.on("error", (error) => {
      this.handleChildTermination(error);
    });
    child.on("exit", (code, signal) => {
      this.handleChildTermination(
        new Error(
          `provider discovery helper 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`
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
  return message.includes("provider discovery helper 已退出");
}

export function getSharedProviderDiscoveryHelperClient(): ProviderDiscoveryHelperClient {
  const scope = globalThis as typeof globalThis & {
    [GLOBAL_PROVIDER_DISCOVERY_HELPER_CLIENT_KEY]?: ProviderDiscoveryHelperClient | null;
  };
  const globalClient = scope[GLOBAL_PROVIDER_DISCOVERY_HELPER_CLIENT_KEY];

  if (globalClient) {
    sharedProviderDiscoveryHelperClient = globalClient;
    return globalClient;
  }

  if (!sharedProviderDiscoveryHelperClient) {
    sharedProviderDiscoveryHelperClient = new ProviderDiscoveryHelperClient();
  }

  scope[GLOBAL_PROVIDER_DISCOVERY_HELPER_CLIENT_KEY] = sharedProviderDiscoveryHelperClient;
  return sharedProviderDiscoveryHelperClient;
}

export function disposeSharedProviderDiscoveryHelperClient(): void {
  const scope = globalThis as typeof globalThis & {
    [GLOBAL_PROVIDER_DISCOVERY_HELPER_CLIENT_KEY]?: ProviderDiscoveryHelperClient | null;
  };
  const sharedClient =
    scope[GLOBAL_PROVIDER_DISCOVERY_HELPER_CLIENT_KEY] ?? sharedProviderDiscoveryHelperClient;

  if (!sharedClient) {
    return;
  }

  sharedClient.dispose();
  scope[GLOBAL_PROVIDER_DISCOVERY_HELPER_CLIENT_KEY] = null;
  sharedProviderDiscoveryHelperClient = null;
}

export interface ProviderSessionDiscoveryHelperConfig {
  claudeCodeHomeDir: string;
  legnaCodeHomeDir: string;
  codexCliPath: string;
  codexHomeDir: string;
  legnaCodeCliPath: string;
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

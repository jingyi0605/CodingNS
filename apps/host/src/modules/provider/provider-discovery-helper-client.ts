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

export class ProviderDiscoveryHelperClient {
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
  }): Promise<{
    config: {
      model: string | null;
      modelReasoningEffort: string | null;
    };
    models: Array<Record<string, unknown>>;
  }> {
    const result = await this.sendRequest({
      type: "codex_app_server_state",
      ...input
    });

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
  }): Promise<string[]> {
    const result = await this.sendRequest({
      type: "opencode_cli_models",
      ...input
    });

    return result as string[];
  }

  async discoverWorkspaceSessions(input: {
    config: ProviderSessionDiscoveryHelperConfig;
    workspacePath: string;
    knownSessions: ProviderSessionSummary[];
  }): Promise<ProviderSessionDiscovery> {
    const result = await this.sendRequest({
      type: "workspace_session_discovery",
      ...input
    });

    return result as ProviderSessionDiscovery;
  }

  private async sendRequest(payload: Record<string, unknown>): Promise<unknown> {
    const id = String(this.nextRequestId++);

    return await new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject
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

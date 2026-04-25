import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import type {
  CodexAppServerTransport,
  CodexForkTransport,
  CodexThreadControlTransport,
  ProviderRuntimeRunRequest,
  RuntimeSendOptions
} from "@codingns/session-sync-core";

type HelperToParentMessage =
  | {
      type: "response";
      transportId: string;
      requestId: string;
      ok: true;
      result: Record<string, unknown>;
    }
  | {
      type: "response";
      transportId: string;
      requestId: string;
      ok: false;
      error: string;
    }
  | {
      type: "notification";
      transportId: string;
      notification: Record<string, unknown>;
    }
  | {
      type: "server_request";
      transportId: string;
      requestId: string;
      request: Record<string, unknown>;
    }
  | {
      type: "transport_closed";
      transportId: string;
      detail: string | null;
    };

type ParentToHelperMessage =
  | {
      type: "transport_request";
      transportId: string;
      requestId: string;
      method:
        | "initialize"
        | "startThread"
        | "resumeThread"
        | "forkThread"
        | "archiveThread"
        | "unarchiveThread"
        | "readThread"
        | "rollbackThread"
        | "resumeThreadFromHistory"
        | "startTurn"
        | "steerTurn"
        | "interruptTurn"
        | "close";
      request?: ProviderRuntimeRunRequest;
      options?: RuntimeSendOptions;
      providerSessionId?: string;
      expectedTurnId?: string;
      numTurns?: number;
      workspacePath?: string;
      history?: unknown[];
      model?: string | null;
    }
  | {
      type: "server_request_result";
      transportId: string;
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      type: "server_request_result";
      transportId: string;
      requestId: string;
      ok: false;
      error: string;
    };

interface PendingResponse {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason?: unknown) => void;
}

interface LogicalTransportState {
  pendingResponses: Map<string, PendingResponse>;
  notificationHandler: (notification: Record<string, unknown>) => void | Promise<void>;
  serverRequestHandler: (request: Record<string, unknown>) => Promise<unknown>;
  closeHandler: ((error: Error | null) => void) | null;
  closed: boolean;
}

interface CodexAppServerHelperClientOptions {
  homeDir?: string;
  runtimeEnv?: Record<string, string> | null;
  requestTimeoutMs?: number;
}

export class CodexAppServerHelperClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutReader: readline.Interface;
  private readonly transports = new Map<string, LogicalTransportState>();
  private readonly requestTimeoutMs: number;
  private nextTransportId = 1;
  private nextRequestId = 1;
  private disposed = false;

  constructor(commandPath: string, options: CodexAppServerHelperClientOptions = {}) {
    const launch = resolveHelperLaunch(commandPath);
    const helperEnv = {
      ...process.env
    };
    const configuredHomeDir = options.homeDir?.trim();
    const configuredRuntimeEnv = options.runtimeEnv ?? null;

    if (configuredHomeDir) {
      helperEnv.CODINGNS_CODEX_HOME = configuredHomeDir;
      helperEnv.CODEX_HOME = configuredHomeDir;
    }
    if (configuredRuntimeEnv) {
      for (const [key, value] of Object.entries(configuredRuntimeEnv)) {
        const normalizedKey = key.trim();

        if (!normalizedKey) {
          continue;
        }

        helperEnv[normalizedKey] = String(value);
      }
    }
    this.requestTimeoutMs = Math.max(1, Math.floor(options.requestTimeoutMs ?? 20_000));

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

      console.warn(`[codex-app-server-helper] ${content}`);
    });
    this.child.on("error", (error) => {
      this.failAll(error);
    });
    this.child.on("exit", (code, signal) => {
      if (this.disposed && (code === 0 || signal === "SIGTERM")) {
        return;
      }

      this.failAll(new Error(`Codex app-server helper 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  }

  createTransport(): CodexAppServerTransport {
    const transportId = String(this.nextTransportId++);
    const state: LogicalTransportState = {
      pendingResponses: new Map(),
      notificationHandler: () => undefined,
      serverRequestHandler: async () => {
        throw new Error("CODEX_APP_SERVER_REQUEST_NOT_SUPPORTED");
      },
      closeHandler: null,
      closed: false
    };

    this.transports.set(transportId, state);

    const request = async (
      method: Extract<ParentToHelperMessage, { type: "transport_request" }>["method"],
      input: {
        request?: ProviderRuntimeRunRequest;
        options?: RuntimeSendOptions;
        providerSessionId?: string;
        expectedTurnId?: string;
        workspacePath?: string;
        history?: unknown[];
        model?: string | null;
      } = {}
    ): Promise<Record<string, unknown>> => {
      if (state.closed) {
        throw new Error("CODEX_APP_SERVER_CLOSED");
      }

      const requestId = String(this.nextRequestId++);

      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.closeLogicalTransport(transportId, state, new Error("SERVER_TIMEOUT"));
        }, this.requestTimeoutMs);

        state.pendingResponses.set(requestId, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          }
        });

        this.sendMessage({
          type: "transport_request",
          transportId,
          requestId,
          method,
          ...input
        }).catch((error) => {
          clearTimeout(timeout);
          state.pendingResponses.delete(requestId);
          reject(error);
        });
      });
    };

    return {
      async initialize() {
        await request("initialize");
      },
      async startThread(runtimeRequest) {
        const result = await request("startThread", {
          request: runtimeRequest
        });
        return {
          providerSessionId: String(result.providerSessionId ?? ""),
          rawStoreRef: normalizeNullableString(result.rawStoreRef)
        };
      },
      async resumeThread(runtimeRequest, providerSessionId) {
        const result = await request("resumeThread", {
          request: runtimeRequest,
          providerSessionId
        });
        return {
          providerSessionId: String(result.providerSessionId ?? providerSessionId),
          rawStoreRef: normalizeNullableString(result.rawStoreRef)
        };
      },
      async resumeThreadFromHistory(input) {
        const result = await request("resumeThreadFromHistory", {
          providerSessionId: input.providerSessionId ?? undefined,
          workspacePath: input.workspacePath,
          history: input.history,
          model: input.model ?? null
        });
        return {
          providerSessionId: String(result.providerSessionId ?? ""),
          rawStoreRef: normalizeNullableString(result.rawStoreRef)
        };
      },
      async startTurn(runtimeRequest, providerSessionId) {
        await request("startTurn", {
          request: runtimeRequest,
          providerSessionId
        });
      },
      async steerTurn(options) {
        const result = await request("steerTurn", {
          options
        });
        return {
          turnId: normalizeNullableString(result.turnId)
        };
      },
      async interruptTurn() {
        await request("interruptTurn");
      },
      setNotificationHandler(handler) {
        state.notificationHandler = handler;
      },
      setServerRequestHandler(handler) {
        state.serverRequestHandler = handler;
      },
      setOnClose(handler) {
        state.closeHandler = handler;
      },
      isClosed() {
        return state.closed;
      },
      close: () => {
        this.closeLogicalTransport(transportId, state, null);
      }
    };
  }

  createForkTransport(): CodexForkTransport {
    const transportId = String(this.nextTransportId++);
    const state: LogicalTransportState = {
      pendingResponses: new Map(),
      notificationHandler: () => undefined,
      serverRequestHandler: async () => {
        throw new Error("CODEX_APP_SERVER_REQUEST_NOT_SUPPORTED");
      },
      closeHandler: null,
      closed: false
    };

    this.transports.set(transportId, state);

    const request = async (
      method: Extract<ParentToHelperMessage, { type: "transport_request" }>["method"],
      input: {
        providerSessionId?: string;
        numTurns?: number;
        workspacePath?: string;
        history?: unknown[];
        model?: string | null;
      } = {}
    ): Promise<Record<string, unknown>> => {
      if (state.closed) {
        throw new Error("CODEX_APP_SERVER_CLOSED");
      }

      const requestId = String(this.nextRequestId++);

      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.closeLogicalTransport(transportId, state, new Error("SERVER_TIMEOUT"));
        }, this.requestTimeoutMs);

        state.pendingResponses.set(requestId, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          }
        });

        this.sendMessage({
          type: "transport_request",
          transportId,
          requestId,
          method,
          ...input
        }).catch((error) => {
          clearTimeout(timeout);
          state.pendingResponses.delete(requestId);
          reject(error);
        });
      });
    };

    return {
      async initialize() {
        await request("initialize");
      },
      async forkThread(providerSessionId) {
        const result = await request("forkThread", {
          providerSessionId
        });
        return {
          providerSessionId: String(result.providerSessionId ?? providerSessionId),
          rawStoreRef: normalizeNullableString(result.rawStoreRef)
        };
      },
      async readThread(providerSessionId) {
        return await request("readThread", {
          providerSessionId
        });
      },
      async rollbackThread(providerSessionId, numTurns) {
        const result = await request("rollbackThread", {
          providerSessionId,
          numTurns
        });
        return {
          providerSessionId: String(result.providerSessionId ?? providerSessionId),
          rawStoreRef: normalizeNullableString(result.rawStoreRef)
        };
      },
      async resumeThreadFromHistory(input) {
        const result = await request("resumeThreadFromHistory", {
          providerSessionId: input.providerSessionId ?? undefined,
          workspacePath: input.workspacePath,
          history: input.history,
          model: input.model ?? null
        });
        return {
          providerSessionId: String(result.providerSessionId ?? ""),
          rawStoreRef: normalizeNullableString(result.rawStoreRef)
        };
      },
      close: () => {
        this.closeLogicalTransport(transportId, state, null);
      }
    };
  }

  createThreadControlTransport(): CodexThreadControlTransport {
    const transportId = String(this.nextTransportId++);
    const state: LogicalTransportState = {
      pendingResponses: new Map(),
      notificationHandler: () => undefined,
      serverRequestHandler: async () => {
        throw new Error("CODEX_APP_SERVER_REQUEST_NOT_SUPPORTED");
      },
      closeHandler: null,
      closed: false
    };

    this.transports.set(transportId, state);

    const request = async (
      method: Extract<ParentToHelperMessage, { type: "transport_request" }>["method"],
      input: {
        providerSessionId?: string;
      } = {}
    ): Promise<Record<string, unknown>> => {
      if (state.closed) {
        throw new Error("CODEX_APP_SERVER_CLOSED");
      }

      const requestId = String(this.nextRequestId++);

      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.closeLogicalTransport(transportId, state, new Error("SERVER_TIMEOUT"));
        }, this.requestTimeoutMs);

        state.pendingResponses.set(requestId, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          }
        });

        this.sendMessage({
          type: "transport_request",
          transportId,
          requestId,
          method,
          ...input
        }).catch((error) => {
          clearTimeout(timeout);
          state.pendingResponses.delete(requestId);
          reject(error);
        });
      });
    };

    return {
      async initialize() {
        await request("initialize");
      },
      async archiveThread(providerSessionId) {
        await request("archiveThread", {
          providerSessionId
        });
      },
      async unarchiveThread(providerSessionId) {
        await request("unarchiveThread", {
          providerSessionId
        });
      },
      async readThread(providerSessionId) {
        return await request("readThread", {
          providerSessionId
        });
      },
      close: () => {
        this.closeLogicalTransport(transportId, state, null);
      }
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stdoutReader.close();
    this.child.kill("SIGTERM");
    this.failAll(new Error("Codex app-server helper 已关闭"));
  }

  private async handleMessageLine(line: string): Promise<void> {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{")) {
      console.warn(`[codex-app-server-helper] 忽略非协议输出: ${trimmed}`);
      return;
    }

    let message: HelperToParentMessage;

    try {
      message = JSON.parse(trimmed) as HelperToParentMessage;
    } catch (error) {
      console.warn("[codex-app-server-helper] 无法解析响应", error);
      return;
    }

    const state = this.transports.get(message.transportId);

    if (!state) {
      return;
    }

    switch (message.type) {
      case "response": {
        const pending = state.pendingResponses.get(message.requestId);

        if (!pending) {
          return;
        }

        state.pendingResponses.delete(message.requestId);

        if (message.ok) {
          pending.resolve(message.result);
          return;
        }

        pending.reject(new Error(message.error));
        return;
      }
      case "notification":
        await state.notificationHandler(message.notification);
        return;
      case "server_request":
        try {
          const result = await state.serverRequestHandler(message.request);
          await this.sendMessage({
            type: "server_request_result",
            transportId: message.transportId,
            requestId: message.requestId,
            ok: true,
            result
          });
        } catch (error) {
          await this.sendMessage({
            type: "server_request_result",
            transportId: message.transportId,
            requestId: message.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      case "transport_closed":
        state.closed = true;
        this.rejectTransportPending(state, new Error(message.detail ?? "CODEX_APP_SERVER_CLOSED"));
        this.notifyTransportClosed(
          state,
          message.detail ? new Error(message.detail) : null
        );
        this.transports.delete(message.transportId);
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

  private rejectTransportPending(state: LogicalTransportState, error: Error): void {
    for (const pending of state.pendingResponses.values()) {
      pending.reject(error);
    }
    state.pendingResponses.clear();
  }

  private closeLogicalTransport(
    transportId: string,
    state: LogicalTransportState,
    error: Error | null
  ): void {
    if (state.closed) {
      return;
    }

    state.closed = true;
    void this.sendMessage({
      type: "transport_request",
      transportId,
      requestId: String(this.nextRequestId++),
      method: "close"
    });
    this.rejectTransportPending(state, error ?? new Error("CODEX_APP_SERVER_CLOSED"));
    this.notifyTransportClosed(state, error);
    this.transports.delete(transportId);
  }

  private notifyTransportClosed(state: LogicalTransportState, error: Error | null): void {
    if (!state.closeHandler) {
      return;
    }

    try {
      state.closeHandler(error);
    } catch {
      return;
    }
  }

  private failAll(error: unknown): void {
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    for (const state of this.transports.values()) {
      state.closed = true;
      this.rejectTransportPending(state, normalizedError);
      this.notifyTransportClosed(state, normalizedError);
    }
    this.transports.clear();
  }
}

function resolveHelperLaunch(commandPath: string): { command: string; args: string[] } {
  const currentFilePath = fileURLToPath(import.meta.url);
  const extension = path.extname(currentFilePath);
  const helperPath = currentFilePath.replace(
    /codex-app-server-helper-client\.(ts|js)$/,
    `codex-app-server-helper-process${extension}`
  );
  const baseArgs = extension === ".ts" ? ["--import", "tsx", helperPath] : [helperPath];

  return {
    command: process.execPath,
    args: [...baseArgs, "--command-path", commandPath]
  };
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline, { createInterface } from "node:readline";

import type { ProviderRuntimeRunRequest, RuntimeSendOptions } from "@codingns/session-sync-core";
import { resolveCommandLaunch } from "../../shared/utils/command-launch.js";
import {
  buildCodexAppServerArgsWithWorkspaceOfficeMcp
} from "./workspace-office-mcp-config.js";

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
        | "setThreadName"
        | "listThreads"
        | "rollbackThread"
        | "resumeThreadFromHistory"
        | "startTurn"
        | "steerTurn"
        | "interruptTurn"
        | "close";
      request?: ProviderRuntimeRunRequest;
      options?: RuntimeSendOptions;
      providerSessionId?: string;
      name?: string;
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

interface PendingJsonRpcResponse {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason?: unknown) => void;
}

interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface TransportRecord {
  child: ChildProcessWithoutNullStreams;
  stdout: readline.Interface;
  pendingResponses: Map<string, PendingJsonRpcResponse>;
  pendingServerRequests: Map<string, PendingServerRequest>;
  closed: boolean;
  requestSequence: number;
  activeThreadId: string | null;
  activeTurnId: string | null;
}
const CODEX_APP_SERVER_REQUEST_TIMEOUT_MS = 20_000;

const helperArgs = process.argv.slice(2);
const rawCommandPath = readFlag(helperArgs, "--command-path");

if (!rawCommandPath) {
  throw new Error("CODEX_APP_SERVER_HELPER_COMMAND_PATH_REQUIRED");
}

const commandPath = rawCommandPath;

const transports = new Map<string, TransportRecord>();
const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

stdinReader.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  let message: ParentToHelperMessage;

  try {
    message = JSON.parse(line) as ParentToHelperMessage;
  } catch (error) {
    console.error("[codex-app-server-helper] 无法解析请求", error);
    return;
  }

  switch (message.type) {
    case "transport_request":
      await handleTransportRequest(message);
      return;
    case "server_request_result": {
      const transport = transports.get(message.transportId);

      if (!transport) {
        return;
      }

      const pending = transport.pendingServerRequests.get(message.requestId);

      if (!pending) {
        return;
      }

      transport.pendingServerRequests.delete(message.requestId);

      if (message.ok) {
        pending.resolve(message.result);
        return;
      }

      pending.reject(new Error(message.error));
    }
  }
}

async function handleTransportRequest(message: Extract<ParentToHelperMessage, { type: "transport_request" }>): Promise<void> {
  let transport = transports.get(message.transportId);

  if (!transport && message.method !== "close") {
    transport = createTransportRecord(commandPath);
    transports.set(message.transportId, transport);
  }

  if (!transport) {
    emitResponse(message.transportId, message.requestId, {});
    return;
  }

  try {
    switch (message.method) {
      case "initialize": {
        await sendJsonRpcRequest(transport, {
          method: "initialize",
          params: {
            clientInfo: {
              name: "codingns-runtime-helper",
              version: "0.0.0"
            },
            capabilities: {
              experimentalApi: true
            }
          }
        });
        writeJsonRpcMessage(transport.child, {
          jsonrpc: "2.0",
          method: "initialized",
          params: {}
        });
        emitResponse(message.transportId, message.requestId, {});
        return;
      }
      case "startThread": {
        const request = requireRequest(message.request);
        const result = await sendJsonRpcRequest(transport, {
          method: "thread/start",
          params: createThreadStartParams(request)
        });
        const thread = toRecord(result.thread);
        const providerSessionId = ensureText(thread?.id).trim();

        if (!providerSessionId) {
          throw new Error("CODEX_APP_SERVER_THREAD_ID_MISSING");
        }

        transport.activeThreadId = providerSessionId;
        emitResponse(message.transportId, message.requestId, {
          providerSessionId,
          rawStoreRef: normalizeText(thread?.path) || null
        });
        return;
      }
      case "resumeThread": {
        const request = requireRequest(message.request);
        const providerSessionId = ensureText(message.providerSessionId).trim();
        const result = await sendJsonRpcRequest(transport, {
          method: "thread/resume",
          params: createThreadResumeParams(request, providerSessionId)
        });
        const thread = toRecord(result.thread);
        transport.activeThreadId = ensureText(thread?.id).trim() || providerSessionId;
        emitResponse(message.transportId, message.requestId, {
          providerSessionId: transport.activeThreadId,
          rawStoreRef: normalizeText(thread?.path) || null
        });
        return;
      }
      case "startTurn": {
        const request = requireRequest(message.request);
        const providerSessionId = ensureText(message.providerSessionId).trim();
        const result = await sendJsonRpcRequest(transport, {
          method: "turn/start",
          params: createTurnStartParams(request, providerSessionId)
        });
        transport.activeTurnId =
          ensureText(readProp(readProp(result, "turn"), "id")).trim() || transport.activeTurnId;
        emitResponse(message.transportId, message.requestId, {});
        return;
      }
      case "steerTurn": {
        const options = requireOptions(message.options);

        if (!transport.activeThreadId || !transport.activeTurnId) {
          throw new Error("SESSION_NOT_RUNNING");
        }

        try {
          const result = await sendJsonRpcRequest(transport, {
            method: "turn/steer",
            params: createTurnSteerParams(
              transport.activeThreadId,
              transport.activeTurnId,
              options
            )
          });
          const turnId = ensureText(readProp(result, "turnId")).trim() || transport.activeTurnId;
          transport.activeTurnId = turnId;
          emitResponse(message.transportId, message.requestId, {
            turnId
          });
          return;
        } catch (error) {
          throw normalizeCodexTurnSteerError(error);
        }
      }
      case "forkThread": {
        const providerSessionId = ensureText(message.providerSessionId).trim();

        if (!providerSessionId) {
          throw new Error("CODEX_APP_SERVER_THREAD_ID_REQUIRED");
        }

        const result = await sendJsonRpcRequest(transport, {
          method: "thread/fork",
          params: {
            threadId: providerSessionId
          }
        });
        const thread = toRecord(result.thread);
        const forkedProviderSessionId = ensureText(thread?.id).trim();

        if (!forkedProviderSessionId) {
          throw new Error("CODEX_APP_SERVER_THREAD_ID_MISSING");
        }

        transport.activeThreadId = forkedProviderSessionId;
        emitResponse(message.transportId, message.requestId, {
          providerSessionId: forkedProviderSessionId,
          rawStoreRef: normalizeText(thread?.path) || null
        });
        return;
      }
      case "archiveThread": {
        const providerSessionId = ensureText(message.providerSessionId).trim();

        if (!providerSessionId) {
          throw new Error("CODEX_APP_SERVER_THREAD_ID_REQUIRED");
        }

        await sendJsonRpcRequest(transport, {
          method: "thread/archive",
          params: {
            threadId: providerSessionId
          }
        });
        emitResponse(message.transportId, message.requestId, {});
        return;
      }
      case "unarchiveThread": {
        const providerSessionId = ensureText(message.providerSessionId).trim();

        if (!providerSessionId) {
          throw new Error("CODEX_APP_SERVER_THREAD_ID_REQUIRED");
        }

        await sendJsonRpcRequest(transport, {
          method: "thread/unarchive",
          params: {
            threadId: providerSessionId
          }
        });
        emitResponse(message.transportId, message.requestId, {});
        return;
      }
      case "readThread": {
        const providerSessionId = ensureText(message.providerSessionId).trim();

        if (!providerSessionId) {
          throw new Error("CODEX_APP_SERVER_THREAD_ID_REQUIRED");
        }

        const result = await sendJsonRpcRequest(transport, {
          method: "thread/read",
          params: {
            threadId: providerSessionId,
            includeTurns: true
          }
        });
        emitResponse(message.transportId, message.requestId, result);
        return;
      }
      case "setThreadName": {
        const providerSessionId = ensureText(message.providerSessionId).trim();
        const name = ensureText(message.name).trim();

        if (!providerSessionId) {
          throw new Error("CODEX_APP_SERVER_THREAD_ID_REQUIRED");
        }

        if (!name) {
          throw new Error("CODEX_APP_SERVER_THREAD_NAME_REQUIRED");
        }

        await sendJsonRpcRequest(transport, {
          method: "thread/name/set",
          params: {
            threadId: providerSessionId,
            name
          }
        });
        emitResponse(message.transportId, message.requestId, {});
        return;
      }
      case "listThreads": {
        const workspacePath = ensureText(message.workspacePath).trim();

        if (!workspacePath) {
          throw new Error("CODEX_APP_SERVER_WORKSPACE_PATH_REQUIRED");
        }

        const activeThreads = await listCodexThreads(transport, workspacePath, false);
        const archivedThreads = await listCodexThreads(transport, workspacePath, true)
          .catch(() => []);

        emitResponse(message.transportId, message.requestId, {
          data: [...activeThreads, ...archivedThreads]
        });
        return;
      }
      case "rollbackThread": {
        const providerSessionId = ensureText(message.providerSessionId).trim();
        const numTurns = Math.trunc(Number(message.numTurns ?? 0));

        if (!providerSessionId) {
          throw new Error("CODEX_APP_SERVER_THREAD_ID_REQUIRED");
        }

        if (!Number.isFinite(numTurns) || numTurns < 1) {
          throw new Error("CODEX_APP_SERVER_ROLLBACK_TURNS_REQUIRED");
        }

        const result = await sendJsonRpcRequest(transport, {
          method: "thread/rollback",
          params: {
            threadId: providerSessionId,
            numTurns
          }
        });
        const thread = toRecord(result.thread);
        const rolledProviderSessionId = ensureText(thread?.id).trim() || providerSessionId;
        transport.activeThreadId = rolledProviderSessionId;
        emitResponse(message.transportId, message.requestId, {
          providerSessionId: rolledProviderSessionId,
          rawStoreRef: normalizeText(thread?.path) || null
        });
        return;
      }
      case "resumeThreadFromHistory": {
        const workspacePath = ensureText(message.workspacePath).trim();
        const providerSessionId = ensureText(message.providerSessionId).trim() || null;
        const history = Array.isArray(message.history) ? message.history : null;

        if (!workspacePath) {
          throw new Error("CODEX_APP_SERVER_WORKSPACE_PATH_REQUIRED");
        }

        if (!history) {
          throw new Error("CODEX_APP_SERVER_HISTORY_REQUIRED");
        }

        const result = await sendJsonRpcRequest(transport, {
          method: "thread/resume",
          params: createThreadResumeWithHistoryParams(
            providerSessionId,
            workspacePath,
            history,
            normalizeText(message.model)
          )
        });
        const thread = toRecord(result.thread);
        const resumedProviderSessionId = ensureText(thread?.id).trim();

        if (!resumedProviderSessionId) {
          throw new Error("CODEX_APP_SERVER_THREAD_ID_MISSING");
        }

        transport.activeThreadId = resumedProviderSessionId;
        emitResponse(message.transportId, message.requestId, {
          providerSessionId: resumedProviderSessionId,
          rawStoreRef: normalizeText(thread?.path) || null
        });
        return;
      }
      case "interruptTurn": {
        if (transport.activeThreadId && transport.activeTurnId) {
          await sendJsonRpcRequest(transport, {
            method: "turn/interrupt",
            params: {
              threadId: transport.activeThreadId,
              turnId: transport.activeTurnId
            }
          });
        }
        emitResponse(message.transportId, message.requestId, {});
        return;
      }
      case "close":
        closeTransport(message.transportId, transport, null);
        emitResponse(message.transportId, message.requestId, {});
    }
  } catch (error) {
    emitError(message.transportId, message.requestId, error instanceof Error ? error.message : String(error));
  }
}

function createTransportRecord(commandPath: string): TransportRecord {
  const launch = resolveCommandLaunch(commandPath, buildCodexAppServerArgsWithWorkspaceOfficeMcp(process.env));
  const child = spawn(launch.command, launch.args, {
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: launch.shell,
    windowsHide: true
  });
  const stdout = createInterface({
    input: child.stdout
  });
  const transport: TransportRecord = {
    child,
    stdout,
    pendingResponses: new Map(),
    pendingServerRequests: new Map(),
    closed: false,
    requestSequence: 0,
    activeThreadId: null,
    activeTurnId: null
  };

  child.on("error", (error) => {
    closeTransportForRecord(transport, error);
  });
  child.on("exit", (code, signal) => {
    if (transport.closed) {
      return;
    }

    const detail = signal
      ? `codex app-server exited with signal ${signal}`
      : `codex app-server exited with code ${String(code ?? "unknown")}`;
    closeTransportForRecord(transport, new Error(detail));
  });

  stdout.on("line", (line) => {
    void handleTransportStdout(transport, line);
  });

  return transport;
}

async function handleTransportStdout(transport: TransportRecord, line: string): Promise<void> {
  const trimmed = line.trim();

  if (!trimmed) {
    return;
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return;
  }

  const transportId = findTransportId(transport);

  if (!transportId) {
    return;
  }

  if (typeof parsed.method === "string" && parsed.id !== undefined) {
    const requestId = String(parsed.id);
    const result = await new Promise<unknown>((resolve, reject) => {
      transport.pendingServerRequests.set(requestId, {
        resolve,
        reject
      });
      emit({
        type: "server_request",
        transportId,
        requestId,
        request: parsed
      });
    }).catch((error) => {
      writeJsonRpcMessage(transport.child, {
        jsonrpc: "2.0",
        id: parsed.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "CODEX_APP_SERVER_REQUEST_FAILED"
        }
      });
      return undefined;
    });

    if (result !== undefined) {
      writeJsonRpcMessage(transport.child, {
        jsonrpc: "2.0",
        id: parsed.id,
        result
      });
    }
    return;
  }

  if (typeof parsed.method === "string") {
    const method = parsed.method.trim();
    const params = readJsonRpcParams(parsed);

    if (method === "turn/started") {
      transport.activeTurnId =
        ensureText(readProp(readProp(params, "turn"), "id")).trim() || transport.activeTurnId;
    }

    if (method === "thread/started") {
      transport.activeThreadId =
        ensureText(readProp(readProp(params, "thread"), "id")).trim() || transport.activeThreadId;
    }

    emit({
      type: "notification",
      transportId,
      notification: {
        method,
        params
      }
    });
    return;
  }

  const responseId = String(parsed.id ?? "");
  const pending = transport.pendingResponses.get(responseId);

  if (!pending) {
    return;
  }

  transport.pendingResponses.delete(responseId);

  if (parsed.error && typeof parsed.error === "object") {
    const message =
      ensureText(readProp(parsed.error, "message")).trim() || "CODEX_APP_SERVER_ERROR";
    pending.reject(new Error(message));
    return;
  }

  pending.resolve(readJsonRpcResult(parsed));
}

function sendJsonRpcRequest(
  transport: TransportRecord,
  message: {
    method: string;
    params: Record<string, unknown>;
  }
): Promise<Record<string, unknown>> {
  const id = `${message.method}:${++transport.requestSequence}`;

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      transport.pendingResponses.delete(id);
      const timeoutError = new Error("SERVER_TIMEOUT");
      const transportId = findTransportId(transport);

      if (transportId) {
        closeTransport(transportId, transport, timeoutError);
      } else {
        closeTransportForRecord(transport, timeoutError);
      }

      reject(timeoutError);
    }, CODEX_APP_SERVER_REQUEST_TIMEOUT_MS);

    transport.pendingResponses.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        reject(reason);
      }
    });
    writeJsonRpcMessage(transport.child, {
      jsonrpc: "2.0",
      id,
      method: message.method,
      params: message.params
    });
  });
}

async function listCodexThreads(
  transport: TransportRecord,
  workspacePath: string,
  archived: boolean
): Promise<unknown[]> {
  const threads: unknown[] = [];
  let cursor: string | null = null;

  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const result = await sendJsonRpcRequest(transport, {
      method: "thread/list",
      params: {
        limit: 200,
        sortKey: "updated_at",
        sortDirection: "desc",
        cwd: workspacePath,
        sourceKinds: ["vscode", "appServer", "subAgent", "subAgentThreadSpawn"],
        archived,
        ...(cursor ? { cursor } : {})
      }
    });
    const data = readProp(result, "data");

    if (Array.isArray(data)) {
      threads.push(...data);
    }

    cursor = ensureText(readProp(result, "nextCursor")).trim() || null;

    if (!cursor) {
      break;
    }
  }

  return threads;
}

function writeJsonRpcMessage(
  child: ChildProcessWithoutNullStreams,
  payload: Record<string, unknown>
): void {
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function closeTransport(transportId: string, transport: TransportRecord, error: Error | null): void {
  closeTransportForRecord(transport, error);
  transports.delete(transportId);
  emit({
    type: "transport_closed",
    transportId,
    detail: error?.message ?? null
  });
}

function closeTransportForRecord(transport: TransportRecord, error: Error | null): void {
  if (transport.closed) {
    return;
  }

  transport.closed = true;
  transport.stdout.close();
  for (const pending of transport.pendingResponses.values()) {
    pending.reject(error ?? new Error("CODEX_APP_SERVER_CLOSED"));
  }
  transport.pendingResponses.clear();
  for (const pending of transport.pendingServerRequests.values()) {
    pending.reject(error ?? new Error("CODEX_APP_SERVER_CLOSED"));
  }
  transport.pendingServerRequests.clear();

  if (!transport.child.stdin.destroyed) {
    transport.child.stdin.end();
  }
  if (!transport.child.killed) {
    transport.child.kill("SIGTERM");
  }
}

function emitResponse(transportId: string, requestId: string, result: Record<string, unknown>): void {
  emit({
    type: "response",
    transportId,
    requestId,
    ok: true,
    result
  });
}

function emitError(transportId: string, requestId: string, error: string): void {
  emit({
    type: "response",
    transportId,
    requestId,
    ok: false,
    error
  });
}

function emit(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function findTransportId(target: TransportRecord): string | null {
  for (const [transportId, transport] of transports) {
    if (transport === target) {
      return transportId;
    }
  }

  return null;
}

function readFlag(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);

  if (index < 0) {
    return null;
  }

  return argv[index + 1] ?? null;
}

function requireRequest(request: ProviderRuntimeRunRequest | undefined): ProviderRuntimeRunRequest {
  if (!request) {
    throw new Error("CODEX_APP_SERVER_REQUEST_REQUIRED");
  }

  return request;
}

function requireOptions(options: RuntimeSendOptions | undefined): RuntimeSendOptions {
  if (!options) {
    throw new Error("CODEX_APP_SERVER_OPTIONS_REQUIRED");
  }

  return options;
}

function createThreadStartParams(request: ProviderRuntimeRunRequest): Record<string, unknown> {
  const permissionOptions = createCodexThreadPermissionOptions(
    request.options.permissionMode ?? "default"
  );
  const params: Record<string, unknown> = {
    cwd: request.workspacePath,
    approvalsReviewer: "user"
  };

  if (permissionOptions.approvalPolicy) {
    params.approvalPolicy = permissionOptions.approvalPolicy;
  }

  if (permissionOptions.sandbox) {
    params.sandbox = permissionOptions.sandbox;
  }

  if (request.options.model) {
    params.model = request.options.model;
  }

  return params;
}

function createThreadResumeParams(
  request: ProviderRuntimeRunRequest,
  providerSessionId: string
): Record<string, unknown> {
  const permissionOptions = createCodexThreadPermissionOptions(
    request.options.permissionMode ?? "default"
  );
  const params: Record<string, unknown> = {
    threadId: providerSessionId,
    cwd: request.workspacePath,
    approvalsReviewer: "user"
  };

  if (permissionOptions.approvalPolicy) {
    params.approvalPolicy = permissionOptions.approvalPolicy;
  }

  if (permissionOptions.sandbox) {
    params.sandbox = permissionOptions.sandbox;
  }

  if (request.options.model) {
    params.model = request.options.model;
  }

  return params;
}

function createThreadResumeWithHistoryParams(
  providerSessionId: string | null,
  workspacePath: string,
  history: unknown[],
  model: string | null
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    threadId:
      providerSessionId && providerSessionId.trim().length > 0
        ? providerSessionId.trim()
        : "__history_resume__",
    cwd: workspacePath,
    history,
    approvalsReviewer: "user"
  };

  if (model) {
    params.model = model;
  }

  return params;
}

function createTurnStartParams(
  request: ProviderRuntimeRunRequest,
  providerSessionId: string
): Record<string, unknown> {
  const permissionOptions = createCodexThreadPermissionOptions(
    request.options.permissionMode ?? "default"
  );
  const params: Record<string, unknown> = {
    threadId: providerSessionId,
    input: createCodexAppServerInput(request),
    cwd: request.workspacePath,
    approvalsReviewer: "user"
  };

  if (permissionOptions.approvalPolicy) {
    params.approvalPolicy = permissionOptions.approvalPolicy;
  }

  if (permissionOptions.sandboxPolicy) {
    params.sandboxPolicy = permissionOptions.sandboxPolicy;
  }

  if (request.options.model) {
    params.model = request.options.model;
  }

  const reasoningEffort = normalizeCodexReasoningEffort(request.options.reasoningLevel);

  if (reasoningEffort) {
    params.effort = reasoningEffort;
  }

  return params;
}

function createTurnSteerParams(
  providerSessionId: string,
  activeTurnId: string,
  options: RuntimeSendOptions
): Record<string, unknown> {
  return {
    threadId: providerSessionId,
    expectedTurnId: activeTurnId,
    input: createCodexAppServerInputFromOptions(options)
  };
}

function createCodexAppServerInput(
  request: ProviderRuntimeRunRequest
): Array<Record<string, unknown>> {
  return createCodexAppServerInputFromOptions(request.options);
}

function createCodexAppServerInputFromOptions(
  options: Pick<RuntimeSendOptions, "content" | "providerPrompt" | "attachments">
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  const promptText = (options.providerPrompt ?? options.content).trim();

  if (promptText.length > 0) {
    input.push({
      type: "text",
      text: promptText
    });
  }

  for (const attachment of options.attachments) {
    if (attachment.kind !== "image") {
      continue;
    }

    input.push({
      type: "localImage",
      path: attachment.filePath
    });
  }

  return input;
}

function normalizeCodexTurnSteerError(error: unknown): Error {
  const detail = error instanceof Error ? error.message.trim() : String(error).trim();
  const normalized = detail.toLowerCase();

  if (
    normalized.includes("method not found")
    || (normalized.includes("turn/steer") && normalized.includes("not found"))
    || normalized.includes("unknown method")
  ) {
    return new Error("IN_RUN_INPUT_NOT_SUPPORTED");
  }

  if (
    normalized.includes("expectedturnid")
    || normalized.includes("active turn")
    || normalized.includes("turn mismatch")
    || normalized.includes("no active turn")
    || normalized.includes("not running")
  ) {
    return new Error("SESSION_NOT_RUNNING");
  }

  return error instanceof Error ? error : new Error(detail || "CODEX_TURN_STEER_FAILED");
}

function createCodexThreadPermissionOptions(
  permissionMode: string | null
): {
  approvalPolicy?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  sandboxPolicy?: {
    mode: "read-only" | "workspace-write" | "danger-full-access";
  };
} {
  if (permissionMode === "bypassPermissions") {
    return {
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      sandboxPolicy: {
        mode: "danger-full-access"
      }
    };
  }

  if (permissionMode === "acceptEdits") {
    return {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      sandboxPolicy: {
        mode: "workspace-write"
      }
    };
  }

  return {};
}

function normalizeCodexReasoningEffort(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? null;

  if (!normalized) {
    return null;
  }

  if (normalized === "maximum") {
    return "xhigh";
  }

  if (
    normalized === "minimal" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh"
  ) {
    return normalized;
  }

  return null;
}

function readJsonRpcParams(message: Record<string, unknown>): Record<string, unknown> {
  return toRecord(message.params) ?? {};
}

function readJsonRpcResult(message: Record<string, unknown>): Record<string, unknown> {
  return toRecord(message.result) ?? {};
}

function readProp(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function ensureText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeText(value: unknown): string | null {
  const text = ensureText(value).trim();
  return text.length > 0 ? text : null;
}

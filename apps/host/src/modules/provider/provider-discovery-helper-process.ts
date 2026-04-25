import { spawn } from "node:child_process";
import readline, { createInterface } from "node:readline";

import {
  type ProviderSessionSummary
} from "@codingns/session-sync-core";

import { resolveCommandLaunch } from "../../shared/utils/command-launch.js";
import type { ProviderSessionDiscoveryHelperConfig } from "./provider-discovery-helper-client.js";
import {
  discoverWorkspaceSessionsInRuntime,
  readSessionTitleInRuntime
} from "./provider-discovery-runtime.js";

type HelperRequest =
  | {
      id: string;
      type: "codex_app_server_state";
      commandPath: string;
      timeoutMs: number;
    }
  | {
      id: string;
      type: "opencode_cli_models";
      commandPath: string;
      workspacePath: string | null;
      timeoutMs: number;
    }
  | {
      id: string;
      type: "workspace_session_discovery";
      config: ProviderSessionDiscoveryHelperConfig;
      workspacePath: string;
      knownSessions: ProviderSessionSummary[];
    }
  | {
      id: string;
      type: "session_title_read";
      config: ProviderSessionDiscoveryHelperConfig;
      provider: string;
      providerSessionId: string;
      rawStoreRef: string;
    }
  | {
      id: string;
      type: "cancel";
      targetId: string;
    };

const activeRequests = new Map<string, AbortController>();
const PROVIDER_HELPER_RSS_HIGH_WATER_BYTES = 768 * 1024 * 1024;
const PROVIDER_HELPER_IDLE_EXIT_MS = 5_000;
let idleExitTimer: NodeJS.Timeout | null = null;

// helper 启动后立刻进入空闲计时，避免“只创建不请求”的僵尸进程常驻。
scheduleIdleExit();

const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

stdinReader.on("line", (line) => {
  void handleLine(line);
});

stdinReader.on("close", () => {
  clearIdleExitTimer();
  process.exit(0);
});

async function handleLine(line: string): Promise<void> {
  clearIdleExitTimer();
  let payload: HelperRequest;

  try {
    payload = JSON.parse(line) as HelperRequest;
  } catch {
    return;
  }

  try {
    if (payload.type === "cancel") {
      activeRequests.get(payload.targetId)?.abort(new Error("provider discovery helper aborted"));
      return;
    }

    const controller = new AbortController();
    activeRequests.set(payload.id, controller);

    switch (payload.type) {
      case "codex_app_server_state": {
        const result = await readCodexAppServerState(
          payload.commandPath,
          payload.timeoutMs,
          controller.signal
        );
        emitResult(payload.id, result);
        return;
      }
      case "opencode_cli_models": {
        const result = await readOpenCodeCliModels(
          payload.commandPath,
          payload.workspacePath,
          payload.timeoutMs,
          controller.signal
        );
        emitResult(payload.id, result);
        return;
      }
      case "workspace_session_discovery": {
        const result = await discoverWorkspaceSessions(
          payload.config,
          payload.workspacePath,
          payload.knownSessions,
          controller.signal
        );
        emitResult(payload.id, result);
        return;
      }
      case "session_title_read": {
        const result = await readSessionTitle(
          payload.config,
          payload.provider,
          payload.providerSessionId,
          payload.rawStoreRef,
          controller.signal
        );
        emitResult(payload.id, result);
        return;
      }
    }
  } catch (error) {
    emitError(payload.id, error instanceof Error ? error.message : String(error));
  } finally {
    if ("targetId" in payload) {
      scheduleIdleExit();
      return;
    }

    activeRequests.delete(payload.id);
    maybeRecycleProcess();
    scheduleIdleExit();
  }
}

function emitResult(id: string, result: unknown): void {
  process.stdout.write(
    `${JSON.stringify({
      type: "result",
      id,
      ok: true,
      result
    })}\n`
  );
}

function emitError(id: string, error: string): void {
  process.stdout.write(
    `${JSON.stringify({
      type: "result",
      id,
      ok: false,
      error
    })}\n`
  );
}

function maybeRecycleProcess(): void {
  if (activeRequests.size > 0) {
    return;
  }

  if (process.memoryUsage.rss() < PROVIDER_HELPER_RSS_HIGH_WATER_BYTES) {
    return;
  }

  process.stderr.write(
    `[provider-discovery-helper] rss 高水位回收，rss=${process.memoryUsage.rss()}\n`
  );
  setImmediate(() => {
    process.exit(0);
  });
}

function scheduleIdleExit(): void {
  if (activeRequests.size > 0) {
    return;
  }

  clearIdleExitTimer();
  idleExitTimer = setTimeout(() => {
    if (activeRequests.size === 0) {
      process.exit(0);
    }
  }, PROVIDER_HELPER_IDLE_EXIT_MS);
  idleExitTimer.unref?.();
}

function clearIdleExitTimer(): void {
  if (!idleExitTimer) {
    return;
  }

  clearTimeout(idleExitTimer);
  idleExitTimer = null;
}

async function readCodexAppServerState(
  commandPath: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{
  config: {
    model: string | null;
    modelReasoningEffort: string | null;
  };
  models: Array<Record<string, unknown>>;
}> {
  return await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("provider discovery helper aborted"));
      return;
    }

    const launch = resolveCommandLaunch(commandPath, ["app-server"]);
    const child = spawn(launch.command, launch.args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: launch.shell,
      windowsHide: true
    });
    const stdout = createInterface({
      input: child.stdout
    });
    const stderrChunks: string[] = [];
    let settled = false;
    let onAbort: (() => void) | null = null;
    let configResult: { model: string | null; modelReasoningEffort: string | null } | null = null;
    let modelResult: Array<Record<string, unknown>> | null = null;
    const timeout = setTimeout(() => {
      finishWithError(new Error("CODEX_APP_SERVER_TIMEOUT"));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      stdout.close();

      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }

      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }

    function finishWithError(error: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    function finishWithValue(value: {
      config: {
        model: string | null;
        modelReasoningEffort: string | null;
      };
      models: Array<Record<string, unknown>>;
    }): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(value);
    }

    child.on("error", (error) => {
      finishWithError(error);
    });

    if (signal) {
      onAbort = () => {
        finishWithError(signal.reason instanceof Error ? signal.reason : new Error("provider discovery helper aborted"));
      };

      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk.toString("utf8"));
    });

    child.on("exit", (code) => {
      if (settled) {
        return;
      }

      const stderr = stderrChunks.join("").trim();
      const detail = stderr || `codex app-server exited with code ${code ?? "unknown"}`;
      finishWithError(new Error(detail));
    });

    stdout.on("line", (line) => {
      const trimmed = line.trim();

      if (!trimmed.length) {
        return;
      }

      let parsed: Record<string, unknown>;

      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }

      const responseId = String(parsed.id ?? "");

      if (parsed.error && typeof parsed.error === "object") {
        const message = normalizeText((parsed.error as { message?: unknown }).message);

        if (responseId === "config.read" || responseId === "model.list") {
          finishWithError(new Error(message ?? `CODEX_APP_SERVER_${responseId}_FAILED`));
        }
        return;
      }

      if (responseId === "config.read") {
        const result = normalizeCodexConfigReadResult(parsed.result);

        if (!result) {
          finishWithError(new Error("CODEX_CONFIG_READ_INVALID"));
          return;
        }

        configResult = result;
      } else if (responseId === "model.list") {
        const result = normalizeCodexModelListResult(parsed.result);

        if (!result) {
          finishWithError(new Error("CODEX_MODEL_LIST_INVALID"));
          return;
        }

        modelResult = result;
      }

      if (configResult && modelResult) {
        finishWithValue({
          config: configResult,
          models: modelResult
        });
      }
    });

    const requests = [
      {
        jsonrpc: "2.0",
        id: "initialize",
        method: "initialize",
        params: {
          clientInfo: {
            name: "codingns-host",
            version: "0.0.0"
          },
          capabilities: null
        }
      },
      {
        jsonrpc: "2.0",
        method: "initialized",
        params: {}
      },
      {
        jsonrpc: "2.0",
        id: "config.read",
        method: "config/read",
        params: {}
      },
      {
        jsonrpc: "2.0",
        id: "model.list",
        method: "model/list",
        params: {
          includeHidden: false,
          limit: 100
        }
      }
    ];

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
  });
}

async function readOpenCodeCliModels(
  commandPath: string,
  workspacePath: string | null,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string[]> {
  return await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("provider discovery helper aborted"));
      return;
    }

    const launch = resolveCommandLaunch(commandPath, ["models"]);
    const child = spawn(launch.command, launch.args, {
      cwd: workspacePath ?? undefined,
      env: {
        ...process.env,
        NO_COLOR: "1"
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: launch.shell,
      windowsHide: true
    });
    const stdout = createInterface({
      input: child.stdout
    });
    const stderrChunks: string[] = [];
    const models: string[] = [];
    const seen = new Set<string>();
    let settled = false;
    let onAbort: (() => void) | null = null;
    const timeout = setTimeout(() => {
      finishWithError(new Error("OPENCODE_MODELS_TIMEOUT"));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      stdout.close();

      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }

      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }

    function finishWithError(error: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    function finishWithValue(value: string[]): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(value);
    }

    child.on("error", (error) => {
      finishWithError(error);
    });

    if (signal) {
      onAbort = () => {
        finishWithError(signal.reason instanceof Error ? signal.reason : new Error("provider discovery helper aborted"));
      };

      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk.toString("utf8"));
    });

    stdout.on("line", (line) => {
      const modelId = normalizeCliModelId(line);

      if (!modelId || seen.has(modelId)) {
        return;
      }

      seen.add(modelId);
      models.push(modelId);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      const stderr = stderrChunks.join("").trim();

      if (code !== 0) {
        finishWithError(new Error(stderr || `opencode models exited with code ${code ?? "unknown"}`));
        return;
      }

      if (!models.length) {
        finishWithError(new Error(stderr || "OPENCODE_MODELS_EMPTY"));
        return;
      }

      finishWithValue(models);
    });
  });
}

function normalizeCodexConfigReadResult(
  input: unknown
): { model: string | null; modelReasoningEffort: string | null } | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const result = input as {
    model?: unknown;
    model_reasoning_effort?: unknown;
  };

  return {
    model: normalizeText(result.model),
    modelReasoningEffort: normalizeText(result.model_reasoning_effort)
  };
}

function normalizeCodexModelListResult(input: unknown): Array<Record<string, unknown>> | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const data = (input as { data?: unknown }).data;

  if (!Array.isArray(data)) {
    return null;
  }

  return data.filter((entry): entry is Record<string, unknown> => {
    return !!entry && typeof entry === "object";
  });
}

function normalizeCliModelId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function discoverWorkspaceSessions(
  config: ProviderSessionDiscoveryHelperConfig,
  workspacePath: string,
  knownSessions: ProviderSessionSummary[],
  signal?: AbortSignal
): Promise<import("@codingns/session-sync-core").ProviderSessionDiscovery> {
  return await discoverWorkspaceSessionsInRuntime(config, workspacePath, knownSessions, signal);
}

async function readSessionTitle(
  config: ProviderSessionDiscoveryHelperConfig,
  provider: string,
  providerSessionId: string,
  rawStoreRef: string,
  signal?: AbortSignal
): Promise<string> {
  return await readSessionTitleInRuntime(
    config,
    provider,
    providerSessionId,
    rawStoreRef,
    signal
  );
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

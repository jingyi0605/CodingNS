import { spawn } from "node:child_process";
import readline, { createInterface } from "node:readline";

import {
  ClaudeCodeAdapter,
  CodexAdapter,
  GeminiAdapter,
  KimiAdapter,
  OpenCodeAdapter,
  ProviderRegistry,
  SessionSyncService,
  type ProviderSessionDiscovery,
  type ProviderSessionSummary
} from "@codingns/session-sync-core";

import { resolveCommandLaunch } from "../../shared/utils/command-launch.js";
import type { ProviderSessionDiscoveryHelperConfig } from "./provider-discovery-helper-client.js";

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
    };

let workspaceDiscoveryRuntime:
  | {
      cacheKey: string;
      service: SessionSyncService;
    }
  | null = null;

const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

stdinReader.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  let payload: HelperRequest;

  try {
    payload = JSON.parse(line) as HelperRequest;
  } catch {
    return;
  }

  try {
    switch (payload.type) {
      case "codex_app_server_state": {
        const result = await readCodexAppServerState(payload.commandPath, payload.timeoutMs);
        emitResult(payload.id, result);
        return;
      }
      case "opencode_cli_models": {
        const result = await readOpenCodeCliModels(
          payload.commandPath,
          payload.workspacePath,
          payload.timeoutMs
        );
        emitResult(payload.id, result);
        return;
      }
      case "workspace_session_discovery": {
        const result = await discoverWorkspaceSessions(
          payload.config,
          payload.workspacePath,
          payload.knownSessions
        );
        emitResult(payload.id, result);
        return;
      }
      case "session_title_read": {
        const result = await readSessionTitle(
          payload.config,
          payload.provider,
          payload.providerSessionId,
          payload.rawStoreRef
        );
        emitResult(payload.id, result);
        return;
      }
    }
  } catch (error) {
    emitError(payload.id, error instanceof Error ? error.message : String(error));
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

async function readCodexAppServerState(commandPath: string, timeoutMs: number): Promise<{
  config: {
    model: string | null;
    modelReasoningEffort: string | null;
  };
  models: Array<Record<string, unknown>>;
}> {
  return await new Promise((resolve, reject) => {
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
    let configResult: { model: string | null; modelReasoningEffort: string | null } | null = null;
    let modelResult: Array<Record<string, unknown>> | null = null;
    const timeout = setTimeout(() => {
      finishWithError(new Error("CODEX_APP_SERVER_TIMEOUT"));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      stdout.close();

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
  timeoutMs: number
): Promise<string[]> {
  return await new Promise((resolve, reject) => {
    const launch = resolveCommandLaunch(commandPath, ["models", "opencode"]);
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
    const timeout = setTimeout(() => {
      finishWithError(new Error("OPENCODE_MODELS_TIMEOUT"));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      stdout.close();

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
  knownSessions: ProviderSessionSummary[]
): Promise<ProviderSessionDiscovery> {
  const service = getWorkspaceDiscoveryService(config);
  return service.discoverWorkspaceSessions(workspacePath, {
    knownSessions
  });
}

async function readSessionTitle(
  config: ProviderSessionDiscoveryHelperConfig,
  provider: string,
  providerSessionId: string,
  rawStoreRef: string
): Promise<string> {
  const service = getWorkspaceDiscoveryService(config);
  return await service.readSessionTitle(provider, providerSessionId, rawStoreRef);
}

function getWorkspaceDiscoveryService(
  config: ProviderSessionDiscoveryHelperConfig
): SessionSyncService {
  const cacheKey = JSON.stringify(config);

  if (workspaceDiscoveryRuntime?.cacheKey === cacheKey) {
    return workspaceDiscoveryRuntime.service;
  }

  const registry = new ProviderRegistry([
    new ClaudeCodeAdapter({ homeDir: config.claudeCodeHomeDir }),
    new CodexAdapter({
      homeDir: config.codexHomeDir
    }),
    new GeminiAdapter({
      homeDir: config.geminiHomeDir,
      commandPath: config.geminiCliPath
    }),
    new KimiAdapter({
      homeDir: config.kimiHomeDir,
      defaultModel: config.kimiDefaultModel
    }),
    new OpenCodeAdapter({
      baseUrl: config.opencodeBaseUrl,
      dataDir: config.opencodeDataDir,
      dbPath: config.opencodeDbPath
    })
  ]);
  const service = new SessionSyncService(registry);

  workspaceDiscoveryRuntime = {
    cacheKey,
    service
  };

  return service;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

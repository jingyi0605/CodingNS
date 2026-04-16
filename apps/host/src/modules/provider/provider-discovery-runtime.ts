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

import type { ProviderSessionDiscoveryHelperConfig } from "./provider-discovery-helper-client.js";

let workspaceDiscoveryRuntime:
  | {
      cacheKey: string;
      service: SessionSyncService;
    }
  | null = null;

export async function discoverWorkspaceSessionsInRuntime(
  config: ProviderSessionDiscoveryHelperConfig,
  workspacePath: string,
  knownSessions: ProviderSessionSummary[],
  signal?: AbortSignal
): Promise<ProviderSessionDiscovery> {
  const service = getWorkspaceDiscoveryService(config);
  return await raceWithAbortSignal(
    service.discoverWorkspaceSessions(workspacePath, {
      knownSessions
    }),
    signal
  );
}

export async function readSessionTitleInRuntime(
  config: ProviderSessionDiscoveryHelperConfig,
  provider: string,
  providerSessionId: string,
  rawStoreRef: string,
  signal?: AbortSignal
): Promise<string> {
  const service = getWorkspaceDiscoveryService(config);
  return await raceWithAbortSignal(
    service.readSessionTitle(provider, providerSessionId, rawStoreRef),
    signal
  );
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

async function raceWithAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return await promise;
  }

  if (signal.aborted) {
    throw signal.reason ?? new Error("provider discovery helper aborted");
  }

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason ?? new Error("provider discovery helper aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

import {
  ClaudeCodeAdapter,
  CodexAdapter,
  GeminiAdapter,
  KimiAdapter,
  LegnaCodeAdapter,
  OpenCodeAdapter,
  ProviderRegistry,
  SessionSyncService,
  type ProviderSessionDiscovery,
  type ProviderSessionSummary
} from "@codingns/session-sync-core";

import type { ProviderSessionDiscoveryHelperConfig } from "./provider-discovery-helper-client.js";

const WORKSPACE_DISCOVERY_CACHE_MAX_AGE_MS = 5_000;
const SESSION_TITLE_CACHE_MAX_AGE_MS = 15_000;

let workspaceDiscoveryRuntime:
  | {
      cacheKey: string;
      service: SessionSyncService;
    }
  | null = null;

const workspaceDiscoveryCache = new Map<string, {
  knownSessionsSignature: string;
  cachedAt: number;
  result: ProviderSessionDiscovery;
}>();
const workspaceDiscoveryInflight = new Map<string, {
  knownSessionsSignature: string;
  promise: Promise<ProviderSessionDiscovery>;
}>();
const sessionTitleCache = new Map<string, {
  cachedAt: number;
  title: string;
}>();
const sessionTitleInflight = new Map<string, Promise<string>>();

export async function discoverWorkspaceSessionsInRuntime(
  config: ProviderSessionDiscoveryHelperConfig,
  workspacePath: string,
  knownSessions: ProviderSessionSummary[],
  enabledProviders: string[],
  signal?: AbortSignal
): Promise<ProviderSessionDiscovery> {
  const service = getWorkspaceDiscoveryService(config, enabledProviders);
  const runtimeKey = buildWorkspaceDiscoveryRuntimeKey(config, workspacePath, enabledProviders);
  const knownSessionsSignature = buildKnownSessionsSignature(knownSessions);
  const cached = workspaceDiscoveryCache.get(runtimeKey);

  if (
    cached &&
    cached.knownSessionsSignature === knownSessionsSignature &&
    Date.now() - cached.cachedAt <= WORKSPACE_DISCOVERY_CACHE_MAX_AGE_MS
  ) {
    return cached.result;
  }

  const inflight = workspaceDiscoveryInflight.get(runtimeKey);

  if (inflight && inflight.knownSessionsSignature === knownSessionsSignature) {
    return await raceWithAbortSignal(inflight.promise, signal);
  }

  const promise = service.discoverWorkspaceSessions(workspacePath, {
    knownSessions
  }).then((result) => {
    workspaceDiscoveryCache.set(runtimeKey, {
      knownSessionsSignature,
      cachedAt: Date.now(),
      result
    });
    return result;
  }).finally(() => {
    const active = workspaceDiscoveryInflight.get(runtimeKey);

    if (active?.promise === promise) {
      workspaceDiscoveryInflight.delete(runtimeKey);
    }
  });

  workspaceDiscoveryInflight.set(runtimeKey, {
    knownSessionsSignature,
    promise
  });

  return await raceWithAbortSignal(promise, signal);
}

export async function readSessionTitleInRuntime(
  config: ProviderSessionDiscoveryHelperConfig,
  provider: string,
  providerSessionId: string,
  rawStoreRef: string,
  signal?: AbortSignal
): Promise<string> {
  const service = getWorkspaceDiscoveryService(config);
  const runtimeKey = buildSessionTitleRuntimeKey(
    config,
    provider,
    providerSessionId,
    rawStoreRef
  );
  const cached = sessionTitleCache.get(runtimeKey);

  if (cached && Date.now() - cached.cachedAt <= SESSION_TITLE_CACHE_MAX_AGE_MS) {
    return cached.title;
  }

  const inflight = sessionTitleInflight.get(runtimeKey);

  if (inflight) {
    return await raceWithAbortSignal(inflight, signal);
  }

  const promise = service.readSessionTitle(provider, providerSessionId, rawStoreRef)
    .then((title) => {
      sessionTitleCache.set(runtimeKey, {
        cachedAt: Date.now(),
        title
      });
      return title;
    })
    .finally(() => {
      if (sessionTitleInflight.get(runtimeKey) === promise) {
        sessionTitleInflight.delete(runtimeKey);
      }
    });

  sessionTitleInflight.set(runtimeKey, promise);
  return await raceWithAbortSignal(promise, signal);
}

function getWorkspaceDiscoveryService(
  config: ProviderSessionDiscoveryHelperConfig,
  enabledProviders: string[] | null = null
): SessionSyncService {
  const cacheKey = buildRuntimeConfigCacheKey(config, enabledProviders);

  if (workspaceDiscoveryRuntime?.cacheKey === cacheKey) {
    return workspaceDiscoveryRuntime.service;
  }

  const enabledProviderSet = enabledProviders ? new Set(enabledProviders) : null;
  const registry = new ProviderRegistry([
    new ClaudeCodeAdapter({ homeDir: config.claudeCodeHomeDir }),
    new LegnaCodeAdapter({
      homeDir: config.legnaCodeHomeDir,
      legacyClaudeHomeDir: config.claudeCodeHomeDir
    }),
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
  ].filter((adapter) => !enabledProviderSet || enabledProviderSet.has(adapter.providerId)));
  const service = new SessionSyncService(registry);

  workspaceDiscoveryRuntime = {
    cacheKey,
    service
  };

  return service;
}

function buildWorkspaceDiscoveryRuntimeKey(
  config: ProviderSessionDiscoveryHelperConfig,
  workspacePath: string,
  enabledProviders: string[]
): string {
  return `${buildRuntimeConfigCacheKey(config, enabledProviders)}::${workspacePath}`;
}

function buildSessionTitleRuntimeKey(
  config: ProviderSessionDiscoveryHelperConfig,
  provider: string,
  providerSessionId: string,
  rawStoreRef: string
): string {
  return `${JSON.stringify(config)}::${provider}::${providerSessionId}::${rawStoreRef}`;
}

function buildRuntimeConfigCacheKey(
  config: ProviderSessionDiscoveryHelperConfig,
  enabledProviders: string[] | null = null
): string {
  return `${JSON.stringify(config)}::${enabledProviders ? [...enabledProviders].sort().join(",") : "*"}`;
}

function buildKnownSessionsSignature(knownSessions: ProviderSessionSummary[]): string {
  return JSON.stringify(
    [...knownSessions]
      .map((session) => ({
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        workspacePath: session.workspacePath,
        rawStoreRef: session.rawStoreRef,
        isArchived: session.isArchived ?? false,
        parentProviderSessionId: session.parentProviderSessionId ?? null,
        isSubagent: session.isSubagent ?? false,
        subagentLabel: session.subagentLabel ?? null,
        sourceMtimeMs: session.sourceMtimeMs ?? null,
        sourceSizeBytes: session.sourceSizeBytes ?? null
      }))
      .sort((left, right) =>
        `${left.provider}:${left.providerSessionId}:${left.rawStoreRef}`.localeCompare(
          `${right.provider}:${right.providerSessionId}:${right.rawStoreRef}`
        )
      )
  );
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

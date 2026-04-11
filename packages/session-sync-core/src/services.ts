import { ProviderRegistry } from "./registry.js";
import type {
  ContextUsageSnapshot,
  DetectSessionsOptions,
  ForkSessionOptions,
  ForkSessionResult,
  HistoryDirection,
  HistoryPage,
  ProviderCapabilities,
  ProviderArchiveUpdateResult,
  ProviderSessionDiscovery,
  ProviderRealtimeEvent,
  ProviderSubscription,
  ResumeSessionResult,
  SendMessageResult,
  StartSessionOptions,
  StartSessionResult
} from "./types.js";
export { ActiveRunRegistry } from "./runtime/active-run-registry.js";
export { ProviderRuntimeService } from "./runtime/provider-runtime-service.js";
export type {
  ActiveRunHandle,
  ActiveRunSnapshot,
  ProviderRuntimeAdapter,
  ProviderRuntimeLaunchResult,
  ProviderRuntimeRunRequest,
  RuntimeEvent,
  RuntimeEventInput,
  RuntimeEventListener,
  RuntimeRunState,
  RuntimeSendOptions,
  RuntimeSessionContext,
  RuntimeSessionView
} from "./runtime/types.js";

export class SessionSyncService {
  constructor(private readonly registry: ProviderRegistry) {}

  async discoverWorkspaceSessions(
    workspacePath: string,
    options?: DetectSessionsOptions
  ): Promise<ProviderSessionDiscovery> {
    const discoveries = await Promise.all(
      this.registry.list().map(async (provider) => {
        if (provider.detectSessionsDetailed) {
          return provider.detectSessionsDetailed(workspacePath, options);
        }

        return {
          sessions: await provider.detectSessions(workspacePath, options),
          isComplete: true
        } satisfies ProviderSessionDiscovery;
      })
    );

    return {
      sessions: discoveries
        .flatMap((discovery) => discovery.sessions)
        .sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? "")),
      isComplete: discoveries.every((discovery) => discovery.isComplete)
    };
  }

  async readHistory(
    providerId: string,
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward"
  ): Promise<HistoryPage> {
    return this.registry
      .get(providerId)
      .readSessionHistory(providerSessionId, rawStoreRef, cursor, limit, direction);
  }

  async readRecentHistory(
    providerId: string,
    providerSessionId: string,
    rawStoreRef: string,
    totalMessageCount: number,
    limit: number
  ): Promise<HistoryPage> {
    const provider = this.registry.get(providerId);
    const recentPage = await provider.readRecentSessionHistory?.(
      providerSessionId,
      rawStoreRef,
      totalMessageCount,
      limit
    );

    if (recentPage) {
      return recentPage;
    }

    return provider.readSessionHistory(providerSessionId, rawStoreRef, null, limit, "backward");
  }

  subscribe(
    providerId: string,
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    onEvent: (event: ProviderRealtimeEvent) => Promise<void> | void
  ): ProviderSubscription {
    return this.registry
      .get(providerId)
      .subscribeSession(providerSessionId, rawStoreRef, cursor, limit, onEvent);
  }

  async resumeSession(
    providerId: string,
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ResumeSessionResult> {
    return this.registry.get(providerId).resumeSession(providerSessionId, rawStoreRef);
  }

  async startSession(
    providerId: string,
    workspacePath: string,
    options: StartSessionOptions
  ): Promise<StartSessionResult> {
    return this.registry.get(providerId).startSession(workspacePath, options);
  }

  async forkSession(
    providerId: string,
    providerSessionId: string,
    workspacePath: string,
    options: ForkSessionOptions
  ): Promise<ForkSessionResult> {
    const provider = this.registry.get(providerId);

    if (!provider.forkSession) {
      throw new Error("PROVIDER_FORK_NOT_SUPPORTED");
    }

    return provider.forkSession(providerSessionId, workspacePath, options);
  }

  async sendMessage(
    providerId: string,
    providerSessionId: string,
    rawStoreRef: string,
    content: string,
    clientRequestId: string | null,
    permissionMode?: string | null
  ): Promise<SendMessageResult> {
    return this.registry
      .get(providerId)
      .sendMessage(providerSessionId, rawStoreRef, content, clientRequestId, permissionMode);
  }

  async readSessionTitle(
    providerId: string,
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<string> {
    return this.registry
      .get(providerId)
      .readSessionTitle(providerSessionId, rawStoreRef);
  }

  async renameSessionTitle(
    providerId: string,
    providerSessionId: string,
    rawStoreRef: string,
    title: string
  ): Promise<string> {
    return this.registry
      .get(providerId)
      .renameSessionTitle(providerSessionId, rawStoreRef, title);
  }

  async updateSessionArchiveState(
    providerId: string,
    providerSessionId: string,
    rawStoreRef: string,
    isArchived: boolean
  ): Promise<ProviderArchiveUpdateResult> {
    return this.registry
      .get(providerId)
      .updateSessionArchiveState(providerSessionId, rawStoreRef, isArchived);
  }

  async readContextUsage(
    providerId: string,
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ContextUsageSnapshot | null> {
    return this.registry.get(providerId).readContextUsage?.(providerSessionId, rawStoreRef) ?? null;
  }
}

export class CapabilityService {
  constructor(private readonly registry: ProviderRegistry) {}

  getProviderCapabilities(providerId: string): ProviderCapabilities {
    return this.registry.get(providerId).getProviderCapabilities();
  }

  async getSessionCapabilities(
    providerId: string,
    providerSessionId: string
  ): Promise<ProviderCapabilities> {
    return this.registry.get(providerId).getSessionCapabilities(providerSessionId);
  }
}

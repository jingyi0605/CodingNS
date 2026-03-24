import { ProviderRegistry } from "./registry.js";
import type {
  DetectSessionsOptions,
  HistoryDirection,
  HistoryPage,
  ProviderCapabilities,
  ProviderRealtimeEvent,
  ProviderSessionSummary,
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
  ): Promise<ProviderSessionSummary[]> {
    const sessions = await Promise.all(
      this.registry.list().map((provider) => provider.detectSessions(workspacePath, options))
    );

    return sessions
      .flat()
      .sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? ""));
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

  async sendMessage(
    providerId: string,
    providerSessionId: string,
    rawStoreRef: string,
    content: string,
    clientRequestId: string | null
  ): Promise<SendMessageResult> {
    return this.registry
      .get(providerId)
      .sendMessage(providerSessionId, rawStoreRef, content, clientRequestId);
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

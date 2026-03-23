import { ProviderRegistry } from "./registry.js";
import type {
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

export class SessionSyncService {
  constructor(private readonly registry: ProviderRegistry) {}

  async discoverWorkspaceSessions(workspacePath: string): Promise<ProviderSessionSummary[]> {
    const sessions = await Promise.all(
      this.registry.list().map((provider) => provider.detectSessions(workspacePath))
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
    limit: number
  ): Promise<HistoryPage> {
    return this.registry
      .get(providerId)
      .readSessionHistory(providerSessionId, rawStoreRef, cursor, limit);
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

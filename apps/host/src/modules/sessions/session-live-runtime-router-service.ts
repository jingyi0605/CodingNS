import type { ProviderSubscription } from "@codingns/session-sync-core";

import type {
  SessionHistoryEnvelope,
  SessionHistoryService
} from "./session-history-service.js";
import type {
  SessionLiveRuntimeService,
  SessionRuntimeEnvelope
} from "./session-live-runtime-service.js";

export type SessionRuntimeRouterServiceContract = Pick<
  SessionLiveRuntimeService,
  | "startLiveSession"
  | "sendLiveMessage"
  | "enqueueLiveMessage"
  | "getSessionRuntime"
  | "interruptSession"
  | "subscribeRuntime"
  | "listPermissionRequests"
  | "replyPermissionRequest"
  | "listQueuedMessages"
  | "deleteQueuedMessage"
  | "steerQueuedMessage"
  | "getClaudeHookBridgeConfig"
  | "ingestClaudeHookEvent"
  | "resolveLiveActivityObservation"
>;

export class SessionLiveRuntimeRouterService implements SessionRuntimeRouterServiceContract {
  private readonly services: readonly SessionRuntimeRouterServiceContract[];

  constructor(
    private readonly primaryService: SessionRuntimeRouterServiceContract,
    delegatedServices: readonly SessionRuntimeRouterServiceContract[]
  ) {
    this.services = [primaryService, ...delegatedServices];
  }

  readonly startLiveSession: SessionLiveRuntimeService["startLiveSession"] = async (input) =>
    this.primaryService.startLiveSession(input);

  readonly sendLiveMessage: SessionLiveRuntimeService["sendLiveMessage"] = async (input) =>
    this.resolveServiceForSession(input.sessionId).sendLiveMessage(input);

  readonly enqueueLiveMessage: SessionLiveRuntimeService["enqueueLiveMessage"] = async (input) =>
    this.resolveServiceForSession(input.sessionId).enqueueLiveMessage(input);

  readonly getSessionRuntime: SessionLiveRuntimeService["getSessionRuntime"] = async (sessionId, userId) =>
    this.resolveServiceForSession(sessionId).getSessionRuntime(sessionId, userId);

  readonly interruptSession: SessionLiveRuntimeService["interruptSession"] = async (sessionId, userId) =>
    this.resolveServiceForSession(sessionId).interruptSession(sessionId, userId);

  readonly subscribeRuntime = (
    sessionId: string,
    onEnvelope: (envelope: SessionRuntimeEnvelope | SessionHistoryEnvelope) => Promise<void> | void
  ): ProviderSubscription =>
    this.resolveServiceForSession(sessionId).subscribeRuntime(sessionId, onEnvelope);

  readonly listPermissionRequests: SessionLiveRuntimeService["listPermissionRequests"] = async (sessionId, userId) =>
    this.resolveServiceForSession(sessionId).listPermissionRequests(sessionId, userId);

  readonly replyPermissionRequest: SessionLiveRuntimeService["replyPermissionRequest"] = async (
    sessionId,
    userId,
    requestId,
    input
  ) => this.resolveServiceForSession(sessionId).replyPermissionRequest(sessionId, userId, requestId, input);

  readonly listQueuedMessages: SessionLiveRuntimeService["listQueuedMessages"] = async (sessionId, userId) =>
    this.resolveServiceForSession(sessionId).listQueuedMessages(sessionId, userId);

  readonly deleteQueuedMessage: SessionLiveRuntimeService["deleteQueuedMessage"] = async (
    sessionId,
    userId,
    queueItemId
  ) => this.resolveServiceForSession(sessionId).deleteQueuedMessage(sessionId, userId, queueItemId);

  readonly steerQueuedMessage: SessionLiveRuntimeService["steerQueuedMessage"] = async (
    sessionId,
    userId,
    queueItemId
  ) => this.resolveServiceForSession(sessionId).steerQueuedMessage(sessionId, userId, queueItemId);

  readonly getClaudeHookBridgeConfig: SessionLiveRuntimeService["getClaudeHookBridgeConfig"] = (provider) =>
    this.primaryService.getClaudeHookBridgeConfig(provider);

  readonly ingestClaudeHookEvent: SessionLiveRuntimeService["ingestClaudeHookEvent"] = async (
    providerOrPayload,
    payload
  ) => {
    const provider = typeof providerOrPayload === "string" ? providerOrPayload : null;

    for (const service of this.services) {
      const result = provider
        ? await service.ingestClaudeHookEvent(provider, payload)
        : await service.ingestClaudeHookEvent(providerOrPayload);

      if (!result.ignored || result.sessionId) {
        return result;
      }
    }

    return provider
      ? this.primaryService.ingestClaudeHookEvent(provider, payload)
      : this.primaryService.ingestClaudeHookEvent(providerOrPayload);
  };

  readonly resolveLiveActivityObservation: SessionLiveRuntimeService["resolveLiveActivityObservation"] = (sessionId) =>
    this.findOwningService(sessionId)?.resolveLiveActivityObservation(sessionId) ?? null;

  private resolveServiceForSession(sessionId: string): SessionRuntimeRouterServiceContract {
    return this.findOwningService(sessionId) ?? this.primaryService;
  }

  private findOwningService(sessionId: string): SessionRuntimeRouterServiceContract | null {
    for (const service of this.services) {
      if (service.resolveLiveActivityObservation(sessionId)) {
        return service;
      }
    }

    return null;
  }
}

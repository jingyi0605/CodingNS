import { useEffect, useState } from "react";

import { authStore } from "../../auth/store/auth-store";
import { RealtimeClient } from "../../../network/realtime-client";
import { t } from "../../../shared/i18n";
import {
  getSessionCapabilities,
  getSessionDetail,
  getSessionMessages,
  sendSessionMessage,
  type ProviderCapabilitiesDto
} from "../api/conversation-api";
import {
  createInitialRuntimeState,
  createPendingMessage,
  markPendingAsFailed,
  mergeAuthoritativeMessages,
  reconcileMessage,
  type RuntimeConnectionState,
  type SessionRuntimeState
} from "./session-runtime-machine";

type RuntimeListener = () => void;

export class SessionRuntimeStore {
  private state: SessionRuntimeState = createInitialRuntimeState();
  private listeners = new Set<RuntimeListener>();
  private realtimeClient: RealtimeClient | null = null;

  constructor(private readonly sessionId: string) {}

  subscribe = (listener: RuntimeListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  async initialize(): Promise<void> {
    this.patch({
      historyState: "loading",
      errorCode: null,
      errorDetail: null
    });

    try {
      const [session, capabilities] = await Promise.all([
        getSessionDetail(this.sessionId),
        getSessionCapabilities(this.sessionId)
      ]);

      this.patch({
        session,
        capabilities
      });

      await this.loadHistory();
      this.startRealtime();
    } catch (error) {
      this.handleError(error);
    }
  }

  async reload(): Promise<void> {
    this.realtimeClient?.close();
    this.realtimeClient = null;
    this.state = createInitialRuntimeState();
    this.emit();
    await this.initialize();
  }

  async sendMessage(content: string, options?: { model?: string; reasoningLevel?: string }): Promise<void> {
    const clientRequestId = crypto.randomUUID();
    const pending = createPendingMessage(this.sessionId, content, clientRequestId);

    this.patch({
      messages: [...this.state.messages, pending]
    });

    try {
      // TODO: Pass model and reasoningLevel to API when backend supports it
      const response = await sendSessionMessage(this.sessionId, {
        content,
        clientRequestId
      });

      this.patch({
        messages: reconcileMessage(this.state.messages, this.sessionId, response.message, clientRequestId)
      });
    } catch (error) {
      this.patch({
        messages: markPendingAsFailed(this.state.messages, clientRequestId)
      });
      throw error;
    }
  }

  async retryMessage(clientRequestId: string): Promise<void> {
    const target = this.state.messages.find((item) => item.clientRequestId === clientRequestId);

    if (!target) {
      return;
    }

    this.patch({
      messages: this.state.messages.map((item) =>
        item.clientRequestId === clientRequestId
          ? {
              ...item,
              deliveryState: "sending"
            }
          : item
      )
    });

    try {
      const response = await sendSessionMessage(this.sessionId, {
        content: target.content,
        clientRequestId
      });

      this.patch({
        messages: reconcileMessage(this.state.messages, this.sessionId, response.message, clientRequestId)
      });
    } catch (error) {
      this.patch({
        messages: markPendingAsFailed(this.state.messages, clientRequestId)
      });
      throw error;
    }
  }

  reconnect(): void {
    this.realtimeClient?.reconnectNow();
  }

  destroy(): void {
    this.realtimeClient?.close();
    this.realtimeClient = null;
  }

  private async loadHistory(): Promise<void> {
    let cursor: string | null = null;
    let nextCursor: string | null = null;
    let pagesLoaded = 0;
    let merged = this.state.messages;

    do {
      const page = await getSessionMessages(this.sessionId, cursor, 40);
      pagesLoaded += 1;
      merged = mergeAuthoritativeMessages(merged, this.sessionId, page.messages);
      cursor = page.nextCursor;
      nextCursor = page.cursor;
    } while (cursor);

    this.patch({
      messages: merged,
      historyState: "ready",
      lastCursor: nextCursor,
      pagesLoaded,
      errorCode: null,
      errorDetail: null
    });
  }

  private startRealtime(): void {
    const accessToken = authStore.getState().session?.accessToken;

    if (!accessToken) {
      authStore.clear();
      return;
    }

    this.realtimeClient = new RealtimeClient({
      sessionId: this.sessionId,
      cursor: this.state.lastCursor,
      limit: 40,
      onSubscribed: () => {
        this.patch({ connectionState: "connected" });
      },
      onConnectionChange: (connectionState) => {
        this.patch({ connectionState });
      },
      onEnvelope: (event) => {
        const merged = mergeAuthoritativeMessages(this.state.messages, this.sessionId, event.messages);
        this.patch({
          messages: merged,
          lastCursor: event.cursor
        });
        this.realtimeClient?.updateCursor(event.cursor);
      },
      onError: (event) => {
        this.patch({
          errorCode: event.error_code,
          errorDetail: event.detail
        });
      },
      onUnauthorized: () => {
        authStore.clear();
      }
    });
    this.realtimeClient.start();
  }

  private patch(input: Partial<SessionRuntimeState>): void {
    this.state = {
      ...this.state,
      ...input
    };
    this.emit();
  }

  private handleError(error: unknown): void {
    const detail = error instanceof Error ? error.message : "unknown";
    this.patch({
      historyState: "error",
      errorCode: "RUNTIME_INIT_FAILED",
      errorDetail: detail
    });
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function useSessionRuntimeStore<T>(
  store: SessionRuntimeStore,
  selector: (state: SessionRuntimeState) => T
) {
  const [value, setValue] = useState(() => selector(store.getState()));

  useEffect(() => {
    return store.subscribe(() => {
      setValue(selector(store.getState()));
    });
  }, [selector, store]);

  return value;
}

export function summarizeCapabilities(capabilities: ProviderCapabilitiesDto | null): string[] {
  if (!capabilities) {
    return [];
  }

  const summary: string[] = [];

  if (capabilities.canResumeSession) {
    summary.push(t("conversation.capabilityResume"));
  }

  if (capabilities.canSendMessage !== false) {
    summary.push(t("conversation.capabilitySend"));
  }

  if (capabilities.supportsInterrupt) {
    summary.push(t("conversation.capabilityInterrupt"));
  }

  if (capabilities.supportsStructuredToolCalls) {
    summary.push(t("conversation.capabilityTools"));
  }

  return summary;
}

export function connectionTone(state: RuntimeConnectionState) {
  return state;
}

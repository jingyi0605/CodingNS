import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { clientConfigStore } from "../../../config/client-config-store";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  getProviderCapabilities,
  startLiveSession,
  type HistoryMessageDto,
  type ProviderCapabilitiesDto,
  type ProviderId,
  type SessionSummaryDto
} from "../api/conversation-api";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ComposerPanel } from "../components/ComposerPanel";
import { MessageTimeline } from "../components/MessageTimeline";
import { QueuedMessageList } from "../components/QueuedMessageList";
import { SessionHeader } from "../components/SessionHeader";
import { useWorkbenchShell } from "../components/WorkbenchLayout";
import { SessionRuntimeStore, useSessionRuntimeStore } from "../runtime/session-runtime-store";
import {
  createPendingMessage,
  markPendingAsFailed,
  type SessionMessageViewModel
} from "../runtime/session-runtime-machine";
import {
  createDraftCapabilities as createProviderDraftCapabilities,
  getDraftTitle as getProviderDraftTitle,
  isDraftProviderSupported,
  shouldSupportRunSteering
} from "../capability/provider-ui";

const RUNTIME_TIMEOUT_TOAST_DELAY_MS = 15_000;

export function ConversationPage() {
  const { sessionId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const draftContext = useMemo(
    () => parseDraftContext(sessionId, searchParams),
    [searchParams, sessionId]
  );
  const liveBootstrapMessages = useMemo(
    () => parseLiveBootstrapMessages(sessionId, location.state),
    [location.state, sessionId]
  );

  if (draftContext) {
    return <DraftConversationPage draft={draftContext} navigate={navigate} />;
  }

  return <LiveConversationPage sessionId={sessionId} bootstrapMessages={liveBootstrapMessages} />;
}

function LiveConversationPage({
  sessionId,
  bootstrapMessages
}: {
  sessionId: string;
  bootstrapMessages: HistoryMessageDto[];
}) {
  const {
    navigationGroups,
    requestNavigationRefresh,
    setSessionWorkspace,
    markNavigationSessionSeen
  } = useWorkbenchShell();
  const storeRef = useRef<SessionRuntimeStore | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const navigationSession = useMemo(
    () =>
      navigationGroups
        .flatMap((group) => group.sessions)
        .find((item) => item.sessionId === sessionId) ?? null,
    [navigationGroups, sessionId]
  );

  if (!storeRef.current || currentSessionIdRef.current !== sessionId) {
    storeRef.current?.destroy();
    storeRef.current = new SessionRuntimeStore(sessionId, {
      initialSession: navigationSession,
      bootstrapMessages,
      onSeen: (seenSessionId, seenAt) => {
        markNavigationSessionSeen(seenSessionId, seenAt);
      }
    });
    currentSessionIdRef.current = sessionId;
  }

  const store = storeRef.current;
  const { showToast, dismissToast } = useToast();
  const lastRuntimeErrorSignatureRef = useRef<string | null>(null);
  const pendingRuntimeErrorSignatureRef = useRef<string | null>(null);
  const delayedRuntimeToastTimerRef = useRef<number | null>(null);
  const session = useSessionRuntimeStore(store, (state) => state.session);
  const capabilities = useSessionRuntimeStore(store, (state) => state.capabilities);
  const runtimeHasActiveRun = useSessionRuntimeStore(store, (state) => state.runtimeHasActiveRun);
  const runtimeCanInterrupt = useSessionRuntimeStore(store, (state) => state.runtimeCanInterrupt);
  const messages = useSessionRuntimeStore(store, (state) => state.messages);
  const queuedMessages = useSessionRuntimeStore(store, (state) => state.queuedMessages);
  const contextUsage = useSessionRuntimeStore(store, (state) => state.contextUsage);
  const historyState = useSessionRuntimeStore(store, (state) => state.historyState);
  const runtimeErrorCode = useSessionRuntimeStore(store, (state) => state.errorCode);
  const runtimeErrorDetail = useSessionRuntimeStore(store, (state) => state.errorDetail);
  const loadingOlderMessages = useSessionRuntimeStore(
    store,
    (state) => state.loadingOlderMessages
  );
  const hasOlderMessages = useSessionRuntimeStore(store, (state) => state.hasOlderMessages);
  const connectionState = useSessionRuntimeStore(store, (state) => state.connectionState);
  const [deletingQueueItemId, setDeletingQueueItemId] = useState<string | null>(null);
  const [steeringQueueItemId, setSteeringQueueItemId] = useState<string | null>(null);
  const isRunning = isSessionRunning(session);
  const canSteerQueuedMessage =
    isRunning &&
    shouldSupportRunSteering(capabilities) &&
    session?.provider === capabilities?.provider;
  const hasPendingQueuedMessages = queuedMessages.some(
    (item) => item.status === "queued" || item.status === "dispatching"
  );

  useEffect(() => {
    store.applyNavigationSession(navigationSession);
  }, [navigationSession, store]);

  useEffect(() => {
    void store.initialize();

    return () => {
      store.destroy();
    };
  }, [store]);

  useEffect(() => {
    setSessionWorkspace(sessionId, session?.workspaceId ?? null);

    return () => {
      setSessionWorkspace(sessionId, null);
    };
  }, [session?.workspaceId, sessionId, setSessionWorkspace]);

  useEffect(() => {
    return () => {
      if (delayedRuntimeToastTimerRef.current !== null) {
        window.clearTimeout(delayedRuntimeToastTimerRef.current);
        delayedRuntimeToastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!runtimeErrorCode || !runtimeErrorDetail) {
      if (delayedRuntimeToastTimerRef.current !== null) {
        window.clearTimeout(delayedRuntimeToastTimerRef.current);
        delayedRuntimeToastTimerRef.current = null;
      }

      pendingRuntimeErrorSignatureRef.current = null;
      lastRuntimeErrorSignatureRef.current = null;
      dismissToast("conversation-runtime-error");
      return;
    }

    const signature = `${runtimeErrorCode}:${runtimeErrorDetail}`;

    if (
      lastRuntimeErrorSignatureRef.current === signature
      || pendingRuntimeErrorSignatureRef.current === signature
    ) {
      return;
    }

    if (delayedRuntimeToastTimerRef.current !== null) {
      window.clearTimeout(delayedRuntimeToastTimerRef.current);
      delayedRuntimeToastTimerRef.current = null;
    }

    if (shouldDelayRuntimeErrorToast(session?.provider ?? null, runtimeErrorCode, runtimeErrorDetail)) {
      pendingRuntimeErrorSignatureRef.current = signature;
      delayedRuntimeToastTimerRef.current = window.setTimeout(() => {
        pendingRuntimeErrorSignatureRef.current = null;
        delayedRuntimeToastTimerRef.current = null;
        lastRuntimeErrorSignatureRef.current = signature;
        showToast({
          id: "conversation-runtime-error",
          title: t("conversation.runtimeErrorTitle"),
          description: runtimeErrorDetail,
          tone: "error",
          durationMs: null
        });
      }, RUNTIME_TIMEOUT_TOAST_DELAY_MS);
      return;
    }

    pendingRuntimeErrorSignatureRef.current = null;
    lastRuntimeErrorSignatureRef.current = signature;
    showToast({
      id: "conversation-runtime-error",
      title: t("conversation.runtimeErrorTitle"),
      description: runtimeErrorDetail,
      tone: "error",
      durationMs: null
    });
  }, [dismissToast, runtimeErrorCode, runtimeErrorDetail, session?.provider, showToast]);

  return (
    <main className="workbench-page conversation-page-shell">
      <SessionHeader session={session ?? navigationSession} />
      <ConnectionBanner connectionState={connectionState} onReconnect={() => store.reconnect()} />
      <MessageTimeline
        sessionId={sessionId}
        messages={messages}
        historyState={historyState}
        loadingOlderMessages={loadingOlderMessages}
        hasOlderMessages={hasOlderMessages}
        provider={session?.provider ?? null}
        onLoadOlderMessages={() => {
          void store.loadOlderMessages();
        }}
        onRetryMessage={(clientRequestId: string) => {
          void store.retryMessage(clientRequestId);
        }}
      />
      <QueuedMessageList
        items={queuedMessages}
        deletingQueueItemId={deletingQueueItemId}
        steeringQueueItemId={steeringQueueItemId}
        canSteer={canSteerQueuedMessage}
        onDelete={async (queueItemId) => {
          setDeletingQueueItemId(queueItemId);

          try {
            await store.deleteQueuedMessage(queueItemId);
          } finally {
            setDeletingQueueItemId(null);
          }
        }}
        onSteer={async (queueItemId) => {
          setSteeringQueueItemId(queueItemId);

          try {
            await store.steerQueuedMessage(queueItemId);
            requestNavigationRefresh();
          } finally {
            setSteeringQueueItemId(null);
          }
        }}
      />
      <ComposerPanel
        capabilities={capabilities}
        hasActiveRun={runtimeHasActiveRun}
        contextUsage={contextUsage}
        hasPendingQueuedMessages={hasPendingQueuedMessages}
        canInterrupt={runtimeCanInterrupt}
        isSubmitting={sending}
        isRunning={isRunning}
        onInterrupt={async () => {
          await store.interrupt();
          requestNavigationRefresh();
        }}
        onSend={async (content, options) => {
          setSending(true);

          try {
            await store.sendMessage(content, {
              model: options?.model,
              reasoningLevel: options?.reasoningLevel,
              attachments: options?.attachments,
              attachmentMeta: options?.attachmentMeta
            });
            requestNavigationRefresh();
          } finally {
            setSending(false);
          }
        }}
        onQueueSend={async (content, options) => {
          setSending(true);

          try {
            await store.enqueueMessage(content, {
              model: options?.model,
              reasoningLevel: options?.reasoningLevel,
              attachments: options?.attachments,
              attachmentMeta: options?.attachmentMeta
            });
          } finally {
            setSending(false);
          }
        }}
      />
    </main>
  );
}

function shouldDelayRuntimeErrorToast(
  provider: ProviderId | null,
  errorCode: string,
  errorDetail: string
): boolean {
  if (provider !== "opencode") {
    return false;
  }

  return (
    errorCode === "OPENCODE_REQUEST_TIMEOUT"
    || errorCode === "PROVIDER_RUNTIME_TIMEOUT"
    || /\bSERVER_TIMEOUT\b/i.test(errorDetail)
    || /timeout/i.test(errorDetail)
    || /超时/.test(errorDetail)
  );
}

function DraftConversationPage({
  draft,
  navigate
}: {
  draft: DraftConversationContext;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const {
    requestNavigationRefresh,
    setSessionWorkspace,
    upsertNavigationSession
  } = useWorkbenchShell();
  const [sending, setSending] = useState(false);
  const [draftMessages, setDraftMessages] = useState<SessionMessageViewModel[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapabilitiesDto>(() =>
    createProviderDraftCapabilities(draft.provider)
  );
  const session = useMemo(() => createDraftSessionSummary(draft), [draft]);
  useEffect(() => {
    setSessionWorkspace(draft.sessionId, draft.workspaceId);

    return () => {
      setSessionWorkspace(draft.sessionId, null);
    };
  }, [draft.sessionId, draft.workspaceId, setSessionWorkspace]);

  useEffect(() => {
    let disposed = false;

    setCapabilities(createProviderDraftCapabilities(draft.provider));
    void getProviderCapabilities(draft.provider, draft.workspaceId)
      .then((nextCapabilities) => {
        if (!disposed) {
          setCapabilities(nextCapabilities);
        }
      })
      .catch(() => {
        return;
      });

    return () => {
      disposed = true;
    };
  }, [draft.provider]);

  return (
    <main className="workbench-page conversation-page-shell">
      <SessionHeader session={session} />
      <ConnectionBanner connectionState="closed" onReconnect={() => {}} />
      <MessageTimeline
        sessionId={draft.sessionId}
        messages={draftMessages}
        historyState="ready"
        loadingOlderMessages={false}
        hasOlderMessages={false}
        provider={draft.provider}
        onLoadOlderMessages={() => {}}
        onRetryMessage={() => {}}
      />
      <ComposerPanel
        capabilities={capabilities}
        contextUsage={null}
        isSubmitting={sending}
        isRunning={false}
        onSend={async (content, options) => {
          const clientRequestId = createClientRequestId();
          setDraftMessages((current) => [
            ...current,
            createPendingMessage(
              draft.sessionId,
              content,
              clientRequestId,
              options?.attachmentMeta ?? [],
              options?.attachments ?? []
            )
          ]);
          setSending(true);

          try {
            const permissionMode = clientConfigStore.getState().defaultPermissionMode;
            const created = await startLiveSession({
              workspaceId: draft.workspaceId,
              provider: draft.provider,
              content,
              clientRequestId,
              model: options?.model ?? null,
              reasoningLevel: options?.reasoningLevel ?? null,
              permissionMode: permissionMode === "default" ? null : permissionMode,
              attachments: options?.attachments ?? []
            });

            if (created.session) {
              upsertNavigationSession(created.session);
            }

            setSessionWorkspace(created.sessionId, draft.workspaceId);
            navigate(`/sessions/${created.sessionId}`, {
              replace: true,
              state: created.message
                ? {
                    bootstrap: {
                      sessionId: created.sessionId,
                      messages: [created.message]
                    }
                  }
                : null
            });
            requestNavigationRefresh();
          } catch (error) {
            setDraftMessages((current) => markPendingAsFailed(current, clientRequestId));
            throw error;
          } finally {
            setSending(false);
          }
        }}
      />
    </main>
  );
}

interface DraftConversationContext {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
}

function parseDraftContext(
  sessionId: string,
  searchParams: URLSearchParams
): DraftConversationContext | null {
  if (!isDraftSessionId(sessionId)) {
    return null;
  }

  const workspaceId = searchParams.get("workspaceId")?.trim();
  const provider = searchParams.get("provider")?.trim() ?? null;

  if (!workspaceId || !isDraftProviderSupported(provider)) {
    return null;
  }

  return {
    sessionId,
    workspaceId,
    provider: provider as ProviderId
  };
}

function createDraftSessionSummary(draft: DraftConversationContext): SessionSummaryDto {
  const timestamp = new Date().toISOString();

  return {
    sessionId: draft.sessionId,
    workspaceId: draft.workspaceId,
    provider: draft.provider,
    providerSessionId: `draft://${draft.sessionId}`,
    rawStoreRef: `draft://${draft.sessionId}`,
    parentSessionId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    title: getProviderDraftTitle(draft.provider),
    messageCount: 0,
    lastMessageAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    lastEventAt: null,
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle"
  };
}

function isSessionRunning(session: SessionSummaryDto | null): boolean {
  if (!session) {
    return false;
  }

  if (session.activityState === "running") {
    return true;
  }

  return (
    session.runningState === "starting"
    || session.runningState === "running"
    || session.runningState === "reconnecting"
  );
}

function isDraftSessionId(sessionId: string): boolean {
  return sessionId.startsWith("draft-");
}

function parseLiveBootstrapMessages(sessionId: string, state: unknown): HistoryMessageDto[] {
  if (!state || typeof state !== "object") {
    return [];
  }

  const bootstrap = (state as { bootstrap?: unknown }).bootstrap;

  if (!bootstrap || typeof bootstrap !== "object") {
    return [];
  }

  const bootstrapSessionId = (bootstrap as { sessionId?: unknown }).sessionId;
  const messages = (bootstrap as { messages?: unknown }).messages;

  if (bootstrapSessionId !== sessionId || !Array.isArray(messages)) {
    return [];
  }

  return messages.filter(isHistoryMessageDto);
}

function isHistoryMessageDto(value: unknown): value is HistoryMessageDto {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<HistoryMessageDto>;
  return (
    typeof message.messageId === "string" &&
    typeof message.provider === "string" &&
    typeof message.providerSessionId === "string" &&
    typeof message.role === "string" &&
    typeof message.content === "string" &&
    typeof message.timestamp === "string" &&
    typeof message.sequence === "number" &&
    typeof message.rawRef === "string"
  );
}

function createClientRequestId(): string {
  const nativeCrypto = globalThis.crypto;

  if (nativeCrypto && typeof nativeCrypto.randomUUID === "function") {
    return nativeCrypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

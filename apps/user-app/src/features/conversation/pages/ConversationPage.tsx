import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

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
import { useWorkbenchShell } from "../components/WorkbenchLayout";
import { SessionRuntimeStore, useSessionRuntimeStore } from "../runtime/session-runtime-store";
import {
  createPendingMessage,
  markPendingAsFailed,
  type SessionMessageViewModel
} from "../runtime/session-runtime-machine";

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
  const session = useSessionRuntimeStore(store, (state) => state.session);
  const capabilities = useSessionRuntimeStore(store, (state) => state.capabilities);
  const messages = useSessionRuntimeStore(store, (state) => state.messages);
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
  const isRunning =
    session?.activitySource !== "inferred" &&
    (
      session?.runningState === "starting"
      || session?.runningState === "running"
      || session?.runningState === "reconnecting"
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
    if (!runtimeErrorCode || !runtimeErrorDetail) {
      lastRuntimeErrorSignatureRef.current = null;
      dismissToast("conversation-runtime-error");
      return;
    }

    const signature = `${runtimeErrorCode}:${runtimeErrorDetail}`;

    if (lastRuntimeErrorSignatureRef.current === signature) {
      return;
    }

    lastRuntimeErrorSignatureRef.current = signature;
    showToast({
      id: "conversation-runtime-error",
      title: t("conversation.runtimeErrorTitle"),
      description: runtimeErrorDetail,
      tone: "error",
      durationMs: null
    });
  }, [dismissToast, runtimeErrorCode, runtimeErrorDetail, showToast]);

  return (
    <main className="workbench-page conversation-page-shell">
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
      <ComposerPanel
        capabilities={capabilities}
        contextUsage={contextUsage}
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
      />
    </main>
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
    createDraftCapabilities(draft.provider)
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

    setCapabilities(createDraftCapabilities(draft.provider));
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
            const created = await startLiveSession({
              workspaceId: draft.workspaceId,
              provider: draft.provider,
              content,
              clientRequestId,
              model: options?.model ?? null,
              reasoningLevel: options?.reasoningLevel ?? null,
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
  const provider = searchParams.get("provider")?.trim();

  if (!workspaceId || (provider !== "codex" && provider !== "claude-code")) {
    return null;
  }

  return {
    sessionId,
    workspaceId,
    provider
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
    title:
      draft.provider === "codex"
        ? t("conversation.draftTitleCodex")
        : t("conversation.draftTitleClaude"),
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

function createDraftCapabilities(provider: ProviderId): ProviderCapabilitiesDto {
  return {
    provider,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode: provider === "claude-code" ? "streaming_guidance" : "none",
    supportsSubagents: false,
    supportsInterrupt: false,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: true,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    modelOptions:
      provider === "claude-code"
        ? [
            {
              id: "provider-default",
              name: t("conversation.modelUseCliDefault"),
              usesProviderDefault: true
            }
          ]
        : [
            {
              id: "provider-default",
              name: t("conversation.modelUseCodexConfig"),
              usesProviderDefault: true
            }
          ],
    defaultReasoningLevel: provider === "codex" ? null : undefined,
    limitations: []
  };
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

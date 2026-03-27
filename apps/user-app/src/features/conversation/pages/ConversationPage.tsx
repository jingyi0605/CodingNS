import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { buildSessionTitlePresentation } from "../session-title";
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
import {
  buildNavigationSessionTree,
  buildWorkspaceSessionIndexPath,
  buildWorkspaceSessionPath,
  flattenNavigationSessions,
  type WorkbenchNavigationEntry
} from "../../workbench/utils/workbench-navigation";
import {
  readMobileConversationPreviewMode,
  writeMobileConversationPreviewMode,
  type MobileConversationPreviewMode
} from "../../mobile-sessions/mobile-conversation-state";
import "../../mobile-sessions/styles.css";

const RUNTIME_TIMEOUT_TOAST_DELAY_MS = 15_000;

export function ConversationPage() {
  const { sessionId = "", workspaceId: routeWorkspaceIdParam } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const routeWorkspaceId = routeWorkspaceIdParam?.trim() || null;
  const draftContext = useMemo(
    () => parseDraftContext(sessionId, routeWorkspaceId, searchParams),
    [routeWorkspaceId, searchParams, sessionId]
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
    shellMode,
    navigationGroups,
    requestNavigationRefresh,
    selectWorkspace,
    setSessionWorkspace,
    markNavigationSessionSeen,
    favoriteSessions,
    archiveSession,
    unarchiveSession
  } = useWorkbenchShell();
  const navigate = useNavigate();
  const storeRef = useRef<SessionRuntimeStore | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveFolderOpen, setArchiveFolderOpen] = useState(false);
  const [archiveRestoreSessionId, setArchiveRestoreSessionId] = useState<string | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);
  const [mobilePreviewMode, setMobilePreviewMode] = useState<MobileConversationPreviewMode>(() =>
    readMobileConversationPreviewMode()
  );
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
  const showInlineHeader = shellMode !== "mobile";
  const mobileWorkspaceId = session?.workspaceId ?? navigationSession?.workspaceId ?? null;
  const mobileFavoriteSessionIdSet = useMemo(
    () => new Set(favoriteSessions.map((item) => item.session.sessionId)),
    [favoriteSessions]
  );
  const mobilePreviewItems = useMemo(
    () =>
      buildMobilePreviewItems(
        navigationGroups,
        session?.workspaceId ?? navigationSession?.workspaceId ?? null,
        mobileFavoriteSessionIdSet
      ),
    [mobileFavoriteSessionIdSet, navigationGroups, navigationSession?.workspaceId, session?.workspaceId]
  );
  const mobileFavoritePreviewItems = useMemo(
    () => buildMobileFavoritePreviewItems(favoriteSessions),
    [favoriteSessions]
  );
  const mobileArchiveWorkspaceGroup = useMemo(
    () =>
      mobileWorkspaceId
        ? navigationGroups.find((group) => group.workspace.id === mobileWorkspaceId) ?? null
        : null,
    [mobileWorkspaceId, navigationGroups]
  );
  const mobileArchivedSessions = useMemo(
    () =>
      mobileArchiveWorkspaceGroup?.sessions.filter(
        (item) => item.isArchived === true && !(item.parentSessionId?.trim() || null)
      ) ?? [],
    [mobileArchiveWorkspaceGroup]
  );
  useEffect(() => {
    if (shellMode !== "mobile") {
      return;
    }

    writeMobileConversationPreviewMode(mobilePreviewMode);
  }, [mobilePreviewMode, shellMode]);

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
    <>
      <main
        className="workbench-page conversation-page-shell mobile-page-fixed-root mobile-conversation-page"
        data-mobile-shell={!showInlineHeader}
        data-preview-mode={!showInlineHeader ? mobilePreviewMode : undefined}
      >
        {showInlineHeader ? <SessionHeader session={session ?? navigationSession} /> : null}
        {!showInlineHeader ? (
          <MobileConversationHeader
            session={session ?? navigationSession}
            previewMode={mobilePreviewMode}
            onTogglePreview={() => {
              setMobilePreviewMode((current) => (current === "preview" ? "immersive" : "preview"));
            }}
          />
        ) : null}
        {!showInlineHeader ? (
        <MobileConversationPreviewRail
          open={mobilePreviewMode === "preview"}
          activeSessionId={sessionId}
          favoriteItems={mobileFavoritePreviewItems}
          items={mobilePreviewItems}
          workspaceSectionLabel={t("shell.mobileConversationCurrentWorkspaceSection")}
          archiveCurrentActionLabel={t("shell.archiveCurrentSessionAction")}
          archiveFolderActionLabel={t("shell.archiveFolderAction")}
          onArchiveActiveSession={() => {
            setArchiveConfirmOpen(true);
          }}
          onOpenArchiveFolder={() => {
            setArchiveFolderOpen(true);
          }}
          onActivate={(entry) => {
            writeMobileConversationPreviewMode("preview");
            navigate(buildWorkspaceSessionPath(entry.workspace.id, entry.session.sessionId));
            }}
          />
        ) : null}
        <div className="mobile-conversation-stage">
          <div className="mobile-conversation-main">
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
          </div>
        </div>
      </main>
      <ConversationArchiveConfirmModal
        open={archiveConfirmOpen}
        busy={archiveSubmitting}
        onClose={() => {
          if (archiveSubmitting) {
            return;
          }

          setArchiveConfirmOpen(false);
        }}
        onConfirm={async () => {
          if (archiveSubmitting) {
            return;
          }

          setArchiveSubmitting(true);

          try {
            await archiveSession(sessionId);
            setArchiveConfirmOpen(false);
            showToast({
              title: t("shell.archiveAdded"),
              tone: "success"
            });

            if (mobileWorkspaceId) {
              selectWorkspace(mobileWorkspaceId);
              writeMobileConversationPreviewMode("preview");
              navigate(buildWorkspaceSessionIndexPath(mobileWorkspaceId));
              return;
            }

            navigate("/workspaces");
          } catch (error) {
            showToast({
              title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
              tone: "error"
            });
          } finally {
            setArchiveSubmitting(false);
          }
        }}
      />
      <ConversationArchiveFolderModal
        open={archiveFolderOpen}
        workspaceName={mobileArchiveWorkspaceGroup?.workspace.name ?? null}
        sessions={mobileArchivedSessions}
        restoringSessionId={archiveRestoreSessionId}
        onClose={() => {
          if (archiveRestoreSessionId) {
            return;
          }

          setArchiveFolderOpen(false);
        }}
        onRestore={async (restoreSessionId) => {
          setArchiveRestoreSessionId(restoreSessionId);

          try {
            await unarchiveSession(restoreSessionId);
            showToast({
              title: t("shell.archiveRestored"),
              tone: "success"
            });
          } catch (error) {
            showToast({
              title: error instanceof Error ? error.message : t("shell.navigationLoadFailed"),
              tone: "error"
            });
          } finally {
            setArchiveRestoreSessionId(null);
          }
        }}
      />
    </>
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
    shellMode,
    navigationGroups,
    requestNavigationRefresh,
    setSessionWorkspace,
    upsertNavigationSession,
    favoriteSessions
  } = useWorkbenchShell();
  const [sending, setSending] = useState(false);
  const [draftMessages, setDraftMessages] = useState<SessionMessageViewModel[]>([]);
  const [mobilePreviewMode, setMobilePreviewMode] = useState<MobileConversationPreviewMode>(() =>
    readMobileConversationPreviewMode()
  );
  const fallbackCapabilities = useMemo(
    () => createProviderDraftCapabilities(draft.provider),
    [draft.provider]
  );
  const [capabilities, setCapabilities] = useState<ProviderCapabilitiesDto>(fallbackCapabilities);
  const showInlineHeader = shellMode !== "mobile";
  const session = useMemo(() => createDraftSessionSummary(draft), [draft]);
  const mobileFavoriteSessionIdSet = useMemo(
    () => new Set(favoriteSessions.map((item) => item.session.sessionId)),
    [favoriteSessions]
  );
  const mobilePreviewItems = useMemo(
    () => buildMobilePreviewItems(navigationGroups, draft.workspaceId, mobileFavoriteSessionIdSet),
    [draft.workspaceId, mobileFavoriteSessionIdSet, navigationGroups]
  );
  const mobileFavoritePreviewItems = useMemo(
    () => buildMobileFavoritePreviewItems(favoriteSessions),
    [favoriteSessions]
  );

  useEffect(() => {
    if (shellMode !== "mobile") {
      return;
    }

    writeMobileConversationPreviewMode(mobilePreviewMode);
  }, [mobilePreviewMode, shellMode]);

  useEffect(() => {
    setSessionWorkspace(draft.sessionId, draft.workspaceId);

    return () => {
      setSessionWorkspace(draft.sessionId, null);
    };
  }, [draft.sessionId, draft.workspaceId, setSessionWorkspace]);

  useEffect(() => {
    let disposed = false;

    // 草稿页先用本地兜底能力，随后再按 provider + workspace 拉真实模型列表。
    setCapabilities(fallbackCapabilities);

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
  }, [draft.provider, draft.workspaceId, fallbackCapabilities]);

  return (
    <main
      className="workbench-page conversation-page-shell mobile-page-fixed-root mobile-conversation-page"
      data-mobile-shell={!showInlineHeader}
      data-preview-mode={!showInlineHeader ? mobilePreviewMode : undefined}
    >
      {showInlineHeader ? <SessionHeader session={session} /> : null}
      {!showInlineHeader ? (
        <MobileConversationHeader
          session={session}
          previewMode={mobilePreviewMode}
          onTogglePreview={() => {
            setMobilePreviewMode((current) => (current === "preview" ? "immersive" : "preview"));
          }}
        />
      ) : null}
      {!showInlineHeader ? (
        <MobileConversationPreviewRail
          open={mobilePreviewMode === "preview"}
          activeSessionId={draft.sessionId}
          favoriteItems={mobileFavoritePreviewItems}
          items={mobilePreviewItems}
          workspaceSectionLabel={t("shell.mobileConversationCurrentWorkspaceSection")}
          onActivate={(entry) => {
            writeMobileConversationPreviewMode("preview");
            navigate(buildWorkspaceSessionPath(entry.workspace.id, entry.session.sessionId));
          }}
        />
      ) : null}
      <div className="mobile-conversation-stage">
        <div className="mobile-conversation-main">
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
                writeMobileConversationPreviewMode("preview");
                navigate(buildWorkspaceSessionPath(draft.workspaceId, created.sessionId), {
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
        </div>
      </div>
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
  routeWorkspaceId: string | null,
  searchParams: URLSearchParams
): DraftConversationContext | null {
  if (!isDraftSessionId(sessionId)) {
    return null;
  }

  const workspaceId = routeWorkspaceId ?? searchParams.get("workspaceId")?.trim() ?? null;
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

function buildMobilePreviewItems(
  navigationGroups: ReturnType<typeof useWorkbenchShell>["navigationGroups"],
  workspaceId: string | null,
  excludedSessionIds: ReadonlySet<string>
) {
  if (!workspaceId) {
    return [] as Array<{
      entry: WorkbenchNavigationEntry;
      depth: 0 | 1;
    }>;
  }

  const workspaceGroup = navigationGroups.find((group) => group.workspace.id === workspaceId);

  if (!workspaceGroup) {
    return [] as Array<{
      entry: WorkbenchNavigationEntry;
      depth: 0 | 1;
    }>;
  }

  const tree = buildNavigationSessionTree(
    flattenNavigationSessions([workspaceGroup]).filter(
      (entry) => !entry.session.isArchived && !excludedSessionIds.has(entry.session.sessionId)
    )
  );

  return tree.flatMap((node) => [
    {
      entry: node.entry,
      depth: 0 as const
    },
    ...node.children.map((entry) => ({
      entry,
      depth: 1 as const
    }))
  ]);
}

function buildMobileFavoritePreviewItems(
  favoriteSessions: readonly WorkbenchNavigationEntry[]
) {
  return favoriteSessions
    .map((entry) => ({
      entry,
      depth: 0 as const
    }));
}

function MobileConversationHeader({
  session,
  previewMode,
  onTogglePreview
}: {
  session: SessionSummaryDto | null;
  previewMode: MobileConversationPreviewMode;
  onTogglePreview: () => void;
}) {
  const titlePresentation = buildSessionTitlePresentation(session?.title ?? null, t("conversation.titleFallback"));
  const toggleLabel =
    previewMode === "preview"
      ? t("shell.mobileConversationCollapsePreviewAction")
      : t("shell.mobileConversationRestorePreviewAction");

  return (
    <header className="mobile-conversation-header">
      <button
        type="button"
        className="mobile-conversation-header-toggle"
        aria-label={toggleLabel}
        title={toggleLabel}
        data-preview-mode={previewMode}
        onClick={onTogglePreview}
      >
        <MobileConversationPreviewToggleIcon previewMode={previewMode} />
      </button>
      <div className="mobile-conversation-header-copy">
        <h1 title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</h1>
      </div>
    </header>
  );
}

function MobileConversationPreviewRail({
  open,
  activeSessionId,
  favoriteItems,
  items,
  workspaceSectionLabel,
  archiveCurrentActionLabel,
  archiveFolderActionLabel,
  onArchiveActiveSession,
  onOpenArchiveFolder,
  onActivate
}: {
  open: boolean;
  activeSessionId: string;
  favoriteItems: Array<{
    entry: WorkbenchNavigationEntry;
    depth: 0 | 1;
  }>;
  items: Array<{
    entry: WorkbenchNavigationEntry;
    depth: 0 | 1;
  }>;
  workspaceSectionLabel: string;
  archiveCurrentActionLabel?: string;
  archiveFolderActionLabel?: string;
  onArchiveActiveSession?: (() => void | Promise<void>) | null;
  onOpenArchiveFolder?: (() => void) | null;
  onActivate: (entry: WorkbenchNavigationEntry) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <aside className="mobile-conversation-preview-rail surface-card">
      <section className="mobile-conversation-preview-group mobile-conversation-preview-list-favorites">
        <div className="mobile-conversation-preview-group-heading">
          {t("shell.favoriteSectionTitle")}
        </div>
        {favoriteItems.length > 0 ? (
          <div className="mobile-conversation-preview-list mobile-conversation-preview-list-static">
            {favoriteItems.map((item) => (
              <button
                key={`favorite:${item.entry.workspace.id}:${item.entry.session.sessionId}`}
                type="button"
                className="mobile-conversation-preview-item"
                data-active={item.entry.session.sessionId === activeSessionId}
                onClick={() => onActivate(item.entry)}
              >
                <span
                  className={resolvePreviewIndicatorClassName(
                    item.entry.session.activityState ?? null,
                    item.entry.session.sessionId === activeSessionId
                  )}
                  aria-hidden="true"
                />
                <span className="mobile-conversation-preview-item-copy">
                  <span className="mobile-conversation-preview-item-title">
                    {item.entry.session.title || t("common.unknown")}
                  </span>
                  <span className="mobile-conversation-preview-item-meta">
                    {formatMobilePreviewMeta(
                      item.entry.session.provider,
                      item.entry.session.lastMessageAt ?? item.entry.session.updatedAt,
                      item.entry.workspace.name
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mobile-conversation-preview-group mobile-conversation-preview-group-workspace">
        <div className="mobile-conversation-preview-group-heading">
          {workspaceSectionLabel}
        </div>
        <div className="mobile-conversation-preview-list">
          {items.length === 0 ? (
            <p className="mobile-conversation-preview-empty">{t("shell.emptyWorkspaceSessions")}</p>
          ) : (
            items.map((item) => (
              <button
                key={`${item.entry.workspace.id}:${item.entry.session.sessionId}`}
                type="button"
                className="mobile-conversation-preview-item"
                data-active={item.entry.session.sessionId === activeSessionId}
                data-depth={item.depth}
                onClick={() => onActivate(item.entry)}
              >
                <span
                  className={resolvePreviewIndicatorClassName(
                    item.entry.session.activityState ?? null,
                    item.entry.session.sessionId === activeSessionId
                  )}
                  aria-hidden="true"
                />
                <span className="mobile-conversation-preview-item-copy">
                  <span className="mobile-conversation-preview-item-title">
                    {item.entry.session.title || t("common.unknown")}
                  </span>
                  <span className="mobile-conversation-preview-item-meta">
                    {formatMobilePreviewMeta(
                      item.entry.session.provider,
                      item.entry.session.lastMessageAt ?? item.entry.session.updatedAt
                    )}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      {(archiveCurrentActionLabel && onArchiveActiveSession) || (archiveFolderActionLabel && onOpenArchiveFolder) ? (
        <section className="mobile-conversation-preview-group mobile-conversation-preview-group-archive">
          {archiveCurrentActionLabel && onArchiveActiveSession ? (
            <button
              type="button"
              className="mobile-conversation-preview-archive-button"
              onClick={() => {
                void onArchiveActiveSession();
              }}
            >
              {archiveCurrentActionLabel}
            </button>
          ) : null}
          {archiveFolderActionLabel && onOpenArchiveFolder ? (
            <button
              type="button"
              className="mobile-conversation-preview-archive-button"
              onClick={onOpenArchiveFolder}
            >
              {archiveFolderActionLabel}
            </button>
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}

function resolvePreviewIndicatorClassName(activityState: string | null, isActive: boolean) {
  if (activityState === "running") {
    return "mobile-conversation-preview-indicator is-running";
  }

  if (isActive) {
    return "mobile-conversation-preview-indicator is-active";
  }

  return "mobile-conversation-preview-indicator is-idle";
}

function formatMobilePreviewMeta(
  provider: ProviderId,
  value: string | null,
  workspaceName?: string | null
) {
  return [workspaceName ?? null, formatMobileProviderLabel(provider), formatMobilePreviewTime(value)]
    .filter(Boolean)
    .join(" · ");
}

function formatMobileProviderLabel(provider: ProviderId) {
  if (provider === "codex") {
    return t("conversation.providerCodex");
  }

  if (provider === "opencode") {
    return t("conversation.providerOpenCode");
  }

  return t("conversation.providerClaude");
}

function formatMobilePreviewTime(value: string | null) {
  if (!value) {
    return t("common.unknown");
  }

  return new Date(value).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function MobileConversationPreviewToggleIcon({
  previewMode
}: {
  previewMode: MobileConversationPreviewMode;
}) {
  if (previewMode === "preview") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ConversationArchiveConfirmModal({
  open,
  busy,
  onClose,
  onConfirm
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="workbench-modal-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        disabled={busy}
        onClick={onClose}
      />
      <section
        className="workbench-modal-card surface-card"
        role="dialog"
        aria-modal="true"
        aria-label={t("shell.archiveConfirmTitle")}
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2>{t("shell.archiveConfirmTitle")}</h2>
            <p>{t("shell.archiveConfirmDescription")}</p>
          </div>
        </div>
        <div className="workbench-modal-body">
          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={onClose}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="secondary-button workbench-danger-button"
              disabled={busy}
              onClick={() => {
                void onConfirm();
              }}
            >
              {t("shell.archiveAction")}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function ConversationArchiveFolderModal({
  open,
  workspaceName,
  sessions,
  restoringSessionId,
  onClose,
  onRestore
}: {
  open: boolean;
  workspaceName: string | null;
  sessions: SessionSummaryDto[];
  restoringSessionId: string | null;
  onClose: () => void;
  onRestore: (sessionId: string) => void | Promise<void>;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !restoringSessionId) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open, restoringSessionId]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="workbench-modal-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        disabled={Boolean(restoringSessionId)}
        onClick={onClose}
      />
      <section
        className="workbench-modal-card surface-card"
        role="dialog"
        aria-modal="true"
        aria-label={t("shell.archiveModalTitle")}
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2>{t("shell.archiveModalTitle")}</h2>
            <p>
              {workspaceName
                ? `${workspaceName} · ${t("shell.archiveModalDescription")}`
                : t("shell.archiveModalDescription")}
            </p>
          </div>
        </div>
        <div className="workbench-modal-body">
          {sessions.length > 0 ? (
            <div className="workbench-archive-list">
              {sessions.map((session) => {
                const titlePresentation = buildSessionTitlePresentation(session.title, t("common.unknown"));

                return (
                  <article key={session.sessionId} className="workbench-archive-item">
                    <div className="workbench-archive-item-main">
                      <strong title={titlePresentation.fullTitle}>{titlePresentation.displayTitle}</strong>
                      <p>{formatMobilePreviewMeta(session.provider, session.lastMessageAt ?? session.updatedAt)}</p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={restoringSessionId === session.sessionId}
                      onClick={() => {
                        void onRestore(session.sessionId);
                      }}
                    >
                      {t("shell.unarchiveAction")}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="workbench-section-empty">{t("shell.archiveEmpty")}</p>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ComposerPanel } from "../components/ComposerPanel";
import { FileContextPanel } from "../components/FileContextPanel";
import { GitSidebar } from "../components/GitSidebar";
import { MessageTimeline } from "../components/MessageTimeline";
import { SessionHeader } from "../components/SessionHeader";
import { useWorkbenchShell } from "../components/WorkbenchLayout";
import { SessionRuntimeStore, useSessionRuntimeStore } from "../runtime/session-runtime-store";

export function ConversationPage() {
  const { sessionId = "" } = useParams();
  const { navigationGroups, refreshNavigation, setAuxiliaryPanel } = useWorkbenchShell();
  const storeRef = useRef<SessionRuntimeStore | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!storeRef.current || currentSessionIdRef.current !== sessionId) {
    storeRef.current?.destroy();
    storeRef.current = new SessionRuntimeStore(sessionId);
    currentSessionIdRef.current = sessionId;
  }

  const store = storeRef.current;
  const session = useSessionRuntimeStore(store, (state) => state.session);
  const capabilities = useSessionRuntimeStore(store, (state) => state.capabilities);
  const messages = useSessionRuntimeStore(store, (state) => state.messages);
  const historyState = useSessionRuntimeStore(store, (state) => state.historyState);
  const connectionState = useSessionRuntimeStore(store, (state) => state.connectionState);
  const pagesLoaded = useSessionRuntimeStore(store, (state) => state.pagesLoaded);
  const errorDetail = useSessionRuntimeStore(store, (state) => state.errorDetail);

  useEffect(() => {
    void store.initialize();

    return () => {
      store.destroy();
    };
  }, [store]);

  const workspaceName = useMemo(
    () =>
      navigationGroups.find((item) => item.workspace.id === session?.workspaceId)?.workspace.name ?? null,
    [navigationGroups, session?.workspaceId]
  );

  useEffect(() => {
    setAuxiliaryPanel({
      title: t("shell.auxiliaryTitle"),
      description: t("conversation.auxiliarySubtitle"),
      defaultCollapsed: false,
      content: (
        <>
          <section className="workbench-side-card">
            <h3>{t("conversation.sidebarTitle")}</h3>
            <p className="status-text">{t("conversation.sidebarSubtitle")}</p>
            <div className="badge-row">
              <span className="badge">
                {t("conversation.historyPages")} {pagesLoaded}
              </span>
              <span className="badge">{session?.provider ?? t("common.unknown")}</span>
            </div>
            {errorDetail ? (
              <p className="status-text" data-tone="error">
                {errorDetail}
              </p>
            ) : null}
          </section>

          <FileContextPanel sessionId={sessionId} workspaceId={session?.workspaceId ?? null} />
          <GitSidebar workspaceId={session?.workspaceId} />
        </>
      )
    });

    return () => {
      setAuxiliaryPanel(null);
    };
  }, [errorDetail, pagesLoaded, session?.provider, session?.workspaceId, sessionId, setAuxiliaryPanel]);

  return (
    <main className="workbench-page conversation-page-shell">
      <SessionHeader
        session={session}
        capabilities={capabilities}
        connectionState={connectionState}
        workspaceName={workspaceName}
      />
      <ConnectionBanner connectionState={connectionState} onReconnect={() => store.reconnect()} />
      <MessageTimeline
        messages={messages}
        historyState={historyState}
        onRetryMessage={(clientRequestId: string) => {
          void store.retryMessage(clientRequestId);
        }}
      />
      <ComposerPanel
        capabilities={capabilities}
        isSubmitting={sending}
        onSend={async (content) => {
          setSending(true);

          try {
            await store.sendMessage(content);
            await refreshNavigation();
          } finally {
            setSending(false);
          }
        }}
      />
    </main>
  );
}

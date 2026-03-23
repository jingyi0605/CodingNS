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
          <FileContextPanel sessionId={sessionId} workspaceId={session?.workspaceId ?? null} />
          <GitSidebar workspaceId={session?.workspaceId} />
        </>
      )
    });

    return () => {
      setAuxiliaryPanel(null);
    };
  }, [session?.workspaceId, sessionId, setAuxiliaryPanel]);

  return (
    <main className="workbench-page conversation-page-shell">
      <SessionHeader
        session={session}
        workspaceName={workspaceName}
        capabilities={capabilities}
        connectionState={connectionState}
      />
      <ConnectionBanner connectionState={connectionState} onReconnect={() => store.reconnect()} />
      <MessageTimeline
        messages={messages}
        historyState={historyState}
        provider={session?.provider ?? null}
        onRetryMessage={(clientRequestId: string) => {
          void store.retryMessage(clientRequestId);
        }}
      />
      <ComposerPanel
        capabilities={capabilities}
        isSubmitting={sending}
        onSend={async (content, options) => {
          setSending(true);

          try {
            // Pass model and reasoning level options to the store
            await store.sendMessage(content, {
              model: options?.model,
              reasoningLevel: options?.reasoningLevel
            });
            await refreshNavigation();
          } finally {
            setSending(false);
          }
        }}
      />
    </main>
  );
}

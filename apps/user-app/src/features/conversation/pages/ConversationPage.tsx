import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { ConnectionBanner } from "../components/ConnectionBanner";
import { ComposerPanel } from "../components/ComposerPanel";
import { MessageTimeline } from "../components/MessageTimeline";
import { SessionHeader } from "../components/SessionHeader";
import { useWorkbenchShell } from "../components/WorkbenchLayout";
import { SessionRuntimeStore, useSessionRuntimeStore } from "../runtime/session-runtime-store";

export function ConversationPage() {
  const { sessionId = "" } = useParams();
  const { navigationGroups, refreshNavigation, setSessionWorkspace } = useWorkbenchShell();
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
  const loadingOlderMessages = useSessionRuntimeStore(
    store,
    (state) => state.loadingOlderMessages
  );
  const hasOlderMessages = useSessionRuntimeStore(store, (state) => state.hasOlderMessages);
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
    setSessionWorkspace(sessionId, session?.workspaceId ?? null);

    return () => {
      setSessionWorkspace(sessionId, null);
    };
  }, [session?.workspaceId, sessionId, setSessionWorkspace]);

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

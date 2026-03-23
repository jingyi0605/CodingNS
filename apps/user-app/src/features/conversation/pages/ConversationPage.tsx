import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { authStore } from "../../auth/store/auth-store";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ComposerPanel } from "../components/ComposerPanel";
import { ConversationLayout } from "../components/ConversationLayout";
import { MessageTimeline } from "../components/MessageTimeline";
import { SessionHeader } from "../components/SessionHeader";
import { SessionRuntimeStore, useSessionRuntimeStore } from "../runtime/session-runtime-store";

export function ConversationPage() {
  const { sessionId = "" } = useParams();
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

  const sidebar = useMemo(
    () => (
      <>
        <section className="conversation-panel surface-card">
          <h2>{t("conversation.sidebarTitle")}</h2>
          <p className="status-text">{t("conversation.sidebarSubtitle")}</p>
          <div className="badge-row">
            <span className="badge">
              {t("conversation.historyPages")} · {pagesLoaded}
            </span>
            <span className="badge">{session?.provider ?? t("common.unknown")}</span>
          </div>
          {errorDetail ? (
            <p className="status-text" data-tone="error">
              {errorDetail}
            </p>
          ) : null}
        </section>

        <section className="conversation-panel surface-card">
          <div className="badge-row">
            <Link className="ghost-button" to="/">
              {t("common.back")}
            </Link>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                authStore.clear();
              }}
            >
              {t("common.logout")}
            </button>
          </div>
        </section>
      </>
    ),
    [errorDetail, pagesLoaded, session?.provider]
  );

  return (
    <ConversationLayout
      header={
        <SessionHeader
          session={session}
          capabilities={capabilities}
          connectionState={connectionState}
        />
      }
      banner={<ConnectionBanner connectionState={connectionState} onReconnect={() => store.reconnect()} />}
      sidebar={sidebar}
      composer={
        <ComposerPanel
          capabilities={capabilities}
          isSubmitting={sending}
          onSend={async (content) => {
            setSending(true);

            try {
              await store.sendMessage(content);
            } finally {
              setSending(false);
            }
          }}
        />
      }
    >
      <MessageTimeline
        messages={messages}
        historyState={historyState}
        onRetryMessage={(clientRequestId) => {
          void store.retryMessage(clientRequestId);
        }}
      />
    </ConversationLayout>
  );
}

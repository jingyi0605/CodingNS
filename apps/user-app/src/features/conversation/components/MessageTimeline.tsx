import { t } from "../../../shared/i18n";

import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";

interface MessageTimelineProps {
  messages: SessionMessageViewModel[];
  historyState: "idle" | "loading" | "ready" | "error";
  onRetryMessage: (clientRequestId: string) => void;
}

export function MessageTimeline({
  messages,
  historyState,
  onRetryMessage
}: MessageTimelineProps) {
  const roleLabelMap = {
    user: t("conversation.roleUser"),
    assistant: t("conversation.roleAssistant"),
    tool: t("conversation.roleTool"),
    system: t("conversation.roleSystem")
  } as const;

  return (
    <section className="conversation-panel surface-card timeline-shell">
      {historyState === "loading" ? (
        <p className="status-text">{t("conversation.historyLoading")}</p>
      ) : null}
      {historyState === "error" ? (
        <p className="status-text" data-tone="error">
          {t("conversation.historyLoadFailed")}
        </p>
      ) : null}

      <div className="timeline-list">
        {messages.length === 0 && historyState === "ready" ? (
          <p className="status-text">{t("conversation.timelineEmpty")}</p>
        ) : null}
        {messages.map((message) => (
          <article key={message.id} className="message-card" data-role={message.role}>
            <div className="message-meta">
              <strong>{roleLabelMap[message.role]}</strong>
              <span>
                {message.deliveryState === "sending"
                  ? t("conversation.sendingState")
                  : message.deliveryState === "failed"
                    ? t("conversation.failedState")
                    : t("conversation.sentState")}
              </span>
            </div>
            <div className="message-content">{message.content}</div>
            <div className="message-meta">
              <span>{message.timestamp}</span>
              <span>
                {t("conversation.rawRefLabel")} · {message.rawRef}
              </span>
            </div>
            {message.deliveryState === "failed" && message.clientRequestId ? (
              <button
                className="ghost-button"
                type="button"
                onClick={() => onRetryMessage(message.clientRequestId!)}
              >
                {t("conversation.resendButton")}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

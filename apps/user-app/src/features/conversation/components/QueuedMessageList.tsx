import { t } from "../../../shared/i18n";
import type { SessionQueueItemDto } from "../api/conversation-api";

interface QueuedMessageListProps {
  items: SessionQueueItemDto[];
  deletingQueueItemId?: string | null;
  steeringQueueItemId?: string | null;
  canSteer?: boolean;
  onDelete: (queueItemId: string) => Promise<void> | void;
  onSteer?: (queueItemId: string) => Promise<void> | void;
}

export function QueuedMessageList({
  items,
  deletingQueueItemId = null,
  steeringQueueItemId = null,
  canSteer = false,
  onDelete,
  onSteer
}: QueuedMessageListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="queued-message-list" aria-label={t("conversation.queueTitle")}>
      <div className="queued-message-list__header">
        <h2>{`${t("conversation.queueTitle")} · ${items.length}`}</h2>
      </div>
      <div className="queued-message-list__items">
        {items.map((item, index) => {
          const canDelete = item.status === "queued" || item.status === "failed";
          const canSteerItem =
            canSteer &&
            typeof onSteer === "function" &&
            (item.status === "queued" || item.status === "failed");

          return (
            <article key={item.id} className="queued-message-item">
              <div className="queued-message-item__main">
                <span className="queued-message-item__order" aria-hidden="true">
                  {index + 1}
                </span>
                <p
                  className="queued-message-item__content"
                  title={item.content || t("conversation.queueImageOnly")}
                >
                  {item.content || t("conversation.queueImageOnly")}
                </p>
                <span
                  className={`queued-message-item__status queued-message-item__status--${item.status}`}
                >
                  {item.status === "failed"
                    ? t("conversation.queueStatusFailed")
                    : t("conversation.queueStatusQueued")}
                </span>
                <div className="queued-message-item__actions">
                  {canSteerItem ? (
                    <button
                      type="button"
                      className="queued-message-item__action queued-message-item__action--steer"
                      onClick={() => void onSteer(item.id)}
                      disabled={steeringQueueItemId === item.id}
                      aria-label={t("conversation.queueSteer")}
                      title={t("conversation.queueSteer")}
                    >
                      {steeringQueueItemId === item.id
                        ? t("conversation.queueSteering")
                        : t("conversation.queueSteer")}
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      className="queued-message-item__action queued-message-item__action--delete"
                      onClick={() => void onDelete(item.id)}
                      disabled={deletingQueueItemId === item.id}
                      aria-label={t("conversation.queueDelete")}
                      title={t("conversation.queueDelete")}
                    >
                      {deletingQueueItemId === item.id ? "…" : "×"}
                    </button>
                  ) : null}
                </div>
              </div>
              {item.errorDetail ? (
                <p className="queued-message-item__error">{item.errorDetail}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

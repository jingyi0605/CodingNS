import { useMemo } from "react";

import { t } from "../../../shared/i18n";
import { WorkbenchModal } from "../../conversation/components/WorkbenchModal";
import type { WorkbenchGlobalNotification, WorkbenchGlobalNotificationKind } from "../../conversation/components/WorkbenchLayout";

interface MobileNotificationsModalProps {
  open: boolean;
  notifications: WorkbenchGlobalNotification[];
  archivedNotificationIds: ReadonlySet<string>;
  showArchivedNotifications: boolean;
  onClose: () => void;
  onToggleShowArchivedNotifications: (checked: boolean) => void;
  onArchiveNotification: (notificationId: string) => void;
  onUnarchiveNotification: (notificationId: string) => void;
  onSelectNotification: (notification: WorkbenchGlobalNotification) => void;
}

export function MobileNotificationsModal(props: MobileNotificationsModalProps) {
  const visibleNotifications = useMemo(
    () =>
      props.notifications.filter(
        (notification) =>
          props.showArchivedNotifications || !props.archivedNotificationIds.has(notification.id)
      ),
    [props.archivedNotificationIds, props.notifications, props.showArchivedNotifications]
  );

  return (
    <WorkbenchModal
      open={props.open}
      title={t("shell.globalNotificationsPanelTitle")}
      description={t("shell.globalNotificationsPanelDescription")}
      className="workbench-notification-modal-card mobile-notification-modal-card"
      onClose={props.onClose}
    >
      <div className="workbench-notification-pane mobile-notification-pane" role="tabpanel" aria-label={t("shell.globalNotificationsAction")}>
        <div className="workbench-notification-toolbar">
          <label className="workbench-notification-filter">
            <input
              type="checkbox"
              checked={props.showArchivedNotifications}
              onChange={(event) => props.onToggleShowArchivedNotifications(event.target.checked)}
            />
            <span>{t("shell.globalNotificationsShowArchived")}</span>
          </label>
        </div>
        {visibleNotifications.length > 0 ? (
          <div className="workbench-notification-list">
            {visibleNotifications.map((notification) => {
              const archived = props.archivedNotificationIds.has(notification.id);

              return (
                <article
                  key={notification.id}
                  className="workbench-notification-item"
                  data-archived={archived}
                >
                  <button
                    type="button"
                    className="workbench-notification-item-content"
                    onClick={() => {
                      props.onSelectNotification(notification);
                    }}
                  >
                    <span className="workbench-notification-item-kind">
                      {resolveNotificationKindLabel(notification.kind)}
                    </span>
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                  </button>
                  <div className="workbench-notification-item-side">
                    <time>{formatNotificationTime(notification.createdAt)}</time>
                    <button
                      type="button"
                      className="secondary-button workbench-notification-item-action-button"
                      onClick={() => {
                        if (archived) {
                          props.onUnarchiveNotification(notification.id);
                          return;
                        }

                        props.onArchiveNotification(notification.id);
                      }}
                    >
                      {archived
                        ? t("shell.globalNotificationsRemoveArchiveAction")
                        : t("shell.globalNotificationsArchiveAction")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="workbench-notification-empty">{t("shell.globalNotificationsEmpty")}</p>
        )}
      </div>
    </WorkbenchModal>
  );
}

function resolveNotificationKindLabel(kind: WorkbenchGlobalNotificationKind): string {
  switch (kind) {
    case "follow_up_waiting_user":
      return t("shell.globalNotificationKindWaitingUser");
    case "follow_up_completed":
      return t("shell.globalNotificationKindFollowUpCompleted");
    case "follow_up_failed":
      return t("shell.globalNotificationKindFollowUpFailed");
    case "verification_failed":
      return t("shell.globalNotificationKindVerificationFailed");
    default:
      return t("shell.globalNotificationsPanelTitle");
  }
}

function formatNotificationTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

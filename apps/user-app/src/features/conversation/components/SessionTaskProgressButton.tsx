import { useMemo, useState } from "react";

import { t } from "../../../shared/i18n";
import type { ProviderId } from "../api/conversation-api";
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";
import {
  buildConversationTaskSnapshot,
  countConversationTasksByStatus,
  type ConversationTaskItem,
  type ConversationTaskStatus
} from "../session-task-progress";
import { WorkbenchModal } from "./WorkbenchModal";
import { TaskListActionIcon } from "./ConversationActionIcons";

interface SessionTaskProgressButtonProps {
  provider: ProviderId | null;
  messages: SessionMessageViewModel[];
  variant?: "header" | "composer";
}

const TASK_STATUS_PRIORITY: Record<ConversationTaskStatus, number> = {
  in_progress: 0,
  failed: 1,
  pending: 2,
  completed: 3,
  cancelled: 4
};

export function SessionTaskProgressButton({
  provider,
  messages,
  variant = "header"
}: SessionTaskProgressButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const snapshot = useMemo(
    () => buildConversationTaskSnapshot(messages, provider),
    [messages, provider]
  );

  if (!snapshot || snapshot.items.length === 0) {
    return null;
  }

  const summary = countConversationTasksByStatus(snapshot.items);
  const activeCount = summary.in_progress || summary.pending;
  const badgeCount = activeCount > 0 ? activeCount : snapshot.items.length;
  const sortedItems = [...snapshot.items].sort((left, right) => {
    const statusDiff = TASK_STATUS_PRIORITY[left.status] - TASK_STATUS_PRIORITY[right.status];

    if (statusDiff !== 0) {
      return statusDiff;
    }

    return left.updatedAt.localeCompare(right.updatedAt);
  });
  const buttonClassName =
    variant === "composer"
      ? "conversation-task-progress-button composer-task-progress-button"
      : "conversation-header-ai-button conversation-task-progress-button";

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        data-variant={variant}
        aria-label={t("conversation.taskProgressButton", { count: snapshot.items.length })}
        title={t("conversation.taskProgressButton", { count: snapshot.items.length })}
        onClick={() => {
          setModalOpen(true);
        }}
      >
        <span className="conversation-header-ai-button-label" aria-hidden="true">
          <TaskListActionIcon />
        </span>
        <span className="conversation-task-progress-badge">{badgeCount}</span>
      </button>

      <WorkbenchModal
        open={modalOpen}
        title={t("conversation.taskProgressModalTitle")}
        description={t("conversation.taskProgressModalDescription", {
          count: snapshot.items.length
        })}
        className="conversation-task-progress-modal"
        onClose={() => {
          setModalOpen(false);
        }}
      >
        <div className="conversation-task-progress-modal-body">
          <div className="conversation-task-progress-summary">
            <SummaryCard
              label={t("conversation.taskProgressSummaryTotal")}
              value={snapshot.items.length}
            />
            <SummaryCard
              label={t("conversation.taskProgressStatusInProgress")}
              value={summary.in_progress}
            />
            <SummaryCard
              label={t("conversation.taskProgressStatusPending")}
              value={summary.pending}
            />
            <SummaryCard
              label={t("conversation.taskProgressStatusCompleted")}
              value={summary.completed}
            />
            {summary.failed > 0 ? (
              <SummaryCard
                label={t("conversation.taskProgressStatusFailed")}
                value={summary.failed}
              />
            ) : null}
          </div>

          {snapshot.explanation ? (
            <div className="conversation-task-progress-explanation">
              <strong>{t("conversation.taskProgressExplanationTitle")}</strong>
              <p>{snapshot.explanation}</p>
            </div>
          ) : null}

          <ol className="conversation-task-progress-list">
            {sortedItems.map((item) => (
              <li
                key={item.id}
                className="conversation-task-progress-item"
                data-status={item.status}
              >
                <span
                  className="conversation-task-progress-item-indicator"
                  data-status={item.status}
                  aria-hidden="true"
                />
                <div className="conversation-task-progress-item-body">
                  <div className="conversation-task-progress-item-header">
                    <strong>{item.title}</strong>
                    <span className="conversation-task-progress-item-status">
                      {resolveTaskStatusLabel(item.status)}
                    </span>
                  </div>
                  {item.detail ? (
                    <p className="conversation-task-progress-item-detail">{item.detail}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </WorkbenchModal>
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="conversation-task-progress-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function resolveTaskStatusLabel(status: ConversationTaskItem["status"]): string {
  switch (status) {
    case "in_progress":
      return t("conversation.taskProgressStatusInProgress");
    case "completed":
      return t("conversation.taskProgressStatusCompleted");
    case "failed":
      return t("conversation.taskProgressStatusFailed");
    case "cancelled":
      return t("conversation.taskProgressStatusCancelled");
    case "pending":
    default:
      return t("conversation.taskProgressStatusPending");
  }
}

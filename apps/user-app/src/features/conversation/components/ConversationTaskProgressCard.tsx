import type { ReactNode } from "react";

import { t } from "../../../shared/i18n";
import {
  countConversationTasksByStatus,
  type ConversationTaskSnapshot
} from "../session-task-progress";

interface ConversationTaskProgressCardProps {
  snapshot: ConversationTaskSnapshot;
  toolName?: string;
  expanded?: boolean;
  exportMode?: boolean;
  className?: string;
  children?: ReactNode;
  onToggleExpanded?: () => void;
}

export function ConversationTaskProgressCard({
  snapshot,
  toolName = "",
  expanded = false,
  exportMode = false,
  className,
  children,
  onToggleExpanded
}: ConversationTaskProgressCardProps) {
  const summary = countConversationTasksByStatus(snapshot.items);
  const normalizedToolName = toolName.trim().toLowerCase().replace(/[\s_.-]+/g, "");
  const shouldShowClaudePlanNotes = normalizedToolName === "exitplanmode";
  const rawLabel = expanded
    ? t("conversation.taskCardRawCollapse")
    : t("conversation.taskCardRawExpand");
  const cardClassName = className
    ? `tool-call-item task-tool-item ${className}`
    : "tool-call-item task-tool-item";

  return (
    <div className={cardClassName}>
      <div className="task-tool-header">
        <div className="task-tool-heading">
          <span className="task-tool-badge">
            {snapshot.source === "plan"
              ? t("conversation.taskCardPlanTitle")
              : t("conversation.taskCardTodoTitle")}
          </span>
          <div className="task-tool-heading-main">
            <strong>{resolveTaskCardTitle(snapshot, toolName)}</strong>
            <span className="task-tool-summary-text">
              {buildTaskCardSummaryText(snapshot.items, summary)}
            </span>
          </div>
        </div>
        {!exportMode && onToggleExpanded ? (
          <button
            type="button"
            className="task-tool-raw-toggle"
            onClick={onToggleExpanded}
          >
            {rawLabel}
          </button>
        ) : null}
      </div>

      {shouldShowClaudePlanNotes && (snapshot.explanation || (snapshot.allowedPrompts?.length ?? 0) > 0) ? (
        <div className="task-tool-notes">
          {snapshot.explanation ? (
            <div className="task-tool-note-block">
              <span className="task-tool-note-label">{t("conversation.taskProgressExplanationTitle")}</span>
              <p className="task-tool-note-text">{snapshot.explanation}</p>
            </div>
          ) : null}
          {(snapshot.allowedPrompts?.length ?? 0) > 0 ? (
            <div className="task-tool-note-block">
              <span className="task-tool-note-label">{t("conversation.taskCardAllowedPromptsTitle")}</span>
              <ul className="task-tool-note-list">
                {snapshot.allowedPrompts?.map((item, index) => (
                  <li key={`${item.tool}:${item.prompt}:${index}`} className="task-tool-note-list-item">
                    <strong>{item.tool}</strong>
                    <span>{item.prompt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <ol className="task-tool-list">
        {snapshot.items.map((item) => (
          <li key={item.id} className="task-tool-list-item" data-status={item.status}>
            <span className="task-tool-item-indicator" data-status={item.status} aria-hidden="true" />
            <strong className="task-tool-item-title">{item.title}</strong>
            {item.detail ? <span className="task-tool-item-detail">{item.detail}</span> : null}
            <span className="task-tool-item-status">{resolveTaskCardStatusLabel(item.status)}</span>
          </li>
        ))}
      </ol>

      {children}
    </div>
  );
}

function resolveTaskCardTitle(snapshot: ConversationTaskSnapshot, toolName: string): string {
  if (snapshot.source === "plan") {
    return t("conversation.taskCardPlanUpdated");
  }

  const normalized = toolName.trim().toLowerCase();

  if (normalized === "taskcreate" || normalized === "todowrite" || normalized === "todoread") {
    return t("conversation.taskCardTodoUpdated");
  }

  if (normalized.startsWith("task")) {
    return t("conversation.taskCardTodoUpdated");
  }

  return t("conversation.taskCardTodoUpdated");
}

function buildTaskCardSummaryText(
  items: ConversationTaskSnapshot["items"],
  summary: ReturnType<typeof countConversationTasksByStatus>
): string {
  const parts = [t("conversation.taskCardSummaryTotal", { count: items.length })];

  if (summary.in_progress > 0) {
    parts.push(t("conversation.taskCardSummaryInProgress", { count: summary.in_progress }));
  }

  if (summary.pending > 0) {
    parts.push(t("conversation.taskCardSummaryPending", { count: summary.pending }));
  }

  if (summary.completed > 0) {
    parts.push(t("conversation.taskCardSummaryCompleted", { count: summary.completed }));
  }

  if (summary.failed > 0) {
    parts.push(t("conversation.taskCardSummaryFailed", { count: summary.failed }));
  }

  return parts.join(" / ");
}

function resolveTaskCardStatusLabel(status: ConversationTaskSnapshot["items"][number]["status"]): string {
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

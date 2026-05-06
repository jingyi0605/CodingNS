import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { t } from "../../../shared/i18n";
import type { ProviderId } from "../api/conversation-api";
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";
import {
  buildConversationTaskSnapshot,
  countConversationTasksByStatus
} from "../session-task-progress";
import { ConversationTaskProgressCard } from "./ConversationTaskProgressCard";
import { TaskListActionIcon } from "./ConversationActionIcons";

interface SessionTaskProgressButtonProps {
  provider: ProviderId | null;
  messages: SessionMessageViewModel[];
  variant?: "header" | "composer";
}

interface TaskProgressPopoverStyle {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

const TASK_PROGRESS_POPOVER_GAP = 12;
const TASK_PROGRESS_POPOVER_MARGIN = 16;
const TASK_PROGRESS_POPOVER_MAX_WIDTH = 640;
const TASK_PROGRESS_POPOVER_MIN_HEIGHT = 180;

export function SessionTaskProgressButton({
  provider,
  messages,
  variant = "header"
}: SessionTaskProgressButtonProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<TaskProgressPopoverStyle | null>(null);
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const snapshot = useMemo(
    () => buildConversationTaskSnapshot(messages, provider),
    [messages, provider]
  );

  useLayoutEffect(() => {
    if (!popoverOpen) {
      return;
    }

    function updatePopoverStyle() {
      const root = rootRef.current;

      if (!root) {
        return;
      }

      const rect = root.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(
        TASK_PROGRESS_POPOVER_MAX_WIDTH,
        Math.max(280, viewportWidth - TASK_PROGRESS_POPOVER_MARGIN * 2)
      );
      const triggerCenterX = rect.left + rect.width / 2;
      const preferredLeft = triggerCenterX - width / 2;
      const left = clamp(
        preferredLeft,
        TASK_PROGRESS_POPOVER_MARGIN,
        Math.max(TASK_PROGRESS_POPOVER_MARGIN, viewportWidth - width - TASK_PROGRESS_POPOVER_MARGIN)
      );

      if (variant === "header") {
        setPopoverStyle({
          left,
          width,
          top: Math.min(
            rect.bottom + TASK_PROGRESS_POPOVER_GAP,
            viewportHeight - TASK_PROGRESS_POPOVER_MIN_HEIGHT - TASK_PROGRESS_POPOVER_MARGIN
          ),
          maxHeight: Math.max(
            TASK_PROGRESS_POPOVER_MIN_HEIGHT,
            viewportHeight - rect.bottom - TASK_PROGRESS_POPOVER_GAP - TASK_PROGRESS_POPOVER_MARGIN
          )
        });
        return;
      }

      setPopoverStyle({
        left,
        width,
        bottom: Math.max(
          TASK_PROGRESS_POPOVER_MARGIN,
          viewportHeight - rect.top + TASK_PROGRESS_POPOVER_GAP
        ),
        maxHeight: Math.max(
          TASK_PROGRESS_POPOVER_MIN_HEIGHT,
          rect.top - TASK_PROGRESS_POPOVER_GAP - TASK_PROGRESS_POPOVER_MARGIN
        )
      });
    }

    updatePopoverStyle();
    window.addEventListener("resize", updatePopoverStyle);
    window.addEventListener("scroll", updatePopoverStyle, true);

    return () => {
      window.removeEventListener("resize", updatePopoverStyle);
      window.removeEventListener("scroll", updatePopoverStyle, true);
    };
  }, [popoverOpen, variant]);

  useEffect(() => {
    if (!popoverOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const root = rootRef.current;
      const popover = popoverRef.current;
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (root?.contains(target) || popover?.contains(target)) {
        return;
      }

      setPopoverOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPopoverOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [popoverOpen]);

  if (!snapshot || snapshot.items.length === 0) {
    return null;
  }

  const summary = countConversationTasksByStatus(snapshot.items);
  const activeCount = summary.in_progress || summary.pending;
  const badgeCount = activeCount > 0 ? activeCount : snapshot.items.length;
  const buttonClassName =
    variant === "composer"
      ? "conversation-task-progress-button composer-task-progress-button"
      : "conversation-header-ai-button conversation-task-progress-button";
  const popover = popoverOpen && popoverStyle
    ? createPortal(
        <div
          id={popoverId}
          ref={popoverRef}
          className="conversation-task-progress-popover"
          role="region"
          aria-label={t("conversation.taskProgressModalTitle")}
          style={{
            left: popoverStyle.left,
            width: popoverStyle.width,
            maxHeight: popoverStyle.maxHeight,
            top: popoverStyle.top,
            bottom: popoverStyle.bottom
          }}
        >
          <ConversationTaskProgressCard
            snapshot={snapshot}
            className="conversation-task-progress-popover-card"
          />
        </div>,
        document.body
      )
    : null;

  return (
    <div className="conversation-task-progress-entry" data-variant={variant} ref={rootRef}>
      <button
        type="button"
        className={buttonClassName}
        data-variant={variant}
        aria-label={t("conversation.taskProgressButton", { count: snapshot.items.length })}
        aria-expanded={popoverOpen}
        aria-controls={popoverOpen ? popoverId : undefined}
        title={t("conversation.taskProgressButton", { count: snapshot.items.length })}
        onClick={() => {
          setPopoverOpen((current) => !current);
        }}
      >
        <span className="conversation-header-ai-button-label" aria-hidden="true">
          <TaskListActionIcon />
        </span>
        <span className="conversation-task-progress-badge">{badgeCount}</span>
      </button>
      {popover}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

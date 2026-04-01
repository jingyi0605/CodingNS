import { t } from "../../shared/i18n";
import type {
  SessionActivityResolutionSource,
  SessionActivitySource,
  SessionActivityState,
  SessionRunningState
} from "./api/conversation-api";

export interface SessionActivityDisplayInput {
  runningState?: SessionRunningState | null;
  activityState?: SessionActivityState | null;
  activitySource?: SessionActivitySource | null;
  activityResolutionSource?: SessionActivityResolutionSource | null;
  lastErrorCode?: string | null;
  lastErrorDetail?: string | null;
}

type SessionIndicatorVariant =
  | "error"
  | "idle"
  | "unread"
  | "running"
  | "running_inferred"
  | "stale"
  | "unknown";

export function hasSessionDisplayError(session: SessionActivityDisplayInput): boolean {
  return (
    session.runningState === "failed"
    || Boolean(session.lastErrorCode?.trim())
    || Boolean(session.lastErrorDetail?.trim())
  );
}

export function resolveSessionIndicatorClassName(
  baseClassName: string,
  session: SessionActivityDisplayInput,
  options?: {
    hasSubagents?: boolean;
    isActive?: boolean;
  }
): string {
  void options;
  const variant = resolveSessionIndicatorVariant(session);

  if (variant === "running_inferred") {
    return `${baseClassName} is-running-inferred`;
  }

  // 多 agent 只影响树结构和交互，不该改写会话状态语义。
  return `${baseClassName} is-${variant.replace("_", "-")}`;
}

export function resolveSessionActivityBadgeLabel(
  session: SessionActivityDisplayInput
): string | null {
  if (session.runningState === "stale") {
    return t("conversation.runtimeStale");
  }

  if (session.runningState === "unknown") {
    return t("conversation.runtimeUnknown");
  }

  return null;
}

export function resolveSessionActivityBadgeClassName(
  baseClassName: string,
  session: SessionActivityDisplayInput
): string | null {
  if (session.runningState === "stale") {
    return `${baseClassName} is-stale`;
  }

  if (session.runningState === "unknown") {
    return `${baseClassName} is-unknown`;
  }

  return null;
}

function resolveSessionIndicatorVariant(
  session: SessionActivityDisplayInput
): SessionIndicatorVariant {
  if (hasSessionDisplayError(session)) {
    return "error";
  }

  if (session.runningState === "stale") {
    return "stale";
  }

  if (session.runningState === "unknown") {
    return "unknown";
  }

  if (session.activityState === "running") {
    return isInferredActivitySource(session) ? "running_inferred" : "running";
  }

  if (session.activityState === "completed_unread") {
    return "unread";
  }

  return "idle";
}

function isInferredActivitySource(session: SessionActivityDisplayInput): boolean {
  return session.activityResolutionSource === "inferred_log" || session.activitySource === "inferred";
}

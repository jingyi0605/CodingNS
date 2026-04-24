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

type SessionIndicatorClassVariant =
  | "error"
  | "idle"
  | "unread"
  | "running"
  | "running-inferred"
  | "stale"
  | "unknown"
  | "subagent"
  | "subagent-unread"
  | "subagent-running";

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
  return `${baseClassName} is-${resolveSessionIndicatorClassVariant(session, options)}`;
}

export function resolveSessionIndicatorClassVariant(
  session: SessionActivityDisplayInput,
  options?: {
    hasSubagents?: boolean;
    isActive?: boolean;
  }
): SessionIndicatorClassVariant {
  void options?.isActive;
  const variant = resolveSessionIndicatorVariant(session);

  if (options?.hasSubagents) {
    if (variant === "error") {
      return "error";
    }

    if (variant === "unread") {
      return "subagent-unread";
    }

    if (variant === "running" || variant === "running_inferred") {
      return "subagent-running";
    }

    return "subagent";
  }

  if (variant === "running_inferred") {
    return "running-inferred";
  }

  return variant.replace("_", "-") as SessionIndicatorClassVariant;
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

export function isSessionRunning(session: SessionActivityDisplayInput | null | undefined): boolean {
  if (!session) {
    return false;
  }

  if (session.activityState === "running") {
    return true;
  }

  return (
    session.runningState === "starting"
    || session.runningState === "running"
    || session.runningState === "reconnecting"
  );
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

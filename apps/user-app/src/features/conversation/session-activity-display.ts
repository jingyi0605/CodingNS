import { t } from "../../shared/i18n";
import type {
  ForkMethod,
  ForkSourceType,
  SessionActivityResolutionSource,
  SessionActivitySource,
  SessionActivityState,
  SessionRunningState
} from "./api/conversation-api";
import { isRealSubagentSession } from "./session-fork-display";

export interface SessionActivityDisplayInput {
  runningState?: SessionRunningState | null;
  activityState?: SessionActivityState | null;
  activitySource?: SessionActivitySource | null;
  activityResolutionSource?: SessionActivityResolutionSource | null;
  lastErrorCode?: string | null;
  lastErrorDetail?: string | null;
  isSubagent?: boolean | null;
  forkMethod?: ForkMethod | null;
  forkSourceType?: ForkSourceType | null;
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
  if (!isRealSubagentSession(session)) {
    return null;
  }

  const lifecycleState = resolveSessionLifecycleState(session);

  switch (lifecycleState) {
    case "starting":
      return t("conversation.runtimeStarting");
    case "running":
      return t("conversation.runtimeRunning");
    case "reconnecting":
      return t("conversation.runtimeReconnecting");
    case "stale":
      return t("conversation.runtimeStale");
    case "unknown":
      return t("conversation.runtimeUnknown");
    case "completed":
      return t("conversation.runtimeCompleted");
    case "interrupted":
      return t("conversation.runtimeInterrupted");
    case "failed":
      return t("conversation.runtimeFailed");
    default:
      return null;
  }
}

export function resolveSessionActivityBadgeClassName(
  baseClassName: string,
  session: SessionActivityDisplayInput
): string | null {
  if (!isRealSubagentSession(session)) {
    return null;
  }

  const lifecycleState = resolveSessionLifecycleState(session);

  if (!lifecycleState || lifecycleState === "idle") {
    return null;
  }

  return `${baseClassName} is-${lifecycleState.replace("_", "-")}`;
}


function resolveSessionLifecycleState(
  session: SessionActivityDisplayInput
): SessionRunningState | null {
  if (hasSessionDisplayError(session)) {
    return "failed";
  }

  if (session.runningState === "starting") {
    return "starting";
  }

  if (session.runningState === "reconnecting") {
    return "reconnecting";
  }

  if (session.activityState === "running" || session.runningState === "running") {
    return "running";
  }

  if (session.runningState === "stale") {
    return "stale";
  }

  if (session.runningState === "unknown") {
    return "unknown";
  }

  if (session.runningState === "interrupted") {
    return "interrupted";
  }

  if (session.activityState === "completed_unread" || session.runningState === "completed") {
    return "completed";
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

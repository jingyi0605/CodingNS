import { t } from "../../shared/i18n";

import type { ForkMethod, ForkSourceType } from "./api/conversation-api";

export type SessionForkBadgeTone = "session" | "message" | "reconstructed";

export function hasSessionForkMetadata(session: {
  forkMethod?: ForkMethod | null;
  forkSourceType?: ForkSourceType | null;
}): boolean {
  return resolveSessionForkBadgeTone(session) !== null;
}

export function isRealSubagentSession(session: {
  isSubagent?: boolean;
  forkMethod?: ForkMethod | null;
  forkSourceType?: ForkSourceType | null;
}): boolean {
  return session.isSubagent === true && !hasSessionForkMetadata(session);
}

export function resolveSessionForkBadgeTone(session: {
  forkMethod?: ForkMethod | null;
  forkSourceType?: ForkSourceType | null;
}): SessionForkBadgeTone | null {
  if (session.forkMethod === "reconstructed_message_fork") {
    return "reconstructed";
  }

  if (session.forkMethod === "native_message_fork" || session.forkSourceType === "message") {
    return "message";
  }

  if (session.forkMethod === "native_session_fork" || session.forkSourceType === "session") {
    return "session";
  }

  return null;
}

export function resolveSessionForkBadgeLabel(session: {
  forkMethod?: ForkMethod | null;
  forkSourceType?: ForkSourceType | null;
}): string | null {
  const tone = resolveSessionForkBadgeTone(session);

  if (tone === "reconstructed") {
    return t("shell.sessionForkReconstructed");
  }

  if (tone === "message") {
    return t("shell.sessionForkMessage");
  }

  if (tone === "session") {
    return t("shell.sessionForkSession");
  }

  return null;
}

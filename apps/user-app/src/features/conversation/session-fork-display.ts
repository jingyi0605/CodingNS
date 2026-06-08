import { t } from "../../shared/i18n";

import type { ForkMethod, ForkSourceType, SessionKind } from "./api/conversation-api";

export type SessionForkBadgeTone = "session" | "message" | "reconstructed";
export type SessionKindBadgeTone = "annotation";

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

export function isArchivedSessionVisibleInArchive(session: {
  isArchived?: boolean;
}): boolean {
  return session.isArchived === true;
}

export function resolveArchivedChildSessionBadgeLabel(session: {
  isSubagent?: boolean;
  subagentLabel?: string | null;
  parentSessionId?: string | null;
  displayParentSessionId?: string | null;
  sessionKind?: SessionKind;
  forkMethod?: ForkMethod | null;
  forkSourceType?: ForkSourceType | null;
}): string | null {
  if (!resolveArchivedChildSessionParentId(session)) {
    return null;
  }

  const kindBadge = resolveSessionKindBadgeLabel(session);

  if (kindBadge) {
    return kindBadge;
  }

  const forkBadge = resolveSessionForkBadgeLabel(session);

  if (forkBadge) {
    return forkBadge;
  }

  if (isRealSubagentSession(session)) {
    return session.subagentLabel?.trim() || t("shell.subagentBadge");
  }

  return t("shell.sessionChildBadge");
}

function resolveArchivedChildSessionParentId(session: {
  parentSessionId?: string | null;
  displayParentSessionId?: string | null;
}) {
  return session.displayParentSessionId?.trim() || session.parentSessionId?.trim() || null;
}

export function resolveSessionForkBadgeTone(session: {
  forkMethod?: ForkMethod | null;
  forkSourceType?: ForkSourceType | null;
}): SessionForkBadgeTone | null {
  if (
    session.forkMethod === "reconstructed_message_fork"
    || session.forkMethod === "reconstructed_session_fork"
  ) {
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

export function resolveSessionKindBadgeTone(session: {
  sessionKind?: SessionKind;
}): SessionKindBadgeTone | null {
  return session.sessionKind === "annotation" ? "annotation" : null;
}

export function resolveSessionKindBadgeLabel(session: {
  sessionKind?: SessionKind;
}): string | null {
  return resolveSessionKindBadgeTone(session) === "annotation"
    ? t("conversation.actionSessionBadge")
    : null;
}

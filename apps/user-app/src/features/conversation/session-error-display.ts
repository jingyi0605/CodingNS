import { t } from "../../shared/i18n";
import type { SyncStatus } from "./api/conversation-api";
import { hasSessionDisplayError, type SessionActivityDisplayInput } from "./session-activity-display";

export interface SessionErrorDisplayInput extends SessionActivityDisplayInput {
  syncStatus?: SyncStatus | null;
}

export interface SessionErrorDisplayContent {
  title: string;
  summary: string;
  code: string | null;
  detail: string | null;
}

export function hasSessionErrorDisplayContent(session: SessionErrorDisplayInput): boolean {
  return hasSessionDisplayError(session) || session.syncStatus === "error";
}

export function resolveSessionErrorDisplayContent(
  session: SessionErrorDisplayInput
): SessionErrorDisplayContent | null {
  if (!hasSessionErrorDisplayContent(session)) {
    return null;
  }

  const code = normalizeErrorCode(session.lastErrorCode);
  const detail = normalizeErrorDetail(session.lastErrorDetail);
  const summary = buildSessionErrorSummary(code, detail, session.syncStatus);

  return {
    title: session.syncStatus === "error" && !hasSessionDisplayError(session)
      ? t("conversation.syncStatusError")
      : t("conversation.runtimeErrorTitle"),
    summary,
    code,
    detail
  };
}

function buildSessionErrorSummary(
  code: string | null,
  detail: string | null,
  syncStatus: SyncStatus | null | undefined
): string {
  if (code && detail && !detail.includes(code)) {
    return `${code} · ${detail}`;
  }

  if (detail) {
    return detail;
  }

  if (code) {
    return code;
  }

  if (syncStatus === "error") {
    return t("conversation.syncStatusError");
  }

  return t("conversation.runtimeErrorFallbackDetail");
}

function normalizeErrorCode(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeErrorDetail(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

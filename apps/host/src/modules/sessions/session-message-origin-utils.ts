import { createId } from "../../shared/utils/id.js";
import type { SessionMessageOriginRepository } from "../../storage/repositories/session-message-origin-repository.js";

interface RecordButlerProxyMessageOriginInput {
  sessionId: string;
  clientRequestId?: string | null;
  messageId?: string | null;
  originRef?: string | null;
  content: string;
  createdAt: string;
  fallbackKey?: string | null;
}

export function recordButlerProxyMessageOrigin(
  repository: Pick<SessionMessageOriginRepository, "upsert"> | null | undefined,
  input: RecordButlerProxyMessageOriginInput
): string | null {
  const content = input.content.trim();

  if (!content) {
    return null;
  }

  const clientRequestId =
    input.clientRequestId?.trim()
    || buildFallbackClientRequestId(input.fallbackKey, input.messageId, input.createdAt);

  if (!repository) {
    return clientRequestId;
  }

  repository.upsert({
    sessionId: input.sessionId,
    clientRequestId,
    messageId: isSyntheticMessageId(input.messageId) ? null : normalizeNullableText(input.messageId),
    origin: "butler_proxy",
    originRef: normalizeNullableText(input.originRef),
    content,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  });

  return clientRequestId;
}

function buildFallbackClientRequestId(
  fallbackKey: string | null | undefined,
  messageId: string | null | undefined,
  createdAt: string
): string {
  const normalizedFallbackKey = fallbackKey?.trim();

  if (normalizedFallbackKey) {
    return `assistant-origin:${normalizedFallbackKey}`;
  }

  const normalizedMessageId = normalizeNullableText(messageId);

  if (normalizedMessageId && !isSyntheticMessageId(normalizedMessageId)) {
    return `assistant-origin:${normalizedMessageId}`;
  }

  const timestamp = Number.isFinite(Date.parse(createdAt))
    ? String(Date.parse(createdAt))
    : createId();

  return `assistant-origin:${timestamp}:${createId()}`;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isSyntheticMessageId(messageId: string | null | undefined): boolean {
  return typeof messageId === "string" && messageId.startsWith("synthetic-");
}

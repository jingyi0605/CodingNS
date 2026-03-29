import type {
  NormalizedMessage,
  ProviderId,
  SessionRole
} from "../types.js";
import {
  ensureText,
  extractTextBlocks,
  messageIdFromRawRef,
  nextTimestamp,
  stringifyStructuredValue
} from "./utils.js";

export interface OpenCodeServerSession {
  id?: unknown;
  parentID?: unknown;
  parent_id?: unknown;
  directory?: unknown;
  title?: unknown;
  time?: unknown;
  summary?: unknown;
}

export interface OpenCodeMessageEnvelope {
  info?: unknown;
  parts?: unknown;
}

export interface OpenCodeSessionMetadataRecord {
  parentProviderSessionId: string | null;
  isArchived: boolean;
  messageCount: number;
}

export interface OpenCodePartNormalizationInput {
  sessionId: string;
  providerSessionId: string;
  partId: string;
  messageId: string;
  partPayload: Record<string, unknown>;
  messagePayload: Record<string, unknown>;
  defaultTimestamp: string;
}

export function buildSessionRawStoreRef(sessionId: string): string {
  return `opencode://session/${encodeURIComponent(sessionId)}`;
}

export function buildMessageRawRef(sessionId: string, messageId: string): string {
  return `opencode://session/${encodeURIComponent(sessionId)}/message/${encodeURIComponent(messageId)}`;
}

export function buildPartRawRef(sessionId: string, messageId: string, partId: string): string {
  return `${buildMessageRawRef(sessionId, messageId)}/part/${encodeURIComponent(partId)}`;
}

export function parseSessionIdFromRawStoreRef(rawStoreRef: string): string | null {
  const matched = rawStoreRef.trim().match(/^opencode:\/\/session\/([^/?#]+)/i);
  const sessionId = matched?.[1] ? decodeURIComponent(matched[1]) : "";
  return sessionId || null;
}

export function normalizeOpenCodeMessageEnvelopes(
  sessionId: string,
  providerSessionId: string,
  envelopes: OpenCodeMessageEnvelope[]
): NormalizedMessage[] {
  const messages: Array<{
    message: Omit<NormalizedMessage, "sequence">;
    envelopeIndex: number;
    partIndex: number;
  }> = [];

  for (let envelopeIndex = 0; envelopeIndex < envelopes.length; envelopeIndex += 1) {
    const envelope = envelopes[envelopeIndex];
    const info = toJsonRecord(envelope.info);
    const parts = Array.isArray(envelope.parts) ? envelope.parts : [];

    if (!info || parts.length === 0) {
      continue;
    }

    const messageId = ensureText(info.id).trim();

    if (!messageId) {
      continue;
    }

    const defaultTimestamp =
      toIsoTimestamp(firstValidNumber(toJsonRecord(info.time)?.created), null)
      ?? nextTimestamp();

    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex];
      const partPayload = toJsonRecord(part);
      const partId = ensureText(partPayload?.id).trim();

      if (!partPayload || !partId) {
        continue;
      }

      const normalized = normalizeOpenCodePartMessage({
        sessionId,
        providerSessionId,
        partId,
        messageId,
        partPayload,
        messagePayload: info,
        defaultTimestamp
      });

      if (!normalized) {
        continue;
      }

      messages.push({
        message: normalized,
        envelopeIndex,
        partIndex
      });
    }
  }

  messages.sort((left, right) => {
    if (left.message.timestamp !== right.message.timestamp) {
      return left.message.timestamp.localeCompare(right.message.timestamp);
    }

    if (left.envelopeIndex !== right.envelopeIndex) {
      return left.envelopeIndex - right.envelopeIndex;
    }

    if (left.partIndex !== right.partIndex) {
      return left.partIndex - right.partIndex;
    }

    return left.message.rawRef.localeCompare(right.message.rawRef);
  });

  return messages.map((entry, index) => ({
    ...entry.message,
    sequence: index + 1
  }));
}

export function normalizeOpenCodePartMessage(
  input: OpenCodePartNormalizationInput
): Omit<NormalizedMessage, "sequence"> | null {
  const partType = normalizePartType(input.partPayload.type);
  const role = resolveMessageRole(input.messagePayload);
  const rawRef = buildPartRawRef(input.sessionId, input.messageId, input.partId);
  const timestamp = resolvePartTimestamp(
    input.partPayload,
    input.messagePayload,
    input.defaultTimestamp
  );
  const provider = "opencode" satisfies ProviderId;
  const providerSessionId = input.providerSessionId;

  if (partType === "text") {
    const content = extractOpenCodeTextLikeContent(input.partPayload).trim();

    if (content.length === 0) {
      return null;
    }

    return {
      messageId: messageIdFromRawRef(rawRef),
      provider,
      providerSessionId,
      role,
      kind: "text",
      content,
      toolCall: null,
      timestamp,
      rawRef
    };
  }

  if (partType === "reasoning") {
    const content = extractOpenCodeTextLikeContent(input.partPayload).trim();

    if (content.length === 0) {
      return null;
    }

    return {
      messageId: messageIdFromRawRef(rawRef),
      provider,
      providerSessionId,
      role: "assistant",
      kind: "thinking",
      content,
      toolCall: null,
      timestamp,
      rawRef
    };
  }

  if (partType === "tool") {
    return normalizeToolPart(input, rawRef, timestamp);
  }

  if (partType === "patch") {
    return {
      messageId: messageIdFromRawRef(rawRef),
      provider,
      providerSessionId,
      role: "assistant",
      kind: "text",
      content: buildOpenCodePatchSummary(input.partPayload),
      toolCall: null,
      timestamp,
      rawRef
    };
  }

  if (partType === "step-start" || partType === "step-finish") {
    return null;
  }

  const marker = `[${partType || "unknown"}]`;
  const fallbackText = extractTextBlocks(input.partPayload).trim();
  const fallbackContent = fallbackText ? `${marker} ${fallbackText}` : marker;

  return {
    messageId: messageIdFromRawRef(rawRef),
    provider,
    providerSessionId,
    role,
    kind: "text",
    content: fallbackContent,
    toolCall: null,
    timestamp,
    rawRef
  };
}

export function resolveMessageRole(payload: Record<string, unknown>): SessionRole {
  const role = ensureText(payload.role).trim().toLowerCase();

  if (role === "user") {
    return "user";
  }

  if (role === "assistant") {
    return "assistant";
  }

  if (role === "tool") {
    return "tool";
  }

  return "system";
}

export function normalizeOpenCodeToolStatus(
  value: unknown
): "running" | "completed" | "failed" {
  const status = ensureText(value).trim().toLowerCase();

  if (status === "running" || status === "pending") {
    return "running";
  }

  if (status === "completed" || status === "done" || status === "success") {
    return "completed";
  }

  return "failed";
}

export function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function readInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  const parsed = Number.parseInt(ensureText(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function firstValidNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed =
      typeof value === "number"
        ? value
        : Number.parseInt(ensureText(value), 10);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

export function toIsoTimestamp(value: unknown, fallback: string | null): string | null {
  const numeric =
    typeof value === "number"
      ? value
      : Number.parseInt(ensureText(value), 10);

  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric).toISOString();
  }

  const text = ensureText(value).trim();

  if (text.length > 0) {
    const parsedMs = Date.parse(text);

    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return new Date(parsedMs).toISOString();
    }
  }

  return fallback;
}

export function workspaceMatches(targetPath: string, sessionPath: string): boolean {
  if (!targetPath) {
    return true;
  }

  if (!sessionPath) {
    return false;
  }

  return targetPath === sessionPath;
}

function normalizeToolPart(
  input: OpenCodePartNormalizationInput,
  rawRef: string,
  timestamp: string
): Omit<NormalizedMessage, "sequence"> {
  const state = toJsonRecord(input.partPayload.state) ?? {};
  const toolName = ensureText(input.partPayload.tool).trim() || "tool";
  const callId =
    ensureText(input.partPayload.callID).trim()
    || ensureText(input.partPayload.callId).trim()
    || rawRef;
  const status = normalizeOpenCodeToolStatus(state.status);
  const toolInput = stringifyStructuredValue(state.input).trim();
  const outputText =
    extractTextBlocks(state.output).trim()
    || stringifyStructuredValue(state.output).trim();
  const errorText = extractTextBlocks(state.error).trim();
  const provider = "opencode" satisfies ProviderId;
  const providerSessionId = input.providerSessionId;

  if (status === "running") {
    return {
      messageId: messageIdFromRawRef(rawRef),
      provider,
      providerSessionId,
      role: "tool",
      kind: "tool_call",
      content: toolInput,
      toolCall: {
        callId,
        name: toolName,
        input: toolInput,
        output: null,
        error: null,
        status: "running"
      },
      timestamp,
      rawRef
    };
  }

  const resolvedError = status === "failed" ? errorText || outputText || "tool call failed" : null;
  const resolvedOutput =
    status === "completed"
      ? outputText || errorText || "[tool result]"
      : null;
  const content = resolvedError ?? resolvedOutput ?? toolInput;

  return {
    messageId: messageIdFromRawRef(rawRef),
    provider,
    providerSessionId,
    role: "tool",
    kind: "tool_result",
    content,
    toolCall: {
      callId,
      name: toolName,
      input: toolInput,
      output: resolvedOutput,
      error: resolvedError,
      status
    },
    timestamp,
    rawRef
  };
}

function normalizePartType(value: unknown): string {
  return ensureText(value).trim().toLowerCase();
}

function extractOpenCodeTextLikeContent(partPayload: Record<string, unknown>): string {
  for (const key of ["text", "content", "message", "thinking"]) {
    const content = extractTextBlocks(partPayload[key]).trim();

    if (content.length > 0) {
      return content;
    }
  }

  return "";
}

function buildOpenCodePatchSummary(partPayload: Record<string, unknown>): string {
  const files = Array.isArray(partPayload.files)
    ? partPayload.files
        .map((value) => ensureText(value).trim())
        .filter((value) => value.length > 0)
    : [];

  if (files.length === 0) {
    return "[patch] generated";
  }

  const fileNames = files.map((file) => getTrailingPathSegment(file));
  const preview = fileNames.slice(0, 3).join(", ");
  const suffix = fileNames.length > 3 ? ", ..." : "";
  const noun = files.length === 1 ? "file" : "files";

  return `[patch] ${files.length} ${noun} changed: ${preview}${suffix}`;
}

function getTrailingPathSegment(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) || path;
}

function resolvePartTimestamp(
  partPayload: Record<string, unknown>,
  messagePayload: Record<string, unknown>,
  fallback: string
): string {
  const partTime = toJsonRecord(partPayload.time);
  const messageTime = toJsonRecord(messagePayload.time);

  return (
    toIsoTimestamp(
      firstValidNumber(
        partTime?.end,
        partTime?.start,
        partTime?.created,
        messageTime?.created,
        messageTime?.completed
      ),
      null
    ) ?? fallback
  );
}

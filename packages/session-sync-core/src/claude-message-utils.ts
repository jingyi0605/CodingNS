import {
  buildApplyPatchFromClaudeEdit,
  buildApplyPatchFromClaudeWrite
} from "./patch-builder.js";
import {
  ensureText,
  extractTextBlocks,
  messageIdFromRawRef,
  stringifyStructuredValue
} from "./providers/utils.js";
import type { MessageKind, NormalizedMessage } from "./types.js";

export type ClaudeEnvelopeSource = "direct" | "progress" | "stream_event";
export type ClaudeEnvelopeRole = "user" | "assistant";
export type ClaudeToolStatus = "running" | "completed" | "failed";

export interface ClaudeMessageEnvelope {
  type: ClaudeEnvelopeRole;
  source: ClaudeEnvelopeSource;
  messageId: string | null;
  envelopeKey?: string | null;
  timestamp: unknown;
  message: {
    content?: unknown;
  };
}

export interface ClaudeStableMessageRef {
  rawRef: string;
  sequence: number;
}

export function buildClaudeProgressiveTrackKey(
  message: Pick<NormalizedMessage, "providerSessionId" | "role" | "kind" | "rawRef" | "timestamp">,
  partIndex: number
): string | null {
  if (
    message.kind !== "text"
    && message.kind !== "thinking"
    && message.kind !== "tool_call"
    && message.kind !== "tool_result"
  ) {
    return null;
  }

  if (message.role !== "assistant" && message.role !== "tool") {
    return null;
  }

  if (isClaudeFallbackRawRef(message.rawRef)) {
    return `${message.providerSessionId}:${message.role}:${message.kind}:timestamp:${message.timestamp}:part:${partIndex}`;
  }

  return `${message.providerSessionId}:${message.role}:${message.kind}:${message.rawRef}`;
}

function isClaudeFallbackRawRef(rawRef: string): boolean {
  const prefix = "claude-code://message/";

  if (!rawRef.startsWith(prefix)) {
    return false;
  }

  try {
    return decodeURIComponent(rawRef.slice(prefix.length)).startsWith("fallback:");
  } catch {
    return false;
  }
}

export function shouldReuseClaudeProgressiveIdentity(
  previous: Pick<NormalizedMessage, "providerSessionId" | "role" | "kind" | "content" | "toolCall">,
  next: Pick<NormalizedMessage, "providerSessionId" | "role" | "kind" | "content" | "toolCall">
): boolean {
  if (
    previous.providerSessionId !== next.providerSessionId
    || previous.role !== next.role
    || previous.kind !== next.kind
  ) {
    return false;
  }

  if (next.kind === "text" || next.kind === "thinking" || next.kind === "tool_result") {
    return next.content === previous.content || next.content.startsWith(previous.content);
  }

  if (next.kind === "tool_call") {
    return (
      (next.content === previous.content || next.content.startsWith(previous.content))
      && (previous.toolCall?.name ?? "") === (next.toolCall?.name ?? "")
    );
  }

  return false;
}

export function buildClaudeMessageSignature(
  message: Pick<NormalizedMessage, "role" | "kind" | "content" | "toolCall">
): string {
  return JSON.stringify({
    role: message.role,
    kind: message.kind ?? null,
    content: message.content,
    toolCall: message.toolCall
      ? {
          callId: message.toolCall.callId,
          name: message.toolCall.name,
          input: message.toolCall.input,
          output: message.toolCall.output,
          error: message.toolCall.error,
          status: message.toolCall.status
        }
      : null
  });
}

export function toClaudeRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

export function readClaudeMessageId(
  message: Record<string, unknown>,
  record?: Record<string, unknown>
): string | null {
  const id = ensureText(message.id).trim();

  if (id.length > 0) {
    return id;
  }

  const messageId = ensureText(message.message_id).trim();

  if (messageId.length > 0) {
    return messageId;
  }

  const messageUuid = ensureText(message.uuid).trim();

  if (messageUuid.length > 0) {
    return messageUuid;
  }

  if (record) {
    const recordUuid = ensureText(record.uuid).trim();

    if (recordUuid.length > 0) {
      return recordUuid;
    }

    const promptId = ensureText(record.promptId).trim();

    if (promptId.length > 0) {
      return promptId;
    }
  }

  return null;
}

export function normalizeClaudeMessageParts(content: unknown): Array<Record<string, unknown>> {
  if (content === undefined || content === null) {
    return [];
  }

  const items = Array.isArray(content) ? content : [content];

  return items
    .map((item) => {
      if (typeof item === "string") {
        return {
          type: "text",
          text: item
        };
      }

      if (!item || typeof item !== "object") {
        const text = ensureText(item).trim();

        return text.length > 0
          ? {
              type: "text",
              text
            }
          : null;
      }

      return item as Record<string, unknown>;
    })
    .filter((item): item is Record<string, unknown> => item !== null);
}

export function buildClaudeStableRawRef(identity: string): string {
  return `claude-code://message/${encodeURIComponent(identity)}`;
}

export function readClaudeStableRawRefIdentity(rawRef: string): string | null {
  const prefix = "claude-code://message/";

  if (!rawRef.startsWith(prefix)) {
    return null;
  }

  try {
    return decodeURIComponent(rawRef.slice(prefix.length));
  } catch {
    return null;
  }
}

export function buildClaudePartIdentity(input: {
  part: Record<string, unknown>;
  partType: string;
  envelope: ClaudeMessageEnvelope;
  partIndex: number;
}): string {
  const { part, partType, envelope, partIndex } = input;
  const normalizedType = partType || "text";

  if (normalizedType === "tool_use") {
    const toolId = ensureText(part.id).trim();

    if (toolId.length > 0) {
      return `tool_use:${toolId}`;
    }
  }

  if (normalizedType === "tool_result") {
    const toolId = ensureText(part.tool_use_id).trim();

    if (toolId.length > 0) {
      return `tool_result:${toolId}`;
    }
  }

  if (envelope.messageId) {
    if (
      envelope.type === "assistant" &&
      (normalizedType === "text" || normalizedType === "thinking")
    ) {
      return `message:${envelope.type}:${envelope.messageId}:type:${normalizedType}`;
    }

    return `message:${envelope.type}:${envelope.messageId}:part:${partIndex}:type:${normalizedType}`;
  }

  if (envelope.envelopeKey) {
    if (
      envelope.type === "assistant" &&
      (normalizedType === "text" || normalizedType === "thinking")
    ) {
      return `stream:${envelope.type}:${envelope.envelopeKey}:type:${normalizedType}`;
    }

    return `stream:${envelope.type}:${envelope.envelopeKey}:part:${partIndex}:type:${normalizedType}`;
  }

  const contentSeed = resolveClaudePartContentSeed(part, normalizedType);
  return [
    "fallback",
    envelope.source,
    envelope.type,
    `timestamp:${ensureText(envelope.timestamp).trim() || "none"}`,
    `part:${partIndex}`,
    `type:${normalizedType}`,
    `seed:${contentSeed || "none"}`
  ].join(":");
}

export function normalizeClaudeMessagePart(input: {
  part: Record<string, unknown>;
  envelope: ClaudeMessageEnvelope;
  providerSessionId: string;
  partIndex: number;
  timestamp: string;
  toolNameById: Map<string, string>;
  resolveStableMessageRef: (identity: string) => ClaudeStableMessageRef;
}): NormalizedMessage | null {
  const {
    part,
    envelope,
    providerSessionId,
    partIndex,
    timestamp,
    toolNameById,
    resolveStableMessageRef
  } = input;
  const partType = ensureText(part.type).trim();
  const identity = buildClaudePartIdentity({
    part,
    partType,
    envelope,
    partIndex
  });
  const stableMessageRef = resolveStableMessageRef(identity);
  const rawRef = stableMessageRef.rawRef;
  const sequence = stableMessageRef.sequence;

  if (envelope.type === "user") {
    if (partType === "tool_result") {
      const callId = ensureText(part.tool_use_id).trim() || rawRef;
      const output = extractTextBlocks(part.content).trim() || stringifyStructuredValue(part.content);
      const isError = Boolean(part.is_error);

      if (output.length === 0) {
        return null;
      }

      return createClaudeMessage({
        providerSessionId,
        rawRef,
        sequence,
        timestamp,
        role: "tool",
        kind: "tool_result",
        content: output,
        toolCall: {
          callId,
          name: toolNameById.get(callId) ?? "tool",
          input: "",
          output: isError ? null : output,
          error: isError ? output : null,
          status: isError ? "failed" : "completed"
        }
      });
    }

    const content = extractTextBlocks(part).trim();

    if (!content) {
      return null;
    }

    return createClaudeMessage({
      providerSessionId,
      rawRef,
      sequence,
      timestamp,
      role: "user",
      kind: "text",
      content,
      toolCall: null
    });
  }

  if (partType === "tool_use") {
    const callId = ensureText(part.id).trim() || rawRef;
    const name = ensureText(part.name).trim() || "tool";
    const toolInput = stringifyStructuredValue(part.input);

    // 将 Edit / Write 工具转换为 apply_patch 格式，使前端统一渲染 diff 预览
    const patchText = buildApplyPatchFromToolName(name, part.input);
    if (patchText) {
      toolNameById.set(callId, "apply_patch");

      return createClaudeMessage({
        providerSessionId,
        rawRef,
        sequence,
        timestamp,
        role: "tool",
        kind: "tool_call",
        content: patchText,
        toolCall: {
          callId,
          name: "apply_patch",
          input: patchText,
          output: null,
          error: null,
          status: "running"
        }
      });
    }

    toolNameById.set(callId, name);

    if (!name && !toolInput) {
      return null;
    }

    return createClaudeMessage({
      providerSessionId,
      rawRef,
      sequence,
      timestamp,
      role: "tool",
      kind: "tool_call",
      content: toolInput,
      toolCall: {
        callId,
        name,
        input: toolInput,
        output: null,
        error: null,
        status: "running"
      }
    });
  }

  const content = resolveClaudeAssistantContent(part, partType);

  if (!content) {
    return null;
  }

  return createClaudeMessage({
    providerSessionId,
    rawRef,
    sequence,
    timestamp,
    role: "assistant",
    kind: partType === "thinking" ? "thinking" : "text",
    content,
    toolCall: null
  });
}

function createClaudeMessage(input: {
  providerSessionId: string;
  rawRef: string;
  sequence: number;
  timestamp: string;
  role: "user" | "assistant" | "tool";
  kind: MessageKind;
  content: string;
  toolCall:
    | {
        callId: string;
        name: string;
        input: string;
        output: string | null;
        error: string | null;
        status: ClaudeToolStatus;
      }
    | null;
}): NormalizedMessage {
  const { providerSessionId, rawRef, sequence, timestamp, role, kind, content, toolCall } = input;

  return {
    messageId: messageIdFromRawRef(rawRef),
    provider: "claude-code",
    providerSessionId,
    role,
    kind,
    content,
    toolCall,
    timestamp,
    sequence,
    rawRef
  };
}

function resolveClaudeAssistantContent(
  part: Record<string, unknown>,
  partType: string
): string {
  if (partType === "thinking") {
    return extractTextBlocks(part.thinking).trim();
  }

  if (partType === "text" && Object.prototype.hasOwnProperty.call(part, "text")) {
    return ensureText(part.text).trim();
  }

  return extractTextBlocks(part).trim();
}

function resolveClaudePartContentSeed(part: Record<string, unknown>, partType: string): string {
  const source =
    partType === "thinking"
      ? extractTextBlocks(part.thinking).trim()
      : extractTextBlocks(part).trim();

  return normalizeIdentitySeed(source);
}

function normalizeIdentitySeed(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

/**
 * 检测 Claude Code 的 Edit / Write 工具并转换为 apply_patch 格式。
 * 若非编辑类工具则返回 null。
 */
function buildApplyPatchFromToolName(
  toolName: string,
  rawInput: unknown
): string | null {
  if (toolName !== "Edit" && toolName !== "Write") {
    return null;
  }

  const input =
    rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : null;

  if (!input) {
    return null;
  }

  if (toolName === "Edit") {
    return buildApplyPatchFromClaudeEdit(input);
  }

  return buildApplyPatchFromClaudeWrite(input);
}

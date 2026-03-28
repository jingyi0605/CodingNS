import {
  createRawRef,
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
  timestamp: unknown;
  message: {
    content?: unknown;
  };
}

export interface ClaudeStableMessageRef {
  rawRef: string;
  sequence: number;
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

export function buildClaudeStableRawRef(
  rawStoreRef: string,
  sequence: number,
  partIndex: number
): string {
  return createRawRef("claude-code", rawStoreRef, sequence, partIndex);
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
    return `message:${envelope.type}:${envelope.messageId}:part:${partIndex}:type:${normalizedType}`;
  }

  const contentSeed = resolveClaudePartContentSeed(part, normalizedType);
  return [
    "fallback",
    envelope.source,
    envelope.type,
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

  const content =
    partType === "thinking"
      ? extractTextBlocks(part.thinking).trim()
      : extractTextBlocks(part).trim();

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

import type {
  DeliveryState,
  HistoryMessageDto,
  ImageAttachmentPayload,
  MessageAttachmentDto,
  ProviderCapabilitiesDto,
  SessionSummaryDto,
  ToolCallDto
} from "../api/conversation-api";
import { parseMessageRichContent } from "../message-rich-content";

export type RuntimeConnectionState = "connected" | "reconnecting" | "reconnect_failed" | "closed";
export type RuntimeHistoryState = "idle" | "loading" | "ready" | "error";

export interface SessionMessageViewModel {
  id: string;
  sessionId: string;
  role: HistoryMessageDto["role"];
  kind: HistoryMessageDto["kind"];
  content: string;
  toolCall: ToolCallDto | null;
  attachments?: MessageAttachmentDto[];
  attachmentPayloads?: ImageAttachmentPayload[] | null;
  timestamp: string;
  sequence: number;
  rawRef: string;
  deliveryState: DeliveryState;
  clientRequestId: string | null;
}

export interface SessionRuntimeState {
  session: SessionSummaryDto | null;
  capabilities: ProviderCapabilitiesDto | null;
  messages: SessionMessageViewModel[];
  historyState: RuntimeHistoryState;
  loadingOlderMessages: boolean;
  olderCursor: string | null;
  hasOlderMessages: boolean;
  connectionState: RuntimeConnectionState;
  lastCursor: string | null;
  pagesLoaded: number;
  errorCode: string | null;
  errorDetail: string | null;
}

export function createInitialRuntimeState(
  seed?: Partial<Pick<SessionRuntimeState, "session" | "capabilities" | "messages">>
): SessionRuntimeState {
  return {
    session: seed?.session ?? null,
    capabilities: seed?.capabilities ?? null,
    messages: seed?.messages ?? [],
    historyState: "idle",
    loadingOlderMessages: false,
    olderCursor: null,
    hasOlderMessages: false,
    connectionState: "closed",
    lastCursor: null,
    pagesLoaded: 0,
    errorCode: null,
    errorDetail: null
  };
}

export function toViewMessage(
  sessionId: string,
  message: HistoryMessageDto,
  deliveryState: DeliveryState = "sent",
  clientRequestId: string | null = null
): SessionMessageViewModel {
  const kind =
    message.kind ??
    (message.role === "tool"
      ? "tool_result"
      : "text");
  const toolCall =
    message.toolCall ??
    (kind === "tool_call" || kind === "tool_result"
      ? {
          callId: message.rawRef || message.messageId,
          name: "tool",
          input: kind === "tool_call" ? message.content : "",
          output: kind === "tool_result" && message.content ? message.content : null,
          error: null,
          status: kind === "tool_call" ? "running" : "completed"
        }
      : null);

  return {
    id: message.messageId,
    sessionId,
    role: message.role,
    kind,
    content: message.content,
    toolCall,
    attachments: message.attachments ?? [],
    attachmentPayloads: null,
    timestamp: message.timestamp,
    sequence: message.sequence,
    rawRef: message.rawRef,
    deliveryState,
    clientRequestId
  };
}

export function createPendingMessage(
  sessionId: string,
  content: string,
  clientRequestId: string,
  attachments: MessageAttachmentDto[] = [],
  attachmentPayloads: ImageAttachmentPayload[] = []
): SessionMessageViewModel {
  return {
    id: `pending-${clientRequestId}`,
    sessionId,
    role: "user",
    kind: "text",
    content,
    toolCall: null,
    attachments,
    attachmentPayloads,
    timestamp: new Date().toISOString(),
    sequence: Number.MAX_SAFE_INTEGER,
    rawRef: `pending://${clientRequestId}`,
    deliveryState: "sending",
    clientRequestId
  };
}

export function mergeAuthoritativeMessages(
  current: SessionMessageViewModel[],
  sessionId: string,
  incoming: HistoryMessageDto[]
): SessionMessageViewModel[] {
  const nextById = new Map<string, SessionMessageViewModel>();

  for (const item of current) {
    nextById.set(item.id, item);
  }

  for (const message of incoming) {
    const nextMessage = toViewMessage(sessionId, message);
    const optimisticMessageId = findMatchingOptimisticMessageId(nextById, nextMessage);

    if (optimisticMessageId && optimisticMessageId !== nextMessage.id) {
      nextById.delete(optimisticMessageId);
    }

    nextById.set(message.messageId, nextMessage);
  }

  const sorted = Array.from(nextById.values()).sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }

    return left.timestamp.localeCompare(right.timestamp);
  });

  return collapseEquivalentCodexMessages(sorted);
}

export function reconcileMessage(
  current: SessionMessageViewModel[],
  sessionId: string,
  message: HistoryMessageDto,
  clientRequestId: string | null
): SessionMessageViewModel[] {
  const next = current.filter((item) => item.clientRequestId !== clientRequestId);
  return mergeAuthoritativeMessages(next, sessionId, [message]);
}

export function markPendingAsFailed(
  current: SessionMessageViewModel[],
  clientRequestId: string
): SessionMessageViewModel[] {
  return current.map((item) =>
    item.clientRequestId === clientRequestId
      ? {
          ...item,
          deliveryState: "failed"
        }
      : item
  );
}

function collapseEquivalentCodexMessages(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const collapsed: SessionMessageViewModel[] = [];

  for (const message of messages) {
    const previous = collapsed.at(-1);

    if (!previous || !isEquivalentCodexTextMessage(previous, message)) {
      collapsed.push(message);
      continue;
    }

    collapsed[collapsed.length - 1] = pickPreferredCodexTextMessage(previous, message);
  }

  return collapsed;
}

function isEquivalentCodexTextMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): boolean {
  if (
    left.deliveryState !== "sent" ||
    right.deliveryState !== "sent" ||
    !left.rawRef.startsWith("codex://") ||
    !right.rawRef.startsWith("codex://") ||
    left.role !== right.role ||
    left.kind !== right.kind ||
    left.toolCall !== null ||
    right.toolCall !== null
  ) {
    return false;
  }

  if (left.kind !== "text" && left.kind !== "thinking") {
    return false;
  }

  const leftContent = parseMessageRichContent(left.content);
  const rightContent = parseMessageRichContent(right.content);

  return (
    areTimestampsNear(left.timestamp, right.timestamp) &&
    normalizeComparableCodexText(leftContent.text) === normalizeComparableCodexText(rightContent.text) &&
    areEquivalentInlineImages(leftContent.inlineImages, rightContent.inlineImages)
  );
}

function pickPreferredCodexTextMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): SessionMessageViewModel {
  const leftAttachmentCount = left.attachments?.length ?? 0;
  const rightAttachmentCount = right.attachments?.length ?? 0;

  if (leftAttachmentCount !== rightAttachmentCount) {
    return leftAttachmentCount > rightAttachmentCount ? left : right;
  }

  const leftInlineImageCount = parseMessageRichContent(left.content).inlineImages.length;
  const rightInlineImageCount = parseMessageRichContent(right.content).inlineImages.length;

  if (leftInlineImageCount !== rightInlineImageCount) {
    return leftInlineImageCount > rightInlineImageCount ? left : right;
  }

  const leftHasTrailingWhitespace =
    left.content !== normalizeComparableCodexText(left.content);
  const rightHasTrailingWhitespace =
    right.content !== normalizeComparableCodexText(right.content);

  if (leftHasTrailingWhitespace !== rightHasTrailingWhitespace) {
    return leftHasTrailingWhitespace ? right : left;
  }

  return right;
}

function normalizeComparableCodexText(content: string): string {
  return content.replace(/\r\n/g, "\n").trimEnd();
}

function areEquivalentInlineImages(
  left: ReturnType<typeof parseMessageRichContent>["inlineImages"],
  right: ReturnType<typeof parseMessageRichContent>["inlineImages"]
): boolean {
  if (left.length === 0 || right.length === 0) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item.url === right[index]?.url);
}

function findMatchingOptimisticMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  incoming: SessionMessageViewModel
): string | null {
  if (
    incoming.role !== "user" ||
    incoming.kind !== "text" ||
    incoming.rawRef.startsWith("pending://") ||
    incoming.rawRef.startsWith("synthetic://")
  ) {
    return null;
  }

  const incomingTimestampMs = toTimestampMs(incoming.timestamp);
  const comparableIncomingContent = normalizeComparableCodexText(incoming.content);
  let matchedId: string | null = null;
  let matchedDistance = Number.POSITIVE_INFINITY;

  for (const [messageId, current] of messagesById.entries()) {
    if (!isOptimisticUserMessage(current)) {
      continue;
    }

    if (normalizeComparableCodexText(current.content) !== comparableIncomingContent) {
      continue;
    }

    const currentTimestampMs = toTimestampMs(current.timestamp);
    const distance = Math.abs(currentTimestampMs - incomingTimestampMs);

    if (distance > 5 * 60 * 1000) {
      continue;
    }

    if (distance < matchedDistance) {
      matchedId = messageId;
      matchedDistance = distance;
    }
  }

  return matchedId;
}

function isOptimisticUserMessage(message: SessionMessageViewModel): boolean {
  if (message.role !== "user" || message.kind !== "text" || message.deliveryState === "failed") {
    return false;
  }

  return message.rawRef.startsWith("pending://") || message.rawRef.startsWith("synthetic://");
}

function toTimestampMs(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
}

function areTimestampsNear(left: string, right: string): boolean {
  return Math.abs(toTimestampMs(left) - toTimestampMs(right)) <= 1000;
}

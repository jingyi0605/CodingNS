import type {
  DeliveryState,
  HistoryMessageDto,
  ProviderCapabilitiesDto,
  SessionSummaryDto,
  ToolCallDto
} from "../api/conversation-api";

export type RuntimeConnectionState = "connected" | "reconnecting" | "reconnect_failed" | "closed";
export type RuntimeHistoryState = "idle" | "loading" | "ready" | "error";

export interface SessionMessageViewModel {
  id: string;
  sessionId: string;
  role: HistoryMessageDto["role"];
  kind: HistoryMessageDto["kind"];
  content: string;
  toolCall: ToolCallDto | null;
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

export function createInitialRuntimeState(): SessionRuntimeState {
  return {
    session: null,
    capabilities: null,
    messages: [],
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
  clientRequestId: string
): SessionMessageViewModel {
  return {
    id: `pending-${clientRequestId}`,
    sessionId,
    role: "user",
    kind: "text",
    content,
    toolCall: null,
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
    nextById.set(message.messageId, toViewMessage(sessionId, message));
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
    left.timestamp !== right.timestamp ||
    left.toolCall !== null ||
    right.toolCall !== null
  ) {
    return false;
  }

  if (left.kind !== "text" && left.kind !== "thinking") {
    return false;
  }

  return normalizeComparableCodexText(left.content) === normalizeComparableCodexText(right.content);
}

function pickPreferredCodexTextMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): SessionMessageViewModel {
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

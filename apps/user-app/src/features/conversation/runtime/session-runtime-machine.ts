import type {
  AttachmentPayload,
  ContextUsageDto,
  DeliveryState,
  HistoryMessageDto,
  MessageAttachmentDto,
  ProviderCapabilitiesDto,
  SessionPermissionRequestDto,
  SessionRuntimePermissionStatusDto,
  SessionQueueItemDto,
  SessionInterruptSource,
  SessionSummaryDto,
  ToolCallDto
} from "../api/conversation-api";
import type { ConversationTimelineSourceItem } from "../timeline-source-items";
import { parseMessageRichContent } from "../message-rich-content";
import { logSessionMessageDedupDebug } from "../../../shared/debug/perf-debug";

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
  attachmentPayloads?: AttachmentPayload[] | null;
  origin?: HistoryMessageDto["origin"];
  originRef?: HistoryMessageDto["originRef"];
  timestamp: string;
  sequence: number;
  rawRef: string;
  deliveryState: DeliveryState;
  clientRequestId: string | null;
}

export interface SessionRuntimeState {
  session: SessionSummaryDto | null;
  capabilities: ProviderCapabilitiesDto | null;
  runtimeHasActiveRun: boolean | null;
  runtimeCanInterrupt: boolean | null;
  contextUsage: ContextUsageDto | null;
  permissionStatus: SessionRuntimePermissionStatusDto | null;
  messages: SessionMessageViewModel[];
  timelineItems: ConversationTimelineSourceItem[];
  permissionRequests: SessionPermissionRequestDto[];
  queuedMessages: SessionQueueItemDto[];
  historyState: RuntimeHistoryState;
  loadingOlderMessages: boolean;
  olderCursor: string | null;
  hasOlderMessages: boolean;
  connectionState: RuntimeConnectionState;
  lastCursor: string | null;
  pagesLoaded: number;
  interruptSource: SessionInterruptSource | null;
  errorCode: string | null;
  errorDetail: string | null;
}

const RUNTIME_THINKING_PLACEHOLDER_RAW_REF_PREFIX = "runtime-placeholder://thinking/";
const CODEX_EQUIVALENT_AUTHORITATIVE_WINDOW_MS = 2 * 60 * 1000;
const CODEX_EQUIVALENT_AUTHORITATIVE_SEQUENCE_WINDOW = 8;
const INTERNAL_ATTACHMENT_DEBUG_BLOCK_PATTERN =
  /\[\[CODINGNS_IMAGE_ATTACHMENTS\]\][\s\S]*?\[\[\/CODINGNS_IMAGE_ATTACHMENTS\]\]/g;
const INTERNAL_ATTACHMENT_DEBUG_BLOCK_TEST_PATTERN =
  /\[\[CODINGNS_IMAGE_ATTACHMENTS\]\][\s\S]*?\[\[\/CODINGNS_IMAGE_ATTACHMENTS\]\]/;
const INTERNAL_ATTACHMENT_DEBUG_TAIL_PATTERN =
  /\[\[CODINGNS_IMAGE_ATTACHMENTS\]\][\s\S]*$/g;

export function createInitialRuntimeState(
  seed?: Partial<
    Pick<
      SessionRuntimeState,
      | "session"
      | "capabilities"
      | "runtimeHasActiveRun"
      | "runtimeCanInterrupt"
      | "contextUsage"
      | "permissionStatus"
      | "messages"
      | "timelineItems"
      | "permissionRequests"
      | "queuedMessages"
      | "olderCursor"
      | "hasOlderMessages"
      | "lastCursor"
      | "interruptSource"
      | "pagesLoaded"
    >
  >
): SessionRuntimeState {
  return {
    session: seed?.session ?? null,
    capabilities: seed?.capabilities ?? null,
    runtimeHasActiveRun: seed?.runtimeHasActiveRun ?? null,
    runtimeCanInterrupt: seed?.runtimeCanInterrupt ?? null,
    contextUsage: seed?.contextUsage ?? null,
    permissionStatus: seed?.permissionStatus ?? null,
    messages: seed?.messages ?? [],
    timelineItems: seed?.timelineItems ?? [],
    permissionRequests: seed?.permissionRequests ?? [],
    queuedMessages: seed?.queuedMessages ?? [],
    historyState: "idle",
    loadingOlderMessages: false,
    olderCursor: seed?.olderCursor ?? null,
    hasOlderMessages: seed?.hasOlderMessages ?? false,
    connectionState: "closed",
    lastCursor: seed?.lastCursor ?? null,
    pagesLoaded: seed?.pagesLoaded ?? 0,
    interruptSource: seed?.interruptSource ?? null,
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
    content: normalizeViewMessageContent(message.provider, message.role, kind, message.content),
    toolCall,
    attachments: message.attachments ?? [],
    attachmentPayloads: message.attachmentPayloads ?? null,
    origin: message.origin ?? null,
    originRef: message.originRef ?? null,
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
  attachmentPayloads: AttachmentPayload[] = [],
  sequence = Number.MAX_SAFE_INTEGER
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
    origin: null,
    originRef: null,
    timestamp: new Date().toISOString(),
    sequence,
    rawRef: `pending://${clientRequestId}`,
    deliveryState: "sending",
    clientRequestId
  };
}

export function insertPendingMessage(
  current: SessionMessageViewModel[],
  pending: SessionMessageViewModel
): SessionMessageViewModel[] {
  return sortMessages([...current, pending]);
}

export function upsertRuntimeThinkingPlaceholder(
  current: SessionMessageViewModel[],
  sessionId: string,
  content: string
): SessionMessageViewModel[] {
  const withoutPlaceholder = removeRuntimeThinkingPlaceholder(current, sessionId);

  if (!shouldShowRuntimeThinkingPlaceholder(withoutPlaceholder)) {
    return withoutPlaceholder;
  }

  return sortMessages([
    ...withoutPlaceholder,
    createRuntimeThinkingPlaceholder(sessionId, content, getNextRuntimePlaceholderSequence(withoutPlaceholder))
  ]);
}

export function removeRuntimeThinkingPlaceholder(
  current: SessionMessageViewModel[],
  sessionId: string
): SessionMessageViewModel[] {
  const placeholderRawRef = buildRuntimeThinkingPlaceholderRawRef(sessionId);
  const next = current.filter((message) => message.rawRef !== placeholderRawRef);
  return next.length === current.length ? current : next;
}

export function mergeAuthoritativeMessages(
  current: SessionMessageViewModel[],
  sessionId: string,
  incoming: HistoryMessageDto[]
): SessionMessageViewModel[] {
  const nextById = new Map<string, SessionMessageViewModel>();
  const currentMessageIds = new Set<string>();
  const incomingMessages: SessionMessageViewModel[] = [];

  for (const item of current) {
    nextById.set(item.id, item);
    currentMessageIds.add(item.id);
  }

  for (const message of incoming) {
    const nextMessage = toViewMessage(sessionId, message);
    incomingMessages.push(nextMessage);
    const authoritativeMessageId = findMatchingAuthoritativeMessageId(
      nextById,
      nextMessage,
      sessionId
    );

    if (authoritativeMessageId && authoritativeMessageId !== nextMessage.id) {
      continue;
    }

    const optimisticMessageId = findMatchingOptimisticMessageId(
      nextById,
      nextMessage,
      sessionId
    );
    const optimisticMessage =
      optimisticMessageId && optimisticMessageId !== nextMessage.id
        ? (nextById.get(optimisticMessageId) ?? null)
        : null;

    if (optimisticMessageId && optimisticMessageId !== nextMessage.id) {
      nextById.delete(optimisticMessageId);
    }

    const equivalentCodexMessageId = findMatchingEquivalentCodexMessageId(
      nextById,
      currentMessageIds,
      nextMessage
    );

    if (equivalentCodexMessageId && equivalentCodexMessageId !== nextMessage.id) {
      const equivalentCodexMessage = nextById.get(equivalentCodexMessageId) ?? null;

      if (equivalentCodexMessage) {
        const mergedEquivalentMessage = mergeCodexEquivalentAuthoritativeVersion(
          equivalentCodexMessage,
          nextMessage
        );
        logSessionMessageDedupDebug("session.messages.codex_equivalent_replace", {
          sessionId,
          previous: summarizeMessageForDebug(equivalentCodexMessage),
          incoming: summarizeMessageForDebug(nextMessage),
          merged: summarizeMessageForDebug(mergedEquivalentMessage)
        });
        nextById.delete(equivalentCodexMessageId);
        nextById.set(nextMessage.id, mergedEquivalentMessage);
        continue;
      }
    }

    const equivalentOpenCodeMessageId = findMatchingEquivalentOpenCodeMessageId(
      nextById,
      nextMessage
    );

    if (equivalentOpenCodeMessageId && equivalentOpenCodeMessageId !== nextMessage.id) {
      const equivalentOpenCodeMessage = nextById.get(equivalentOpenCodeMessageId) ?? null;

      if (equivalentOpenCodeMessage) {
        const mergedEquivalentMessage = mergeEquivalentAuthoritativeVersion(
          equivalentOpenCodeMessage,
          nextMessage
        );
        logSessionMessageDedupDebug("session.messages.opencode_equivalent_replace", {
          sessionId,
          previous: summarizeMessageForDebug(equivalentOpenCodeMessage),
          incoming: summarizeMessageForDebug(nextMessage),
          merged: summarizeMessageForDebug(mergedEquivalentMessage)
        });
        nextById.set(equivalentOpenCodeMessageId, mergedEquivalentMessage);
        continue;
      }
    }

    const currentMessage = nextById.get(message.messageId) ?? null;
    const mergedIncomingMessage =
      optimisticMessage === null
        ? nextMessage
        : mergeResolvedUserMessage(nextMessage, optimisticMessage);
    nextById.set(
      message.messageId,
      currentMessage
        ? mergeAuthoritativeVersion(currentMessage, mergedIncomingMessage)
        : mergedIncomingMessage
    );
  }

  return sortMessages(
    rebaseSyntheticCodexUserMessages(
      Array.from(nextById.values()),
      incomingMessages
    )
  );
}

export function mergeRuntimeOverlayMessages(
  current: SessionMessageViewModel[],
  incoming: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const nextByOverlayKey = new Map<string, SessionMessageViewModel>();

  for (const item of current) {
    nextByOverlayKey.set(buildRuntimeOverlayKey(item), item);
  }

  for (const message of incoming) {
    const overlayKey = buildRuntimeOverlayKey(message);
    const currentMessage = nextByOverlayKey.get(overlayKey) ?? null;

    if (currentMessage) {
      logSessionMessageDedupDebug("session.messages.runtime_overlay_merge", {
        overlayKey,
        mode: "update",
        previous: summarizeMessageForDebug(currentMessage),
        incoming: summarizeMessageForDebug(message)
      });
      nextByOverlayKey.set(
        overlayKey,
        mergePreservingTimelineIdentity(currentMessage, message)
      );
      continue;
    }

    logSessionMessageDedupDebug("session.messages.runtime_overlay_merge", {
      overlayKey,
      mode: "insert",
      incoming: summarizeMessageForDebug(message)
    });
    nextByOverlayKey.set(overlayKey, message);
  }

  return sortMessagesByTimeline(Array.from(nextByOverlayKey.values()));
}

export function reconcileMessage(
  current: SessionMessageViewModel[],
  sessionId: string,
  message: HistoryMessageDto,
  clientRequestId: string | null
): SessionMessageViewModel[] {
  const optimistic =
    clientRequestId === null
      ? null
      : current.find((item) => item.clientRequestId === clientRequestId) ?? null;
  const next = current.filter((item) => item.clientRequestId !== clientRequestId);
  const authoritative = toViewMessage(sessionId, message, "sent", clientRequestId);
  const merged = mergeResolvedUserMessage(authoritative, optimistic);

  return sortMessages([...next.filter((item) => item.id !== merged.id), merged]);
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

function collapseEquivalentOpenCodeUserMessages(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const collapsed: SessionMessageViewModel[] = [];
  let lastOpenCodeUser: SessionMessageViewModel | null = null;
  let sawAssistantTextSinceLastOpenCodeUser = false;

  for (const message of messages) {
    if (
      shouldCollapseOpenCodeRepeatedUserMessage(
        lastOpenCodeUser,
        message,
        sawAssistantTextSinceLastOpenCodeUser
      )
    ) {
      continue;
    }

    collapsed.push(message);

    if (isOpenCodeUserTextMessage(message)) {
      lastOpenCodeUser = message;
      sawAssistantTextSinceLastOpenCodeUser = false;
      continue;
    }

    if (lastOpenCodeUser && isOpenCodeAssistantTextMessage(message)) {
      sawAssistantTextSinceLastOpenCodeUser = true;
    }
  }

  return collapsed;
}

function collapseEquivalentOpenCodeAssistantMessages(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const collapsed: SessionMessageViewModel[] = [];

  for (const message of messages) {
    const previous = collapsed.at(-1);

    if (!previous || !isEquivalentOpenCodeAssistantTextMessage(previous, message)) {
      collapsed.push(message);
      continue;
    }

    collapsed[collapsed.length - 1] = pickPreferredOpenCodeAssistantMessage(previous, message);
  }

  return collapsed;
}

function collapseEquivalentOpenCodeTurnPairs(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const collapsed: SessionMessageViewModel[] = [];

  for (const message of messages) {
    collapsed.push(message);

    if (collapsed.length < 4) {
      continue;
    }

    const firstUser = collapsed[collapsed.length - 4];
    const firstAssistant = collapsed[collapsed.length - 3];
    const secondUser = collapsed[collapsed.length - 2];
    const secondAssistant = collapsed[collapsed.length - 1];

    if (
      !isEquivalentOpenCodeTurnPair(
        firstUser,
        firstAssistant,
        secondUser,
        secondAssistant
      )
    ) {
      continue;
    }

    collapsed.splice(
      collapsed.length - 3,
      3,
      pickPreferredOpenCodeAssistantMessage(firstAssistant, secondAssistant)
    );
  }

  return collapsed;
}

function collapseEquivalentGeminiTextMessages(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const collapsed: SessionMessageViewModel[] = [];

  for (const message of messages) {
    const previous = collapsed.at(-1);

    if (!previous || !isEquivalentGeminiTextMessage(previous, message)) {
      collapsed.push(message);
      continue;
    }

    collapsed[collapsed.length - 1] = pickPreferredGeminiMessage(previous, message);
  }

  return collapsed;
}

function collapseEquivalentKimiTextMessages(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const collapsed: SessionMessageViewModel[] = [];

  for (const message of messages) {
    const equivalentIndex = collapsed.findIndex((existing) =>
      isEquivalentKimiTextMessage(existing, message)
    );

    if (equivalentIndex === -1) {
      collapsed.push(message);
      continue;
    }

    collapsed[equivalentIndex] = pickPreferredKimiMessage(collapsed[equivalentIndex], message);
  }

  return collapsed;
}

function collapseEquivalentCodexImageUserMessages(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const collapsed: SessionMessageViewModel[] = [];

  for (const message of messages) {
    const previous = collapsed.at(-1);

    if (!previous || !isEquivalentCodexImageUserMessage(previous, message)) {
      collapsed.push(message);
      continue;
    }

    collapsed[collapsed.length - 1] = pickPreferredCodexImageUserMessage(previous, message);
  }

  return collapsed;
}

function sortMessages(messages: SessionMessageViewModel[]): SessionMessageViewModel[] {
  const sorted = sortMessagesByTimeline(messages);

  return collapseEquivalentCodexImageUserMessages(
    collapseEquivalentKimiTextMessages(
      collapseEquivalentGeminiTextMessages(
        collapseEquivalentOpenCodeUserMessages(
          collapseEquivalentOpenCodeTurnPairs(
            collapseEquivalentOpenCodeAssistantMessages(sorted)
          )
        )
      )
    )
  );
}

function sortMessagesByTimeline(messages: SessionMessageViewModel[]): SessionMessageViewModel[] {
  return [...messages].sort((left, right) => {
    return compareViewMessageOrder(left, right);
  });
}

export function compareViewMessageOrder(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): number {
  const codexRawRefTimelineOrder = compareCodexRawRefTimelineOrder(left.rawRef, right.rawRef);

  if (codexRawRefTimelineOrder !== null && codexRawRefTimelineOrder !== 0) {
    return codexRawRefTimelineOrder;
  }

  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }

  const rawRefStructuralOrder = compareRawRefStructuralOrder(left.rawRef, right.rawRef);

  if (rawRefStructuralOrder !== 0) {
    return rawRefStructuralOrder;
  }

  const timestampOrder = left.timestamp.localeCompare(right.timestamp);

  if (timestampOrder !== 0) {
    return timestampOrder;
  }

  const rawRefLineOrder = compareRawRefLineOrder(left.rawRef, right.rawRef);

  if (rawRefLineOrder !== 0) {
    return rawRefLineOrder;
  }

  const roleOrder = compareMessageRoleOrder(left.role, right.role);

  if (roleOrder !== 0) {
    return roleOrder;
  }

  const rawRefOrder = left.rawRef.localeCompare(right.rawRef);

  if (rawRefOrder !== 0) {
    return rawRefOrder;
  }

  return left.id.localeCompare(right.id);
}

function compareCodexRawRefTimelineOrder(leftRawRef: string, rightRawRef: string): number | null {
  if (!leftRawRef.startsWith("codex://") || !rightRawRef.startsWith("codex://")) {
    return null;
  }

  const leftStore = extractCodexRawRefStore(leftRawRef);
  const rightStore = extractCodexRawRefStore(rightRawRef);

  if (!leftStore || !rightStore || leftStore !== rightStore) {
    return null;
  }

  const leftLine = extractRawRefLine(leftRawRef);
  const rightLine = extractRawRefLine(rightRawRef);

  if (leftLine === null || rightLine === null) {
    return null;
  }

  if (leftLine !== rightLine) {
    return leftLine - rightLine;
  }

  const leftPart = extractRawRefUrlNumber(leftRawRef, "part") ?? 0;
  const rightPart = extractRawRefUrlNumber(rightRawRef, "part") ?? 0;

  return leftPart - rightPart;
}

function extractCodexRawRefStore(rawRef: string): string | null {
  const match = rawRef.match(/^codex:\/\/(.+?)(?:#|$)/);
  return match?.[1] ?? null;
}

function compareRawRefStructuralOrder(leftRawRef: string, rightRawRef: string): number {
  const claudeStableOrder = compareClaudeStableRawRefOrder(leftRawRef, rightRawRef);

  if (claudeStableOrder !== null && claudeStableOrder !== 0) {
    return claudeStableOrder;
  }

  const sameMessagePartOrder = compareSameMessageRawRefPartOrder(leftRawRef, rightRawRef);

  if (sameMessagePartOrder !== null && sameMessagePartOrder !== 0) {
    return sameMessagePartOrder;
  }

  const leftOrder = extractRawRefStructuralOrder(leftRawRef);
  const rightOrder = extractRawRefStructuralOrder(rightRawRef);

  if (!leftOrder && !rightOrder) {
    return 0;
  }

  if (!leftOrder) {
    return 0;
  }

  if (!rightOrder) {
    return 0;
  }

  const maxLength = Math.max(leftOrder.length, rightOrder.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftOrder[index];
    const rightValue = rightOrder[index];

    if (leftValue === undefined && rightValue === undefined) {
      return 0;
    }

    if (leftValue === undefined) {
      return -1;
    }

    if (rightValue === undefined) {
      return 1;
    }

    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function compareRawRefLineOrder(leftRawRef: string, rightRawRef: string): number {
  const leftLine = extractRawRefLine(leftRawRef);
  const rightLine = extractRawRefLine(rightRawRef);

  if (leftLine === null && rightLine === null) {
    return 0;
  }

  if (leftLine === null) {
    return 1;
  }

  if (rightLine === null) {
    return -1;
  }

  return leftLine - rightLine;
}

function extractRawRefLine(rawRef: string): number | null {
  const match = rawRef.match(/(?:^|[?#&])line=(\d+)(?:$|[&#])/);

  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(value) ? value : null;
}

function compareSameMessageRawRefPartOrder(leftRawRef: string, rightRawRef: string): number | null {
  const leftMessageBase = extractRawRefMessageBase(leftRawRef);
  const rightMessageBase = extractRawRefMessageBase(rightRawRef);

  if (!leftMessageBase || !rightMessageBase || leftMessageBase !== rightMessageBase) {
    return null;
  }

  const leftPart = extractRawRefUrlNumber(leftRawRef, "part");
  const rightPart = extractRawRefUrlNumber(rightRawRef, "part");

  if (leftPart === null || rightPart === null) {
    return null;
  }

  return leftPart - rightPart;
}

function extractRawRefMessageBase(rawRef: string): string | null {
  const match = rawRef.match(/^(.+\/message\/[^/?#]+)\/part\/[^/?#]+(?:[?#].*)?$/i);
  return match?.[1] ?? null;
}

function extractRawRefStructuralOrder(rawRef: string): number[] | null {
  const line = extractRawRefLine(rawRef);

  if (line !== null) {
    const part = extractRawRefUrlNumber(rawRef, "part");
    return part === null ? [line] : [line, part];
  }

  const indexedOrder = extractIndexedRawRefOrder(rawRef);

  if (indexedOrder) {
    return indexedOrder;
  }

  const messagePathOrder = extractMessagePathRawRefOrder(rawRef);

  if (messagePathOrder) {
    return messagePathOrder;
  }

  return null;
}

function extractIndexedRawRefOrder(rawRef: string): number[] | null {
  const index = extractRawRefUrlNumber(rawRef, "index");

  if (index === null) {
    return null;
  }

  const part = extractRawRefUrlNumber(rawRef, "part");
  return part === null ? [index] : [index, part];
}

function extractRawRefUrlNumber(rawRef: string, name: string): number | null {
  const match = rawRef.match(new RegExp(`(?:^|[?#&])${name}=(\\d+)(?:$|[&#])`));

  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(value) ? value : null;
}

function extractMessagePathRawRefOrder(rawRef: string): number[] | null {
  const match = rawRef.match(/\/message\/(user|assistant|tool)-(\d+)\/part\/([a-z_]+)-(\d+)/i);

  if (!match) {
    return null;
  }

  const roleOrder = resolveMessagePathRoleOrder(match[1] ?? "");
  const messageIndex = Number.parseInt(match[2] ?? "", 10);
  const partKindOrder = resolveMessagePathPartKindOrder(match[3] ?? "");
  const partIndex = Number.parseInt(match[4] ?? "", 10);

  if (
    !Number.isFinite(messageIndex)
    || !Number.isFinite(partIndex)
  ) {
    return null;
  }

  return [messageIndex, roleOrder, partKindOrder, partIndex];
}

function resolveMessagePathRoleOrder(value: string): number {
  switch (value.toLowerCase()) {
    case "user":
      return 0;
    case "assistant":
      return 1;
    case "tool":
      return 2;
    default:
      return 3;
  }
}

function resolveMessagePathPartKindOrder(value: string): number {
  switch (value.toLowerCase()) {
    case "reasoning":
    case "thinking":
      return 0;
    case "text":
      return 1;
    case "tool":
    case "tool_call":
    case "tool_result":
      return 2;
    default:
      return 3;
  }
}

function compareClaudeStableRawRefOrder(leftRawRef: string, rightRawRef: string): number | null {
  const prefix = "claude-code://message/";

  if (!leftRawRef.startsWith(prefix) || !rightRawRef.startsWith(prefix)) {
    return null;
  }

  let leftDecoded = "";
  let rightDecoded = "";

  try {
    leftDecoded = decodeURIComponent(leftRawRef.slice(prefix.length));
    rightDecoded = decodeURIComponent(rightRawRef.slice(prefix.length));
  } catch {
    return null;
  }

  const leftTypedMatch = leftDecoded.match(/^message:(assistant|user):([^:]+):type:(thinking|text)$/i);
  const rightTypedMatch = rightDecoded.match(/^message:(assistant|user):([^:]+):type:(thinking|text)$/i);

  if (leftTypedMatch && rightTypedMatch) {
    const leftRole = leftTypedMatch[1] ?? "";
    const rightRole = rightTypedMatch[1] ?? "";
    const leftMessageId = leftTypedMatch[2] ?? "";
    const rightMessageId = rightTypedMatch[2] ?? "";

    if (leftRole !== rightRole || leftMessageId !== rightMessageId) {
      return 0;
    }

    return resolveMessagePathPartKindOrder(leftTypedMatch[3] ?? "")
      - resolveMessagePathPartKindOrder(rightTypedMatch[3] ?? "");
  }

  const leftPartMatch = leftDecoded.match(/^message:(assistant|user):([^:]+):part:(\d+):type:([a-z_]+)$/i);
  const rightPartMatch = rightDecoded.match(/^message:(assistant|user):([^:]+):part:(\d+):type:([a-z_]+)$/i);

  if (!leftPartMatch || !rightPartMatch) {
    return null;
  }

  const leftRole = leftPartMatch[1] ?? "";
  const rightRole = rightPartMatch[1] ?? "";
  const leftMessageId = leftPartMatch[2] ?? "";
  const rightMessageId = rightPartMatch[2] ?? "";

  if (leftRole !== rightRole || leftMessageId !== rightMessageId) {
    return 0;
  }

  const leftPartIndex = Number.parseInt(leftPartMatch[3] ?? "", 10);
  const rightPartIndex = Number.parseInt(rightPartMatch[3] ?? "", 10);

  if (
    !Number.isFinite(leftPartIndex)
    || !Number.isFinite(rightPartIndex)
  ) {
    return null;
  }

  const partIndexOrder = leftPartIndex - rightPartIndex;

  if (partIndexOrder !== 0) {
    return partIndexOrder;
  }

  return resolveMessagePathPartKindOrder(leftPartMatch[4] ?? "")
    - resolveMessagePathPartKindOrder(rightPartMatch[4] ?? "");
}

function compareMessageRoleOrder(
  leftRole: SessionMessageViewModel["role"],
  rightRole: SessionMessageViewModel["role"]
): number {
  return resolveMessageRoleOrder(leftRole) - resolveMessageRoleOrder(rightRole);
}

function resolveMessageRoleOrder(role: SessionMessageViewModel["role"]): number {
  switch (role) {
    case "user":
      return 0;
    case "assistant":
      return 1;
    case "tool":
      return 2;
    case "system":
    default:
      return 3;
  }
}

function createRuntimeThinkingPlaceholder(
  sessionId: string,
  content: string,
  sequence: number
): SessionMessageViewModel {
  return {
    id: `runtime-thinking-placeholder-${sessionId}`,
    sessionId,
    role: "system",
    kind: "text",
    content,
    toolCall: null,
    attachments: [],
    attachmentPayloads: null,
    origin: "system",
    originRef: null,
    timestamp: new Date().toISOString(),
    sequence,
    rawRef: buildRuntimeThinkingPlaceholderRawRef(sessionId),
    deliveryState: "sent",
    clientRequestId: null
  };
}

function buildRuntimeThinkingPlaceholderRawRef(sessionId: string): string {
  return `${RUNTIME_THINKING_PLACEHOLDER_RAW_REF_PREFIX}${sessionId}`;
}

function getNextRuntimePlaceholderSequence(messages: SessionMessageViewModel[]): number {
  const maxSequence = messages.reduce((currentMax, message) => {
    return Number.isFinite(message.sequence) && message.sequence > currentMax
      ? message.sequence
      : currentMax;
  }, 0);

  return maxSequence + 1;
}

function shouldShowRuntimeThinkingPlaceholder(messages: SessionMessageViewModel[]): boolean {
  const latestUserIndex = findLatestUserMessageIndex(messages);

  if (latestUserIndex < 0) {
    return false;
  }

  const trailingMessages = messages.slice(latestUserIndex + 1);

  return !trailingMessages.some(
    (message) =>
      message.role === "assistant" &&
      (message.kind === "text" || message.kind === "thinking")
  );
}

function findLatestUserMessageIndex(messages: SessionMessageViewModel[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === "user" && message.kind === "text") {
      return index;
    }
  }

  return -1;
}

function mergeResolvedUserMessage(
  authoritative: SessionMessageViewModel,
  optimistic: SessionMessageViewModel | null
): SessionMessageViewModel {
  if (!optimistic) {
    return authoritative;
  }

  const authoritativeAttachments = authoritative.attachments ?? [];

  return {
    ...authoritative,
    attachments:
      authoritativeAttachments.length > 0 ? authoritativeAttachments : optimistic.attachments ?? [],
    attachmentPayloads: optimistic.attachmentPayloads ?? null
  };
}

function mergeAuthoritativeVersion(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): SessionMessageViewModel {
  if (
    current.id === incoming.id
    && current.role === "user"
    && incoming.role === "user"
    && current.kind === "text"
    && incoming.kind === "text"
    && areEquivalentRenderableUserMessages(current, incoming)
  ) {
    return current;
  }

  if (current.id !== incoming.id) {
    return incoming;
  }

  if (isEquivalentToolLifecycleMessage(current, incoming)) {
    const mergedToolCall = mergeToolCall(current.toolCall, incoming.toolCall);
    const content = pickToolLifecycleMessageContent(
      current,
      incoming,
      mergedToolCall,
      pickPreferredContent
    );
    const attachments = pickPreferredAttachments(current.attachments, incoming.attachments);
    const stableAnchor = pickStableAuthoritativeMessage(current, incoming);
    const preferred = pickNewerAuthoritativeMessage(current, incoming);

    return {
      ...preferred,
      kind: mergedToolCall?.status === "running" ? "tool_call" : "tool_result",
      content,
      toolCall: mergedToolCall,
      attachments,
      attachmentPayloads: current.attachmentPayloads ?? incoming.attachmentPayloads ?? null,
      rawRef: stableAnchor.rawRef,
      timestamp: stableAnchor.timestamp,
      sequence: stableAnchor.sequence
    };
  }

  if (
    current.role !== incoming.role
    || current.kind !== incoming.kind
  ) {
    return pickNewerAuthoritativeMessage(current, incoming);
  }

  const mergedToolCall = mergeToolCall(current.toolCall, incoming.toolCall);
  const content = isCodexAuthoritativeMessage(current) && isCodexAuthoritativeMessage(incoming)
    ? pickPreferredCodexEquivalentContent(current, incoming)
    : pickPreferredContent(current.content, incoming.content, current.timestamp, incoming.timestamp);
  const attachments = pickPreferredAttachments(current.attachments, incoming.attachments);
  const stableAnchor = pickStableAuthoritativeMessage(current, incoming);

  return {
    ...pickNewerAuthoritativeMessage(current, incoming),
    content,
    toolCall: mergedToolCall,
    attachments,
    attachmentPayloads: current.attachmentPayloads ?? incoming.attachmentPayloads ?? null,
    rawRef: stableAnchor.rawRef,
    // 同一条权威消息的增量更新只能更新内容，不能把时间线锚点越推越靠后。
    // runtime 与 history 即使 rawRef 不同，也仍然可能是在更新同一条消息；
    // 这时也必须保留更早的排序锚点，否则 thinking 会卡在旧位置或沉到底部。
    timestamp: stableAnchor.timestamp,
    sequence: stableAnchor.sequence
  };
}

function mergeEquivalentAuthoritativeVersion(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): SessionMessageViewModel {
  if (
    current.role === "user"
    && incoming.role === "user"
    && current.kind === "text"
    && incoming.kind === "text"
    && areEquivalentRenderableUserMessages(current, incoming)
  ) {
    return current;
  }

  if (isEquivalentToolLifecycleMessage(current, incoming)) {
    const mergedToolCall = mergeToolCall(current.toolCall, incoming.toolCall);
    const content = pickToolLifecycleMessageContent(
      current,
      incoming,
      mergedToolCall,
      pickPreferredContent
    );
    const attachments = pickPreferredAttachments(current.attachments, incoming.attachments);
    const stableAnchor = pickStableAuthoritativeMessage(current, incoming);
    const preferred = pickNewerAuthoritativeMessage(current, incoming);

    return {
      ...preferred,
      id: current.id,
      kind: mergedToolCall?.status === "running" ? "tool_call" : "tool_result",
      content,
      toolCall: mergedToolCall,
      attachments,
      attachmentPayloads: current.attachmentPayloads ?? incoming.attachmentPayloads ?? null,
      rawRef: stableAnchor.rawRef,
      timestamp: stableAnchor.timestamp,
      sequence: stableAnchor.sequence,
      clientRequestId: current.clientRequestId ?? incoming.clientRequestId
    };
  }

  if (
    current.role !== incoming.role
    || current.kind !== incoming.kind
  ) {
    const preferred = pickNewerAuthoritativeMessage(current, incoming);
    return {
      ...preferred,
      id: current.id,
      clientRequestId: current.clientRequestId ?? incoming.clientRequestId
    };
  }

  const mergedToolCall = mergeToolCall(current.toolCall, incoming.toolCall);
  const content = isCodexAuthoritativeMessage(current) && isCodexAuthoritativeMessage(incoming)
    ? pickPreferredCodexEquivalentContent(current, incoming)
    : pickPreferredContent(current.content, incoming.content, current.timestamp, incoming.timestamp);
  const attachments = pickPreferredAttachments(current.attachments, incoming.attachments);
  const stableAnchor = pickStableAuthoritativeMessage(current, incoming);

  return {
    ...pickNewerAuthoritativeMessage(current, incoming),
    id: current.id,
    content,
    toolCall: mergedToolCall,
    attachments,
    attachmentPayloads: current.attachmentPayloads ?? incoming.attachmentPayloads ?? null,
    rawRef: stableAnchor.rawRef,
    // OpenCode 的 runtime 与 history 会给同一个 part 生成不同 messageId，
    // 这里只能把它们合并成同一条，否则前端会把同一轮 thinking/text 画两遍。
    timestamp: stableAnchor.timestamp,
    sequence: stableAnchor.sequence,
    clientRequestId: current.clientRequestId ?? incoming.clientRequestId
  };
}

function mergeCodexEquivalentAuthoritativeVersion(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): SessionMessageViewModel {
  return {
    ...mergeEquivalentAuthoritativeVersion(current, incoming),
    // 历史回填是稳定来源，采用它的 messageId，避免 runtime 临时 ID 留在权威层。
    id: incoming.id
  };
}

function isEquivalentToolLifecycleMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): boolean {
  return isEquivalentOpenCodeToolMessage(current, incoming)
    || isEquivalentCodexToolMessage(current, incoming);
}

function pickToolLifecycleMessageContent(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel,
  mergedToolCall: SessionMessageViewModel["toolCall"],
  fallback: (
    currentContent: string,
    incomingContent: string,
    currentTimestamp: string,
    incomingTimestamp: string
  ) => string
): string {
  if (mergedToolCall?.status === "running") {
    if (incoming.kind === "tool_call" && incoming.content) {
      return incoming.content;
    }

    if (current.kind === "tool_call" && current.content) {
      return current.content;
    }
  } else {
    if (incoming.kind === "tool_result" && incoming.content) {
      return incoming.content;
    }

    if (current.kind === "tool_result" && current.content) {
      return current.content;
    }

    if (mergedToolCall?.output) {
      return mergedToolCall.output;
    }
  }

  return fallback(current.content, incoming.content, current.timestamp, incoming.timestamp);
}

function mergePreservingTimelineIdentity(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): SessionMessageViewModel {
  const merged = mergeAuthoritativeVersion(current, {
    ...incoming,
    id: current.id,
    clientRequestId: current.clientRequestId ?? incoming.clientRequestId
  });

  return {
    ...merged,
    id: current.id,
    rawRef: current.rawRef,
    timestamp: current.timestamp,
    sequence: current.sequence,
    clientRequestId: current.clientRequestId ?? incoming.clientRequestId
  };
}

export function buildRuntimeOverlayKey(message: SessionMessageViewModel): string {
  if (
    message.role === "tool"
    && (message.kind === "tool_call" || message.kind === "tool_result")
  ) {
    const toolCallId = message.toolCall?.callId.trim() ?? "";

    if (toolCallId) {
      return `toolCall:${toolCallId}`;
    }
  }

  if (
    message.role === "assistant"
    && (message.kind === "text" || message.kind === "thinking")
    && message.rawRef.startsWith("codex://")
  ) {
    const codexStore = extractCodexRawRefStore(message.rawRef);

    if (codexStore) {
      return `codexAssistantStream:${codexStore}:${message.kind}:${message.sequence}`;
    }
  }

  if (message.id) {
    return `id:${message.id}`;
  }

  if (message.rawRef) {
    return `rawRef:${message.rawRef}`;
  }

  return `fallback:${message.role}:${message.kind}:${message.timestamp}:${message.sequence}`;
}

function isEquivalentCodexTextMessageWithinWindow(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel,
  windowMs: number
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
  const comparableLeftText = normalizeComparableCodexText(leftContent.text);
  const comparableRightText = normalizeComparableCodexText(rightContent.text);

  return (
    areTimestampsNearWithinWindow(left.timestamp, right.timestamp, windowMs) &&
    areEquivalentCodexAssistantTextContents(left, right, comparableLeftText, comparableRightText) &&
    areEquivalentInlineImages(leftContent.inlineImages, rightContent.inlineImages)
  );
}

function areEquivalentCodexAssistantTextContents(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel,
  comparableLeftText: string,
  comparableRightText: string
): boolean {
  if (comparableLeftText === comparableRightText) {
    return true;
  }

  return foldDuplicatedCodexAssistantTailText(
    left,
    right,
    comparableLeftText,
    comparableRightText
  ) !== null;
}

function shouldCollapseOpenCodeRepeatedUserMessage(
  previousUser: SessionMessageViewModel | null,
  nextMessage: SessionMessageViewModel,
  sawAssistantTextSincePreviousUser: boolean
): boolean {
  if (!previousUser || sawAssistantTextSincePreviousUser) {
    return false;
  }

  if (!isOpenCodeUserTextMessage(previousUser) || !isOpenCodeUserTextMessage(nextMessage)) {
    return false;
  }

  return (
    areTimestampsNearWithinWindow(previousUser.timestamp, nextMessage.timestamp, 2 * 60 * 1000) &&
    normalizeComparableCodexText(previousUser.content) === normalizeComparableCodexText(nextMessage.content)
  );
}

function isOpenCodeUserTextMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent" &&
    message.rawRef.startsWith("opencode://") &&
    message.role === "user" &&
    message.kind === "text"
  );
}

function isOpenCodeAssistantPrimaryMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent" &&
    message.rawRef.startsWith("opencode://") &&
    message.role === "assistant" &&
    (message.kind === "text" || message.kind === "thinking")
  );
}

function isOpenCodeAssistantTextMessage(message: SessionMessageViewModel): boolean {
  return (
    isOpenCodeAssistantPrimaryMessage(message) &&
    message.kind === "text"
  );
}

function isEquivalentOpenCodeAssistantTextMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): boolean {
  return (
    isOpenCodeAssistantPrimaryMessage(left) &&
    isOpenCodeAssistantPrimaryMessage(right) &&
    left.kind === right.kind &&
    areTimestampsNearWithinWindow(left.timestamp, right.timestamp, 2 * 60 * 1000) &&
    normalizeComparableCodexText(left.content) === normalizeComparableCodexText(right.content)
  );
}

function isEquivalentOpenCodeTurnPair(
  firstUser: SessionMessageViewModel | undefined,
  firstAssistant: SessionMessageViewModel | undefined,
  secondUser: SessionMessageViewModel | undefined,
  secondAssistant: SessionMessageViewModel | undefined
): boolean {
  if (!firstUser || !firstAssistant || !secondUser || !secondAssistant) {
    return false;
  }

  if (!isOpenCodeUserTextMessage(firstUser) || !isOpenCodeUserTextMessage(secondUser)) {
    return false;
  }

  return (
    isEquivalentOpenCodeAssistantTextMessage(firstAssistant, secondAssistant) &&
    areTimestampsNearWithinWindow(firstUser.timestamp, secondUser.timestamp, 2 * 60 * 1000) &&
    normalizeComparableCodexText(firstUser.content) === normalizeComparableCodexText(secondUser.content)
  );
}

function pickPreferredOpenCodeAssistantMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): SessionMessageViewModel {
  const leftAttachmentCount = left.attachments?.length ?? 0;
  const rightAttachmentCount = right.attachments?.length ?? 0;

  if (leftAttachmentCount !== rightAttachmentCount) {
    return leftAttachmentCount > rightAttachmentCount ? left : right;
  }

  const leftContentLength = normalizeComparableCodexText(left.content).length;
  const rightContentLength = normalizeComparableCodexText(right.content).length;

  if (leftContentLength !== rightContentLength) {
    return leftContentLength > rightContentLength ? left : right;
  }

  return pickNewerAuthoritativeMessage(left, right);
}

function isEquivalentGeminiTextMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): boolean {
  if (!isGeminiTextMessage(left) || !isGeminiTextMessage(right)) {
    return false;
  }

  return (
    left.role === right.role &&
    areTimestampsNearWithinWindow(left.timestamp, right.timestamp, 2 * 60 * 1000) &&
    normalizeComparableCodexText(left.content) === normalizeComparableCodexText(right.content)
  );
}

function isEquivalentKimiTextMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): boolean {
  if (!isKimiTextMessage(left) || !isKimiTextMessage(right)) {
    return false;
  }

  return (
    left.role === right.role &&
    areTimestampsNearWithinWindow(left.timestamp, right.timestamp, 2 * 60 * 1000) &&
    normalizeComparableCodexText(left.content) === normalizeComparableCodexText(right.content)
  );
}

function isGeminiTextMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent" &&
    message.rawRef.startsWith("gemini://session/") &&
    message.kind === "text" &&
    message.toolCall === null &&
    (message.role === "user" || message.role === "assistant")
  );
}

function isKimiTextMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent" &&
    message.rawRef.startsWith("kimi://session/") &&
    message.kind === "text" &&
    message.toolCall === null &&
    (message.role === "user" || message.role === "assistant")
  );
}

function pickPreferredGeminiMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): SessionMessageViewModel {
  const leftAttachmentCount = left.attachments?.length ?? 0;
  const rightAttachmentCount = right.attachments?.length ?? 0;

  if (leftAttachmentCount !== rightAttachmentCount) {
    return leftAttachmentCount > rightAttachmentCount ? left : right;
  }

  const leftContentLength = normalizeComparableCodexText(left.content).length;
  const rightContentLength = normalizeComparableCodexText(right.content).length;

  if (leftContentLength !== rightContentLength) {
    return leftContentLength > rightContentLength ? left : right;
  }

  const leftIsHistoryMessage = left.rawRef.includes("#file=");
  const rightIsHistoryMessage = right.rawRef.includes("#file=");

  if (leftIsHistoryMessage !== rightIsHistoryMessage) {
    return leftIsHistoryMessage ? left : right;
  }

  return pickNewerAuthoritativeMessage(left, right);
}

function pickPreferredKimiMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): SessionMessageViewModel {
  const leftAttachmentCount = left.attachments?.length ?? 0;
  const rightAttachmentCount = right.attachments?.length ?? 0;

  if (leftAttachmentCount !== rightAttachmentCount) {
    return leftAttachmentCount > rightAttachmentCount ? left : right;
  }

  const leftContentLength = normalizeComparableCodexText(left.content).length;
  const rightContentLength = normalizeComparableCodexText(right.content).length;

  if (leftContentLength !== rightContentLength) {
    return leftContentLength > rightContentLength ? left : right;
  }

  const leftIsHistoryMessage = left.rawRef.includes("/context#");
  const rightIsHistoryMessage = right.rawRef.includes("/context#");

  if (leftIsHistoryMessage !== rightIsHistoryMessage) {
    return leftIsHistoryMessage ? left : right;
  }

  return pickNewerAuthoritativeMessage(left, right);
}

function isEquivalentCodexImageUserMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): boolean {
  if (!isCodexImageUserTextMessage(left) || !isCodexImageUserTextMessage(right)) {
    return false;
  }

  const leftContent = parseMessageRichContent(left.content);
  const rightContent = parseMessageRichContent(right.content);

  return (
    areTimestampsNearWithinWindow(left.timestamp, right.timestamp, 2 * 60 * 1000) &&
    normalizeComparableUserMergeText(leftContent.text) === normalizeComparableUserMergeText(rightContent.text) &&
    areEquivalentInlineImages(leftContent.inlineImages, rightContent.inlineImages)
  );
}

function isCodexImageUserTextMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent" &&
    message.rawRef.startsWith("codex://") &&
    message.role === "user" &&
    message.kind === "text" &&
    !isOptimisticUserMessage(message) &&
    hasImageAttachmentEvidence(message)
  );
}

function pickPreferredCodexImageUserMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): SessionMessageViewModel {
  const leftAttachmentCount = countImageAttachmentEvidence(left);
  const rightAttachmentCount = countImageAttachmentEvidence(right);

  if (leftAttachmentCount !== rightAttachmentCount) {
    return leftAttachmentCount > rightAttachmentCount ? left : right;
  }

  const leftContentLength = normalizeComparableUserMergeText(left.content).length;
  const rightContentLength = normalizeComparableUserMergeText(right.content).length;

  if (leftContentLength !== rightContentLength) {
    return leftContentLength <= rightContentLength ? left : right;
  }

  return compareViewMessageOrder(left, right) <= 0 ? left : right;
}

function hasImageAttachmentEvidence(message: SessionMessageViewModel): boolean {
  return countImageAttachmentEvidence(message) > 0;
}

function countImageAttachmentEvidence(message: SessionMessageViewModel): number {
  const persistedCount = (message.attachments ?? []).filter((attachment) => attachment.kind === "image").length;
  const payloadCount = (message.attachmentPayloads ?? []).filter((attachment) => attachment.kind === "image").length;
  const inlineImageCount = parseMessageRichContent(message.content).inlineImages.length;

  return persistedCount + payloadCount + inlineImageCount;
}

function mergeToolCall(
  current: SessionMessageViewModel["toolCall"],
  incoming: SessionMessageViewModel["toolCall"]
): SessionMessageViewModel["toolCall"] {
  if (!current) {
    return incoming;
  }

  if (!incoming) {
    return current;
  }

  const preferred = pickHigherPriorityToolCall(current, incoming);
  const preferredName = pickPreferredToolCallName(current, incoming, preferred);
  const preferredInput = pickPreferredToolCallInput(current, incoming, preferredName);

  return {
    ...preferred,
    name: preferredName,
    input: preferredInput,
    output: pickLongerNullableText(current.output, incoming.output),
    error: pickLongerNullableText(current.error, incoming.error)
  };
}

function pickPreferredToolCallName(
  current: NonNullable<SessionMessageViewModel["toolCall"]>,
  incoming: NonNullable<SessionMessageViewModel["toolCall"]>,
  preferred: NonNullable<SessionMessageViewModel["toolCall"]>
): string {
  const currentName = current.name.trim().toLowerCase();
  const incomingName = incoming.name.trim().toLowerCase();

  if (currentName === "apply_patch" || incomingName === "apply_patch") {
    return "apply_patch";
  }

  if (!currentName || currentName === "tool") {
    return incoming.name;
  }

  if (!incomingName || incomingName === "tool") {
    return current.name;
  }

  return preferred.name;
}

function pickPreferredToolCallInput(
  current: NonNullable<SessionMessageViewModel["toolCall"]>,
  incoming: NonNullable<SessionMessageViewModel["toolCall"]>,
  preferredName: string
): string {
  if (preferredName === "apply_patch") {
    const currentIsApplyPatch = current.name.trim().toLowerCase() === "apply_patch";
    const incomingIsApplyPatch = incoming.name.trim().toLowerCase() === "apply_patch";

    if (currentIsApplyPatch && incomingIsApplyPatch) {
      return pickLongerText(current.input, incoming.input);
    }

    if (currentIsApplyPatch && current.input) {
      return current.input;
    }

    if (incomingIsApplyPatch && incoming.input) {
      return incoming.input;
    }
  }

  return pickLongerText(current.input, incoming.input);
}

function pickHigherPriorityToolCall(
  current: NonNullable<SessionMessageViewModel["toolCall"]>,
  incoming: NonNullable<SessionMessageViewModel["toolCall"]>
): NonNullable<SessionMessageViewModel["toolCall"]> {
  const currentPriority = toolCallStatusPriority(current.status);
  const incomingPriority = toolCallStatusPriority(incoming.status);

  if (incomingPriority !== currentPriority) {
    return incomingPriority > currentPriority ? incoming : current;
  }

  return incoming;
}

function toolCallStatusPriority(status: NonNullable<SessionMessageViewModel["toolCall"]>["status"]): number {
  if (status === "running") {
    return 0;
  }

  return 1;
}

function pickPreferredContent(
  current: string,
  incoming: string,
  currentTimestamp: string,
  incomingTimestamp: string
): string {
  const normalizedCurrent = normalizeComparableCodexText(current);
  const normalizedIncoming = normalizeComparableCodexText(incoming);

  if (normalizedCurrent === normalizedIncoming) {
    const cleanerContent = pickContentWithoutInternalAttachmentDebugBlock(current, incoming);

    if (cleanerContent !== null) {
      return cleanerContent;
    }

    return current.length >= incoming.length ? current : incoming;
  }

  if (
    normalizedCurrent.length > normalizedIncoming.length
    && normalizedCurrent.includes(normalizedIncoming)
  ) {
    return current;
  }

  if (
    normalizedIncoming.length > normalizedCurrent.length
    && normalizedIncoming.includes(normalizedCurrent)
  ) {
    return incoming;
  }

  return incomingTimestamp.localeCompare(currentTimestamp) >= 0 ? incoming : current;
}

function pickPreferredCodexEquivalentContent(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): string {
  const currentContent = parseMessageRichContent(current.content);
  const incomingContent = parseMessageRichContent(incoming.content);
  const foldedAssistantContent = foldDuplicatedCodexAssistantTailText(
    current,
    incoming,
    normalizeComparableCodexText(currentContent.text),
    normalizeComparableCodexText(incomingContent.text)
  );

  if (foldedAssistantContent !== null) {
    return foldedAssistantContent;
  }

  return pickPreferredContent(current.content, incoming.content, current.timestamp, incoming.timestamp);
}

function foldDuplicatedCodexAssistantTailText(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel,
  comparableLeftText: string,
  comparableRightText: string
): string | null {
  if (
    left.role !== "assistant"
    || right.role !== "assistant"
    || left.kind !== "text"
    || right.kind !== "text"
  ) {
    return null;
  }

  const leftFoldedText = removeRepeatedTrailingText(comparableLeftText);
  const rightFoldedText = removeRepeatedTrailingText(comparableRightText);

  if (
    leftFoldedText === comparableLeftText
    && rightFoldedText === comparableRightText
  ) {
    return null;
  }

  if (leftFoldedText === rightFoldedText) {
    if (comparableLeftText === leftFoldedText) {
      return left.content;
    }

    if (comparableRightText === rightFoldedText) {
      return right.content;
    }

    return leftFoldedText;
  }

  if (
    rightFoldedText.length >= 80
    && comparableLeftText === rightFoldedText
  ) {
    return left.content;
  }

  if (
    leftFoldedText.length >= 80
    && comparableRightText === leftFoldedText
  ) {
    return right.content;
  }

  return null;
}

function removeRepeatedTrailingText(content: string): string {
  const normalized = content.trimEnd();
  const candidateStarts = collectTrailingRepeatCandidateStarts(normalized);

  for (const start of candidateStarts) {
    const tail = normalized.slice(start);
    const beforeTail = normalized.slice(0, start).trimEnd();

    if (!beforeTail.endsWith(tail)) {
      continue;
    }

    return beforeTail;
  }

  return normalized;
}

function collectTrailingRepeatCandidateStarts(content: string): number[] {
  const minRepeatLength = 80;
  const minStart = Math.ceil(content.length / 2);
  const starts: number[] = [];

  for (
    let index = content.indexOf("\n\n");
    index >= 0;
    index = content.indexOf("\n\n", index + 2)
  ) {
    const start = index + 2;

    if (content.length - start >= minRepeatLength) {
      starts.push(start);
    }
  }

  for (let index = content.indexOf("\n", minStart); index >= 0; index = content.indexOf("\n", index + 1)) {
    const start = index + 1;

    if (content.length - start >= minRepeatLength) {
      starts.push(start);
    }
  }

  if (content.length - minStart >= minRepeatLength) {
    starts.push(minStart);
  }

  return starts.sort((left, right) => left - right);
}

function pickPreferredAttachments(
  current: SessionMessageViewModel["attachments"],
  incoming: SessionMessageViewModel["attachments"]
): SessionMessageViewModel["attachments"] {
  const currentCount = current?.length ?? 0;
  const incomingCount = incoming?.length ?? 0;

  if (incomingCount !== currentCount) {
    return incomingCount > currentCount ? incoming : current;
  }

  return incoming ?? current;
}

function areEquivalentRenderableUserMessages(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): boolean {
  const currentContent = parseMessageRichContent(current.content);
  const incomingContent = parseMessageRichContent(incoming.content);

  return (
    normalizeComparableUserMergeText(currentContent.text)
      === normalizeComparableUserMergeText(incomingContent.text)
    && areEquivalentInlineImages(currentContent.inlineImages, incomingContent.inlineImages)
    && buildComparableMessageAttachmentSignature(current)
      === buildComparableMessageAttachmentSignature(incoming)
  );
}

function pickLongerText(current: string, incoming: string): string {
  return incoming.length > current.length ? incoming : current;
}

function pickLongerNullableText(current: string | null, incoming: string | null): string | null {
  if (current === null) {
    return incoming;
  }

  if (incoming === null) {
    return current;
  }

  return pickLongerText(current, incoming);
}

function pickNewerAuthoritativeMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): SessionMessageViewModel {
  if (incoming.timestamp !== current.timestamp) {
    return incoming.timestamp.localeCompare(current.timestamp) >= 0 ? incoming : current;
  }

  if (incoming.sequence !== current.sequence) {
    return incoming.sequence >= current.sequence ? incoming : current;
  }

  return incoming;
}

function pickStableAuthoritativeMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): Pick<SessionMessageViewModel, "timestamp" | "sequence" | "rawRef"> {
  return compareViewMessageOrder(current, incoming) <= 0 ? current : incoming;
}

function normalizeComparableCodexText(content: string): string {
  return stripInternalAttachmentDebugContent(content).replace(/\r\n/g, "\n").trimEnd();
}

function normalizeComparableUserMergeText(content: string): string {
  return normalizeComparableCodexText(content)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function normalizeViewMessageContent(
  provider: string,
  role: SessionMessageViewModel["role"],
  kind: SessionMessageViewModel["kind"],
  content: string
): string {
  if (
    (provider !== "claude-code" && provider !== "codex")
    || (role !== "user" && role !== "assistant")
    || (kind !== "text" && kind !== "thinking")
  ) {
    return content;
  }

  return removeInternalAttachmentDebugBlock(content);
}

function stripInternalAttachmentDebugContent(content: string): string {
  return removeInternalAttachmentDebugBlock(content)
    .replace(/\r\n/g, "\n")
    .trimEnd();
}

function hasInternalAttachmentDebugBlock(content: string): boolean {
  return INTERNAL_ATTACHMENT_DEBUG_BLOCK_TEST_PATTERN.test(content)
    || content.includes("[[CODINGNS_IMAGE_ATTACHMENTS]]");
}

function removeInternalAttachmentDebugBlock(content: string): string {
  if (!hasInternalAttachmentDebugBlock(content)) {
    return content;
  }

  return content
    .replace(INTERNAL_ATTACHMENT_DEBUG_BLOCK_PATTERN, "")
    .replace(INTERNAL_ATTACHMENT_DEBUG_TAIL_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function pickContentWithoutInternalAttachmentDebugBlock(
  current: string,
  incoming: string
): string | null {
  const currentHasDebugBlock = hasInternalAttachmentDebugBlock(current);
  const incomingHasDebugBlock = hasInternalAttachmentDebugBlock(incoming);

  if (currentHasDebugBlock === incomingHasDebugBlock) {
    return null;
  }

  return currentHasDebugBlock ? incoming : current;
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
  incoming: SessionMessageViewModel,
  sessionId: string
): string | null {
  if (!isAuthoritativeUserTextMessage(incoming)) {
    return null;
  }

  return findClosestMatchingUserMessageId(messagesById, incoming, "optimistic", sessionId);
}

function findMatchingAuthoritativeMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  incoming: SessionMessageViewModel,
  sessionId: string
): string | null {
  if (!isOptimisticUserMessage(incoming)) {
    return null;
  }

  return findClosestMatchingUserMessageId(messagesById, incoming, "authoritative", sessionId);
}

function findMatchingEquivalentCodexMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  candidateMessageIds: Set<string>,
  incoming: SessionMessageViewModel
): string | null {
  if (!isCodexAuthoritativeMessage(incoming)) {
    return null;
  }

  for (const [messageId, current] of messagesById.entries()) {
    if (
      messageId === incoming.id
      || !candidateMessageIds.has(messageId)
      || !isCompatibleCodexIdentityBridgeMessage(current, incoming)
    ) {
      continue;
    }

    logSessionMessageDedupDebug("session.messages.codex_identity_bridge_match", {
      previous: summarizeMessageForDebug(current),
      incoming: summarizeMessageForDebug(incoming)
    });
    return messageId;
  }

  return null;
}

function isCompatibleCodexIdentityBridgeMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): boolean {
  if (!isEquivalentCodexAuthoritativeMessage(current, incoming)) {
    return false;
  }

  if (current.rawRef === incoming.rawRef) {
    return true;
  }

  if (current.kind === "tool_call" || current.kind === "tool_result") {
    return isEquivalentCodexToolMessage(current, incoming);
  }

  const currentStore = extractCodexRawRefStore(current.rawRef);
  const incomingStore = extractCodexRawRefStore(incoming.rawRef);

  if (!currentStore || !incomingStore || currentStore !== incomingStore) {
    return false;
  }

  const sequenceDistance = Math.abs(current.sequence - incoming.sequence);

  if (sequenceDistance > 1) {
    logSessionMessageDedupDebug("session.messages.codex_identity_bridge_rejected", {
      reason: "sequence_distance",
      sequenceDistance,
      previous: summarizeMessageForDebug(current),
      incoming: summarizeMessageForDebug(incoming)
    });
    return false;
  }

  return true;
}

function findMatchingEquivalentOpenCodeMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  incoming: SessionMessageViewModel
): string | null {
  if (!isOpenCodeAuthoritativeMessage(incoming)) {
    return null;
  }

  const incomingIdentity = extractEquivalentOpenCodeRawRefIdentity(incoming.rawRef);

  if (incomingIdentity === null) {
    return null;
  }

  const incomingTimestampMs = toTimestampMs(incoming.timestamp);
  let matchedId: string | null = null;
  let matchedScore = Number.POSITIVE_INFINITY;

  for (const [messageId, current] of messagesById.entries()) {
    if (
      messageId === incoming.id
      || !isOpenCodeAuthoritativeMessage(current)
      || current.role !== incoming.role
    ) {
      continue;
    }

    if (isEquivalentOpenCodeToolMessage(current, incoming)) {
      return messageId;
    }

    if (current.kind !== incoming.kind) {
      continue;
    }

    const currentIdentity = extractEquivalentOpenCodeRawRefIdentity(current.rawRef);

    if (currentIdentity !== incomingIdentity) {
      continue;
    }

    const currentTimestampMs = toTimestampMs(current.timestamp);
    const timestampDistance = Math.abs(currentTimestampMs - incomingTimestampMs);
    const sequenceDistance = Math.abs(current.sequence - incoming.sequence);
    const score = sequenceDistance * 60_000 + timestampDistance;

    if (score < matchedScore) {
      matchedId = messageId;
      matchedScore = score;
    }
  }

  return matchedId;
}

function findClosestMatchingUserMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  incoming: SessionMessageViewModel,
  target: "optimistic" | "authoritative",
  sessionId: string
): string | null {
  const incomingTimestampMs = toTimestampMs(incoming.timestamp);
  const comparableIncomingContent = normalizeComparableCodexText(incoming.content);
  const relaxedIncomingContent = normalizeComparableUserMergeText(incoming.content);
  const incomingAttachmentSignature = buildComparableMessageAttachmentSignature(incoming);
  let matchedId: string | null = null;
  let matchedScore = Number.POSITIVE_INFINITY;
  const debugCandidates: Array<Record<string, unknown>> = [];

  for (const [messageId, current] of messagesById.entries()) {
    const matchesTarget =
      target === "optimistic"
        ? isOptimisticUserMessage(current)
        : isAuthoritativeUserTextMessage(current);

    if (!matchesTarget) {
      continue;
    }

    const comparableCurrentContent = normalizeComparableCodexText(current.content);
    const relaxedCurrentContent = normalizeComparableUserMergeText(current.content);
    const strictTextMatches = comparableCurrentContent === comparableIncomingContent;
    const relaxedTextMatches = relaxedCurrentContent === relaxedIncomingContent;

    if (!strictTextMatches && !relaxedTextMatches) {
      continue;
    }

    const currentTimestampMs = toTimestampMs(current.timestamp);
    const distance = Math.abs(currentTimestampMs - incomingTimestampMs);

    if (distance > 5 * 60 * 1000) {
      continue;
    }

    const sequenceDistance = Math.abs(current.sequence - incoming.sequence);
    const currentAttachmentSignature = buildComparableMessageAttachmentSignature(current);
    const attachmentCompatibility = resolveAttachmentCompatibility(
      currentAttachmentSignature,
      incomingAttachmentSignature
    );

    if (
      attachmentCompatibility === "conflict"
      && (strictTextMatches || comparableIncomingContent.length === 0)
    ) {
      debugCandidates.push(
        summarizeUserMatchCandidate(current, {
          strictTextMatches,
          relaxedTextMatches,
          attachmentCompatibility,
          distanceMs: distance,
          sequenceDistance
        })
      );
      continue;
    }

    const score =
      distance
      + sequenceDistance * 15_000
      + (strictTextMatches ? 0 : 500)
      + resolveAttachmentPenalty(attachmentCompatibility);

    debugCandidates.push(
      summarizeUserMatchCandidate(current, {
        strictTextMatches,
        relaxedTextMatches,
        attachmentCompatibility,
        distanceMs: distance,
        sequenceDistance
      })
    );

    if (score < matchedScore) {
      matchedId = messageId;
      matchedScore = score;
    }
  }

  if (debugCandidates.length > 0) {
    logSessionMessageDedupDebug("session.messages.user_match", {
      sessionId,
      target,
      matchedId,
      matchedScore: Number.isFinite(matchedScore) ? matchedScore : null,
      incoming: summarizeUserMessageMatchInput(incoming, {
        relaxedContent: relaxedIncomingContent,
        attachmentSignature: incomingAttachmentSignature
      }),
      candidates: debugCandidates.slice(0, 5)
    });
  }

  return matchedId;
}

function isCodexAuthoritativeMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent"
    && message.rawRef.startsWith("codex://")
    && (message.role === "assistant" || message.role === "tool")
  );
}

function rebaseSyntheticCodexUserMessages(
  messages: SessionMessageViewModel[],
  incoming: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const incomingAuthoritativeCodexMessages = incoming.filter(isCodexAuthoritativeMessage);

  if (incomingAuthoritativeCodexMessages.length === 0) {
    return messages;
  }

  return messages.map((message) => {
    if (!isSyntheticCodexUserMessage(message)) {
      return message;
    }

    const messageTimestampMs = toTimestampMs(message.timestamp);
    const earliestReplySequence = incomingAuthoritativeCodexMessages.reduce((currentMin, item) => {
      if (toTimestampMs(item.timestamp) < messageTimestampMs) {
        return currentMin;
      }

      return Math.min(currentMin, item.sequence);
    }, Number.POSITIVE_INFINITY);

    if (!Number.isFinite(earliestReplySequence) || earliestReplySequence >= message.sequence) {
      return message;
    }

    const rebased = {
      ...message,
      sequence: earliestReplySequence
    };

    logSessionMessageDedupDebug("session.messages.synthetic_user_rebased", {
      syntheticMessage: summarizeMessageForDebug(message),
      rebasedMessage: summarizeMessageForDebug(rebased),
      incomingAnchors: incomingAuthoritativeCodexMessages.slice(0, 5).map(summarizeMessageForDebug)
    });

    return rebased;
  });
}

function isOpenCodeAuthoritativeMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent"
    && message.rawRef.startsWith("opencode://")
    && !isOptimisticUserMessage(message)
    && (message.role === "user" || message.role === "assistant" || message.role === "tool")
  );
}

function isOpenCodeToolMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent"
    && message.rawRef.startsWith("opencode://")
    && message.role === "tool"
    && (message.kind === "tool_call" || message.kind === "tool_result")
    && message.toolCall !== null
  );
}

function isEquivalentOpenCodeToolMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): boolean {
  if (!isOpenCodeToolMessage(current) || !isOpenCodeToolMessage(incoming)) {
    return false;
  }

  const currentCallId = current.toolCall?.callId.trim() ?? "";
  const incomingCallId = incoming.toolCall?.callId.trim() ?? "";

  if (currentCallId && incomingCallId) {
    return currentCallId === incomingCallId;
  }

  return extractEquivalentOpenCodeRawRefIdentity(current.rawRef)
    === extractEquivalentOpenCodeRawRefIdentity(incoming.rawRef);
}

function extractEquivalentOpenCodeRawRefIdentity(rawRef: string): string | null {
  if (!rawRef.startsWith("opencode://")) {
    return null;
  }

  const hashIndex = rawRef.indexOf("#");
  const hashSuffix = hashIndex >= 0 ? rawRef.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? rawRef.slice(0, hashIndex) : rawRef;
  const queryIndex = withoutHash.indexOf("?");

  if (queryIndex < 0) {
    return rawRef;
  }

  const base = withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));

  if (!params.has("part")) {
    return rawRef;
  }

  params.delete("part");
  const nextQuery = params.toString();

  return `${base}${nextQuery ? `?${nextQuery}` : ""}${hashSuffix}`;
}

function isEquivalentCodexAuthoritativeMessage(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): boolean {
  if (!isCodexAuthoritativeMessage(current) || !isCodexAuthoritativeMessage(incoming)) {
    return false;
  }

  if (current.role !== incoming.role) {
    return false;
  }

  const isToolLifecycleMessage =
    (current.kind === "tool_call" || current.kind === "tool_result")
    && (incoming.kind === "tool_call" || incoming.kind === "tool_result");

  if (!isToolLifecycleMessage && current.kind !== incoming.kind) {
    return false;
  }

  if (isToolLifecycleMessage) {
    return isEquivalentCodexToolMessage(current, incoming);
  }

  if (
    Math.abs(current.sequence - incoming.sequence) > CODEX_EQUIVALENT_AUTHORITATIVE_SEQUENCE_WINDOW
    || !areTimestampsNearWithinWindow(
      current.timestamp,
      incoming.timestamp,
      CODEX_EQUIVALENT_AUTHORITATIVE_WINDOW_MS
    )
  ) {
    return false;
  }

  if (incoming.kind === "text" || incoming.kind === "thinking") {
    return isEquivalentCodexTextMessageWithinWindow(
      current,
      incoming,
      CODEX_EQUIVALENT_AUTHORITATIVE_WINDOW_MS
    );
  }

  return false;
}

function isEquivalentCodexToolMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): boolean {
  if (
    left.deliveryState !== "sent" ||
    right.deliveryState !== "sent" ||
    !left.rawRef.startsWith("codex://") ||
    !right.rawRef.startsWith("codex://") ||
    left.role !== "tool" ||
    right.role !== "tool" ||
    (left.kind !== "tool_call" && left.kind !== "tool_result") ||
    (right.kind !== "tool_call" && right.kind !== "tool_result") ||
    left.toolCall === null ||
    right.toolCall === null
  ) {
    return false;
  }

  const leftCallId = left.toolCall.callId.trim();
  const rightCallId = right.toolCall.callId.trim();

  return leftCallId.length > 0 && leftCallId === rightCallId;
}

function isOptimisticUserMessage(message: SessionMessageViewModel): boolean {
  if (message.role !== "user" || message.kind !== "text" || message.deliveryState === "failed") {
    return false;
  }

  return (
    message.rawRef.startsWith("pending://")
    || message.rawRef.startsWith("synthetic://")
    || message.rawRef.includes("#synthetic")
  );
}

function isSyntheticCodexUserMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent"
    && message.role === "user"
    && message.kind === "text"
    && message.rawRef.startsWith("synthetic://codex/")
  );
}

function isAuthoritativeUserTextMessage(message: SessionMessageViewModel): boolean {
  return (
    message.role === "user"
    && message.kind === "text"
    && !isOptimisticUserMessage(message)
  );
}

function toTimestampMs(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
}

function summarizeMessageForDebug(message: SessionMessageViewModel): Record<string, unknown> {
  return {
    id: message.id,
    rawRef: message.rawRef,
    role: message.role,
    kind: message.kind,
    sequence: message.sequence,
    timestamp: message.timestamp,
    callId: message.toolCall?.callId ?? null,
    contentPreview:
      message.kind === "text" || message.kind === "thinking"
        ? normalizeComparableCodexText(parseMessageRichContent(message.content).text).slice(0, 160)
        : normalizeComparableCodexText(message.content).slice(0, 160)
  };
}

function buildComparableAttachmentSignature(
  attachments: SessionMessageViewModel["attachments"]
): string {
  return (attachments ?? [])
    .map((attachment) =>
      [
        attachment.kind,
        attachment.fileName.trim().toLowerCase(),
        attachment.mimeType.trim().toLowerCase(),
        String(attachment.fileSize)
      ].join(":")
    )
    .sort()
    .join("|");
}

function buildComparableAttachmentPayloadSignature(
  attachmentPayloads: SessionMessageViewModel["attachmentPayloads"]
): string {
  return (attachmentPayloads ?? [])
    .map((attachment) =>
      [
        attachment.kind,
        attachment.fileName.trim().toLowerCase(),
        attachment.mimeType.trim().toLowerCase(),
        String(attachment.fileSize)
      ].join(":")
    )
    .sort()
    .join("|");
}

function buildComparableMessageAttachmentSignature(message: SessionMessageViewModel): string {
  const persistedSignature = buildComparableAttachmentSignature(message.attachments);

  if (persistedSignature) {
    return persistedSignature;
  }

  return buildComparableAttachmentPayloadSignature(message.attachmentPayloads);
}

function resolveAttachmentCompatibility(
  currentSignature: string,
  incomingSignature: string
): "same" | "one_side_missing" | "conflict" {
  if (!currentSignature && !incomingSignature) {
    return "same";
  }

  if (!currentSignature || !incomingSignature) {
    return "one_side_missing";
  }

  return currentSignature === incomingSignature ? "same" : "conflict";
}

function resolveAttachmentPenalty(
  compatibility: ReturnType<typeof resolveAttachmentCompatibility>
): number {
  switch (compatibility) {
    case "same":
      return 0;
    case "one_side_missing":
      return 2_500;
    case "conflict":
    default:
      return 120_000;
  }
}

function summarizeUserMatchCandidate(
  message: SessionMessageViewModel,
  detail: {
    strictTextMatches: boolean;
    relaxedTextMatches: boolean;
    attachmentCompatibility: ReturnType<typeof resolveAttachmentCompatibility>;
    distanceMs: number;
    sequenceDistance: number;
  }
): Record<string, unknown> {
  return {
    ...summarizeMessageForDebug(message),
    comparableContent: normalizeComparableUserMergeText(message.content).slice(0, 160),
    attachmentSignature: buildComparableAttachmentSignature(message.attachments),
    strictTextMatches: detail.strictTextMatches,
    relaxedTextMatches: detail.relaxedTextMatches,
    attachmentCompatibility: detail.attachmentCompatibility,
    distanceMs: detail.distanceMs,
    sequenceDistance: detail.sequenceDistance
  };
}

function summarizeUserMessageMatchInput(
  message: SessionMessageViewModel,
  detail: {
    relaxedContent: string;
    attachmentSignature: string;
  }
): Record<string, unknown> {
  return {
    ...summarizeMessageForDebug(message),
    comparableContent: detail.relaxedContent.slice(0, 160),
    attachmentSignature: detail.attachmentSignature
  };
}

export function getNextOptimisticUserSequence(messages: SessionMessageViewModel[]): number {
  const maxSequence = messages.reduce((currentMax, message) => {
    return Number.isFinite(message.sequence) && message.sequence > currentMax
      ? message.sequence
      : currentMax;
  }, 0);

  return maxSequence + 1;
}

function areTimestampsNearWithinWindow(left: string, right: string, windowMs: number): boolean {
  return Math.abs(toTimestampMs(left) - toTimestampMs(right)) <= windowMs;
}

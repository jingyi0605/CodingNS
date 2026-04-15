import type {
  ContextUsageDto,
  DeliveryState,
  HistoryMessageDto,
  ImageAttachmentPayload,
  MessageAttachmentDto,
  ProviderCapabilitiesDto,
  SessionPermissionRequestDto,
  SessionQueueItemDto,
  SessionInterruptSource,
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
  messages: SessionMessageViewModel[];
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

export function createInitialRuntimeState(
  seed?: Partial<
    Pick<
      SessionRuntimeState,
      | "session"
      | "capabilities"
      | "runtimeHasActiveRun"
      | "runtimeCanInterrupt"
      | "contextUsage"
      | "messages"
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
    messages: seed?.messages ?? [],
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
    content: message.content,
    toolCall,
    attachments: message.attachments ?? [],
    attachmentPayloads: null,
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
  attachmentPayloads: ImageAttachmentPayload[] = [],
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

  for (const item of current) {
    nextById.set(item.id, item);
  }

  for (const message of incoming) {
    const nextMessage = toViewMessage(sessionId, message);
    const authoritativeMessageId = findMatchingAuthoritativeMessageId(nextById, nextMessage);

    if (authoritativeMessageId && authoritativeMessageId !== nextMessage.id) {
      continue;
    }

    const optimisticMessageId = findMatchingOptimisticMessageId(nextById, nextMessage);

    if (optimisticMessageId && optimisticMessageId !== nextMessage.id) {
      nextById.delete(optimisticMessageId);
    }

    const currentMessage = nextById.get(message.messageId) ?? null;
    nextById.set(
      message.messageId,
      currentMessage
        ? mergeAuthoritativeVersion(currentMessage, nextMessage)
        : nextMessage
    );
  }

  return sortMessages(Array.from(nextById.values()));
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

function collapseInterleavedEquivalentCodexAssistantMessages(
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  const collapsed: SessionMessageViewModel[] = [];

  for (const message of messages) {
    if (!isCodexAssistantTextLikeMessage(message)) {
      collapsed.push(message);
      continue;
    }

    let candidateIndex = collapsed.length - 1;

    while (candidateIndex >= 0 && isCodexToolMessage(collapsed[candidateIndex])) {
      candidateIndex -= 1;
    }

    const candidate = candidateIndex >= 0 ? collapsed[candidateIndex] : null;

    if (!candidate || !isEquivalentCodexTextMessage(candidate, message)) {
      collapsed.push(message);
      continue;
    }

    collapsed[candidateIndex] = pickPreferredInterleavedCodexAssistantMessage(candidate, message);
  }

  return collapsed;
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

function sortMessages(messages: SessionMessageViewModel[]): SessionMessageViewModel[] {
  const sorted = [...messages].sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }

    return left.timestamp.localeCompare(right.timestamp);
  });

  return collapseEquivalentKimiTextMessages(
    collapseEquivalentGeminiTextMessages(
      collapseEquivalentOpenCodeUserMessages(
        collapseEquivalentOpenCodeTurnPairs(
          collapseEquivalentOpenCodeAssistantMessages(
            collapseInterleavedEquivalentCodexAssistantMessages(
              collapseEquivalentCodexMessages(sorted)
            )
          )
        )
      )
    )
  );
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
  if (!optimistic || !shouldPreserveOptimisticPlacement(optimistic, authoritative)) {
    return authoritative;
  }

  const authoritativeAttachments = authoritative.attachments ?? [];

  return {
    ...authoritative,
    sequence: optimistic.sequence,
    timestamp: optimistic.timestamp,
    attachments:
      authoritativeAttachments.length > 0 ? authoritativeAttachments : optimistic.attachments ?? [],
    attachmentPayloads: optimistic.attachmentPayloads ?? null
  };
}

function mergeAuthoritativeVersion(
  current: SessionMessageViewModel,
  incoming: SessionMessageViewModel
): SessionMessageViewModel {
  if (current.id !== incoming.id) {
    return incoming;
  }

  if (
    current.role !== incoming.role
    || current.kind !== incoming.kind
    || current.rawRef !== incoming.rawRef
  ) {
    return pickNewerAuthoritativeMessage(current, incoming);
  }

  const mergedToolCall = mergeToolCall(current.toolCall, incoming.toolCall);
  const content = pickPreferredContent(current.content, incoming.content, current.timestamp, incoming.timestamp);
  const attachments = pickPreferredAttachments(current.attachments, incoming.attachments);

  return {
    ...pickNewerAuthoritativeMessage(current, incoming),
    content,
    toolCall: mergedToolCall,
    attachments,
    attachmentPayloads: current.attachmentPayloads ?? incoming.attachmentPayloads ?? null,
    timestamp: current.timestamp.localeCompare(incoming.timestamp) >= 0 ? current.timestamp : incoming.timestamp,
    sequence: Math.max(current.sequence, incoming.sequence)
  };
}

function shouldPreserveOptimisticPlacement(
  optimistic: SessionMessageViewModel,
  authoritative: SessionMessageViewModel
): boolean {
  return (
    isOptimisticUserMessage(optimistic) &&
    authoritative.role === "user" &&
    authoritative.kind === "text" &&
    optimistic.sequence > authoritative.sequence
  );
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
    areTimestampsNearWithinWindow(left.timestamp, right.timestamp, 30 * 1000) &&
    normalizeComparableCodexText(leftContent.text) === normalizeComparableCodexText(rightContent.text) &&
    areEquivalentInlineImages(leftContent.inlineImages, rightContent.inlineImages)
  );
}

function isCodexAssistantTextLikeMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent" &&
    message.rawRef.startsWith("codex://") &&
    message.role === "assistant" &&
    (message.kind === "text" || message.kind === "thinking") &&
    message.toolCall === null
  );
}

function isCodexToolMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent" &&
    message.rawRef.startsWith("codex://") &&
    (message.kind === "tool_call" || message.kind === "tool_result")
  );
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

function isOpenCodeAssistantTextMessage(message: SessionMessageViewModel): boolean {
  return (
    message.deliveryState === "sent" &&
    message.rawRef.startsWith("opencode://") &&
    message.role === "assistant" &&
    message.kind === "text"
  );
}

function isEquivalentOpenCodeAssistantTextMessage(
  left: SessionMessageViewModel,
  right: SessionMessageViewModel
): boolean {
  return (
    isOpenCodeAssistantTextMessage(left) &&
    isOpenCodeAssistantTextMessage(right) &&
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

function pickPreferredInterleavedCodexAssistantMessage(
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

  return left;
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

  return {
    ...preferred,
    input: pickLongerText(current.input, incoming.input),
    output: pickLongerNullableText(current.output, incoming.output),
    error: pickLongerNullableText(current.error, incoming.error)
  };
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
  if (!isAuthoritativeUserTextMessage(incoming)) {
    return null;
  }

  return findClosestMatchingUserMessageId(messagesById, incoming, "optimistic");
}

function findMatchingAuthoritativeMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  incoming: SessionMessageViewModel
): string | null {
  if (!isOptimisticUserMessage(incoming)) {
    return null;
  }

  return findClosestMatchingUserMessageId(messagesById, incoming, "authoritative");
}

function findClosestMatchingUserMessageId(
  messagesById: Map<string, SessionMessageViewModel>,
  incoming: SessionMessageViewModel,
  target: "optimistic" | "authoritative"
): string | null {
  const incomingTimestampMs = toTimestampMs(incoming.timestamp);
  const comparableIncomingContent = normalizeComparableCodexText(incoming.content);
  let matchedId: string | null = null;
  let matchedDistance = Number.POSITIVE_INFINITY;

  for (const [messageId, current] of messagesById.entries()) {
    const matchesTarget =
      target === "optimistic"
        ? isOptimisticUserMessage(current)
        : isAuthoritativeUserTextMessage(current);

    if (!matchesTarget) {
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

  return (
    message.rawRef.startsWith("pending://")
    || message.rawRef.startsWith("synthetic://")
    || message.rawRef.includes("#synthetic")
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

import type { SessionRunningState, SyncStatus } from "./api/conversation-api";
import type { SessionMessageViewModel } from "./runtime/session-runtime-machine";
import { resolveSessionErrorDisplayContent } from "./session-error-display";

export type ConversationTimelineSourceItem =
  | {
      type: "message";
      key: string;
      message: SessionMessageViewModel;
    }
  | {
      type: "runtime_thinking";
      key: string;
      label: string;
    }
  | {
      type: "session_error";
      key: string;
      error: NonNullable<ReturnType<typeof resolveSessionErrorDisplayContent>>;
    };

export function buildConversationTimelineSourceItems(input: {
  messages: SessionMessageViewModel[];
  runtimeThinkingPlaceholder?: string | null;
  sessionRunningState?: SessionRunningState | null;
  sessionSyncStatus?: SyncStatus | null;
  sessionLastErrorCode?: string | null;
  sessionLastErrorDetail?: string | null;
}): ConversationTimelineSourceItem[] {
  const items: ConversationTimelineSourceItem[] = input.messages.map((message) => ({
    type: "message",
    key: message.id,
    message
  }));
  const runtimeThinkingPlaceholder = input.runtimeThinkingPlaceholder ?? null;
  const sessionErrorDisplay = resolveSessionErrorDisplayContent({
    runningState: input.sessionRunningState ?? null,
    syncStatus: input.sessionSyncStatus ?? null,
    lastErrorCode: input.sessionLastErrorCode ?? null,
    lastErrorDetail: input.sessionLastErrorDetail ?? null
  });

  if (runtimeThinkingPlaceholder) {
    items.push({
      type: "runtime_thinking",
      key: `runtime-thinking:${runtimeThinkingPlaceholder}`,
      label: runtimeThinkingPlaceholder
    });
  }

  if (sessionErrorDisplay) {
    items.push({
      type: "session_error",
      key: `session-error:${sessionErrorDisplay.code ?? "none"}:${sessionErrorDisplay.summary ?? "none"}`,
      error: sessionErrorDisplay
    });
  }

  return items;
}

export function extractConversationTimelineMessages(
  items: ConversationTimelineSourceItem[]
): SessionMessageViewModel[] {
  return items.flatMap((item) => item.type === "message" ? [item.message] : []);
}

export function findConversationTimelineRuntimeThinkingLabel(
  items: ConversationTimelineSourceItem[]
): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];

    if (item?.type === "runtime_thinking") {
      return item.label;
    }
  }

  return null;
}

export function withConversationTimelineRuntimeThinkingItem(
  items: ConversationTimelineSourceItem[],
  runtimeThinkingPlaceholder: string | null
): ConversationTimelineSourceItem[] {
  const normalizedItems = items.filter((item) => item.type !== "runtime_thinking");

  if (!runtimeThinkingPlaceholder) {
    return normalizedItems;
  }

  const runtimeThinkingItem: ConversationTimelineSourceItem = {
    type: "runtime_thinking",
    key: `runtime-thinking:${runtimeThinkingPlaceholder}`,
    label: runtimeThinkingPlaceholder
  };
  const sessionErrorIndex = normalizedItems.findIndex((item) => item.type === "session_error");

  if (sessionErrorIndex < 0) {
    return [...normalizedItems, runtimeThinkingItem];
  }

  return [
    ...normalizedItems.slice(0, sessionErrorIndex),
    runtimeThinkingItem,
    ...normalizedItems.slice(sessionErrorIndex)
  ];
}

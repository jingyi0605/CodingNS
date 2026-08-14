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
    }
  | {
      type: "runtime_notice";
      key: string;
      notice: {
        title: string;
        summary: string;
        kindLabel: string;
      };
    };

export function buildConversationTimelineSourceItems(input: {
  messages: SessionMessageViewModel[];
  runtimeThinkingPlaceholder?: string | null;
  sessionRunningState?: SessionRunningState | null;
  sessionSyncStatus?: SyncStatus | null;
  sessionLastErrorCode?: string | null;
  sessionLastErrorDetail?: string | null;
  sessionDetail?: string | null;
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

  const runtimeNotice = resolveRuntimeNotice(input.sessionDetail ?? null);

  if (runtimeNotice) {
    items.push({
      type: "runtime_notice",
      key: `runtime-notice:${runtimeNotice.title}:${runtimeNotice.summary}`,
      notice: runtimeNotice
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

function resolveRuntimeNotice(
  detail: string | null
): { title: string; summary: string; kindLabel: string } | null {
  const normalized = detail?.trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("Claude 需要你")
    || normalized.startsWith("Claude 请求")
    || normalized.startsWith("Claude 已收到补充信息结果")
  ) {
    return null;
  }

  if (
    normalized.startsWith("Claude 发来一条通知")
    || normalized.startsWith("Claude 正在执行初始化")
    || normalized.startsWith("Claude 正在展开用户指令")
    || normalized.startsWith("Claude 子任务已启动")
    || normalized.startsWith("Claude 子任务已结束")
    || normalized.startsWith("Claude 正在创建工作树")
    || normalized.startsWith("Claude 正在移除工作树")
    || normalized.startsWith("Claude 已加载指令文件")
    || normalized.startsWith("Claude 检测到配置变化")
    || normalized.startsWith("Claude 已切换工作目录")
    || normalized.startsWith("Claude 检测到文件变化")
  ) {
    return {
      title: "Claude 正在处理当前任务",
      summary: normalized,
      kindLabel: "运行状态"
    };
  }

  return null;
}

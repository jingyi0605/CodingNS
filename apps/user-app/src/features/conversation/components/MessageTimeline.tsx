import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";

import type { ProviderId } from "../api/conversation-api";
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";

interface MessageTimelineProps {
  sessionId?: string;
  messages: SessionMessageViewModel[];
  historyState: "idle" | "loading" | "ready" | "error";
  loadingOlderMessages?: boolean;
  hasOlderMessages?: boolean;
  onLoadOlderMessages?: () => void;
  onRetryMessage: (clientRequestId: string) => void;
  provider: ProviderId | null;
}

interface ResolvedToolCall {
  callId: string;
  name: string;
  input: string;
  output: string | null;
  error: string | null;
  status: "running" | "completed" | "failed";
}

interface ToolMessageGroup {
  key: string;
  tool: ResolvedToolCall;
  hasRequest: boolean;
  hasResult: boolean;
}

type TimelineRenderItem =
  | {
      type: "message";
      key: string;
      message: SessionMessageViewModel;
    }
  | {
      type: "tool_group";
      key: string;
      group: ToolMessageGroup;
    };

function isToolMessage(message: SessionMessageViewModel) {
  return message.kind === "tool_call" || message.kind === "tool_result";
}

function resolveToolCall(message: SessionMessageViewModel): ResolvedToolCall | null {
  if (message.toolCall) {
    return message.toolCall;
  }

  if (!isToolMessage(message)) {
    return null;
  }

  return {
    callId: message.rawRef || message.id,
    name: "tool",
    input: message.kind === "tool_call" ? message.content : "",
    output: message.kind === "tool_result" && message.content ? message.content : null,
    error: null,
    status: message.kind === "tool_call" ? "running" : "completed"
  };
}

function mergeToolMessages(messages: SessionMessageViewModel[]): ToolMessageGroup | null {
  const tools = messages
    .map((message) => ({
      message,
      tool: resolveToolCall(message)
    }))
    .filter((item): item is { message: SessionMessageViewModel; tool: ResolvedToolCall } => Boolean(item.tool));

  if (tools.length === 0) {
    return null;
  }

  const merged: ResolvedToolCall = { ...tools[0]!.tool };
  let hasRequest = false;
  let hasResult = false;

  for (const { message, tool } of tools) {
    if (message.kind === "tool_call") {
      hasRequest = true;

      if (!merged.input && tool.input) {
        merged.input = tool.input;
      }
    }

    if (message.kind === "tool_result") {
      hasResult = true;
      merged.output = tool.output;
      merged.error = tool.error;
      merged.status = tool.status;

      if (!merged.input && tool.input) {
        merged.input = tool.input;
      }
    }

    if (!merged.name && tool.name) {
      merged.name = tool.name;
    }
  }

  return {
    key: tools.map(({ message }) => message.id).join(":"),
    tool: merged,
    hasRequest,
    hasResult
  };
}

function mergeToolMessageBlock(messages: SessionMessageViewModel[]): ToolMessageGroup[] {
  const groupsByCallId = new Map<
    string,
    {
      messages: SessionMessageViewModel[];
      firstSequence: number;
    }
  >();

  for (const message of messages) {
    const tool = resolveToolCall(message);

    if (!tool) {
      continue;
    }

    const existing = groupsByCallId.get(tool.callId);

    if (existing) {
      existing.messages.push(message);
      continue;
    }

    groupsByCallId.set(tool.callId, {
      messages: [message],
      firstSequence: message.sequence
    });
  }

  return Array.from(groupsByCallId.values())
    .sort((left, right) => left.firstSequence - right.firstSequence)
    .map((entry) => mergeToolMessages(entry.messages))
    .filter((group): group is ToolMessageGroup => Boolean(group));
}

function buildTimelineRenderItems(messages: SessionMessageViewModel[]): TimelineRenderItem[] {
  const items: TimelineRenderItem[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index]!;

    if (!isToolMessage(current)) {
      items.push({
        type: "message",
        key: current.id,
        message: current
      });
      continue;
    }

    const toolMessageBlock = [current];
    let cursor = index + 1;

    while (cursor < messages.length) {
      const next = messages[cursor]!;

      if (!isToolMessage(next)) {
        break;
      }

      toolMessageBlock.push(next);
      cursor += 1;
    }

    const groups = mergeToolMessageBlock(toolMessageBlock);

    if (groups.length === 0) {
      items.push({
        type: "message",
        key: current.id,
        message: current
      });
      index = cursor - 1;
      continue;
    }

    groups.forEach((group) => {
      items.push({
        type: "tool_group",
        key: group.key,
        group
      });
    });

    index = cursor - 1;
  }

  return items;
}

function looksLikeCodexRulesMessage(provider: ProviderId | null, content: string) {
  if (provider !== "codex") {
    return false;
  }

  const normalized = content.trim();

  return /AGENTS\.md instructions for/i.test(normalized)
    && /<INSTRUCTIONS>/i.test(normalized)
    && /<\/INSTRUCTIONS>/i.test(normalized);
}

function getRulesMessageSummary(content: string) {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return t("conversation.rulesMessageTitle");
  }

  return firstLine.replace(/^#+\s*/, "");
}

function MessageMarkdownBody({
  content,
  className
}: {
  content: string;
  className: string;
}) {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          p: ({ node, ...props }) => <p {...props} />,
          code(props) {
            const codeClassName = typeof props.className === "string" ? props.className : "";
            const match = /language-(\w+)/.exec(codeClassName);

            if (match) {
              return (
                <div className="code-block">
                  <div className="code-header">{match[1]}</div>
                  <pre className={codeClassName}>
                    <code>{props.children}</code>
                  </pre>
                </div>
              );
            }

            return (
              <code className={codeClassName || undefined}>
                {props.children}
              </code>
            );
          }
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="timeline-skeleton" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <article
          key={index}
          className={`timeline-skeleton-item ${index % 2 === 0 ? "assistant" : "user"}`}
        >
          <div className="timeline-skeleton-avatar" />
          <div className="timeline-skeleton-bubble">
            <span className="timeline-skeleton-line long" />
            <span className="timeline-skeleton-line medium" />
            <span className="timeline-skeleton-line short" />
          </div>
        </article>
      ))}
    </div>
  );
}

function ToolCallItem({ group }: { group: ToolMessageGroup }) {
  const [expanded, setExpanded] = useState(false);
  const { tool, hasRequest, hasResult } = group;
  const previewSource = tool.input || tool.error || tool.output || t("conversation.toolResultEmpty");
  const preview = previewSource.length > 60 ? `${previewSource.slice(0, 60)}...` : previewSource;
  const hasDetails = Boolean(tool.input || tool.output || tool.error);
  const statusLabel =
    tool.status === "running"
      ? t("conversation.toolStatusRunning")
      : tool.status === "failed"
        ? t("conversation.toolStatusFailed")
        : t("conversation.toolStatusCompleted");

  return (
    <div className={`tool-call-item ${hasResult ? "tool-result" : ""}`}>
      <button
        type="button"
        className="tool-call-header"
        onClick={() => hasDetails && setExpanded((current) => !current)}
      >
        <div className="tool-call-info">
          <span className="tool-call-name">{tool.name}</span>
          <span className="tool-call-input-preview">{preview}</span>
        </div>
        <div className="tool-call-meta">
          <span className={`tool-call-status is-${tool.status}`}>{statusLabel}</span>
          {hasDetails && (
            <span className={`tool-call-toggle ${expanded ? "expanded" : ""}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          )}
        </div>
      </button>

      {expanded && hasDetails && (
        <div className="tool-call-output">
          {hasRequest && tool.input && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">{t("conversation.toolInputLabel")}</div>
              <pre>{tool.input}</pre>
            </div>
          )}

          {(hasResult || tool.error || tool.output) && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">{t("conversation.toolResultLabel")}</div>
              <pre className={tool.error ? "tool-call-error" : undefined}>
                {tool.error || tool.output || t("conversation.toolResultEmpty")}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RulesMessageCard({
  message,
  tone,
  onRetry
}: {
  message: SessionMessageViewModel;
  tone: "user-message" | "assistant-message" | "system-message";
  onRetry: (clientRequestId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = getRulesMessageSummary(message.content);
  const isUser = tone === "user-message";

  return (
    <article className={`message-item ${tone} rules-message-row`}>
      <div className="message-content-wrapper">
        <div className="rules-message-card">
          <button
            type="button"
            className="rules-message-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <div className="rules-message-heading">
              <span className="rules-message-badge">{t("conversation.rulesMessageTitle")}</span>
              <span className="rules-message-summary">{summary}</span>
            </div>
            <span className="rules-message-action">
              {expanded ? t("conversation.rulesMessageCollapse") : t("conversation.rulesMessageExpand")}
            </span>
          </button>

          <p className="rules-message-hint">{t("conversation.rulesMessageHint")}</p>

          {expanded && (
            <div className="rules-message-body">
              <MessageMarkdownBody
                content={message.content}
                className="message-text message-content markdown-content"
              />
            </div>
          )}
        </div>

        {message.deliveryState === "failed" && message.clientRequestId && (
          <button
            className="retry-button"
            type="button"
            onClick={() => onRetry(message.clientRequestId!)}
          >
            {t("conversation.resendButton")}
          </button>
        )}
      </div>

      {isUser && (
        <time className="message-time" dateTime={message.timestamp}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      )}
    </article>
  );
}

function MessageItem({
  message,
  provider,
  onRetry
}: {
  message: SessionMessageViewModel;
  provider: ProviderId | null;
  onRetry: (clientRequestId: string) => void;
}) {
  const isUser = message.role === "user";
  const isThinking = message.kind === "thinking";
  const isAssistantText = message.role === "assistant" && message.kind === "text";
  const isRulesMessage = looksLikeCodexRulesMessage(provider, message.content);

  if (isRulesMessage) {
    const tone =
      message.role === "user"
        ? "user-message"
        : message.role === "assistant"
          ? "assistant-message"
          : "system-message";

    return <RulesMessageCard message={message} tone={tone} onRetry={onRetry} />;
  }

  if (isUser) {
    return (
      <article className="message-item user-message">
        <div className="message-content-wrapper">
          <MessageMarkdownBody content={message.content} className="message-text message-content" />
          {message.deliveryState === "failed" && message.clientRequestId && (
            <button
              className="retry-button"
              type="button"
              onClick={() => onRetry(message.clientRequestId!)}
            >
              {t("conversation.resendButton")}
            </button>
          )}
        </div>
        <time className="message-time" dateTime={message.timestamp}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      </article>
    );
  }

  if (isAssistantText || isThinking) {
    return (
      <article className="message-item assistant-message">
        <div className="message-avatar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </div>
        <div className="message-content-wrapper">
          {isThinking && (
            <div className="tool-call-name">{t("conversation.thinkingLabel")}</div>
          )}
          {message.content && (
            <MessageMarkdownBody
              content={message.content}
              className="message-text message-content markdown-content"
            />
          )}
        </div>
      </article>
    );
  }

  return (
    <article className="message-item system-message">
      <div className="message-content-wrapper">
        <div className="message-text message-content">
          <pre>{message.content}</pre>
        </div>
      </div>
    </article>
  );
}

export function MessageTimeline({
  sessionId = "session",
  messages,
  historyState,
  loadingOlderMessages = false,
  hasOlderMessages = false,
  onLoadOlderMessages = () => {},
  onRetryMessage,
  provider
}: MessageTimelineProps) {
  const { showToast } = useToast();
  const listRef = useRef<HTMLDivElement | null>(null);
  const previousSessionIdRef = useRef(sessionId);
  const previousMessageCountRef = useRef(messages.length);
  const previousLastMessageSignatureRef = useRef<string | null>(
    buildMessageSignature(messages.at(-1) ?? null)
  );
  const stickToBottomRef = useRef(true);
  const pendingOlderLoadOffsetRef = useRef<number | null>(null);
  const renderItems = buildTimelineRenderItems(messages);
  const showTimelineSkeleton = historyState === "loading" && messages.length === 0;

  useEffect(() => {
    if (historyState !== "error") {
      return;
    }

    showToast({
      title: t("conversation.historyLoadFailed"),
      tone: "error"
    });
  }, [historyState, showToast]);

  useEffect(() => {
    if (previousSessionIdRef.current !== sessionId) {
      previousSessionIdRef.current = sessionId;
      previousMessageCountRef.current = 0;
      previousLastMessageSignatureRef.current = null;
      stickToBottomRef.current = true;
      pendingOlderLoadOffsetRef.current = null;
    }
  }, [sessionId]);

  useLayoutEffect(() => {
    const list = listRef.current;

    if (!list) {
      previousMessageCountRef.current = messages.length;
      previousLastMessageSignatureRef.current = buildMessageSignature(messages.at(-1) ?? null);
      return;
    }

    const previousCount = previousMessageCountRef.current;
    const previousLastSignature = previousLastMessageSignatureRef.current;
    const currentLastSignature = buildMessageSignature(messages.at(-1) ?? null);

    if (pendingOlderLoadOffsetRef.current !== null && messages.length >= previousCount) {
      list.scrollTop = Math.max(0, list.scrollHeight - pendingOlderLoadOffsetRef.current);
      pendingOlderLoadOffsetRef.current = null;
    } else if (
      stickToBottomRef.current
      && (
        previousCount === 0 ||
        messages.length !== previousCount ||
        currentLastSignature !== previousLastSignature
      )
    ) {
      list.scrollTop = list.scrollHeight;
    }

    previousMessageCountRef.current = messages.length;
    previousLastMessageSignatureRef.current = currentLastSignature;
  }, [messages, sessionId]);

  function handleScroll() {
    const list = listRef.current;

    if (!list) {
      return;
    }

    const distanceToBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
    stickToBottomRef.current = distanceToBottom <= 80;

    if (
      list.scrollTop <= 120
      && hasOlderMessages
      && !loadingOlderMessages
      && historyState === "ready"
    ) {
      pendingOlderLoadOffsetRef.current = list.scrollHeight - list.scrollTop;
      onLoadOlderMessages();
    }
  }

  return (
    <section className="message-timeline">
      {historyState === "loading" && (
        <div className="timeline-status">
          <span className="status-text">{t("conversation.historyLoading")}</span>
        </div>
      )}
      <div
        ref={listRef}
        className="message-list"
        onScroll={handleScroll}
      >
        {showTimelineSkeleton ? <TimelineSkeleton /> : null}

        {loadingOlderMessages ? (
          <div className="timeline-status timeline-status-inline">
            <span className="status-text">{t("conversation.historyLoadingOlder")}</span>
          </div>
        ) : null}

        {renderItems.length === 0 && historyState === "ready" && (
          <div className="timeline-empty">
            <p className="status-text">{t("conversation.timelineEmpty")}</p>
          </div>
        )}

        {renderItems.map((item) =>
          item.type === "tool_group" ? (
            <article key={item.key} className="message-item tool-message-row">
              <ToolCallItem group={item.group} />
            </article>
          ) : (
            <MessageItem
              key={item.key}
              message={item.message}
              provider={provider}
              onRetry={onRetryMessage}
            />
          )
        )}
      </div>
    </section>
  );
}

function buildMessageSignature(message: SessionMessageViewModel | null): string | null {
  if (!message) {
    return null;
  }

  return JSON.stringify({
    id: message.id,
    content: message.content,
    timestamp: message.timestamp,
    deliveryState: message.deliveryState,
    toolCall: message.toolCall
      ? {
          status: message.toolCall.status,
          output: message.toolCall.output,
          error: message.toolCall.error
        }
      : null
  });
}

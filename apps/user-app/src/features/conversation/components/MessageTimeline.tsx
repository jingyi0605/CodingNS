import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { t } from "../../../shared/i18n";

import type { ProviderId } from "../api/conversation-api";
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";

interface MessageTimelineProps {
  messages: SessionMessageViewModel[];
  historyState: "idle" | "loading" | "ready" | "error";
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

function shouldMergeToolMessages(
  current: SessionMessageViewModel,
  next: SessionMessageViewModel
) {
  const currentTool = resolveToolCall(current);
  const nextTool = resolveToolCall(next);

  if (!currentTool || !nextTool) {
    return false;
  }

  return currentTool.callId === nextTool.callId;
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

    const groupedMessages = [current];
    let cursor = index + 1;

    while (cursor < messages.length) {
      const next = messages[cursor]!;

      if (!isToolMessage(next) || !shouldMergeToolMessages(groupedMessages[groupedMessages.length - 1]!, next)) {
        break;
      }

      groupedMessages.push(next);
      cursor += 1;
    }

    const group = mergeToolMessages(groupedMessages);

    if (group) {
      items.push({
        type: "tool_group",
        key: group.key,
        group
      });
    } else {
      items.push({
        type: "message",
        key: current.id,
        message: current
      });
    }

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
  messages,
  historyState,
  onRetryMessage,
  provider
}: MessageTimelineProps) {
  const renderItems = buildTimelineRenderItems(messages);

  return (
    <section className="message-timeline">
      {historyState === "loading" && (
        <div className="timeline-status">
          <span className="status-text">{t("conversation.historyLoading")}</span>
        </div>
      )}
      {historyState === "error" && (
        <div className="timeline-status">
          <span className="status-text" data-tone="error">
            {t("conversation.historyLoadFailed")}
          </span>
        </div>
      )}

      <div className="message-list">
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

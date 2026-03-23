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

function ToolCallItem({ message }: { message: SessionMessageViewModel }) {
  const [expanded, setExpanded] = useState(false);
  const tool = message.toolCall;

  if (!tool) {
    return null;
  }

  const isResult = message.kind === "tool_result";
  const previewSource = isResult
    ? tool.error || tool.output || t("conversation.toolResultEmpty")
    : tool.input || "{}";
  const preview = previewSource.length > 60 ? `${previewSource.slice(0, 60)}...` : previewSource;
  const hasOutput = Boolean(tool.output || tool.error);

  return (
    <div className={`tool-call-item ${isResult ? "tool-result" : ""}`}>
      <button
        type="button"
        className="tool-call-header"
        onClick={() => hasOutput && setExpanded((current) => !current)}
      >
        <div className="tool-call-info">
          <span className="tool-call-name">
            {isResult ? `${tool.name} / ${t("conversation.toolResultLabel")}` : tool.name}
          </span>
          <span className="tool-call-input-preview">{preview}</span>
        </div>
        {hasOutput && (
          <span className={`tool-call-toggle ${expanded ? "expanded" : ""}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        )}
      </button>

      {expanded && hasOutput && (
        <div className="tool-call-output">
          <pre className={tool.error ? "tool-call-error" : undefined}>
            {tool.error || tool.output}
          </pre>
        </div>
      )}
    </div>
  );
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
  const isTool = message.kind === "tool_call" || message.kind === "tool_result";
  const isThinking = message.kind === "thinking";
  const isAssistantText = message.role === "assistant" && message.kind === "text";
  const isRulesMessage = looksLikeCodexRulesMessage(provider, message.content);

  if (isTool) {
    return (
      <article className="message-item tool-message-row">
        <ToolCallItem message={message} />
      </article>
    );
  }

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
        {messages.length === 0 && historyState === "ready" && (
          <div className="timeline-empty">
            <p className="status-text">{t("conversation.timelineEmpty")}</p>
          </div>
        )}

        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            provider={provider}
            onRetry={onRetryMessage}
          />
        ))}
      </div>
    </section>
  );
}

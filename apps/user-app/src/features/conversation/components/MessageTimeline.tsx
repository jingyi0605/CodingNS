import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { t } from "../../../shared/i18n";

import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";

interface MessageTimelineProps {
  messages: SessionMessageViewModel[];
  historyState: "idle" | "loading" | "ready" | "error";
  onRetryMessage: (clientRequestId: string) => void;
}

// Parse tool calls from message content
interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
}

function parseToolCalls(content: string): { text: string; tools: ToolCall[] } {
  const tools: ToolCall[] = [];
  let text = content;

  // Match tool calls in various formats

  // Format 1: <tool> tags
  const toolRegex = /<tool>([\s\S]*?)<\/tool>/g;
  let match;
  while ((match = toolRegex.exec(content)) !== null) {
    try {
      const toolData = JSON.parse(match[1]);
      tools.push({
        id: toolData.tool_call_id || toolData.id || `tool-${tools.length}`,
        name: toolData.name || "tool",
        input: toolData.arguments ? JSON.parse(toolData.arguments) : toolData.input || {},
        output: toolData.output,
        error: toolData.error
      });
      text = text.replace(match[0], "");
    } catch {
      // Skip invalid tool calls
    }
  }

  // Format 2: <tool_result> tags
  const resultRegex = /<tool_result>([\s\S]*?)<\/tool_result>/g;
  while ((match = resultRegex.exec(content)) !== null) {
    try {
      const resultData = JSON.parse(match[1]);
      const existingTool = tools.find((t) => t.id === resultData.tool_call_id);
      if (existingTool) {
        existingTool.output = resultData.content || resultData.output;
      }
      text = text.replace(match[0], "");
    } catch {
      // Skip invalid results
    }
  }

  // Format 3: Function call format "function_name(...)"
  const funcCallRegex = /(?:function_call|tool_use)\s*[:\{]\s*["']?name["']?\s*:\s*["']([^"']+)["']\s*,?\s*["']?arguments?["']?\s*:\s*(\{[^}]+\})/gi;
  while ((match = funcCallRegex.exec(content)) !== null) {
    try {
      const name = match[1];
      const argsStr = match[2];
      const input = JSON.parse(argsStr);
      tools.push({
        id: `tool-${tools.length}`,
        name,
        input
      });
      text = text.replace(match[0], "");
    } catch {
      // Skip invalid
    }
  }

  // Format 4: Anthropic-style tool use blocks
  const anthropicToolRegex = /\u27e8tool\u27e9([\s\S]*?)\u27e9\/tool\u27e9/g;
  while ((match = anthropicToolRegex.exec(content)) !== null) {
    try {
      const toolData = JSON.parse(match[1]);
      tools.push({
        id: toolData.id || `tool-${tools.length}`,
        name: toolData.name || "tool",
        input: toolData.input || {}
      });
      text = text.replace(match[0], "");
    } catch {
      // Skip invalid
    }
  }

  return { text: text.trim(), tools };
}

function ToolCallItem({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const inputStr = JSON.stringify(tool.input, null, 2);
  const hasOutput = tool.output || tool.error;

  return (
    <div className="tool-call-item">
      <button
        type="button"
        className="tool-call-header"
        onClick={() => hasOutput && setExpanded(!expanded)}
      >
        <div className="tool-call-info">
          <span className="tool-call-name">{tool.name}</span>
          <span className="tool-call-input-preview">
            {inputStr.length > 60 ? `${inputStr.slice(0, 60)}...` : inputStr}
          </span>
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
          {tool.error ? (
            <pre className="tool-call-error">{tool.error}</pre>
          ) : (
            <pre>{tool.output}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function ToolMessage({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  let output = content;
  let toolName = "Tool";

  // Try to parse tool result
  try {
    const parsed = JSON.parse(content);
    if (parsed.name) toolName = parsed.name;
    if (parsed.output) output = parsed.output;
    if (parsed.content) output = parsed.content;
    if (parsed.result) output = parsed.result;
  } catch {
    // Use raw content
  }

  const preview = output.length > 60 ? `${output.slice(0, 60)}...` : output;

  return (
    <div className="tool-call-item tool-result">
      <button
        type="button"
        className="tool-call-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="tool-call-info">
          <span className="tool-call-name">{toolName}</span>
          <span className="tool-call-input-preview">{preview}</span>
        </div>
        <span className={`tool-call-toggle ${expanded ? "expanded" : ""}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="tool-call-output">
          <pre>{output}</pre>
        </div>
      )}
    </div>
  );
}

function MessageItem({
  message,
  onRetry
}: {
  message: SessionMessageViewModel;
  onRetry: (clientRequestId: string) => void;
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isTool = message.role === "tool";

  // Parse tool calls from assistant messages
  const { text, tools } = useMemo(() => {
    if (isAssistant) {
      return parseToolCalls(message.content);
    }
    return { text: message.content, tools: [] };
  }, [message.content, isAssistant]);

  // Tool role messages
  if (isTool) {
    return (
      <article className="message-item tool-message-row">
        <ToolMessage content={message.content} />
      </article>
    );
  }

  if (isUser) {
    return (
      <article className="message-item user-message">
        <div className="message-content-wrapper">
          <div className="message-text">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                p: ({ node, ...props }) => <p {...props} />
              }}
            >
              {message.content}
            </Markdown>
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
        <time className="message-time" dateTime={message.timestamp}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      </article>
    );
  }

  if (isAssistant) {
    return (
      <article className="message-item assistant-message">
        <div className="message-avatar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </div>
        <div className="message-content-wrapper">
          <div className="message-text markdown-content">
            {text && (
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  code({ node, inline, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || "");
                    return !inline && match ? (
                      <div className="code-block">
                        <div className="code-header">{match[1]}</div>
                        <pre className={className} {...props}>
                          <code>{children}</code>
                        </pre>
                      </div>
                    ) : (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  }
                }}
              >
                {text}
              </Markdown>
            )}
          </div>
          {tools.length > 0 && (
            <div className="tool-calls">
              {tools.map((tool) => (
                <ToolCallItem key={tool.id} tool={tool} />
              ))}
            </div>
          )}
        </div>
      </article>
    );
  }

  // System messages
  return (
    <article className="message-item system-message">
      <div className="message-content-wrapper">
        <div className="message-text">
          <pre>{message.content}</pre>
        </div>
      </div>
    </article>
  );
}

export function MessageTimeline({
  messages,
  historyState,
  onRetryMessage
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
            onRetry={onRetryMessage}
          />
        ))}
      </div>
    </section>
  );
}

import { isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { usePlatform } from "../../../platform/platform-provider";
import { getSessionAttachmentBlob } from "../api/conversation-api";
import {
  getApplyPatchDisplayName,
  parseApplyPatchPreview,
  type ApplyPatchPreview,
  type ApplyPatchFileChange
} from "../apply-patch-preview";
import { parseMessageRichContent } from "../message-rich-content";

import type {
  ImageAttachmentPayload,
  MessageAttachmentDto,
  ProviderId
} from "../api/conversation-api";
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";
import { shouldFoldRulesMessages } from "../capability/provider-ui";

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

function getToolDisplayName(name: string): string {
  if (name === "shell_command" || name === "tool") {
    return t("conversation.roleTool");
  }

  return name;
}

function parseToolInputRecord(input: string): Record<string, unknown> | null {
  if (!input.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(input) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getToolPreview(tool: ResolvedToolCall): string {
  const parsedInput = parseToolInputRecord(tool.input);
  const command =
    parsedInput && typeof parsedInput.command === "string" ? parsedInput.command.trim() : "";

  if (command) {
    return `${t("conversation.toolPreviewCommand")}：${command}`;
  }

  if (tool.name === "read_thread_terminal") {
    return t("conversation.toolPreviewTerminal");
  }

  const previewSource = tool.input || tool.error || tool.output || t("conversation.toolResultEmpty");
  return previewSource.length > 60 ? `${previewSource.slice(0, 60)}...` : previewSource;
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

function looksLikeRulesMessage(provider: ProviderId | null, content: string) {
  if (!shouldFoldRulesMessages(null, provider)) {
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

function flattenReactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((item) => flattenReactNodeText(item)).join("");
  }

  if (node && typeof node === "object" && "props" in node) {
    const element = node as { props?: { children?: ReactNode } };
    return flattenReactNodeText(element.props?.children ?? "");
  }

  return "";
}

function extractCodeBlockProps(node: ReactNode): {
  content: string;
  codeClassName?: string;
  language: string | null;
} | null {
  const candidate = Array.isArray(node) ? node[0] : node;

  if (!isValidElement(candidate)) {
    return null;
  }

  const props = candidate.props as {
    className?: string;
    children?: ReactNode;
  };
  const codeClassName = typeof props.className === "string" ? props.className : "";
  const match = /language-([^\s]+)/.exec(codeClassName);

  return {
    content: flattenReactNodeText(props.children).replace(/\n$/, ""),
    codeClassName: codeClassName || undefined,
    language: match?.[1] ?? null
  };
}

function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

async function writeTextToClipboard(
  text: string,
  platform: ReturnType<typeof usePlatform>
): Promise<void> {
  if (platform.isDesktop) {
    const desktopResult = await platform.bridge.writeClipboardText(text);

    if (desktopResult.ok) {
      return;
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 浏览器剪贴板在部分 WebView/权限场景下会失败，继续走兼容回退。
    }
  }

  if (copyTextWithExecCommand(text)) {
    return;
  }

  throw new Error(t("conversation.copyContentFailed"));
}

function CopyableContentBlock({
  language,
  codeClassName,
  content
}: {
  language: string | null;
  codeClassName?: string;
  content: string;
}) {
  const { showToast } = useToast();
  const platform = usePlatform();
  const normalizedLanguage = language?.trim().toLowerCase() ?? null;
  const isTextBlock = normalizedLanguage === "text";
  const blockLabel = normalizedLanguage || "code";

  async function handleCopy() {
    try {
      await writeTextToClipboard(content, platform);
      showToast({
        title: t("conversation.copyContentSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("conversation.copyContentFailed"),
        tone: "error"
      });
    }
  }

  return (
    <div className={`code-block${isTextBlock ? " text-code-block" : ""}`}>
      <div className="code-header">
        <span className="code-header-label">{blockLabel}</span>
        <button className="code-copy-button" type="button" onClick={() => void handleCopy()}>
          {t("conversation.copyAction")}
        </button>
      </div>
      <pre className={codeClassName}>
        <code>{content}</code>
      </pre>
    </div>
  );
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
          pre(props) {
            const blockProps = extractCodeBlockProps(props.children);

            if (!blockProps) {
              return <pre>{props.children}</pre>;
            }

            return (
              <CopyableContentBlock
                language={blockProps.language}
                codeClassName={blockProps.codeClassName}
                content={blockProps.content}
              />
            );
          },
          code(props) {
            const codeClassName = typeof props.className === "string" ? props.className : "";
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

interface AttachmentPreviewSource {
  id: string;
  fileName: string;
  fileSize: number | null;
  url: string | null;
  status: "ready" | "loading" | "error";
}

function buildInlineAttachmentPreviewUrl(
  attachment: MessageAttachmentDto,
  payload: ImageAttachmentPayload | null | undefined
) {
  if (!payload?.contentBase64 || payload.mimeType !== attachment.mimeType) {
    return null;
  }

  return `data:${payload.mimeType};base64,${payload.contentBase64}`;
}

function MessageAttachments({
  sessionId,
  attachmentPayloads = [],
  attachments = [],
  inlineImages = []
}: {
  sessionId?: string;
  attachmentPayloads?: ImageAttachmentPayload[] | null;
  attachments?: MessageAttachmentDto[];
  inlineImages?: ReturnType<typeof parseMessageRichContent>["inlineImages"];
}) {
  return (
    <RichMessageAttachments
      sessionId={sessionId}
      attachments={attachments}
      attachmentPayloads={attachmentPayloads}
      inlineImages={inlineImages}
    />
  );
}

function RichMessageAttachments({
  sessionId,
  attachmentPayloads = [],
  attachments = [],
  inlineImages = []
}: {
  sessionId?: string;
  attachmentPayloads?: ImageAttachmentPayload[] | null;
  attachments?: MessageAttachmentDto[];
  inlineImages?: ReturnType<typeof parseMessageRichContent>["inlineImages"];
}) {
  const [remotePreviewSources, setRemotePreviewSources] = useState<Record<string, AttachmentPreviewSource>>({});
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);

  const attachmentPreviewSources = useMemo(
    () =>
      attachments.map((attachment, index) => {
        const inlineUrl = buildInlineAttachmentPreviewUrl(attachment, attachmentPayloads?.[index]);

        if (inlineUrl) {
          return {
            id: attachment.id,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            url: inlineUrl,
            status: "ready" as const
          };
        }

        const remoteSource = remotePreviewSources[attachment.id];

        return {
          id: attachment.id,
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          url: remoteSource?.url ?? null,
          status: remoteSource?.status ?? (sessionId ? "loading" : "error")
        };
      }),
    [attachmentPayloads, attachments, remotePreviewSources, sessionId]
  );
  const inlinePreviewSources = useMemo(
    () =>
      inlineImages.map((image, index) => ({
        id: `inline-image-${index}`,
        fileName: image.altText || `${t("conversation.imageAttachmentLabel")} ${index + 1}`,
        fileSize: image.estimatedBytes,
        url: image.url,
        status: "ready" as const
      })),
    [inlineImages]
  );
  const previewSources = useMemo(
    () => [...inlinePreviewSources, ...attachmentPreviewSources],
    [attachmentPreviewSources, inlinePreviewSources]
  );

  const previewAttachment =
    previewSources.find((attachment) => attachment.id === previewAttachmentId) ?? null;

  useEffect(() => {
    if (!previewAttachmentId) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewAttachmentId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewAttachmentId]);

  useEffect(() => {
    const attachmentsNeedingRemotePreview = attachments.filter((attachment, index) =>
      !buildInlineAttachmentPreviewUrl(attachment, attachmentPayloads?.[index])
    );

    if (!sessionId || attachmentsNeedingRemotePreview.length === 0) {
      setRemotePreviewSources({});
      return undefined;
    }

    let cancelled = false;
    const objectUrls: string[] = [];

    setRemotePreviewSources(
      Object.fromEntries(
        attachmentsNeedingRemotePreview.map((attachment) => [
          attachment.id,
          {
            id: attachment.id,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            url: null,
            status: "loading" as const
          }
        ])
      )
    );

    void Promise.all(
      attachmentsNeedingRemotePreview.map(async (attachment) => {
        try {
          const blob = await getSessionAttachmentBlob(sessionId, attachment.id);
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.push(objectUrl);

          return {
            id: attachment.id,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            url: objectUrl,
            status: "ready" as const
          };
        } catch {
          return {
            id: attachment.id,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            url: null,
            status: "error" as const
          };
        }
      })
    ).then((results) => {
      if (cancelled) {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      setRemotePreviewSources(Object.fromEntries(results.map((attachment) => [attachment.id, attachment])));
    });

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachmentPayloads, attachments, sessionId]);

  if (previewSources.length === 0) {
    return null;
  }

  return (
    <>
      <div className="message-attachments">
        {previewSources.map((attachment) => {
          const previewLabel =
            attachment.status === "loading"
              ? t("conversation.attachmentPreviewLoading")
              : attachment.status === "error"
                ? t("conversation.attachmentPreviewUnavailable")
                : t("conversation.attachmentPreviewOpen");

          return (
            <button
              key={attachment.id}
              type="button"
              className="message-attachment-button"
              onClick={() => attachment.url && setPreviewAttachmentId(attachment.id)}
              disabled={!attachment.url}
              aria-label={`${attachment.fileName} - ${previewLabel}`}
              title={previewLabel}
            >
              <div className="message-attachment-card">
                {attachment.url ? (
                  <img
                    className="message-attachment-thumbnail"
                    src={attachment.url}
                    alt={attachment.fileName || t("conversation.attachmentPreviewAlt")}
                    loading="lazy"
                  />
                ) : (
                  <div className="message-attachment-placeholder" aria-hidden="true">
                    {attachment.status === "loading"
                      ? t("conversation.attachmentPreviewLoading")
                      : t("conversation.attachmentPreviewUnavailable")}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {previewAttachment?.url ? (
        <div className="workbench-modal-layer message-image-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="workbench-modal-backdrop"
            aria-label={t("conversation.attachmentPreviewClose")}
            onClick={() => setPreviewAttachmentId(null)}
          />
          <div className="workbench-modal-card surface-card message-image-modal-card">
            <div className="workbench-modal-header message-image-modal-header">
              <div className="workbench-modal-title-wrap">
                <h2>{t("conversation.imagePreviewTitle")}</h2>
                <p>{previewAttachment.fileName}</p>
              </div>
              <button
                type="button"
                className="workbench-modal-close"
                aria-label={t("conversation.attachmentPreviewClose")}
                onClick={() => setPreviewAttachmentId(null)}
              >
                x
              </button>
            </div>
            <div className="message-image-modal-body">
              <div className="message-image-modal-stage">
                <img
                  className="message-image-modal-image"
                  src={previewAttachment.url}
                  alt={previewAttachment.fileName || t("conversation.attachmentPreviewAlt")}
                />
              </div>
              <p className="message-image-modal-hint">{t("conversation.imagePreviewHint")}</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
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

function ApplyPatchToolItem({
  tool,
  preview
}: {
  tool: ResolvedToolCall;
  preview: ApplyPatchPreview;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (!isModalOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen]);

  return (
    <>
      <div className="tool-call-item apply-patch-item">
        {preview.files.map((file, index) => (
          <button
            key={buildApplyPatchFileRenderKey(file, index)}
            type="button"
            className="apply-patch-summary-row"
            onClick={() => setIsModalOpen(true)}
          >
            <span className="apply-patch-summary-label">{getApplyPatchActionLabel(file.action)}</span>
            <span className="apply-patch-summary-file" title={buildApplyPatchFullPathLabel(file)}>
              {getApplyPatchDisplayName(file.nextPath ?? file.path)}
            </span>
            <span className="apply-patch-summary-stats">
              <span className="apply-patch-summary-added">+{file.additions}</span>
              <span className="apply-patch-summary-removed">-{file.deletions}</span>
            </span>
          </button>
        ))}
      </div>

      {isModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="workbench-modal-layer apply-patch-modal" role="dialog" aria-modal="true">
              <button
                type="button"
                className="workbench-modal-backdrop"
                aria-label={t("common.close")}
                onClick={() => setIsModalOpen(false)}
              />
              <div className="workbench-modal-card surface-card apply-patch-modal-card">
                <div className="workbench-modal-header">
                  <div className="workbench-modal-title-wrap">
                    <h2>{t("conversation.applyPatchDialogTitle")}</h2>
                    <p>{t("conversation.applyPatchDialogDescription")}</p>
                  </div>
                  <button
                    type="button"
                    className="workbench-modal-close"
                    aria-label={t("common.close")}
                    onClick={() => setIsModalOpen(false)}
                  >
                    x
                  </button>
                </div>

                <div className="apply-patch-modal-totals">
                  <span className="apply-patch-stat-pill positive">
                    {t("conversation.applyPatchAddedStat")} +{preview.totalAdditions}
                  </span>
                  <span className="apply-patch-stat-pill negative">
                    {t("conversation.applyPatchRemovedStat")} -{preview.totalDeletions}
                  </span>
                </div>

                <div className="apply-patch-modal-body">
                  {preview.files.length === 0 ? (
                    <p className="status-text">{t("conversation.applyPatchEmpty")}</p>
                  ) : (
                    preview.files.map((file, index) => (
                      <section
                        key={buildApplyPatchFileRenderKey(file, index)}
                        className="apply-patch-file-panel"
                      >
                        <div className="apply-patch-file-panel-header">
                          <div className="apply-patch-file-panel-title">
                            <span className="apply-patch-summary-label">{getApplyPatchActionLabel(file.action)}</span>
                            <strong>{buildApplyPatchFullPathLabel(file)}</strong>
                          </div>
                          <div className="apply-patch-summary-stats">
                            <span className="apply-patch-summary-added">+{file.additions}</span>
                            <span className="apply-patch-summary-removed">-{file.deletions}</span>
                          </div>
                        </div>
                        <div className="apply-patch-diff-view">
                          <div className="apply-patch-diff-scroll">
                            {file.lines.map((line, index) => (
                              <div
                                key={`${buildApplyPatchFullPathLabel(file)}:${index}`}
                                className={`apply-patch-diff-line ${resolveApplyPatchLineClassName(line.kind)}`}
                              >
                                <span className="apply-patch-line-number">
                                  {formatApplyPatchLineNumber(line.oldLineNumber)}
                                </span>
                                <span className="apply-patch-line-number">
                                  {formatApplyPatchLineNumber(line.newLineNumber)}
                                </span>
                                <span className="apply-patch-line-content">{line.text || " "}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </section>
                    ))
                  )}

                  {tool.error ? (
                    <section className="apply-patch-error-panel">
                      <div className="tool-call-section-label">{t("conversation.toolResultLabel")}</div>
                      <pre className="tool-call-error">{tool.error}</pre>
                    </section>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function ToolCallItem({ group }: { group: ToolMessageGroup }) {
  const [expanded, setExpanded] = useState(false);
  const { tool, hasRequest, hasResult } = group;
  const toolDisplayName = getToolDisplayName(tool.name);
  const applyPatchPreview = useMemo(
    () => (tool.name === "apply_patch" ? parseApplyPatchPreview(tool.input) : null),
    [tool.input, tool.name]
  );

  if (applyPatchPreview) {
    return <ApplyPatchToolItem tool={tool} preview={applyPatchPreview} />;
  }

  const preview = getToolPreview(tool);
  const hasDetails = Boolean(tool.input || tool.output || tool.error);

  return (
    <div className={`tool-call-item ${hasResult ? "tool-result" : ""}`}>
      <button
        type="button"
        className="tool-call-header"
        onClick={() => hasDetails && setExpanded((current) => !current)}
      >
        <div className="tool-call-info">
          <span className="tool-call-name">{toolDisplayName}</span>
          <span className="tool-call-input-preview">{preview}</span>
        </div>
        <div className="tool-call-meta">
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

function getApplyPatchActionLabel(action: ApplyPatchFileChange["action"]) {
  if (action === "add") {
    return t("conversation.applyPatchAddedLabel");
  }

  if (action === "delete") {
    return t("conversation.applyPatchDeletedLabel");
  }

  return t("conversation.applyPatchEditedLabel");
}

function buildApplyPatchFullPathLabel(file: ApplyPatchFileChange) {
  if (file.nextPath && file.nextPath !== file.path) {
    return `${file.path} -> ${file.nextPath}`;
  }

  return file.nextPath ?? file.path;
}

function buildApplyPatchFileRenderKey(file: ApplyPatchFileChange, index: number) {
  return `${file.path}:${file.nextPath ?? ""}:${index}`;
}

function resolveApplyPatchLineClassName(kind: ApplyPatchFileChange["lines"][number]["kind"]) {
  if (kind === "add") {
    return "is-added";
  }

  if (kind === "remove") {
    return "is-removed";
  }

  if (kind === "hunk") {
    return "is-hunk";
  }

  if (kind === "meta") {
    return "is-meta";
  }

  return "is-context";
}

function formatApplyPatchLineNumber(value: number | null) {
  return value === null || value <= 0 ? "" : String(value);
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
  const isRulesMessage = looksLikeRulesMessage(provider, message.content);
  const richContent = useMemo(() => parseMessageRichContent(message.content), [message.content]);
  const visibleContent = richContent.text;
  const inlineImages = richContent.inlineImages;

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
          <MessageAttachments
            sessionId={message.sessionId}
            attachments={message.attachments}
            attachmentPayloads={message.attachmentPayloads}
            inlineImages={inlineImages}
          />
          {visibleContent ? (
            <MessageMarkdownBody
              content={visibleContent}
              className="message-text message-content markdown-content"
            />
          ) : null}
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
          <MessageAttachments
            sessionId={message.sessionId}
            attachments={message.attachments}
            attachmentPayloads={message.attachmentPayloads}
            inlineImages={inlineImages}
          />
          {visibleContent && (
            <MessageMarkdownBody
              content={visibleContent}
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
        <MessageAttachments
          sessionId={message.sessionId}
          attachments={message.attachments}
          attachmentPayloads={message.attachmentPayloads}
          inlineImages={inlineImages}
        />
        {visibleContent ? (
          <div className="message-text message-content">
            <CopyableContentBlock language="text" content={visibleContent} />
          </div>
        ) : null}
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
    attachments: message.attachments,
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

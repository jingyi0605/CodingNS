import {
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { usePlatform } from "../../../platform/platform-provider";
import { getButlerFollowUpTask, type ButlerFollowUpTaskDto } from "../../butler/api/butler-api";
import { getSessionAttachmentBlob } from "../api/conversation-api";
import {
  getApplyPatchDisplayName,
  parseApplyPatchPreview,
  type ApplyPatchPreview,
  type ApplyPatchFileChange
} from "../apply-patch-preview";
import { parseMessageRichContent } from "../message-rich-content";
import {
  buildConversationTaskSnapshotFromToolCall,
  countConversationTasksByStatus,
  type ConversationTaskSnapshot
} from "../session-task-progress";
import { useWorkbenchShell } from "./WorkbenchLayout";
import {
  CopyActionIcon,
  ForkActionIcon
} from "./ConversationActionIcons";
import {
  persistConversationScrollState,
  readPersistedConversationScrollState
} from "./conversation-scroll-persistence";

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
  onForkMessage?: (message: SessionMessageViewModel) => Promise<void> | void;
  provider: ProviderId | null;
  runtimeThinkingPlaceholder?: string | null;
  assistantAvatar?: ReactNode;
}

interface MessageActionState {
  canCopy: boolean;
  canFork: boolean;
}

function stripThinkingTrailingDots(value: string): string {
  return value.replace(/(\.{3,}|…+)$/, "").trimEnd();
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
  updatedAt: string;
}

type FoldedPromptKind = "rules" | "system_prompt";

const OLDER_HISTORY_PREFETCH_THRESHOLD_PX = 480;
const STICK_TO_BOTTOM_DISTANCE_PX = 80;
const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 240;
const SCROLL_STATE_PERSIST_DELAY_MS = 120;
const MANUAL_RESTORE_INTERVAL_MS = 50;
const MANUAL_RESTORE_DURATION_MS = 3500;
const MarkdownLinkContext = createContext(false);

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

function normalizeMessagePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:\//.test(value);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("//") || isWindowsAbsolutePath(value);
}

function looksLikeExternalProtocol(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) && !isWindowsAbsolutePath(value);
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function stripFileReferenceDecorations(value: string): string {
  const hashIndex = value.indexOf("#");
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf("?");
  const withoutQuery = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;

  return withoutQuery.replace(/:(\d+)(?::(\d+))?$/, "");
}

function normalizeRelativePath(value: string): string | null {
  const segments: string[] = [];

  for (const segment of normalizeMessagePathSeparators(value).split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return segments.join("/");
}

function decodeMarkdownHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function resolveWorkspaceRelativePathFromHref(
  href: string,
  workspacePath: string
): string | null {
  const decodedHref = decodeMarkdownHref(href).trim();

  if (!decodedHref || decodedHref.startsWith("#")) {
    return null;
  }

  let candidatePath = decodedHref;

  if (/^file:\/\//i.test(candidatePath)) {
    try {
      candidatePath = decodeURIComponent(new URL(candidatePath).pathname);
      if (/^\/[a-zA-Z]:\//.test(candidatePath)) {
        candidatePath = candidatePath.slice(1);
      }
    } catch {
      return null;
    }
  } else if (looksLikeExternalProtocol(candidatePath)) {
    return null;
  }

  candidatePath = normalizeMessagePathSeparators(stripFileReferenceDecorations(candidatePath.trim()));

  if (!candidatePath) {
    return null;
  }

  const normalizedWorkspacePath = trimTrailingSlashes(normalizeMessagePathSeparators(workspacePath.trim()));

  if (!normalizedWorkspacePath) {
    return null;
  }

  if (isAbsolutePath(candidatePath)) {
    const normalizedCandidatePath = trimTrailingSlashes(candidatePath);
    const compareWorkspacePath = isWindowsAbsolutePath(normalizedWorkspacePath)
      ? normalizedWorkspacePath.toLowerCase()
      : normalizedWorkspacePath;
    const compareCandidatePath = isWindowsAbsolutePath(normalizedCandidatePath)
      ? normalizedCandidatePath.toLowerCase()
      : normalizedCandidatePath;

    if (compareCandidatePath === compareWorkspacePath) {
      return null;
    }

    const workspacePrefix = `${compareWorkspacePath}/`;

    if (!compareCandidatePath.startsWith(workspacePrefix)) {
      return null;
    }

    return normalizedCandidatePath.slice(normalizedWorkspacePath.length + 1);
  }

  return normalizeRelativePath(candidatePath);
}

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

function readToolInputText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function buildEditableToolPreview(tool: ResolvedToolCall): ApplyPatchPreview | null {
  if (tool.name === "apply_patch") {
    return parseApplyPatchPreview(tool.input);
  }

  if (tool.name !== "Write" && tool.name !== "Edit" && tool.name !== "MultiEdit") {
    return null;
  }

  const input = parseToolInputRecord(tool.input);

  if (!input) {
    return null;
  }

  const filePath = readToolInputText(input, "file_path") || readToolInputText(input, "path");

  if (!filePath) {
    return null;
  }

  if (tool.name === "Write") {
    const content = readToolInputText(input, "content");
    const contentLines = content.length > 0 ? content.split(/\r?\n/) : [];

    return {
      files: [
        {
          path: filePath,
          nextPath: null,
          action: "add",
          additions: contentLines.length,
          deletions: 0,
          lines: contentLines.map((line, index) => ({
            kind: "add" as const,
            text: `+${line}`,
            oldLineNumber: null,
            newLineNumber: index + 1
          }))
        }
      ],
      totalAdditions: contentLines.length,
      totalDeletions: 0
    };
  }

  if (tool.name === "Edit") {
    const oldLines = readToolInputText(input, "old_string").split(/\r?\n/);
    const newLines = readToolInputText(input, "new_string").split(/\r?\n/);

    return buildUpdatePreview(filePath, [{ oldLines, newLines }]);
  }

  const edits = Array.isArray(input.edits) ? input.edits : [];
  const normalizedEdits = edits
    .map((edit) => {
      if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
        return null;
      }

      const record = edit as Record<string, unknown>;
      return {
        oldLines: readToolInputText(record, "old_string").split(/\r?\n/),
        newLines: readToolInputText(record, "new_string").split(/\r?\n/)
      };
    })
    .filter((edit): edit is { oldLines: string[]; newLines: string[] } => Boolean(edit));

  return normalizedEdits.length > 0 ? buildUpdatePreview(filePath, normalizedEdits) : null;
}

function buildUpdatePreview(
  filePath: string,
  edits: Array<{ oldLines: string[]; newLines: string[] }>
): ApplyPatchPreview {
  const lines: ApplyPatchFileChange["lines"] = [];
  let additions = 0;
  let deletions = 0;

  edits.forEach((edit, index) => {
    lines.push({
      kind: "hunk",
      text: `@@ -1,${edit.oldLines.length} +1,${edit.newLines.length} @@`,
      oldLineNumber: null,
      newLineNumber: null
    });

    edit.oldLines.forEach((line, lineIndex) => {
      if (line.length === 0 && edit.oldLines.length === 1 && edit.newLines.length > 0) {
        return;
      }

      deletions += 1;
      lines.push({
        kind: "remove",
        text: `-${line}`,
        oldLineNumber: lineIndex + 1,
        newLineNumber: null
      });
    });

    edit.newLines.forEach((line, lineIndex) => {
      if (line.length === 0 && edit.newLines.length === 1 && edit.oldLines.length > 0) {
        return;
      }

      additions += 1;
      lines.push({
        kind: "add",
        text: `+${line}`,
        oldLineNumber: null,
        newLineNumber: lineIndex + 1
      });
    });

    if (index < edits.length - 1) {
      lines.push({
        kind: "meta",
        text: "***",
        oldLineNumber: null,
        newLineNumber: null
      });
    }
  });

  return {
    files: [
      {
        path: filePath,
        nextPath: null,
        action: "update",
        additions,
        deletions,
        lines
      }
    ],
    totalAdditions: additions,
    totalDeletions: deletions
  };
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
    hasResult,
    updatedAt: tools.at(-1)?.message.timestamp ?? tools[0]!.message.timestamp
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

function collectLeadingSystemPromptMessageIds(
  messages: SessionMessageViewModel[],
  provider: ProviderId | null
): Set<string> {
  const messageIds = new Set<string>();

  if (provider !== "kimi") {
    return messageIds;
  }

  for (const message of messages) {
    if (message.role === "system" && message.kind === "text") {
      messageIds.add(message.id);
      continue;
    }

    break;
  }

  return messageIds;
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

function MarkdownInlineCode({
  className,
  children,
  onCopy
}: {
  className?: string;
  children: ReactNode;
  onCopy: (text: string) => void;
}) {
  const isInsideLink = useContext(MarkdownLinkContext);
  const content = flattenReactNodeText(children).trim();

  if (isInsideLink || !content) {
    return <code className={className || undefined}>{children}</code>;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onCopy(content);
  }

  return (
    <code
      className={[className, "markdown-inline-copy"].filter(Boolean).join(" ")}
      role="button"
      tabIndex={0}
      aria-label={t("conversation.copyAction")}
      onClick={() => onCopy(content)}
      onKeyDown={handleKeyDown}
    >
      {children}
    </code>
  );
}

function InteractiveMessageLink({
  href,
  children,
  className,
  onInteract
}: {
  href?: string;
  children: ReactNode;
  className?: string;
  onInteract: (href: string | undefined, text: string) => void;
}) {
  const interactiveText = flattenReactNodeText(children).trim() || (href ? decodeMarkdownHref(href).trim() : "");

  return (
    <MarkdownLinkContext.Provider value={true}>
      <a
        href={href}
        className={[className, "markdown-interactive-link"].filter(Boolean).join(" ")}
        onClick={(event) => {
          event.preventDefault();
          onInteract(href, interactiveText);
        }}
      >
        {children}
      </a>
    </MarkdownLinkContext.Provider>
  );
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
  const { showToast } = useToast();
  const platform = usePlatform();
  const { navigationGroups, currentWorkspaceId, revealWorkspaceFile } = useWorkbenchShell();
  const currentWorkspace = useMemo(
    () =>
      navigationGroups.find((group) => group.workspace.id === currentWorkspaceId)?.workspace
      ?? null,
    [currentWorkspaceId, navigationGroups]
  );

  async function handleCopyText(text: string) {
    if (!text.trim()) {
      return;
    }

    try {
      await writeTextToClipboard(text, platform);
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

  function handleLinkInteract(href: string | undefined, text: string) {
    const relativeFilePath =
      href && currentWorkspace?.path
        ? resolveWorkspaceRelativePathFromHref(href, currentWorkspace.path)
        : null;

    if (
      relativeFilePath &&
      revealWorkspaceFile({
        workspaceId: currentWorkspace?.id ?? currentWorkspaceId,
        filePath: relativeFilePath,
        openViewer: false
      })
    ) {
      return;
    }

    void handleCopyText(text || (href ? decodeMarkdownHref(href).trim() : ""));
  }

  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          p: ({ node, ...props }) => <p {...props} />,
          a(props) {
            return (
              <InteractiveMessageLink
                href={typeof props.href === "string" ? props.href : undefined}
                className={typeof props.className === "string" ? props.className : undefined}
                onInteract={handleLinkInteract}
              >
                {props.children}
              </InteractiveMessageLink>
            );
          },
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
              <MarkdownInlineCode
                className={codeClassName || undefined}
                onCopy={(text) => {
                  void handleCopyText(text);
                }}
              >
                {props.children}
              </MarkdownInlineCode>
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
      {Array.from({ length: 3 }, (_, index) => (
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
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(null);

  useEffect(() => {
    if (selectedFileIndex === null) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedFileIndex(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFileIndex]);

  return (
    <>
      <div className="tool-call-item apply-patch-item">
        {preview.files.map((file, index) => (
          <button
            key={buildApplyPatchFileRenderKey(file, index)}
            type="button"
            className="apply-patch-summary-row"
            onClick={() => setSelectedFileIndex(index)}
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

      {selectedFileIndex !== null && typeof document !== "undefined"
        ? createPortal(
            <div className="workbench-modal-layer apply-patch-modal" role="dialog" aria-modal="true">
              <button
                type="button"
                className="workbench-modal-backdrop"
                aria-label={t("common.close")}
                onClick={() => setSelectedFileIndex(null)}
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
                    onClick={() => setSelectedFileIndex(null)}
                  >
                    x
                  </button>
                </div>

                {(() => {
                  const file = preview.files[selectedFileIndex];
                  if (!file) return null;
                  return (
                    <>
                      <div className="apply-patch-modal-totals">
                        <span className="apply-patch-stat-pill positive">
                          {t("conversation.applyPatchAddedStat")} +{file.additions}
                        </span>
                        <span className="apply-patch-stat-pill negative">
                          {t("conversation.applyPatchRemovedStat")} -{file.deletions}
                        </span>
                      </div>

                      <div className="apply-patch-modal-body">
                        <section
                          key={buildApplyPatchFileRenderKey(file, selectedFileIndex)}
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

                        {tool.error ? (
                          <section className="apply-patch-error-panel">
                            <div className="tool-call-section-label">{t("conversation.toolResultLabel")}</div>
                            <pre className="tool-call-error">{tool.error}</pre>
                          </section>
                        ) : null}
                      </div>
                    </>
                  );
                })()}
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
  const taskSnapshot = useMemo(
    () => buildConversationTaskSnapshotFromToolCall(tool, null, group.updatedAt),
    [group.updatedAt, tool]
  );
  const applyPatchPreview = useMemo(
    () => buildEditableToolPreview(tool),
    [tool.input, tool.name]
  );

  if (applyPatchPreview) {
    return <ApplyPatchToolItem tool={tool} preview={applyPatchPreview} />;
  }

  if (taskSnapshot) {
    return (
      <TaskToolItem
        tool={tool}
        snapshot={taskSnapshot}
        expanded={expanded}
        hasRequest={hasRequest}
        hasResult={hasResult}
        onToggleExpanded={() => {
          setExpanded((current) => !current);
        }}
      />
    );
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

function TaskToolItem({
  tool,
  snapshot,
  expanded,
  hasRequest,
  hasResult,
  onToggleExpanded
}: {
  tool: ResolvedToolCall;
  snapshot: ConversationTaskSnapshot;
  expanded: boolean;
  hasRequest: boolean;
  hasResult: boolean;
  onToggleExpanded: () => void;
}) {
  const summary = countConversationTasksByStatus(snapshot.items);
  const rawLabel = expanded
    ? t("conversation.taskCardRawCollapse")
    : t("conversation.taskCardRawExpand");

  return (
    <div className="tool-call-item task-tool-item">
      <div className="task-tool-header">
        <div className="task-tool-heading">
          <span className="task-tool-badge">
            {snapshot.source === "plan"
              ? t("conversation.taskCardPlanTitle")
              : t("conversation.taskCardTodoTitle")}
          </span>
          <div className="task-tool-heading-main">
            <strong>{resolveTaskToolTitle(snapshot, tool.name)}</strong>
            <span className="task-tool-summary-text">
              {buildTaskToolSummaryText(snapshot.items, summary)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="task-tool-raw-toggle"
          onClick={onToggleExpanded}
        >
          {rawLabel}
        </button>
      </div>

      <ol className="task-tool-list">
        {snapshot.items.map((item) => (
          <li key={item.id} className="task-tool-list-item" data-status={item.status}>
            <span className="task-tool-item-indicator" data-status={item.status} aria-hidden="true" />
            <strong className="task-tool-item-title">{item.title}</strong>
            {item.detail ? <span className="task-tool-item-detail">{item.detail}</span> : null}
            <span className="task-tool-item-status">{resolveTaskToolStatusLabel(item.status)}</span>
          </li>
        ))}
      </ol>

      {expanded ? (
        <div className="tool-call-output">
          {hasRequest && tool.input ? (
            <div className="tool-call-section">
              <div className="tool-call-section-label">{t("conversation.toolInputLabel")}</div>
              <pre>{tool.input}</pre>
            </div>
          ) : null}

          {(hasResult || tool.error || tool.output) ? (
            <div className="tool-call-section">
              <div className="tool-call-section-label">{t("conversation.toolResultLabel")}</div>
              <pre className={tool.error ? "tool-call-error" : undefined}>
                {tool.error || tool.output || t("conversation.toolResultEmpty")}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function resolveTaskToolTitle(snapshot: ConversationTaskSnapshot, toolName: string): string {
  if (snapshot.source === "plan") {
    return t("conversation.taskCardPlanUpdated");
  }

  const normalized = toolName.trim().toLowerCase();

  if (normalized === "taskcreate" || normalized === "todowrite" || normalized === "todoread") {
    return t("conversation.taskCardTodoUpdated");
  }

  if (normalized.startsWith("task")) {
    return t("conversation.taskCardTodoUpdated");
  }

  return t("conversation.taskCardTodoUpdated");
}

function buildTaskToolSummaryText(
  items: ConversationTaskSnapshot["items"],
  summary: ReturnType<typeof countConversationTasksByStatus>
): string {
  const parts = [t("conversation.taskCardSummaryTotal", { count: items.length })];

  if (summary.in_progress > 0) {
    parts.push(t("conversation.taskCardSummaryInProgress", { count: summary.in_progress }));
  }

  if (summary.pending > 0) {
    parts.push(t("conversation.taskCardSummaryPending", { count: summary.pending }));
  }

  if (summary.completed > 0) {
    parts.push(t("conversation.taskCardSummaryCompleted", { count: summary.completed }));
  }

  if (summary.failed > 0) {
    parts.push(t("conversation.taskCardSummaryFailed", { count: summary.failed }));
  }

  return parts.join(" / ");
}

function resolveTaskToolStatusLabel(status: ConversationTaskSnapshot["items"][number]["status"]): string {
  switch (status) {
    case "in_progress":
      return t("conversation.taskProgressStatusInProgress");
    case "completed":
      return t("conversation.taskProgressStatusCompleted");
    case "failed":
      return t("conversation.taskProgressStatusFailed");
    case "cancelled":
      return t("conversation.taskProgressStatusCancelled");
    case "pending":
    default:
      return t("conversation.taskProgressStatusPending");
  }
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

function formatMessageTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function UserMessageFooter({
  timestamp,
  leading,
  children
}: {
  timestamp: string;
  leading?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="user-message-footer">
      <div className="user-message-footer-leading">{leading}</div>
      <div className="user-message-footer-trailing">
        <time className="message-time" dateTime={timestamp}>
          {formatMessageTimestamp(timestamp)}
        </time>
        {children}
      </div>
    </div>
  );
}

function MessageMetadataBar({
  text,
  canCopy = true,
  canFork = false,
  compact = false,
  onFork
}: {
  text: string;
  canCopy?: boolean;
  canFork?: boolean;
  compact?: boolean;
  onFork?: (() => Promise<void> | void) | null;
}) {
  const { showToast } = useToast();
  const platform = usePlatform();
  const [copying, setCopying] = useState(false);
  const [forking, setForking] = useState(false);
  const hasText = text.trim().length > 0;
  const shouldShowCopy = canCopy && hasText;

  async function handleCopy() {
    if (!shouldShowCopy || copying) {
      return;
    }

    setCopying(true);

    try {
      await writeTextToClipboard(text, platform);
      showToast({
        title: t("conversation.copyContentSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("conversation.copyContentFailed"),
        tone: "error"
      });
    } finally {
      setCopying(false);
    }
  }

  async function handleFork() {
    if (!onFork || forking) {
      return;
    }

    setForking(true);

    try {
      await onFork();
    } finally {
      setForking(false);
    }
  }

  if (!shouldShowCopy && !canFork) {
    return null;
  }

  return (
    <div className={compact ? "message-metadata-bar compact" : "message-metadata-bar"}>
      {shouldShowCopy ? (
        <button
          type="button"
          className="message-metadata-action"
          aria-label={t("conversation.copyAction")}
          title={t("conversation.copyAction")}
          onClick={() => {
            void handleCopy();
          }}
          disabled={copying}
        >
          <CopyActionIcon />
        </button>
      ) : null}
      {canFork ? (
        <button
          type="button"
          className="message-metadata-action"
          aria-label={forking ? t("conversation.forkingAction") : t("conversation.forkFromHereAction")}
          title={forking ? t("conversation.forkingAction") : t("conversation.forkFromHereAction")}
          onClick={() => {
            void handleFork();
          }}
          disabled={forking}
        >
          <ForkActionIcon />
        </button>
      ) : null}
    </div>
  );
}

function RulesMessageCard({
  message,
  kind,
  tone,
  actionState,
  onRetry,
  onForkMessage
}: {
  message: SessionMessageViewModel;
  kind: FoldedPromptKind;
  tone: "user-message" | "assistant-message" | "system-message";
  actionState: MessageActionState;
  onRetry: (clientRequestId: string) => void;
  onForkMessage?: ((message: SessionMessageViewModel) => Promise<void> | void) | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = getRulesMessageSummary(message.content);
  const isUser = tone === "user-message";
  const title =
    kind === "system_prompt"
      ? t("conversation.systemPromptTitle")
      : t("conversation.rulesMessageTitle");
  const hint =
    kind === "system_prompt"
      ? t("conversation.systemPromptHint")
      : t("conversation.rulesMessageHint");
  const actionLabel =
    expanded
      ? kind === "system_prompt"
        ? t("conversation.systemPromptCollapse")
        : t("conversation.rulesMessageCollapse")
      : kind === "system_prompt"
        ? t("conversation.systemPromptExpand")
        : t("conversation.rulesMessageExpand");

  return (
    <article className={`message-item ${tone} rules-message-row`} data-message-id={message.id}>
      <div className="message-content-wrapper">
        <div className="rules-message-card">
          <button
            type="button"
            className="rules-message-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <div className="rules-message-heading">
              <span className="rules-message-badge">{title}</span>
              <span className="rules-message-summary">{summary}</span>
            </div>
            <span className="rules-message-action">{actionLabel}</span>
          </button>

          <p className="rules-message-hint">{hint}</p>

          {expanded && (
            <div className="rules-message-body">
              <MessageMarkdownBody
                content={message.content}
                className="message-text message-content markdown-content"
              />
            </div>
          )}
          {isUser ? (
            <UserMessageFooter timestamp={message.timestamp}>
              <MessageMetadataBar
                text={message.content}
                canCopy={actionState.canCopy}
                canFork={actionState.canFork && Boolean(onForkMessage && message.deliveryState === "sent")}
                compact
                onFork={onForkMessage ? () => onForkMessage(message) : null}
              />
            </UserMessageFooter>
          ) : (
            <MessageMetadataBar
              text={message.content}
              canCopy={actionState.canCopy}
              canFork={actionState.canFork && Boolean(onForkMessage && message.deliveryState === "sent")}
              onFork={onForkMessage ? () => onForkMessage(message) : null}
            />
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

    </article>
  );
}

function MessageItem({
  message,
  provider,
  foldedPromptKind = null,
  actionState,
  onRetry,
  onForkMessage,
  assistantAvatar
}: {
  message: SessionMessageViewModel;
  provider: ProviderId | null;
  foldedPromptKind?: FoldedPromptKind | null;
  actionState: MessageActionState;
  onRetry: (clientRequestId: string) => void;
  onForkMessage?: ((message: SessionMessageViewModel) => Promise<void> | void) | null;
  assistantAvatar?: ReactNode;
}) {
  const isUser = message.role === "user";
  const isThinking = message.kind === "thinking";
  const isAssistantText = message.role === "assistant" && message.kind === "text";
  const promptKind: FoldedPromptKind | null =
    foldedPromptKind ??
    (looksLikeRulesMessage(provider, message.content)
      ? "rules"
      : null);
  const richContent = useMemo(() => parseMessageRichContent(message.content), [message.content]);
  const visibleContent = richContent.text;
  const inlineImages = richContent.inlineImages;
  const [originDetailOpen, setOriginDetailOpen] = useState(false);
  const [originDetailLoading, setOriginDetailLoading] = useState(false);
  const [originDetailError, setOriginDetailError] = useState<string | null>(null);
  const [originDetail, setOriginDetail] = useState<ButlerFollowUpTaskDto | null>(null);

  if (promptKind) {
    const tone =
      message.role === "user"
        ? "user-message"
        : message.role === "assistant"
          ? "assistant-message"
          : "system-message";

    return (
      <RulesMessageCard
        message={message}
        kind={promptKind}
        tone={tone}
        actionState={actionState}
        onRetry={onRetry}
        onForkMessage={onForkMessage}
      />
    );
  }

  if (isUser) {
    const isButlerProxyMessage =
      message.origin === "butler_proxy" || isButlerProxyClientRequestId(message.clientRequestId);
    const hasOriginDetail = message.origin === "butler_proxy" && typeof message.originRef === "string" && message.originRef.trim().length > 0;

    async function handleToggleOriginDetail() {
      if (!hasOriginDetail) {
        return;
      }

      const nextOpen = !originDetailOpen;
      setOriginDetailOpen(nextOpen);

      if (!nextOpen || originDetail || originDetailLoading) {
        return;
      }

      setOriginDetailLoading(true);
      setOriginDetailError(null);

      try {
        const response = await getButlerFollowUpTask(message.originRef!);
        setOriginDetail(response.task);
      } catch (error) {
        setOriginDetailError(error instanceof Error ? error.message : t("conversation.butlerOriginDetailLoadFailed"));
      } finally {
        setOriginDetailLoading(false);
      }
    }

    const originBadge = isButlerProxyMessage ? (
      hasOriginDetail ? (
        <div className="message-origin-detail-anchor">
          <button
            type="button"
            className="message-origin-badge message-origin-badge-button"
            aria-expanded={originDetailOpen}
            onClick={() => {
              void handleToggleOriginDetail();
            }}
          >
            {t("conversation.butlerProxyMessageBadge")}
          </button>
          {originDetailOpen ? (
            <div className="message-origin-detail-popover" role="dialog" aria-live="polite">
              <strong>{t("conversation.butlerOriginDetailTitle")}</strong>
              {originDetailLoading ? (
                <p>{t("conversation.butlerOriginDetailLoading")}</p>
              ) : originDetailError ? (
                <p>{originDetailError}</p>
              ) : originDetail ? (
                <>
                  <p>{t("conversation.butlerOriginDetailObjectiveLabel")}：{originDetail.objective}</p>
                  <p>{t("conversation.butlerOriginDetailStatusLabel")}：{resolveFollowUpTaskStatusLabel(originDetail.status)}</p>
                  <p>{t("conversation.butlerOriginDetailSummaryLabel")}：{originDetail.lastAutomationSummary || t("conversation.butlerAnalysisEmpty")}</p>
                  {originDetail.waitingReason ? (
                    <p>{t("conversation.butlerOriginDetailWaitingReasonLabel")}：{originDetail.waitingReason}</p>
                  ) : null}
                </>
              ) : (
                <p>{t("conversation.butlerAnalysisEmpty")}</p>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <span className="message-origin-badge">{t("conversation.butlerProxyMessageBadge")}</span>
      )
    ) : null;

    return (
      <article className="message-item user-message" data-message-id={message.id}>
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
          <UserMessageFooter timestamp={message.timestamp} leading={originBadge}>
            <MessageMetadataBar
              text={visibleContent}
              canCopy={actionState.canCopy}
              canFork={actionState.canFork && Boolean(onForkMessage && message.deliveryState === "sent")}
              compact
              onFork={onForkMessage ? () => onForkMessage(message) : null}
            />
          </UserMessageFooter>
        </div>
      </article>
    );
  }

  if (isThinking) {
    return (
      <article className="message-item assistant-message thinking-message-row" data-message-id={message.id}>
        <div className="message-avatar">{assistantAvatar ?? <DefaultAssistantAvatar />}</div>
        <div className="thinking-message-content">
          <div className="thinking-message-label">{t("conversation.thinkingLabel")}</div>
          <MessageAttachments
            sessionId={message.sessionId}
            attachments={message.attachments}
            attachmentPayloads={message.attachmentPayloads}
            inlineImages={inlineImages}
          />
          {visibleContent && (
            <MessageMarkdownBody
              content={visibleContent}
              className="message-text message-content markdown-content thinking-message-text"
            />
          )}
          <MessageMetadataBar
            text={visibleContent}
            canCopy={actionState.canCopy}
            canFork={actionState.canFork && Boolean(onForkMessage && message.deliveryState === "sent")}
            onFork={onForkMessage ? () => onForkMessage(message) : null}
          />
        </div>
      </article>
    );
  }

  if (isAssistantText) {
    return (
      <article className="message-item assistant-message" data-message-id={message.id}>
        <div className="message-avatar">{assistantAvatar ?? <DefaultAssistantAvatar />}</div>
        <div className="message-content-wrapper">
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
          <MessageMetadataBar
            text={visibleContent}
            canCopy={actionState.canCopy}
            canFork={actionState.canFork && Boolean(onForkMessage && message.deliveryState === "sent")}
            onFork={onForkMessage ? () => onForkMessage(message) : null}
          />
        </div>
      </article>
    );
  }

  return (
    <article className="message-item system-message" data-message-id={message.id}>
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
        <MessageMetadataBar
          text={visibleContent}
          canCopy={actionState.canCopy}
          canFork={actionState.canFork && Boolean(onForkMessage && message.deliveryState === "sent")}
          onFork={onForkMessage ? () => onForkMessage(message) : null}
        />
      </div>
    </article>
  );
}

function DefaultAssistantAvatar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

function isButlerProxyClientRequestId(clientRequestId: string | null): boolean {
  return typeof clientRequestId === "string" && clientRequestId.startsWith("butler-follow-up:");
}

function resolveFollowUpTaskStatusLabel(status: ButlerFollowUpTaskDto["status"]): string {
  switch (status) {
    case "waiting_user":
      return t("shell.butlerAutomationStatusWaitingUser");
    case "completed":
      return t("shell.butlerAutomationStatusCompleted");
    case "failed":
      return t("shell.butlerAutomationStatusFailed");
    case "cancelled":
      return t("shell.butlerAutomationStatusCancelled");
    case "active":
    default:
      return t("shell.butlerAutomationStatusActive");
  }
}

export function MessageTimeline({
  sessionId = "session",
  messages,
  historyState,
  loadingOlderMessages = false,
  hasOlderMessages = false,
  onLoadOlderMessages = () => {},
  onRetryMessage,
  onForkMessage,
  provider,
  runtimeThinkingPlaceholder = null,
  assistantAvatar
}: MessageTimelineProps) {
  const { showToast } = useToast();
  const listRef = useRef<HTMLDivElement | null>(null);
  const previousSessionIdRef = useRef(sessionId);
  const previousMessageCountRef = useRef(0);
  const previousLastMessageSignatureRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const pendingOlderLoadOffsetRef = useRef<number | null>(null);
  const olderLoadLockRef = useRef(false);
  const pendingRestoreStateRef = useRef(readPersistedConversationScrollState(sessionId));
  const restoredTailSignatureRef = useRef<string | null>(
    readPersistedConversationScrollState(sessionId)?.lastMessageSignature ?? null
  );
  const currentScrollStateRef = useRef(readPersistedConversationScrollState(sessionId));
  const scrollPersistTimerRef = useRef<number | null>(null);
  const manualRestoreTimerRef = useRef<number | null>(null);
  const manualRestoreTargetRef = useRef<number | null>(null);
  const manualRestoreDeadlineRef = useRef(0);
  const manualRestoreInProgressRef = useRef(false);
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const hasNewMessagesBelowRef = useRef(false);
  const renderItems = buildTimelineRenderItems(messages);
  const leadingSystemPromptMessageIds = useMemo(
    () => collectLeadingSystemPromptMessageIds(messages, provider),
    [messages, provider]
  );
  const actionStateByMessageId = useMemo(
    () => buildMessageActionStateById(messages),
    [messages]
  );
  const showTimelineSkeleton = historyState === "loading" && messages.length === 0;

  function buildCurrentScrollState(list: HTMLDivElement) {
    const distanceToBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
    const stickToBottom = distanceToBottom <= STICK_TO_BOTTOM_DISTANCE_PX;

    return {
      scrollTop: list.scrollTop,
      stickToBottom,
      lastMessageSignature:
        hasNewMessagesBelowRef.current && !stickToBottom
          ? restoredTailSignatureRef.current
          : buildMessageSignature(messages.at(-1) ?? null)
    };
  }

  function rememberCurrentScrollState(list: HTMLDivElement) {
    currentScrollStateRef.current = buildCurrentScrollState(list);
    return currentScrollStateRef.current;
  }

  function syncScrollAffordance(list: HTMLDivElement) {
    const distanceToBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
    const nextStickToBottom = distanceToBottom <= STICK_TO_BOTTOM_DISTANCE_PX;

    stickToBottomRef.current = nextStickToBottom;
    if (nextStickToBottom && hasNewMessagesBelowRef.current) {
      finishManualRestore();
      hasNewMessagesBelowRef.current = false;
      restoredTailSignatureRef.current = buildMessageSignature(messages.at(-1) ?? null);
      setHasNewMessagesBelow(false);
    }
    setShowScrollToBottomButton(
      messages.length > 0
      && (
        distanceToBottom > SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX
        || hasNewMessagesBelowRef.current
      )
    );
    rememberCurrentScrollState(list);
  }

  function persistCurrentScrollState(list: HTMLDivElement | null = listRef.current) {
    if (list) {
      rememberCurrentScrollState(list);
    }

    if (!currentScrollStateRef.current) {
      return;
    }

    persistConversationScrollState(sessionId, currentScrollStateRef.current);
  }

  function persistCachedScrollState(targetSessionId: string) {
    if (!currentScrollStateRef.current) {
      return;
    }

    persistConversationScrollState(targetSessionId, currentScrollStateRef.current);
  }

  function clearPersistScrollTimer() {
    if (scrollPersistTimerRef.current === null) {
      return;
    }

    window.clearTimeout(scrollPersistTimerRef.current);
    scrollPersistTimerRef.current = null;
  }

  function schedulePersistCurrentScrollState() {
    clearPersistScrollTimer();
    scrollPersistTimerRef.current = window.setTimeout(() => {
      scrollPersistTimerRef.current = null;
      persistCurrentScrollState();
    }, SCROLL_STATE_PERSIST_DELAY_MS);
  }

  function jumpToBottom(list: HTMLDivElement) {
    list.scrollTop = list.scrollHeight;
  }

  function clearManualRestoreTimer() {
    if (manualRestoreTimerRef.current === null) {
      return;
    }

    window.clearTimeout(manualRestoreTimerRef.current);
    manualRestoreTimerRef.current = null;
  }

  function finishManualRestore() {
    clearManualRestoreTimer();
    manualRestoreInProgressRef.current = false;
    manualRestoreTargetRef.current = null;
    manualRestoreDeadlineRef.current = 0;
  }

  function applyManualRestorePosition(list: HTMLDivElement, targetScrollTop: number) {
    const maxScrollableTop = Math.max(0, list.scrollHeight - list.clientHeight);
    const nextScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollableTop));

    list.scrollTop = nextScrollTop;
    stickToBottomRef.current = false;
    setShowScrollToBottomButton(
      messages.length > 0
      && (
        maxScrollableTop - nextScrollTop > SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX
        || hasNewMessagesBelowRef.current
      )
    );
  }

  function scheduleManualRestoreFrame() {
    clearManualRestoreTimer();

    if (!manualRestoreInProgressRef.current) {
      return;
    }

    manualRestoreTimerRef.current = window.setTimeout(() => {
      manualRestoreTimerRef.current = null;
      const list = listRef.current;
      const targetScrollTop = manualRestoreTargetRef.current;

      if (!list || targetScrollTop === null) {
        finishManualRestore();
        return;
      }

      applyManualRestorePosition(list, targetScrollTop);

      if (Date.now() < manualRestoreDeadlineRef.current) {
        scheduleManualRestoreFrame();
        return;
      }

      finishManualRestore();
      syncScrollAffordance(list);
    }, MANUAL_RESTORE_INTERVAL_MS);
  }

  function startManualRestore(targetScrollTop: number, list: HTMLDivElement) {
    manualRestoreInProgressRef.current = true;
    manualRestoreTargetRef.current = targetScrollTop;
    manualRestoreDeadlineRef.current = Date.now() + MANUAL_RESTORE_DURATION_MS;
    applyManualRestorePosition(list, targetScrollTop);
    scheduleManualRestoreFrame();
  }

  function triggerOlderMessagesPrefetch(list: HTMLDivElement): boolean {
    if (
      olderLoadLockRef.current ||
      !hasOlderMessages ||
      loadingOlderMessages ||
      historyState !== "ready" ||
      list.scrollTop > OLDER_HISTORY_PREFETCH_THRESHOLD_PX
    ) {
      return false;
    }

    olderLoadLockRef.current = true;
    pendingOlderLoadOffsetRef.current = list.scrollHeight - list.scrollTop;
    onLoadOlderMessages();
    return true;
  }

  useEffect(() => {
    if (historyState !== "error") {
      return;
    }

    showToast({
      title: t("conversation.historyLoadFailed"),
      tone: "error"
    });
  }, [historyState, showToast]);

  useLayoutEffect(() => {
    if (previousSessionIdRef.current !== sessionId) {
      persistCachedScrollState(previousSessionIdRef.current);
      previousSessionIdRef.current = sessionId;
      previousMessageCountRef.current = 0;
      previousLastMessageSignatureRef.current = null;
      pendingRestoreStateRef.current = readPersistedConversationScrollState(sessionId);
      restoredTailSignatureRef.current = pendingRestoreStateRef.current?.lastMessageSignature ?? null;
      currentScrollStateRef.current = pendingRestoreStateRef.current;
      stickToBottomRef.current = pendingRestoreStateRef.current?.stickToBottom ?? true;
      pendingOlderLoadOffsetRef.current = null;
      finishManualRestore();
      hasNewMessagesBelowRef.current = false;
      setHasNewMessagesBelow(false);
      setShowScrollToBottomButton(false);
    }
  }, [sessionId]);

  useLayoutEffect(() => {
    return () => {
      clearPersistScrollTimer();
      finishManualRestore();
      persistCachedScrollState(previousSessionIdRef.current);
    };
  }, [sessionId]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const currentLastSignature = buildMessageSignature(messages.at(-1) ?? null);

    if (!list) {
      previousMessageCountRef.current = messages.length;
      previousLastMessageSignatureRef.current = currentLastSignature;
      return;
    }

    const previousCount = previousMessageCountRef.current;
    const previousLastSignature = previousLastMessageSignatureRef.current;
    const pendingRestoreState = pendingRestoreStateRef.current;

    // 会话切回来时先恢复阅读位置；是否有新消息是另一件事，用 NEW 提示，不要强行把用户踢到底部。
    if (pendingRestoreState && historyState === "ready") {
      const hasTailUpdates =
        !pendingRestoreState.stickToBottom
        && pendingRestoreState.lastMessageSignature !== null
        && currentLastSignature !== null
        && pendingRestoreState.lastMessageSignature !== currentLastSignature;

      if (pendingRestoreState.stickToBottom) {
        finishManualRestore();
        jumpToBottom(list);
      } else {
        startManualRestore(pendingRestoreState.scrollTop, list);
      }

      hasNewMessagesBelowRef.current = hasTailUpdates;
      restoredTailSignatureRef.current = pendingRestoreState.lastMessageSignature;
      setHasNewMessagesBelow(hasTailUpdates);
      pendingRestoreStateRef.current = null;
      syncScrollAffordance(list);
      previousMessageCountRef.current = messages.length;
      previousLastMessageSignatureRef.current = currentLastSignature;
      rememberCurrentScrollState(list);
      return;
    }

    if (pendingRestoreState && historyState === "error") {
      if (pendingRestoreState.stickToBottom) {
        finishManualRestore();
        jumpToBottom(list);
      } else {
        startManualRestore(pendingRestoreState.scrollTop, list);
      }

      pendingRestoreStateRef.current = null;
      syncScrollAffordance(list);
      previousMessageCountRef.current = messages.length;
      previousLastMessageSignatureRef.current = currentLastSignature;
      rememberCurrentScrollState(list);
      return;
    }

    if (manualRestoreInProgressRef.current) {
      applyManualRestorePosition(list, manualRestoreTargetRef.current ?? list.scrollTop);
      previousMessageCountRef.current = messages.length;
      previousLastMessageSignatureRef.current = currentLastSignature;
      rememberCurrentScrollState(list);
      return;
    }

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
      jumpToBottom(list);
    }

    syncScrollAffordance(list);
    previousMessageCountRef.current = messages.length;
    previousLastMessageSignatureRef.current = currentLastSignature;
  }, [historyState, messages, sessionId]);

  useEffect(() => {
    if (!hasOlderMessages) {
      olderLoadLockRef.current = false;
      return;
    }

    if (!loadingOlderMessages && pendingOlderLoadOffsetRef.current === null) {
      olderLoadLockRef.current = false;
    }
  }, [hasOlderMessages, loadingOlderMessages, messages.length]);

  function handleScroll() {
    const list = listRef.current;

    if (!list) {
      return;
    }

    syncScrollAffordance(list);
    schedulePersistCurrentScrollState();

    if (
      triggerOlderMessagesPrefetch(list)
    ) {
      return;
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
              foldedPromptKind={
                leadingSystemPromptMessageIds.has(item.message.id)
                  ? "system_prompt"
                  : null
              }
              actionState={
                actionStateByMessageId.get(item.message.id) ?? {
                  canCopy: item.message.role === "user",
                  canFork: false
                }
              }
              onRetry={onRetryMessage}
              onForkMessage={onForkMessage}
              assistantAvatar={assistantAvatar}
            />
          )
        )}

        {runtimeThinkingPlaceholder ? (
          <div className="timeline-status timeline-status-inline thinking-status-inline">
            <span
              className="status-text thinking-status-text"
              aria-label={runtimeThinkingPlaceholder}
            >
              <span>{stripThinkingTrailingDots(runtimeThinkingPlaceholder) || runtimeThinkingPlaceholder}</span>
              <span className="thinking-status-dots" aria-hidden="true">...</span>
            </span>
          </div>
        ) : null}
      </div>
      {showScrollToBottomButton ? (
        <button
          type="button"
          className="conversation-scroll-to-bottom-button"
          data-has-new={hasNewMessagesBelow ? "true" : "false"}
          aria-label={t("conversation.scrollToBottomAction")}
          title={t("conversation.scrollToBottomAction")}
          onClick={() => {
            const list = listRef.current;

            if (!list) {
              return;
            }

            finishManualRestore();
            jumpToBottom(list);
            hasNewMessagesBelowRef.current = false;
            restoredTailSignatureRef.current = buildMessageSignature(messages.at(-1) ?? null);
            setHasNewMessagesBelow(false);
            syncScrollAffordance(list);
            persistCurrentScrollState(list);
          }}
        >
          {hasNewMessagesBelow ? (
            <span className="conversation-scroll-to-bottom-button-badge">NEW</span>
          ) : null}
          <svg
            className="conversation-scroll-to-bottom-button-icon"
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M10 4.25a.75.75 0 0 1 .75.75v7.19l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V5a.75.75 0 0 1 .75-.75Zm-4 11a.75.75 0 0 1 0-1.5h8a.75.75 0 0 1 0 1.5H6Z"
              fill="currentColor"
            />
          </svg>
        </button>
      ) : null}
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

function buildMessageActionStateById(
  messages: SessionMessageViewModel[]
): Map<string, MessageActionState> {
  const actionStateById = new Map<string, MessageActionState>();
  let blockStart = 0;

  function applyAssistantBlock(endExclusive: number) {
    let tailMessageId: string | null = null;

    for (let index = endExclusive - 1; index >= blockStart; index -= 1) {
      const message = messages[index];

      if (!message || !shouldParticipateInAssistantActionBlock(message)) {
        continue;
      }

      tailMessageId = message.id;
      break;
    }

    for (let index = blockStart; index < endExclusive; index += 1) {
      const message = messages[index];

      if (!message) {
        continue;
      }

      if (message.role === "user") {
        actionStateById.set(message.id, {
          canCopy: true,
          canFork: false
        });
        continue;
      }

      actionStateById.set(message.id, {
        canCopy: message.id === tailMessageId,
        canFork: message.id === tailMessageId
      });
    }
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (!message) {
      continue;
    }

    if (message.role === "user" && index > blockStart) {
      applyAssistantBlock(index);
      blockStart = index;
    }
  }

  applyAssistantBlock(messages.length);
  return actionStateById;
}

function shouldParticipateInAssistantActionBlock(message: SessionMessageViewModel): boolean {
  if (message.role === "user") {
    return false;
  }

  return message.kind !== "tool_call" && message.kind !== "tool_result";
}

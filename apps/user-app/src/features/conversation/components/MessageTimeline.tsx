import {
  createContext,
  isValidElement,
  memo,
  useDeferredValue,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
  type ReactNode
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { DesktopModal } from "../../../components/DesktopModal";
import { getHostBaseUrl, getHostRequestUrl } from "../../../config/env";
import {
  logPerfDebug,
  logConversationTimelineDebug,
  isTimelineScrollDebugEnabled,
  logTimelineScrollDebug
} from "../../../shared/debug/perf-debug";
import { resolveHostTransportTarget } from "../../../network/host-transport-registry";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { usePlatform } from "../../../platform/platform-provider";
import { getButlerFollowUpTask, type ButlerFollowUpTaskDto } from "../../butler/api/butler-api";
import { getSessionAttachmentBlob } from "../api/conversation-api";
import {
  getFilePreviewLink,
  getOfficeArtifactPreviewLink,
  getOfficeTaskFilePreviewLink
} from "../api/file-context-api";
import {
  extractApplyPatchPathsFromToolOutput,
  getApplyPatchDisplayName,
  normalizeApplyPatchPreviewInput,
  parseApplyPatchPreview,
  type ApplyPatchPreview,
  type ApplyPatchFileChange
} from "../apply-patch-preview";
import {
  parseMessageRichContent,
  type StructuredQuestionPrompt
} from "../message-rich-content";
import {
  buildConversationTaskSnapshotFromToolCall,
  type ConversationTaskSnapshot
} from "../session-task-progress";
import { ConversationTaskProgressCard } from "./ConversationTaskProgressCard";
import { useWorkbenchShell } from "./WorkbenchLayout";
import {
  CopyActionIcon,
  ForkActionIcon
} from "./ConversationActionIcons";
import {
  persistConversationScrollState,
  readPersistedConversationScrollState
} from "./conversation-scroll-persistence";
import { useTransientScrollbarVisibility } from "./useTransientScrollbarVisibility";
import {
  extractConversationTimelineMessages,
  findConversationTimelineRuntimeThinkingLabel,
  type ConversationTimelineSourceItem
} from "../timeline-source-items";

import type {
  AttachmentPayload,
  MessageAttachmentDto,
  ProviderId,
  SessionPermissionRequestDto,
  SessionSummaryDto,
  SessionInterruptSource
} from "../api/conversation-api";
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";
import { shouldFoldRulesMessages } from "../capability/provider-ui";

interface MessageTimelineProps {
  sessionId?: string;
  sessionSummary?: SessionSummaryDto | null;
  workspaceId?: string | null;
  workspacePath?: string | null;
  items: ConversationTimelineSourceItem[];
  historyState: "idle" | "loading" | "ready" | "error";
  loadingOlderMessages?: boolean;
  hasOlderMessages?: boolean;
  onLoadOlderMessages?: () => void;
  onRetryMessage: (clientRequestId: string) => void;
  onForkMessage?: (message: SessionMessageViewModel) => Promise<void> | void;
  provider: ProviderId | null;
  interruptedSource?: SessionInterruptSource | null;
  assistantAvatar?: ReactNode;
  followTailUpdates?: boolean;
  onSubmitStructuredQuestion?: (payload: { messageId: string; answers: Record<string, string[]> }) => Promise<void> | void;
  permissionRequests?: SessionPermissionRequestDto[];
  replyingPermissionRequestId?: string | null;
  onReplyPermissionRequest?: (requestId: string, payload: { action: string; answers?: Record<string, string[]> }) => Promise<void> | void;
}

interface MessageActionState {
  canCopy: boolean;
  canFork: boolean;
}

const DEFAULT_MESSAGE_ACTION_STATE: MessageActionState = {
  canCopy: false,
  canFork: false
};

const DEFAULT_USER_MESSAGE_ACTION_STATE: MessageActionState = {
  canCopy: true,
  canFork: false
};

function stripThinkingTrailingDots(value: string): string {
  return value.replace(/(\.{3,}|…+)$/, "").trimEnd();
}

type SessionErrorSummarySegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "status_code";
      text: string;
    }
  | {
      type: "request_id";
      text: string;
    };

function tokenizeSessionErrorSummary(summary: string): SessionErrorSummarySegment[] {
  const normalized = summary.trim();

  if (!normalized) {
    return [];
  }

  const pattern = /\b(?:last status:\s*\d{3}\s+[A-Za-z][A-Za-z ]*|\d{3}\s+(?:Too Many Requests|Bad Gateway|Gateway Timeout|Service Unavailable|Unauthorized|Forbidden|Not Found|Internal Server Error))\b|\brequest id:\s*[A-Za-z0-9-]+\b/gi;
  const segments: SessionErrorSummarySegment[] = [];
  let lastIndex = 0;

  for (const match of normalized.matchAll(pattern)) {
    const start = match.index ?? 0;
    const matchedText = match[0];

    if (start > lastIndex) {
      segments.push({
        type: "text",
        text: normalized.slice(lastIndex, start)
      });
    }

    segments.push({
      type: /^request id:/i.test(matchedText) ? "request_id" : "status_code",
      text: matchedText
    });
    lastIndex = start + matchedText.length;
  }

  if (lastIndex < normalized.length) {
    segments.push({
      type: "text",
      text: normalized.slice(lastIndex)
    });
  }

  return segments.filter((segment) => segment.text.length > 0);
}

function parseTurnAbortedMessage(value: string): { detail: string | null } | null {
  const match = value.match(/^\s*<turn_aborted>([\s\S]*?)<\/turn_aborted>\s*$/i);

  if (!match) {
    return null;
  }

  const detail = match[1]?.trim() ?? "";

  if (!detail || /^previous turn aborted$/i.test(detail)) {
    return { detail: null };
  }

  return { detail };
}

function resolveTurnAbortedMessageText(source: SessionInterruptSource | null | undefined): string {
  if (source === "user") {
    return t("conversation.turnAbortedUser");
  }

  if (source === "runtime") {
    return t("conversation.turnAbortedUnexpected");
  }

  return t("conversation.turnAbortedGeneric");
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
  messageIds: string[];
  tool: ResolvedToolCall;
  hasRequest: boolean;
  hasResult: boolean;
  updatedAt: string;
}

interface TimelineViewModel {
  visibleMessages: SessionMessageViewModel[];
  renderItems: TimelineRenderItem[];
  leadingSystemPromptMessageIds: Set<string>;
  actionStateByMessageId: Map<string, MessageActionState>;
  hiddenMessageIds: string[];
  validationIssues: string[];
}

interface TimelineViewModelInput {
  sessionSummary?: SessionSummaryDto | null;
  items: ConversationTimelineSourceItem[];
  provider: ProviderId | null;
}

interface ViewImageToolSnapshot {
  previewTarget:
    | {
        kind: "workspace_file";
        relativePath: string;
      }
    | {
        kind: "session_attachment";
        sessionId: string;
        attachmentId: string;
      }
    | {
        kind: "office_artifact";
        artifactId: string;
      }
    | {
        kind: "office_task_file";
        taskId: string;
        fileName: string;
      }
    | null;
  inlineImageUrl: string | null;
  displayPath: string;
  fileName: string;
}

type ViewImagePreviewState =
  | { status: "idle"; url: null }
  | { status: "loading"; url: null }
  | { status: "ready"; url: string }
  | { status: "error"; url: null };

interface AssistantCapabilityReceiptRecord {
  ok: true;
  capability: string;
  auditId: string;
  timestamp: string;
  targetRef: {
    kind: string;
    id: string | null;
  };
  payload: Record<string, unknown>;
}

interface AssistantCapabilityNavigationLookup {
  workspaceNamesById: Map<string, string>;
  sessionNamesById: Map<string, string>;
  sessionWorkspaceIdsById: Map<string, string>;
}

interface AssistantCapabilitySnapshot {
  kind: "session" | "automation" | "terminal" | "workspace" | "debug" | "query";
  badge: string;
  title: string;
  summary: string;
  rows: Array<{
    label: string;
    value: string;
  }>;
}

type CodexAgentToolAction = "create" | "read" | "update" | "reply" | "close";

interface SubagentNotificationSnapshot {
  agentPath: string | null;
  statusLabel: string;
  resultMarkdown: string;
  rows: AssistantCapabilitySnapshot["rows"];
}

type FoldedPromptKind = "rules" | "system_prompt" | "skill_context";

const OLDER_HISTORY_PREFETCH_THRESHOLD_PX = 480;
const STICK_TO_BOTTOM_DISTANCE_PX = 80;
const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 240;
const SCROLL_STATE_PERSIST_DELAY_MS = 120;
const OLDER_HISTORY_TOUCH_DRAG_THRESHOLD_PX = 18;
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
    }
  | {
      type: "runtime_thinking";
      key: string;
      label: string;
    }
  | {
      type: "session_error";
      key: string;
      error: Extract<ConversationTimelineSourceItem, { type: "session_error" }>["error"];
    }
  | {
      type: "runtime_notice";
      key: string;
      notice: Extract<ConversationTimelineSourceItem, { type: "runtime_notice" }>["notice"];
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

function resolveOfficeArtifactPreviewTargetFromHref(href: string): { kind: "artifact"; artifactId: string } | {
  kind: "task_file";
  taskId: string;
  fileName: string;
} | null {
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
  } else if (/^https?:\/\//i.test(candidatePath)) {
    try {
      candidatePath = decodeURIComponent(new URL(candidatePath).pathname);
    } catch {
      return null;
    }
  } else if (looksLikeExternalProtocol(candidatePath)) {
    return null;
  }

  const normalizedPath = normalizeMessagePathSeparators(stripFileReferenceDecorations(candidatePath));
  const match = normalizedPath.match(
    /(?:^|\/)office-artifacts\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[^/]+$/i
  );

  if (!match?.[1]) {
    const legacyFileMatch = normalizedPath.match(/(?:^|\/)office-artifacts\/([^/]+)\/([^/]+)$/i);

    if (!legacyFileMatch?.[1] || !legacyFileMatch?.[2]) {
      return null;
    }

    return {
      kind: "task_file",
      taskId: legacyFileMatch[1],
      fileName: legacyFileMatch[2]
    };
  }

  return {
    kind: "artifact",
    artifactId: match[1]
  };
}

function readViewImageToolPath(tool: ResolvedToolCall): string | null {
  if (tool.name.trim() !== "view_image") {
    return null;
  }

  const parsedInput = parseToolInputRecord(tool.input);
  const imagePath = parsedInput ? readToolInputText(parsedInput, "path").trim() : "";
  return imagePath || null;
}

function getFileNameFromPath(filePath: string): string {
  const segments = normalizeMessagePathSeparators(filePath).split("/").filter(Boolean);
  return segments.at(-1) ?? filePath;
}

function collectInlineImageUrls(value: unknown, results: string[], depth: number) {
  if (depth > 6 || results.length > 8 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const normalized = value.trim();

    if (/^data:image\//i.test(normalized)) {
      results.push(normalized);
      return;
    }

    if ((normalized.startsWith("{") && normalized.endsWith("}")) || (normalized.startsWith("[") && normalized.endsWith("]"))) {
      try {
        collectInlineImageUrls(JSON.parse(normalized) as unknown, results, depth + 1);
      } catch {
        // ignore invalid nested json
      }
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (results.length > 8) {
        break;
      }
      collectInlineImageUrls(item, results, depth + 1);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const type = readText(value, "type")?.toLowerCase() ?? null;
  const imageUrl = readText(value, "image_url");

  if (imageUrl && /^data:image\//i.test(imageUrl) && (!type || type === "input_image" || type === "image_url")) {
    results.push(imageUrl);
  }

  for (const nestedValue of Object.values(value)) {
    if (results.length > 8) {
      break;
    }
    collectInlineImageUrls(nestedValue, results, depth + 1);
  }
}

function resolveViewImageToolInlineImageUrl(tool: ResolvedToolCall): string | null {
  const candidates: unknown[] = [];

  if (tool.output?.trim()) {
    candidates.push(tool.output);
  }

  if (tool.input?.trim()) {
    candidates.push(tool.input);
  }

  const matches: string[] = [];

  for (const candidate of candidates) {
    collectInlineImageUrls(candidate, matches, 0);
    if (matches.length > 0) {
      return matches[0] ?? null;
    }
  }

  return null;
}

function resolveSessionAttachmentPreviewTarget(
  imagePath: string,
  fallbackSessionId: string | null | undefined
): {
  kind: "session_attachment";
  sessionId: string;
  attachmentId: string;
} | null {
  const normalizedPath = normalizeMessagePathSeparators(stripFileReferenceDecorations(imagePath)).trim();

  if (!normalizedPath) {
    return null;
  }

  const matched = normalizedPath.match(
    /(?:^|\/)session-attachments\/([^/]+)\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[^/]+$/i
  );

  if (!matched?.[2]) {
    return null;
  }

  const sessionId = (matched[1] || fallbackSessionId?.trim() || "").trim();

  if (!sessionId) {
    return null;
  }

  return {
    kind: "session_attachment",
    sessionId,
    attachmentId: matched[2]
  };
}

function resolveViewImageToolSnapshot(
  tool: ResolvedToolCall,
  workspacePath: string | null | undefined,
  sessionId?: string | null
): ViewImageToolSnapshot | null {
  const imagePath = readViewImageToolPath(tool);

  if (!imagePath) {
    return null;
  }

  const officeArtifactPreviewTarget = resolveOfficeArtifactPreviewTargetFromHref(imagePath);

  if (officeArtifactPreviewTarget) {
    return {
      previewTarget: officeArtifactPreviewTarget.kind === "artifact"
        ? {
            kind: "office_artifact",
            artifactId: officeArtifactPreviewTarget.artifactId
          }
        : {
            kind: "office_task_file",
            taskId: officeArtifactPreviewTarget.taskId,
            fileName: officeArtifactPreviewTarget.fileName
          },
      inlineImageUrl: resolveViewImageToolInlineImageUrl(tool),
      displayPath: imagePath,
      fileName: getFileNameFromPath(imagePath)
    };
  }

  const sessionAttachmentPreviewTarget = resolveSessionAttachmentPreviewTarget(imagePath, sessionId);

  if (sessionAttachmentPreviewTarget) {
    return {
      previewTarget: sessionAttachmentPreviewTarget,
      inlineImageUrl: resolveViewImageToolInlineImageUrl(tool),
      displayPath: imagePath,
      fileName: getFileNameFromPath(imagePath)
    };
  }

  const relativePath = workspacePath
    ? resolveWorkspaceRelativePathFromHref(imagePath, workspacePath)
    : normalizeRelativePath(stripFileReferenceDecorations(imagePath));

  return {
    previewTarget: relativePath
      ? {
          kind: "workspace_file",
          relativePath
        }
      : null,
    inlineImageUrl: resolveViewImageToolInlineImageUrl(tool),
    displayPath: relativePath ?? imagePath,
    fileName: getFileNameFromPath(imagePath)
  };
}

function resolveToolImagePreviewAccessUrl(previewPath: string | null, previewUrl: string | null, isDesktop: boolean): string | null {
  if (previewPath && !isDesktop && typeof window !== "undefined" && window.location?.origin) {
    return new URL(previewPath, window.location.origin).toString();
  }

  if (previewPath && isDesktop) {
    try {
      const resolvedBaseUrl = resolveHostTransportTarget(getHostBaseUrl()).baseUrl;
      return getHostRequestUrl(previewPath, resolvedBaseUrl);
    } catch {
      return previewUrl;
    }
  }

  return previewUrl;
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
  if (name === "web_search" || name === "web_search_20250305") {
    return t("conversation.toolWebSearch");
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

function readFirstToolInputText(
  record: Record<string, unknown>,
  fields: string[]
): string {
  for (const field of fields) {
    const value = readToolInputText(record, field);

    if (value) {
      return value;
    }
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRecord(record: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  if (!record) {
    return null;
  }

  const value = record[key];
  return isRecord(value) ? value : null;
}

function readArray(record: Record<string, unknown> | null | undefined, key: string): unknown[] | null {
  if (!record) {
    return null;
  }

  const value = record[key];
  return Array.isArray(value) ? value : null;
}

function readText(record: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!record) {
    return null;
  }

  const value = record[key];

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function parseAssistantCapabilityReceipt(tool: ResolvedToolCall): AssistantCapabilityReceiptRecord | null {
  const candidates = [tool.output, tool.input];

  for (const candidate of candidates) {
    const parsed = parseAssistantCapabilityReceiptCandidate(candidate, 0);

    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseAssistantCapabilityReceiptCandidate(
  raw: string | null | undefined,
  depth: number
): AssistantCapabilityReceiptRecord | null {
  if (!raw?.trim() || depth > 2) {
    return null;
  }

  try {
    return unwrapAssistantCapabilityReceipt(JSON.parse(raw) as unknown, depth);
  } catch {
    return null;
  }
}

function unwrapAssistantCapabilityReceipt(
  value: unknown,
  depth: number
): AssistantCapabilityReceiptRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  if (looksLikeAssistantCapabilityReceipt(value)) {
    return {
      ok: true,
      capability: readText(value, "capability") ?? "",
      auditId: readText(value, "auditId") ?? "",
      timestamp: readText(value, "timestamp") ?? "",
      targetRef: {
        kind: readText(readRecord(value, "targetRef"), "kind") ?? "none",
        id: readText(readRecord(value, "targetRef"), "id")
      },
      payload: readRecord(value, "payload") ?? {}
    };
  }

  const nestedKeys = ["output", "result", "data", "payload"];

  for (const key of nestedKeys) {
    const nested = value[key];

    if (typeof nested === "string") {
      const parsed = parseAssistantCapabilityReceiptCandidate(nested, depth + 1);

      if (parsed) {
        return parsed;
      }
    }

    if (isRecord(nested)) {
      const parsed = unwrapAssistantCapabilityReceipt(nested, depth + 1);

      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

function looksLikeAssistantCapabilityReceipt(value: Record<string, unknown>): boolean {
  return value.ok === true
    && typeof value.capability === "string"
    && typeof value.auditId === "string"
    && typeof value.timestamp === "string"
    && isRecord(value.targetRef)
    && isRecord(value.payload);
}

function buildAssistantCapabilityNavigationLookup(
  navigationGroups: ReturnType<typeof useWorkbenchShell>["navigationGroups"]
): AssistantCapabilityNavigationLookup {
  const workspaceNamesById = new Map<string, string>();
  const sessionNamesById = new Map<string, string>();
  const sessionWorkspaceIdsById = new Map<string, string>();

  navigationGroups.forEach((group) => {
    workspaceNamesById.set(group.workspace.id, group.workspace.name);

    group.sessions.forEach((session) => {
      const title = typeof session.title === "string" && session.title.trim()
        ? session.title.trim()
        : session.sessionId;
      sessionNamesById.set(session.sessionId, title);
      sessionWorkspaceIdsById.set(session.sessionId, group.workspace.id);
    });
  });

  return {
    workspaceNamesById,
    sessionNamesById,
    sessionWorkspaceIdsById
  };
}

function buildAssistantCapabilitySnapshot(
  tool: ResolvedToolCall,
  navigationLookup: AssistantCapabilityNavigationLookup
): AssistantCapabilitySnapshot | null {
  const receipt = parseAssistantCapabilityReceipt(tool);

  if (!receipt) {
    return null;
  }

  return {
    ...resolveAssistantCapabilityMeta(receipt.capability),
    rows: buildAssistantCapabilityRows(receipt, navigationLookup)
  };
}

function buildAssistantCliCommandSnapshot(
  tool: ResolvedToolCall,
  navigationLookup: AssistantCapabilityNavigationLookup
): AssistantCapabilitySnapshot | null {
  const command = extractAssistantCliCommand(tool);

  if (!command) {
    return null;
  }

  const parsed = parseAssistantCliCommand(command);

  if (!parsed) {
    return null;
  }

  return {
    ...resolveAssistantCliSnapshotMeta(parsed),
    rows: buildAssistantCliSnapshotRows(parsed, navigationLookup)
  };
}

function buildCodexAgentToolSnapshot(
  tool: ResolvedToolCall
): AssistantCapabilitySnapshot | null {
  const input = parseToolInputRecord(tool.input);
  const normalizedName = normalizeCodexAgentToolName(tool.name);
  const action = resolveCodexAgentToolAction(normalizedName, input);

  if (!action) {
    return null;
  }

  const output = parseToolLooseRecord(tool.output);

  return {
    ...resolveCodexAgentToolMeta(action),
    rows: buildCodexAgentToolRows(action, input, output, tool)
  };
}

function normalizeCodexAgentToolName(name: string): string {
  return name.trim().split(/[.:/]/).filter(Boolean).at(-1) ?? name.trim();
}

function resolveCodexAgentToolAction(
  name: string,
  input: Record<string, unknown> | null
): CodexAgentToolAction | null {
  switch (name) {
    case "spawn_agent":
      return "create";
    case "wait_agent":
      return "read";
    case "resume_agent":
      return "update";
    case "send_input":
      return input?.interrupt === true ? "update" : "reply";
    case "close_agent":
      return "close";
    case "update_agent":
      return "update";
    default:
      return null;
  }
}

function resolveCodexAgentToolMeta(
  action: CodexAgentToolAction
): Omit<AssistantCapabilitySnapshot, "rows"> {
  switch (action) {
    case "create":
      return {
        kind: "session",
        badge: t("conversation.assistantCapabilityBadgeSubAgent"),
        title: t("conversation.codexAgentToolCreateTitle"),
        summary: t("conversation.codexAgentToolCreateSummary")
      };
    case "read":
      return {
        kind: "session",
        badge: t("conversation.assistantCapabilityBadgeSubAgent"),
        title: t("conversation.codexAgentToolReadTitle"),
        summary: t("conversation.codexAgentToolReadSummary")
      };
    case "update":
      return {
        kind: "session",
        badge: t("conversation.assistantCapabilityBadgeSubAgent"),
        title: t("conversation.codexAgentToolUpdateTitle"),
        summary: t("conversation.codexAgentToolUpdateSummary")
      };
    case "reply":
      return {
        kind: "session",
        badge: t("conversation.assistantCapabilityBadgeSubAgent"),
        title: t("conversation.codexAgentToolReplyTitle"),
        summary: t("conversation.codexAgentToolReplySummary")
      };
    case "close":
      return {
        kind: "session",
        badge: t("conversation.assistantCapabilityBadgeSubAgent"),
        title: t("conversation.codexAgentToolCloseTitle"),
        summary: t("conversation.codexAgentToolCloseSummary")
      };
  }
}

function buildCodexAgentToolRows(
  action: CodexAgentToolAction,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
  tool: ResolvedToolCall
): AssistantCapabilitySnapshot["rows"] {
  const rows: AssistantCapabilitySnapshot["rows"] = [];
  const agentId = resolveCodexAgentId(input, output);

  pushAssistantCapabilityRow(rows, t("conversation.codexAgentToolLabelAgent"), agentId);
  pushAssistantCapabilityRow(rows, t("conversation.codexAgentToolLabelNickname"), resolveCodexAgentNickname(output));
  pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelStatus"), resolveToolStatusLabel(tool.status));

  if (action === "create") {
    pushAssistantCapabilityRow(rows, t("conversation.codexAgentToolLabelRole"), readText(input, "agent_type"));
    pushAssistantCapabilityRow(rows, t("conversation.codexAgentToolLabelModel"), readText(input, "model"));
  }

  if (action === "read") {
    pushAssistantCapabilityRow(rows, t("conversation.codexAgentToolLabelTargets"), readCodexAgentTargets(input));
    pushAssistantCapabilityRow(rows, t("conversation.codexAgentToolLabelTimeout"), readText(input, "timeout_ms"));
  }

  if (action === "reply" || action === "update") {
    pushAssistantCapabilityRow(rows, t("conversation.codexAgentToolLabelMessage"), readCodexAgentMessage(input));
  }

  if (action === "close") {
    pushAssistantCapabilityRow(rows, t("conversation.codexAgentToolLabelReason"), readCodexAgentCloseSummary(output));
  }

  return rows.slice(0, 5);
}

function buildClaudeAgentToolSnapshot(
  tool: ResolvedToolCall
): AssistantCapabilitySnapshot | null {
  if (tool.name !== "Agent") {
    return null;
  }

  const input = parseToolInputRecord(tool.input);
  if (!input) {
    return null;
  }

  const subagentType = readText(input, "subagent_type");
  const description = readText(input, "description");

  const rows: AssistantCapabilitySnapshot["rows"] = [];
  pushAssistantCapabilityRow(rows, t("conversation.claudeAgentToolLabelType"), subagentType);
  pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelStatus"), resolveToolStatusLabel(tool.status));
  if (description) {
    pushAssistantCapabilityRow(rows, t("conversation.claudeAgentToolLabelDescription"), description);
  }

  return {
    kind: "session",
    badge: t("conversation.assistantCapabilityBadgeSubAgent"),
    title: t("conversation.claudeAgentToolTitle"),
    summary: description || subagentType || "",
    rows
  };
}

function resolveCodexAgentNickname(
  output: Record<string, unknown> | null
): string | null {
  return readText(output, "nickname");
}

function resolveCodexAgentId(
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null
): string | null {
  return readText(input, "target")
    ?? readFirstTextFromArray(input, "targets")
    ?? readText(output, "id")
    ?? readText(output, "agent_id")
    ?? readText(output, "target");
}

function readCodexAgentTargets(input: Record<string, unknown> | null): string | null {
  if (!input) {
    return null;
  }

  const targets = readArray(input, "targets")
    ?.map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean) ?? [];

  if (targets.length === 0) {
    return null;
  }

  return targets.join(", ");
}

function readCodexAgentMessage(input: Record<string, unknown> | null): string | null {
  return readText(input, "message") ?? readText(input, "prompt") ?? readText(input, "content");
}

function readCodexAgentCloseSummary(output: Record<string, unknown> | null): string | null {
  return readText(output, "status") ?? readText(output, "summary");
}

function readFirstTextFromArray(record: Record<string, unknown> | null, key: string): string | null {
  const value = readArray(record, key)?.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value.trim() : null;
}

function parseToolLooseRecord(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveToolStatusLabel(status: ResolvedToolCall["status"]): string {
  switch (status) {
    case "running":
      return t("conversation.toolStatusRunning");
    case "failed":
      return t("conversation.toolStatusFailed");
    case "completed":
    default:
      return t("conversation.toolStatusCompleted");
  }
}

function parseSubagentNotificationMessage(content: string): SubagentNotificationSnapshot | null {
  const match = content.trim().match(/^<subagent_notification>\s*([\s\S]*?)\s*<\/subagent_notification>$/i);

  if (!match) {
    return null;
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(match[1] ?? "");
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const status = readRecord(parsed, "status");

  if (!status) {
    return null;
  }

  const completed = readText(status, "completed");
  const failed = readText(status, "failed");
  const cancelled = readText(status, "cancelled");
  const running = readText(status, "running");
  const resultMarkdown = completed ?? failed ?? cancelled ?? running;

  if (!resultMarkdown) {
    return null;
  }

  const statusLabel =
    completed ? t("conversation.toolStatusCompleted")
      : failed ? t("conversation.toolStatusFailed")
        : cancelled ? t("conversation.subagentNotificationStatusCancelled")
          : t("conversation.toolStatusRunning");
  const agentPath = readText(parsed, "agent_path");
  const rows: AssistantCapabilitySnapshot["rows"] = [];

  pushAssistantCapabilityRow(rows, t("conversation.codexAgentToolLabelAgent"), agentPath);
  pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelStatus"), statusLabel);
  pushAssistantCapabilityRow(rows, t("conversation.subagentNotificationLabelSummary"), readFirstMeaningfulLine(resultMarkdown));

  return {
    agentPath,
    statusLabel,
    resultMarkdown,
    rows
  };
}

function readFirstMeaningfulLine(markdown: string): string | null {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .find(Boolean) ?? null;
}

function extractAssistantCliCommand(tool: ResolvedToolCall): string | null {
  const input = parseToolInputRecord(tool.input);
  const command = input && typeof input.command === "string" ? input.command.trim() : "";

  if (!command) {
    return null;
  }

  const index = command.indexOf("codingns assistant");

  if (index < 0) {
    return null;
  }

  return command.slice(index).trim();
}

interface ParsedAssistantCliCommand {
  group: string | null;
  action: string | null;
  mode: "help" | "execute";
  options: Record<string, string | true>;
  positionals: string[];
}

function parseAssistantCliCommand(command: string): ParsedAssistantCliCommand | null {
  const tokens = tokenizeShellCommand(command);
  const startIndex = tokens.findIndex((token, index) => token === "codingns" && tokens[index + 1] === "assistant");

  if (startIndex < 0) {
    return null;
  }

  const invocation = tokens.slice(startIndex + 2);

  if (invocation.length === 0 || invocation[0] === "--help" || invocation[0] === "-h") {
    return {
      group: null,
      action: null,
      mode: "help",
      options: {},
      positionals: []
    };
  }

  if (invocation[0] === "help") {
    return {
      group: invocation[1] ?? null,
      action: invocation[2] ?? null,
      mode: "help",
      options: {},
      positionals: []
    };
  }

  const group = invocation[0] ?? null;
  const actionCandidate = invocation[1];
  const action = actionCandidate && !actionCandidate.startsWith("-") ? actionCandidate : null;
  const remainder = invocation.slice(action ? 2 : 1);
  const { options, positionals } = parseCommandOptions(remainder);

  if (!action && options["--help"]) {
    return {
      group,
      action: null,
      mode: "help",
      options,
      positionals
    };
  }

  return {
    group,
    action,
    mode: "execute",
    options,
    positionals
  };
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`|\S+/g;

  for (const match of command.matchAll(pattern)) {
    const value = match[0] ?? "";

    if (!value) {
      continue;
    }

    const quoted = value[0];

    if ((quoted === "\"" || quoted === "'" || quoted === "`") && value[value.length - 1] === quoted) {
      tokens.push(value.slice(1, -1));
      continue;
    }

    tokens.push(value);
  }

  return tokens;
}

function parseCommandOptions(tokens: string[]): {
  options: Record<string, string | true>;
  positionals: string[];
} {
  const options: Record<string, string | true> = {};
  const positionals: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const next = tokens[index + 1];

    if (!next || next.startsWith("--")) {
      options[token] = true;
      continue;
    }

    options[token] = next;
    index += 1;
  }

  return {
    options,
    positionals
  };
}

function resolveAssistantCliSnapshotMeta(
  parsed: ParsedAssistantCliCommand
): Omit<AssistantCapabilitySnapshot, "rows"> {
  if (parsed.mode === "help") {
    return resolveAssistantCliHelpMeta(parsed.group, parsed.action);
  }

  const capability = buildAssistantCliCapabilityKey(parsed.group, parsed.action);

  if (capability) {
    return resolveAssistantCapabilityMeta(capability);
  }

  return {
    kind: resolveAssistantCliKind(parsed.group),
    badge: resolveAssistantCliBadge(parsed.group),
    title: t("conversation.assistantCapabilityQueryTitle"),
    summary: t("conversation.assistantCliSummaryCommand")
  };
}

function resolveAssistantCliHelpMeta(
  group: string | null,
  action: string | null
): Omit<AssistantCapabilitySnapshot, "rows"> {
  if (!group) {
    return {
      kind: "query",
      badge: t("conversation.assistantCapabilityBadgeQuery"),
      title: t("conversation.assistantCliHelpRootTitle"),
      summary: t("conversation.assistantCliSummaryHelp")
    };
  }

  if (group === "sessions") {
    return {
      kind: "session",
      badge: t("conversation.assistantCapabilityBadgeSession"),
      title: action
        ? t("conversation.assistantCliHelpSessionActionTitle", { action })
        : t("conversation.assistantCliHelpSessionsTitle"),
      summary: t("conversation.assistantCliSummaryHelp")
    };
  }

  if (group === "timers") {
    return {
      kind: "automation",
      badge: t("conversation.assistantCapabilityBadgeAutomation"),
      title: t("conversation.assistantCliHelpTimersTitle"),
      summary: t("conversation.assistantCliSummaryHelp")
    };
  }

  if (group === "terminals") {
    return {
      kind: "terminal",
      badge: t("conversation.assistantCapabilityBadgeTerminal"),
      title: t("conversation.assistantCliHelpTerminalsTitle"),
      summary: t("conversation.assistantCliSummaryHelp")
    };
  }

  if (group === "workspaces" || group === "worktrees") {
    return {
      kind: "workspace",
      badge: t("conversation.assistantCapabilityBadgeWorkspace"),
      title: t("conversation.assistantCliHelpWorkspacesTitle"),
      summary: t("conversation.assistantCliSummaryHelp")
    };
  }

  return {
    kind: resolveAssistantCliKind(group),
    badge: resolveAssistantCliBadge(group),
    title: t("conversation.assistantCliHelpGenericTitle", { group }),
    summary: t("conversation.assistantCliSummaryHelp")
  };
}

function buildAssistantCliCapabilityKey(group: string | null, action: string | null): string | null {
  const normalizedGroup = group?.trim();
  const normalizedAction = action?.trim();

  if (!normalizedGroup) {
    return null;
  }

  if (normalizedGroup === "capabilities" && normalizedAction === "list") {
    return "capabilities.list";
  }

  if (normalizedGroup === "projects" && normalizedAction === "list") {
    return "projects.list";
  }

  if (normalizedGroup === "projects" && normalizedAction === "get") {
    return "projects.get";
  }

  if (normalizedGroup === "sessions" && normalizedAction === "list") {
    return "projects.sessions.list";
  }

  if (normalizedGroup === "sessions" && normalizedAction === "get") {
    return "sessions.get";
  }

  if (normalizedGroup === "sessions" && normalizedAction === "messages") {
    return "sessions.messages.list";
  }

  if (normalizedGroup === "sessions" && normalizedAction === "runtime") {
    return "sessions.runtime.get";
  }

  if (normalizedGroup === "sessions" && normalizedAction === "start") {
    return "projects.sessions.start";
  }

  if (normalizedGroup === "sessions" && normalizedAction === "send") {
    return "sessions.message.send";
  }

  if (normalizedGroup === "sessions" && normalizedAction === "fork") {
    return "sessions.fork";
  }

  if (normalizedGroup === "timers" && normalizedAction === "create") {
    return "timers.create";
  }

  if (normalizedGroup === "timers" && normalizedAction === "cancel") {
    return "timers.cancel";
  }

  if (normalizedGroup === "timers" && normalizedAction === "list") {
    return "timers.list";
  }

  if (normalizedGroup === "terminals" && normalizedAction === "send") {
    return "terminals.input.send";
  }

  if (normalizedGroup === "terminals" && normalizedAction === "close") {
    return "terminals.close";
  }

  if (normalizedGroup === "terminals" && normalizedAction === "history") {
    return "terminals.history.read";
  }

  if (normalizedGroup === "terminals" && normalizedAction === "list") {
    return "terminals.list";
  }

  if (normalizedGroup === "workspaces" && normalizedAction === "list") {
    return "workspaces.list";
  }

  if (normalizedGroup === "workspaces" && normalizedAction === "clone") {
    return "workspaces.clone";
  }

  if (normalizedGroup === "workspaces" && normalizedAction === "import") {
    return "workspaces.import";
  }

  if (normalizedGroup === "workspaces" && normalizedAction === "management") {
    return "workspaces.management.get";
  }

  if (normalizedGroup === "worktrees" && normalizedAction === "tree") {
    return "worktrees.tree";
  }

  if (normalizedGroup === "worktrees" && normalizedAction === "create") {
    return "worktrees.create";
  }

  return null;
}

function resolveAssistantCliKind(group: string | null): AssistantCapabilitySnapshot["kind"] {
  switch (group) {
    case "sessions":
    case "projects":
      return "session";
    case "timers":
      return "automation";
    case "terminals":
      return "terminal";
    case "workspaces":
    case "worktrees":
      return "workspace";
    default:
      return "query";
  }
}

function resolveAssistantCliBadge(group: string | null): string {
  switch (resolveAssistantCliKind(group)) {
    case "session":
      return t("conversation.assistantCapabilityBadgeSession");
    case "automation":
      return t("conversation.assistantCapabilityBadgeAutomation");
    case "terminal":
      return t("conversation.assistantCapabilityBadgeTerminal");
    case "workspace":
      return t("conversation.assistantCapabilityBadgeWorkspace");
    case "debug":
      return t("conversation.assistantCapabilityBadgeDebug");
    case "query":
    default:
      return t("conversation.assistantCapabilityBadgeQuery");
  }
}

function buildAssistantCliSnapshotRows(
  parsed: ParsedAssistantCliCommand,
  navigationLookup: AssistantCapabilityNavigationLookup
): AssistantCapabilitySnapshot["rows"] {
  const rows: AssistantCapabilitySnapshot["rows"] = [];
  const sessionId = readAssistantOption(parsed, "--session-id") ?? parsed.positionals[0] ?? null;
  const projectId = readAssistantOption(parsed, "--project") ?? readAssistantOption(parsed, "--project-id");

  if (parsed.mode === "help") {
    pushAssistantCapabilityRow(rows, t("conversation.assistantCliLabelScope"), parsed.group ?? t("conversation.assistantCliScopeRoot"));
    pushAssistantCapabilityRow(rows, t("conversation.assistantCliLabelAction"), parsed.action);
    return rows;
  }

  if (parsed.group === "sessions") {
    pushAssistantCapabilityRow(
      rows,
      t("conversation.assistantCapabilityLabelSession"),
      resolveAssistantSessionName(sessionId, null, navigationLookup)
    );
  }

  if (parsed.group === "timers") {
    pushAssistantCapabilityRow(
      rows,
      t("conversation.assistantCapabilityLabelSession"),
      resolveAssistantSessionName(sessionId, null, navigationLookup)
    );
    pushAssistantCapabilityRow(
      rows,
      t("conversation.assistantCliLabelDelay"),
      readAssistantOption(parsed, "--after-seconds")
    );
  }

  if (parsed.group === "terminals") {
    pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelTerminal"), parsed.positionals[0] ?? null);
  }

  if (parsed.group === "workspaces" || parsed.group === "worktrees") {
    pushAssistantCapabilityRow(
      rows,
      t("conversation.assistantCapabilityLabelWorkspace"),
      resolveAssistantWorkspaceName(parsed.positionals[0] ?? null, null, navigationLookup)
    );
  }

  pushAssistantCapabilityRow(rows, t("conversation.assistantCliLabelProject"), projectId);
  pushAssistantCapabilityRow(rows, t("conversation.assistantCliLabelMessage"), readAssistantOption(parsed, "--message"));
  pushAssistantCapabilityRow(rows, t("conversation.assistantCliLabelInput"), readAssistantOption(parsed, "--input"));

  return rows.slice(0, 4);
}

function readAssistantOption(parsed: ParsedAssistantCliCommand, key: string): string | null {
  const value = parsed.options[key];
  return typeof value === "string" ? value : null;
}

function resolveAssistantCapabilityMeta(capability: string): Omit<AssistantCapabilitySnapshot, "rows"> {
  switch (capability) {
    case "projects.sessions.start":
      return {
        kind: "session",
        badge: t("conversation.assistantCapabilityBadgeSession"),
        title: t("conversation.assistantCapabilityProjectSessionStartTitle"),
        summary: t("conversation.assistantCapabilitySummarySessionStart")
      };
    case "sessions.message.send":
      return {
        kind: "session",
        badge: t("conversation.assistantCapabilityBadgeSession"),
        title: t("conversation.assistantCapabilitySessionSendTitle"),
        summary: t("conversation.assistantCapabilitySummarySessionSend")
      };
    case "sessions.fork":
      return {
        kind: "session",
        badge: t("conversation.assistantCapabilityBadgeSession"),
        title: t("conversation.assistantCapabilitySessionForkTitle"),
        summary: t("conversation.assistantCapabilitySummarySessionFork")
      };
    case "timers.create":
      return {
        kind: "automation",
        badge: t("conversation.assistantCapabilityBadgeAutomation"),
        title: t("conversation.assistantCapabilityTimerCreateTitle"),
        summary: t("conversation.assistantCapabilitySummaryTimerCreate")
      };
    case "timers.cancel":
      return {
        kind: "automation",
        badge: t("conversation.assistantCapabilityBadgeAutomation"),
        title: t("conversation.assistantCapabilityTimerCancelTitle"),
        summary: t("conversation.assistantCapabilitySummaryTimerCancel")
      };
    case "terminals.input.send":
      return {
        kind: "terminal",
        badge: t("conversation.assistantCapabilityBadgeTerminal"),
        title: t("conversation.assistantCapabilityTerminalInputTitle"),
        summary: t("conversation.assistantCapabilitySummaryTerminalInput")
      };
    case "terminals.close":
      return {
        kind: "terminal",
        badge: t("conversation.assistantCapabilityBadgeTerminal"),
        title: t("conversation.assistantCapabilityTerminalCloseTitle"),
        summary: t("conversation.assistantCapabilitySummaryTerminalClose")
      };
    case "workspaces.directory.create":
      return {
        kind: "workspace",
        badge: t("conversation.assistantCapabilityBadgeWorkspace"),
        title: t("conversation.assistantCapabilityWorkspaceDirectoryCreateTitle"),
        summary: t("conversation.assistantCapabilitySummaryWorkspace")
      };
    case "workspaces.import":
      return {
        kind: "workspace",
        badge: t("conversation.assistantCapabilityBadgeWorkspace"),
        title: t("conversation.assistantCapabilityWorkspaceImportTitle"),
        summary: t("conversation.assistantCapabilitySummaryWorkspace")
      };
    case "workspaces.clone":
      return {
        kind: "workspace",
        badge: t("conversation.assistantCapabilityBadgeWorkspace"),
        title: t("conversation.assistantCapabilityWorkspaceCloneTitle"),
        summary: t("conversation.assistantCapabilitySummaryWorkspace")
      };
    case "workspaces.navigation-state.update":
      return {
        kind: "workspace",
        badge: t("conversation.assistantCapabilityBadgeWorkspace"),
        title: t("conversation.assistantCapabilityWorkspaceNavigationUpdateTitle"),
        summary: t("conversation.assistantCapabilitySummaryWorkspace")
      };
    case "workspaces.remove":
      return {
        kind: "workspace",
        badge: t("conversation.assistantCapabilityBadgeWorkspace"),
        title: t("conversation.assistantCapabilityWorkspaceRemoveTitle"),
        summary: t("conversation.assistantCapabilitySummaryWorkspace")
      };
    case "worktrees.create":
      return {
        kind: "workspace",
        badge: t("conversation.assistantCapabilityBadgeWorkspace"),
        title: t("conversation.assistantCapabilityWorktreeCreateTitle"),
        summary: t("conversation.assistantCapabilitySummaryWorktree")
      };
    case "worktrees.merge-into-parent":
      return {
        kind: "workspace",
        badge: t("conversation.assistantCapabilityBadgeWorkspace"),
        title: t("conversation.assistantCapabilityWorktreeMergeTitle"),
        summary: t("conversation.assistantCapabilitySummaryWorktree")
      };
    case "worktrees.cleanup":
      return {
        kind: "workspace",
        badge: t("conversation.assistantCapabilityBadgeWorkspace"),
        title: t("conversation.assistantCapabilityWorktreeCleanupTitle"),
        summary: t("conversation.assistantCapabilitySummaryWorktree")
      };
    default:
      if (capability.startsWith("sessions.") || capability.startsWith("projects.")) {
        return {
          kind: "session",
          badge: t("conversation.assistantCapabilityBadgeSession"),
          title: t("conversation.assistantCapabilitySessionReadTitle"),
          summary: t("conversation.assistantCapabilitySummaryRead")
        };
      }

      if (capability.startsWith("timers.")) {
        return {
          kind: "automation",
          badge: t("conversation.assistantCapabilityBadgeAutomation"),
          title: t("conversation.assistantCapabilityAutomationReadTitle"),
          summary: t("conversation.assistantCapabilitySummaryRead")
        };
      }

      if (capability.startsWith("terminals.")) {
        return {
          kind: "terminal",
          badge: t("conversation.assistantCapabilityBadgeTerminal"),
          title: t("conversation.assistantCapabilityTerminalReadTitle"),
          summary: t("conversation.assistantCapabilitySummaryRead")
        };
      }

      if (capability.startsWith("workspaces.") || capability.startsWith("worktrees.")) {
        return {
          kind: "workspace",
          badge: t("conversation.assistantCapabilityBadgeWorkspace"),
          title: t("conversation.assistantCapabilityWorkspaceReadTitle"),
          summary: t("conversation.assistantCapabilitySummaryRead")
        };
      }

      return {
        kind: "query",
        badge: t("conversation.assistantCapabilityBadgeQuery"),
        title: t("conversation.assistantCapabilityQueryTitle"),
        summary: t("conversation.assistantCapabilitySummaryRead")
      };
  }
}

function buildAssistantCapabilityRows(
  receipt: AssistantCapabilityReceiptRecord,
  navigationLookup: AssistantCapabilityNavigationLookup
): AssistantCapabilitySnapshot["rows"] {
  const rows: AssistantCapabilitySnapshot["rows"] = [];
  const payload = receipt.payload;

  switch (receipt.capability) {
    case "projects.sessions.start": {
      const session = readRecord(payload, "session");
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelSession"),
        resolveAssistantSessionName(readText(session, "sessionId"), readText(session, "title"), navigationLookup)
      );
      pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelProvider"), readText(session, "provider"));
      break;
    }
    case "sessions.message.send": {
      const result = readRecord(payload, "result");
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelSession"),
        resolveAssistantSessionName(receipt.targetRef.id, null, navigationLookup)
      );
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelWorkspace"),
        resolveAssistantWorkspaceNameBySessionId(receipt.targetRef.id, navigationLookup)
      );
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelStatus"),
        t("conversation.assistantCapabilityStatusCompleted")
      );
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelDueAt"),
        formatAssistantCapabilityTimestamp(readText(result, "acceptedAt") ?? receipt.timestamp)
      );
      break;
    }
    case "sessions.fork": {
      const session = readRecord(payload, "session");
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelSession"),
        resolveAssistantSessionName(readText(session, "sessionId"), readText(session, "title"), navigationLookup)
      );
      pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelProvider"), readText(session, "provider"));
      break;
    }
    case "timers.create":
    case "timers.cancel": {
      const timer = readRecord(payload, "timer");
      const controlSession = readRecord(timer, "controlSession");
      const controlSessionRecord = readRecord(controlSession, "session");
      pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelTimer"), readText(timer, "title"));
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelWorkspace"),
        resolveAssistantWorkspaceName(readText(controlSessionRecord, "workspaceId"), null, navigationLookup)
      );
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelSession"),
        resolveAssistantSessionName(readText(timer, "targetSessionId"), null, navigationLookup)
      );
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelDueAt"),
        formatAssistantCapabilityTimestamp(readText(timer, "dueAt"))
      );
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelStatus"),
        resolveAssistantCapabilityStatusLabel(readText(timer, "status"))
      );
      break;
    }
    case "terminals.input.send":
    case "terminals.close":
      pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelTerminal"), receipt.targetRef.id);
      break;
    case "workspaces.directory.create": {
      const result = readRecord(payload, "result");
      pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelPath"), readText(result, "path"));
      break;
    }
    case "workspaces.import":
    case "workspaces.clone":
    case "workspaces.remove": {
      const workspace = readRecord(payload, "workspace");
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelWorkspace"),
        resolveAssistantWorkspaceName(
          readText(workspace, "id") ?? receipt.targetRef.id,
          readText(workspace, "name"),
          navigationLookup
        )
      );
      pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelPath"), readText(workspace, "path"));
      break;
    }
    case "workspaces.navigation-state.update": {
      const state = readRecord(payload, "state");
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelWorkspace"),
        resolveAssistantWorkspaceName(readText(state, "workspaceId") ?? receipt.targetRef.id, null, navigationLookup)
      );
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelStatus"),
        readText(state, "collapsed") === "true"
          ? t("conversation.assistantCapabilityNavigationCollapsed")
          : t("conversation.assistantCapabilityNavigationExpanded")
      );
      break;
    }
    case "worktrees.create": {
      const result = readRecord(payload, "result");
      const workspace = readRecord(result, "workspace");
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelWorkspace"),
        resolveAssistantWorkspaceName(
          readText(workspace, "id") ?? receipt.targetRef.id,
          readText(workspace, "name"),
          navigationLookup
        )
      );
      pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelBranch"), readText(result, "branchName"));
      break;
    }
    case "worktrees.merge-into-parent":
    case "worktrees.cleanup": {
      const result = readRecord(payload, "result");
      pushAssistantCapabilityRow(
        rows,
        t("conversation.assistantCapabilityLabelWorkspace"),
        resolveAssistantWorkspaceName(receipt.targetRef.id, null, navigationLookup)
      );
      pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelStatus"), readText(result, "status"));
      break;
    }
    default:
      break;
  }

  appendAssistantCapabilityGenericRows(rows, receipt, navigationLookup);
  return rows.slice(0, 4);
}

function appendAssistantCapabilityGenericRows(
  rows: AssistantCapabilitySnapshot["rows"],
  receipt: AssistantCapabilityReceiptRecord,
  navigationLookup: AssistantCapabilityNavigationLookup
) {
  if (receipt.targetRef.kind === "session") {
    pushAssistantCapabilityRow(
      rows,
      t("conversation.assistantCapabilityLabelSession"),
      resolveAssistantSessionName(receipt.targetRef.id, null, navigationLookup)
    );
    pushAssistantCapabilityRow(
      rows,
      t("conversation.assistantCapabilityLabelWorkspace"),
      resolveAssistantWorkspaceNameBySessionId(receipt.targetRef.id, navigationLookup)
    );
  }

  if (receipt.targetRef.kind === "workspace" || receipt.targetRef.kind === "worktree") {
    pushAssistantCapabilityRow(
      rows,
      t("conversation.assistantCapabilityLabelWorkspace"),
      resolveAssistantWorkspaceName(receipt.targetRef.id, null, navigationLookup)
    );
  }

  if (receipt.targetRef.kind === "terminal") {
    pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelTerminal"), receipt.targetRef.id);
  }

  if (receipt.targetRef.kind === "timer") {
    pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelTimer"), receipt.targetRef.id);
  }

  const count = extractAssistantCapabilityCount(receipt.payload);

  if (count !== null) {
    pushAssistantCapabilityRow(rows, t("conversation.assistantCapabilityLabelCount"), String(count));
  }
}

function pushAssistantCapabilityRow(
  rows: AssistantCapabilitySnapshot["rows"],
  label: string,
  value: string | null
) {
  const normalized = value?.trim();

  if (!normalized) {
    return;
  }

  if (rows.some((row) => row.label === label)) {
    return;
  }

  rows.push({
    label,
    value: normalized
  });
}

function resolveAssistantSessionName(
  sessionId: string | null,
  fallbackName: string | null,
  navigationLookup: AssistantCapabilityNavigationLookup
): string | null {
  const fallback = fallbackName?.trim();

  if (fallback) {
    return fallback;
  }

  const normalizedId = sessionId?.trim();

  if (!normalizedId) {
    return null;
  }

  return navigationLookup.sessionNamesById.get(normalizedId) ?? normalizedId;
}

function resolveAssistantWorkspaceName(
  workspaceId: string | null,
  fallbackName: string | null,
  navigationLookup: AssistantCapabilityNavigationLookup
): string | null {
  const fallback = fallbackName?.trim();

  if (fallback) {
    return fallback;
  }

  const normalizedId = workspaceId?.trim();

  if (!normalizedId) {
    return null;
  }

  return navigationLookup.workspaceNamesById.get(normalizedId) ?? normalizedId;
}

function resolveAssistantWorkspaceNameBySessionId(
  sessionId: string | null,
  navigationLookup: AssistantCapabilityNavigationLookup
): string | null {
  const normalizedId = sessionId?.trim();

  if (!normalizedId) {
    return null;
  }

  return resolveAssistantWorkspaceName(
    navigationLookup.sessionWorkspaceIdsById.get(normalizedId) ?? null,
    null,
    navigationLookup
  );
}

function extractAssistantCapabilityCount(payload: Record<string, unknown>): number | null {
  const directItems = readArray(payload, "items");

  if (directItems) {
    return directItems.length;
  }

  const page = readRecord(payload, "page");
  const pageItems = readArray(page, "items");

  if (pageItems) {
    return pageItems.length;
  }

  const history = readRecord(payload, "history");
  const historyItems = readArray(history, "items");

  if (historyItems) {
    return historyItems.length;
  }

  return null;
}

function formatAssistantCapabilityTimestamp(value: string | null): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);

  if (!Number.isFinite(timestamp)) {
    return normalized;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function resolveAssistantCapabilityStatusLabel(status: string | null): string | null {
  switch (status) {
    case "active":
      return t("conversation.assistantCapabilityStatusActive");
    case "completed":
      return t("conversation.assistantCapabilityStatusCompleted");
    case "cancelled":
      return t("conversation.assistantCapabilityStatusCancelled");
    case "failed":
      return t("conversation.assistantCapabilityStatusFailed");
    default:
      return status;
  }
}

function AssistantCapabilityIcon({ kind }: { kind: AssistantCapabilitySnapshot["kind"] }) {
  switch (kind) {
    case "session":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v5A2.5 2.5 0 0 1 16.5 15H11l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z" />
        </svg>
      );
    case "automation":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="7.5" />
          <path d="M12 8.5v4.2l2.8 1.8" />
        </svg>
      );
    case "terminal":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m7 8 3.5 3.5L7 15" />
          <path d="M13 15h4" />
          <rect x="4.5" y="5.5" width="15" height="13" rx="2.5" />
        </svg>
      );
    case "workspace":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4.5 8.5A2.5 2.5 0 0 1 7 6h3l1.5 1.5H17A2.5 2.5 0 0 1 19.5 10v6A2.5 2.5 0 0 1 17 18.5H7A2.5 2.5 0 0 1 4.5 16z" />
        </svg>
      );
    case "debug":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M9 4.5h6" />
          <path d="M10 8h4a4 4 0 0 1 4 4v1a6 6 0 0 1-12 0v-1a4 4 0 0 1 4-4Z" />
          <path d="M4.5 11h3M16.5 11h3M5.5 7.5l2 1.5M18.5 7.5l-2 1.5" />
        </svg>
      );
    case "query":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="11" cy="11" r="5.5" />
          <path d="m16 16 3.5 3.5" />
        </svg>
      );
  }
}

function buildEditableToolPreview(tool: ResolvedToolCall): ApplyPatchPreview | null {
  if (tool.name === "apply_patch") {
    const directPreview = parseApplyPatchPreview(tool.input);

    if (directPreview) {
      return directPreview;
    }

    const fallbackPaths = extractApplyPatchPathsFromToolOutput(tool.output || tool.error || "");
    const normalizedInput = normalizeApplyPatchPreviewInput(tool.input, fallbackPaths);

    return normalizedInput ? parseApplyPatchPreview(normalizedInput) : null;
  }

  const normalizedToolName = tool.name.trim().toLowerCase();
  const editableToolKind = resolveEditableToolKind(normalizedToolName);

  if (!editableToolKind) {
    return null;
  }

  const input = parseToolInputRecord(tool.input);

  if (!input) {
    return null;
  }

  const filePath = readFirstToolInputText(input, ["file_path", "filePath", "path"]);

  if (!filePath) {
    return null;
  }

  if (editableToolKind === "write") {
    const content = readFirstToolInputText(input, ["content", "new_content", "newContent"]);
    const contentLines = content.length > 0 ? content.split(/\r?\n/) : [];

    return {
      files: [
        {
          path: filePath,
          nextPath: null,
          action: "add",
          additions: contentLines.length,
          deletions: 0,
          statsKnown: true,
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

  if (editableToolKind === "edit") {
    const oldLines = readFirstToolInputText(input, ["old_string", "oldString", "old_text", "oldText", "search", "searchText"])
      .split(/\r?\n/);
    const newLines = readFirstToolInputText(input, ["new_string", "newString", "new_text", "newText", "replacement", "replacementText", "replace"])
      .split(/\r?\n/);

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
        oldLines: readFirstToolInputText(record, ["old_string", "oldString", "old_text", "oldText", "search", "searchText"])
          .split(/\r?\n/),
        newLines: readFirstToolInputText(record, ["new_string", "newString", "new_text", "newText", "replacement", "replacementText", "replace"])
          .split(/\r?\n/)
      };
    })
    .filter((edit): edit is { oldLines: string[]; newLines: string[] } => Boolean(edit));

  return normalizedEdits.length > 0 ? buildUpdatePreview(filePath, normalizedEdits) : null;
}

function resolveEditableToolKind(
  normalizedToolName: string
): "write" | "edit" | "multiedit" | null {
  if (normalizedToolName === "write" || normalizedToolName === "overwrite") {
    return "write";
  }

  if (normalizedToolName === "edit") {
    return "edit";
  }

  if (normalizedToolName === "multiedit" || normalizedToolName === "multi_edit") {
    return "multiedit";
  }

  return null;
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
        statsKnown: true,
        lines
      }
    ],
    totalAdditions: additions,
    totalDeletions: deletions
  };
}


function resolveToolPreviewSource(tool: ResolvedToolCall, hasResult: boolean): ResolvedToolCall {
  const normalizedName = tool.name.trim().toLowerCase().replace(/[\s_.-]+/g, "");

  if (hasResult && normalizedName === "taskupdate" && tool.output?.trim()) {
    return {
      ...tool,
      input: ""
    };
  }

  return tool;
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

  if (tool.name === "web_search" || tool.name === "web_search_20250305") {
    const query = parsedInput ? readFirstToolInputText(parsedInput, ["query", "q"]) : "";
    if (query) {
      return `搜索：${query}`;
    }
  }

  const previewSource = tool.input || tool.error || tool.output || t("conversation.toolResultEmpty");
  return previewSource.length > 60 ? `${previewSource.slice(0, 60)}...` : previewSource;
}

function parseWebSearchToolResult(tool: ResolvedToolCall): {
  detail: string;
  query: string | null;
  sources: Array<{ title: string | null; url: string | null }>;
} | null {
  if (tool.name !== "web_search" && tool.name !== "web_search_20250305") {
    return null;
  }

  const rawOutput = tool.output?.trim() ?? "";
  if (!rawOutput) {
    return null;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawOutput) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const detail = readText(parsed, "detail") || t("conversation.toolResultEmpty");
  const query = readText(parsed, "query");
  const sources = (readArray(parsed, "sources") ?? [])
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      title: readText(item, "title"),
      url: readText(item, "url")
    }))
    .filter((item) => item.title || item.url)
    .slice(0, 8);

  return {
    detail,
    query,
    sources
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
    messageIds: tools.map(({ message }) => message.id),
    tool: merged,
    hasRequest,
    hasResult,
    updatedAt: tools.at(-1)?.message.timestamp ?? tools[0]!.message.timestamp
  };
}

function mergeToolCallPair(
  current: ResolvedToolCall | null | undefined,
  incoming: ResolvedToolCall | null | undefined
): ResolvedToolCall | null {
  if (!current) {
    return incoming ? { ...incoming } : null;
  }

  if (!incoming) {
    return { ...current };
  }

  return {
    ...incoming,
    callId: incoming.callId || current.callId,
    name: incoming.name || current.name,
    input: incoming.input || current.input,
    output: incoming.output || current.output,
    error: incoming.error || current.error,
    status: incoming.status === "completed" || incoming.status === "failed"
      ? incoming.status
      : current.status
  };
}

function fillSeparatedViewImageResults(messages: SessionMessageViewModel[]): SessionMessageViewModel[] {
  const callMap = new Map<string, ResolvedToolCall>();

  for (const message of messages) {
    if (!isToolMessage(message)) {
      continue;
    }

    const tool = resolveToolCall(message);
    const callId = tool?.callId.trim() ?? "";

    if (!tool || !callId || tool.name.trim() !== "view_image") {
      continue;
    }

    const merged = mergeToolCallPair(callMap.get(callId) ?? null, tool);

    if (merged) {
      callMap.set(callId, merged);
    }
  }

  return messages.map((message) => {
    if (!isToolMessage(message) || !message.toolCall || message.toolCall.name.trim() !== "view_image") {
      return message;
    }

    const callId = message.toolCall.callId.trim();

    if (!callId) {
      return message;
    }

    const mergedTool = callMap.get(callId);

    if (!mergedTool) {
      return message;
    }

    const nextToolCall = mergeToolCallPair(message.toolCall, mergedTool);

    if (!nextToolCall) {
      return message;
    }

    return {
      ...message,
      toolCall: nextToolCall
    };
  });
}

function mergeToolMessageBlock(messages: SessionMessageViewModel[]): ToolMessageGroup[] {
  const claudeTaskGroups = mergeClaudeTaskToolMessageBlock(messages);

  if (claudeTaskGroups) {
    return claudeTaskGroups;
  }

  const groups: ToolMessageGroup[] = [];
  let currentBlock: SessionMessageViewModel[] = [];
  let currentCallId: string | null = null;

  function flushCurrentBlock() {
    if (currentBlock.length === 0) {
      return;
    }

    const merged = mergeToolMessages(currentBlock);

    if (merged) {
      groups.push(merged);
    }

    currentBlock = [];
    currentCallId = null;
  }

  for (const message of messages) {
    const tool = resolveToolCall(message);
    const nextCallId = resolveToolMessageMergeKey(message, tool);

    if (!tool || nextCallId.length === 0) {
      flushCurrentBlock();
      const merged = mergeToolMessages([message]);

      if (merged) {
        groups.push(merged);
      }
      continue;
    }

    if (currentBlock.length === 0) {
      currentBlock = [message];
      currentCallId = nextCallId;
      continue;
    }

    if (currentCallId === nextCallId) {
      currentBlock.push(message);
      continue;
    }

    flushCurrentBlock();
    currentBlock = [message];
    currentCallId = nextCallId;
  }

  flushCurrentBlock();
  return groups;
}

function mergeClaudeTaskToolMessageBlock(messages: SessionMessageViewModel[]): ToolMessageGroup[] | null {
  const groups: ToolMessageGroup[] = [];
  const groupMessagesByKey = new Map<string, SessionMessageViewModel[]>();
  const groupIndexByKey = new Map<string, number>();
  let hasClaudeTaskTool = false;

  for (const message of messages) {
    const tool = resolveToolCall(message);
    const taskKey = tool ? resolveClaudeTaskToolLifecycleKey(message, tool) : null;

    if (!tool || !taskKey) {
      const merged = mergeToolMessages([message]);

      if (merged) {
        groups.push(merged);
      }
      continue;
    }

    hasClaudeTaskTool = true;

    const groupMessages = groupMessagesByKey.get(taskKey);

    if (!groupMessages) {
      const nextMessages = [message];
      const merged = mergeToolMessages(nextMessages);

      if (merged) {
        groupMessagesByKey.set(taskKey, nextMessages);
        groupIndexByKey.set(taskKey, groups.length);
        groups.push(merged);
      }
      continue;
    }

    groupMessages.push(message);
    const merged = mergeToolMessages(groupMessages);
    const existingIndex = groupIndexByKey.get(taskKey);

    if (merged && existingIndex !== undefined) {
      groups[existingIndex] = merged;
    }
  }

  return hasClaudeTaskTool ? groups : null;
}

function resolveToolMessageMergeKey(
  message: SessionMessageViewModel,
  tool: ResolvedToolCall | null
): string {
  if (!tool) {
    return "";
  }

  const taskLifecycleKey = resolveClaudeTaskToolLifecycleKey(message, tool);

  if (taskLifecycleKey) {
    return taskLifecycleKey;
  }

  return tool.callId.trim();
}

function resolveClaudeTaskToolLifecycleKey(
  message: SessionMessageViewModel,
  tool: ResolvedToolCall
): string | null {
  const normalizedName = tool.name.trim().toLowerCase().replace(/[\s_.-]+/g, "");

  if (normalizedName === "taskcreate") {
    const createTitle = extractClaudeTaskCreateTitle(tool);
    const createId = extractClaudeTaskCreateId(tool);

    if (createTitle) {
      return `claude-task-create-title:${createTitle}`;
    }

    if (createId) {
      return `claude-task-create:${createId}`;
    }
  }

  if (normalizedName === "taskupdate") {
    const updateId = extractClaudeTaskUpdateId(tool);

    if (updateId) {
      return `claude-task-update:${updateId}`;
    }
  }

  if (normalizedName === "tasklist" || normalizedName === "taskget") {
    return `claude-task-list:${normalizedName}`;
  }

  return message.toolCall?.callId.trim() ? null : null;
}

function extractClaudeTaskCreateId(tool: ResolvedToolCall): string | null {
  const text = [tool.input, tool.output].find((value) => value && /Task\s*#?\d+\s+created/i.test(value));
  const match = text?.match(/Task\s*#?(\d+)\s+created/i);
  return match?.[1]?.trim() || null;
}

function extractClaudeTaskCreateTitle(tool: ResolvedToolCall): string | null {
  const structured = parseToolJsonObject(tool.input) ?? parseToolJsonObject(tool.output);
  const title =
    readToolTextOrNumber(structured?.title)
    ?? readToolTextOrNumber(structured?.subject)
    ?? readToolTextOrNumber(structured?.content)
    ?? readToolTextOrNumber(structured?.task);

  if (title) {
    return title;
  }

  const text = [tool.input, tool.output].find((value) => value && /created\s+(?:successfully\s*)?:/i.test(value));
  const match = text?.match(/created\s+(?:successfully\s*)?:\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function extractClaudeTaskUpdateId(tool: ResolvedToolCall): string | null {
  const structured = parseToolJsonObject(tool.input) ?? parseToolJsonObject(tool.output);
  const taskId = readToolTextOrNumber(structured?.taskId) ?? readToolTextOrNumber(structured?.task_id);

  if (taskId) {
    return taskId;
  }

  const text = [tool.input, tool.output].find((value) => value && /task\s*#?\d+/i.test(value));
  const match = text?.match(/task\s*#?(\d+)/i);
  return match?.[1]?.trim() || null;
}

function parseToolJsonObject(text: string | null): Record<string, unknown> | null {
  const normalized = text?.trim() ?? "";

  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const objectStart = normalized.indexOf("{");
    const objectEnd = normalized.lastIndexOf("}");

    if (objectStart < 0 || objectEnd <= objectStart) {
      return null;
    }

    try {
      const parsed = JSON.parse(normalized.slice(objectStart, objectEnd + 1)) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function readToolTextOrNumber(value: unknown): string | null {
  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function buildTimelineRenderItems(
  sourceItems: ConversationTimelineSourceItem[],
  visibleMessages: SessionMessageViewModel[]
): TimelineRenderItem[] {
  const hydratedVisibleMessages = fillSeparatedViewImageResults(visibleMessages);
  const hydratedMessageById = new Map(hydratedVisibleMessages.map((message) => [message.id, message]));
  const hydratedSourceItems = sourceItems.map((sourceItem) =>
    sourceItem.type === "message"
      ? {
          ...sourceItem,
          message: hydratedMessageById.get(sourceItem.message.id) ?? sourceItem.message
        }
      : sourceItem
  );
  const renderItems: TimelineRenderItem[] = [];
  const toolMessageBlock: SessionMessageViewModel[] = [];
  let messageIndex = 0;

  function flushToolMessageBlock() {
    if (toolMessageBlock.length === 0) {
      return;
    }

    const groups = mergeToolMessageBlock(toolMessageBlock);

    if (groups.length === 0) {
      const firstToolMessage = toolMessageBlock[0];

      if (firstToolMessage) {
        renderItems.push({
          type: "message",
          key: firstToolMessage.id,
          message: firstToolMessage
        });
      }

      toolMessageBlock.length = 0;
      return;
    }

    groups.forEach((group) => {
      renderItems.push({
        type: "tool_group",
        key: group.key,
        group
      });
    });

    toolMessageBlock.length = 0;
  }

  for (const sourceItem of hydratedSourceItems) {
    if (sourceItem.type !== "message") {
      flushToolMessageBlock();
      renderItems.push(sourceItem);
      continue;
    }

    const current = sourceItem.message;
    const currentMessageIndex = messageIndex;
    messageIndex += 1;

    if (shouldSuppressTurnAbortedMessage(hydratedVisibleMessages, currentMessageIndex)) {
      continue;
    }

    if (!isToolMessage(current)) {
      flushToolMessageBlock();
      renderItems.push({
        type: "message",
        key: current.id,
        message: current
      });
      continue;
    }

    toolMessageBlock.push(current);
  }

  flushToolMessageBlock();

  return renderItems;
}

function sanitizeForkTimelineItems(
  session: SessionSummaryDto | null | undefined,
  sourceItems: ConversationTimelineSourceItem[]
): {
  visibleItems: ConversationTimelineSourceItem[];
  visibleMessages: SessionMessageViewModel[];
  hiddenMessageIds: string[];
} {
  if (
    !session
    || session.forkSourceType !== "message"
    || typeof session.inheritedPrefixMessageCount !== "number"
    || session.inheritedPrefixMessageCount < 0
  ) {
    return {
      visibleItems: sourceItems,
      visibleMessages: sourceItems.flatMap((item) => item.type === "message" ? [item.message] : []),
      hiddenMessageIds: []
    };
  }

  const childCreatedAt = session.createdAt?.trim() || "";

  if (childCreatedAt.length === 0) {
    return {
      visibleItems: sourceItems,
      visibleMessages: sourceItems.flatMap((item) => item.type === "message" ? [item.message] : []),
      hiddenMessageIds: []
    };
  }

  const inheritedBoundary = Math.max(0, session.inheritedPrefixMessageCount);
  const visibleItems: ConversationTimelineSourceItem[] = [];
  const visibleMessages: SessionMessageViewModel[] = [];
  const hiddenMessageIds: string[] = [];

  for (const item of sourceItems) {
    if (item.type !== "message") {
      visibleItems.push(item);
      continue;
    }

    const message = item.message;

    if (message.sequence <= inheritedBoundary || message.timestamp >= childCreatedAt) {
      visibleItems.push(item);
      visibleMessages.push(message);
      continue;
    }

    hiddenMessageIds.push(message.id);
  }

  return {
    visibleItems,
    visibleMessages,
    hiddenMessageIds
  };
}

function buildTimelineViewModel(input: TimelineViewModelInput): TimelineViewModel {
  const sanitized = sanitizeForkTimelineItems(input.sessionSummary, input.items);
  const renderItems = buildTimelineRenderItems(sanitized.visibleItems, sanitized.visibleMessages);
  const leadingSystemPromptMessageIds = collectLeadingSystemPromptMessageIds(
    sanitized.visibleMessages,
    input.provider
  );
  const actionStateByMessageId = buildMessageActionStateById(sanitized.visibleMessages);

  return {
    visibleMessages: sanitized.visibleMessages,
    renderItems,
    leadingSystemPromptMessageIds,
    actionStateByMessageId,
    hiddenMessageIds: sanitized.hiddenMessageIds,
    validationIssues: validateTimelineViewModel(sanitized.visibleMessages, renderItems)
  };
}

function validateTimelineViewModel(
  visibleMessages: SessionMessageViewModel[],
  renderItems: TimelineRenderItem[]
): string[] {
  const issues: string[] = [];
  const renderKeys = renderItems.map((item) => item.key);
  const duplicateRenderKeys = findDuplicateTimelineKeys(renderKeys);

  if (duplicateRenderKeys.length > 0) {
    issues.push(`duplicate_render_keys:${duplicateRenderKeys.join(",")}`);
  }

  const flattenedRenderableMessageIds: string[] = [];

  for (const item of renderItems) {
    if (item.type === "message") {
      flattenedRenderableMessageIds.push(item.message.id);
      continue;
    }

    if (item.type === "tool_group") {
      flattenedRenderableMessageIds.push(...item.group.messageIds);
    }
  }

  const flattenedRenderableIdSet = new Set(flattenedRenderableMessageIds);

  for (const message of visibleMessages) {
    if (shouldRenderTimelineMessage(visibleMessages, message.id) && !flattenedRenderableIdSet.has(message.id)) {
      issues.push(`missing_render_message:${message.id}`);
    }
  }

  const expectedRenderableMessageIds = visibleMessages
    .filter((message) => shouldRenderTimelineMessage(visibleMessages, message.id))
    .map((message) => message.id);

  if (flattenedRenderableMessageIds.join(",") !== expectedRenderableMessageIds.join(",")) {
    issues.push("render_order_mismatch");
  }

  return issues;
}

function shouldRenderTimelineMessage(
  messages: SessionMessageViewModel[],
  messageId: string
): boolean {
  const index = messages.findIndex((message) => message.id === messageId);

  if (index < 0) {
    return false;
  }

  return !shouldSuppressTurnAbortedMessage(messages, index);
}

function findDuplicateTimelineKeys(keys: string[]): string[] {
  const counts = new Map<string, number>();

  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}

function shouldSuppressTurnAbortedMessage(
  messages: SessionMessageViewModel[],
  index: number
): boolean {
  const current = messages[index];

  if (!current || parseTurnAbortedMessage(current.content) === null) {
    return false;
  }

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = messages[cursor];

    if (!previous || isToolMessage(previous)) {
      continue;
    }

    return previous.role === "user";
  }

  return false;
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

function looksLikeSkillContextMessage(provider: ProviderId | null, content: string) {
  if (provider !== "claude-code") {
    return false;
  }

  const normalized = content.trim();

  return /Base directory for this skill:/i.test(normalized)
    && /^#\s+.+/im.test(normalized)
    && /\bARGUMENTS:/i.test(normalized);
}

function getFoldedPromptSummary(kind: FoldedPromptKind, content: string) {
  if (kind === "skill_context") {
    const skillHeading = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^#\s+/.test(line));

    if (skillHeading) {
      return skillHeading.replace(/^#+\s*/, "");
    }
  }

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

function collectRenderItemMessageIds(renderItems: TimelineRenderItem[]): string[] {
  const messageIds: string[] = [];

  for (const item of renderItems) {
    if (item.type === "message") {
      messageIds.push(item.message.id);
      continue;
    }

    if (item.type === "tool_group") {
      messageIds.push(...item.group.messageIds);
    }
  }

  return messageIds;
}

function collectAssistantRenderMoves(
  previousRenderMessageIds: string[] | null,
  nextRenderMessageIds: string[],
  visibleMessages: SessionMessageViewModel[]
): Array<Record<string, unknown>> {
  if (!previousRenderMessageIds) {
    return [];
  }

  const assistantIds = new Set(
    visibleMessages
      .filter((message) => message.role === "assistant")
      .map((message) => message.id)
  );

  if (assistantIds.size === 0) {
    return [];
  }

  const previousIndexById = new Map(previousRenderMessageIds.map((messageId, index) => [messageId, index]));
  const nextIndexById = new Map(nextRenderMessageIds.map((messageId, index) => [messageId, index]));
  const messageById = new Map(visibleMessages.map((message) => [message.id, message]));
  const moves: Array<Record<string, unknown>> = [];

  for (const assistantId of assistantIds) {
    const previousIndex = previousIndexById.get(assistantId) ?? null;
    const nextIndex = nextIndexById.get(assistantId) ?? null;

    if (previousIndex === nextIndex) {
      continue;
    }

    const message = messageById.get(assistantId) ?? null;
    moves.push({
      messageId: assistantId,
      fromIndex: previousIndex,
      toIndex: nextIndex,
      sequence: message?.sequence ?? null,
      rawRef: message?.rawRef ?? null,
      timestamp: message?.timestamp ?? null
    });
  }

  return moves.slice(0, 8);
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
  onCopy,
  exportMode = false
}: {
  className?: string;
  children: ReactNode;
  onCopy: (text: string) => void;
  exportMode?: boolean;
}) {
  const isInsideLink = useContext(MarkdownLinkContext);
  const content = flattenReactNodeText(children).trim();

  if (exportMode || isInsideLink || !content) {
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
  onInteract,
  exportMode = false
}: {
  href?: string;
  children: ReactNode;
  className?: string;
  onInteract: (href: string | undefined, text: string) => void;
  exportMode?: boolean;
}) {
  if (exportMode) {
    return (
      <MarkdownLinkContext.Provider value={true}>
        <a href={href} className={className}>
          {children}
        </a>
      </MarkdownLinkContext.Provider>
    );
  }

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
  content,
  exportMode = false
}: {
  language: string | null;
  codeClassName?: string;
  content: string;
  exportMode?: boolean;
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
        {!exportMode ? (
          <button className="code-copy-button" type="button" onClick={() => void handleCopy()}>
            {t("conversation.copyAction")}
          </button>
        ) : null}
      </div>
      <pre className={codeClassName}>
        <code>{content}</code>
      </pre>
    </div>
  );
}

function MessageMarkdownBody({
  content,
  className,
  exportMode = false
}: {
  content: string;
  className: string;
  exportMode?: boolean;
}) {
  const { showToast } = useToast();
  const platform = usePlatform();
  const { navigationGroups, currentWorkspaceId, revealWorkspaceFile } = useWorkbenchShell();
  const [markdownImagePreviewSources, setMarkdownImagePreviewSources] = useState<Record<string, string>>({});
  const currentWorkspace = useMemo(
    () =>
      navigationGroups.find((group) => group.workspace.id === currentWorkspaceId)?.workspace
      ?? null,
    [currentWorkspaceId, navigationGroups]
  );
  const normalizedWorkspacePath = currentWorkspace?.path
    ? trimTrailingSlashes(normalizeMessagePathSeparators(currentWorkspace.path.trim()))
    : null;

  useEffect(() => {
    const markdownImageMatches = Array.from(
      content.matchAll(/!\[[^\]]*]\(([^)\s]+(?:\s+"[^"]*")?)\)|<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)
    );
    const markdownImageUrls = markdownImageMatches
      .map((match) => (match[1] ?? match[2] ?? "").trim())
      .filter((value) => value.length > 0);

    if (markdownImageUrls.length === 0) {
      setMarkdownImagePreviewSources({});
      return;
    }

    const directPreviewTargets = Array.from(
      new Map(
        markdownImageUrls
          .map((rawUrl) => {
            const sourceUrl = rawUrl.replace(/^<|>$/g, "").replace(/\s+"[^"]*"$/, "");

            if (!sourceUrl || sourceUrl.startsWith("#")) {
              return null;
            }

            const officeArtifactPreviewTarget = resolveOfficeArtifactPreviewTargetFromHref(sourceUrl);

            if (officeArtifactPreviewTarget) {
              return [sourceUrl, officeArtifactPreviewTarget] as const;
            }

            return null;
          })
          .filter((item): item is readonly [string, { kind: "artifact"; artifactId: string } | {
            kind: "task_file";
            taskId: string;
            fileName: string;
          }] => item !== null)
      )
    );
    const directPreviewSourceUrls = new Set(directPreviewTargets.map(([sourceUrl]) => sourceUrl));

    const imageCandidates = Array.from(
      new Map(
        markdownImageUrls
          .map((rawUrl) => {
            const sourceUrl = rawUrl.replace(/^<|>$/g, "").replace(/\s+"[^"]*"$/, "");

            if (!sourceUrl || sourceUrl.startsWith("#")) {
              return null;
            }

            if (directPreviewSourceUrls.has(sourceUrl)) {
              return null;
            }

            if (/^data:image\//i.test(sourceUrl) || /^https?:\/\//i.test(sourceUrl)) {
              return null;
            }

            if (!currentWorkspaceId || !normalizedWorkspacePath) {
              return null;
            }

            const relativePath = resolveWorkspaceRelativePathFromHref(sourceUrl, normalizedWorkspacePath);

            if (!relativePath) {
              return null;
            }

            return [sourceUrl, relativePath] as const;
          })
          .filter((item): item is readonly [string, string] => item !== null)
      ).entries()
    ).map(([sourceUrl, relativePath]) => ({
      sourceUrl,
      relativePath
    }));

    let cancelled = false;

    void Promise.all([
      ...directPreviewTargets.map(async ([sourceUrl, target]) => {
        try {
          const previewLink = target.kind === "artifact"
            ? await getOfficeArtifactPreviewLink(target.artifactId)
            : await getOfficeTaskFilePreviewLink(target.taskId, target.fileName);
          const resolvedUrl = resolveToolImagePreviewAccessUrl(
            previewLink.previewPath,
            previewLink.previewUrl,
            platform.isDesktop
          );

          if (!resolvedUrl) {
            return null;
          }

          return [sourceUrl, resolvedUrl] as const;
        } catch {
          return null;
        }
      }),
      ...imageCandidates.map(async (candidate) => {
        try {
          if (!currentWorkspaceId) {
            return null;
          }

          const previewLink = await getFilePreviewLink(currentWorkspaceId, candidate.relativePath);
          const resolvedUrl = resolveToolImagePreviewAccessUrl(
            previewLink.previewPath,
            previewLink.previewUrl,
            platform.isDesktop
          );

          if (!resolvedUrl) {
            return null;
          }

          return [candidate.sourceUrl, resolvedUrl] as const;
        } catch {
          return null;
        }
      })
    ]).then((results) => {
      if (cancelled) {
        return;
      }

      setMarkdownImagePreviewSources(
        Object.fromEntries([
          ...results.filter((entry): entry is readonly [string, string] => entry !== null)
        ])
      );
    });

    return () => {
      cancelled = true;
    };
  }, [content, currentWorkspaceId, normalizedWorkspacePath, platform.isDesktop]);

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
                exportMode={exportMode}
              >
                {props.children}
              </InteractiveMessageLink>
            );
          },
          img(props) {
            const rawSrc = typeof props.src === "string" ? props.src.trim() : "";
            const resolvedSrc = markdownImagePreviewSources[rawSrc] ?? rawSrc;
            const altText = typeof props.alt === "string" ? props.alt : "";

            if (!resolvedSrc) {
              return null;
            }

            return (
              <img
                src={resolvedSrc}
                alt={altText}
                className="message-markdown-image"
                loading="lazy"
                decoding="async"
              />
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
                exportMode={exportMode}
              />
            );
          },
          code(props) {
            const codeClassName = typeof props.className === "string" ? props.className : "";
            return (
              <MarkdownInlineCode
                className={codeClassName || undefined}
                exportMode={exportMode}
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
  kind: "image" | "file";
  fileName: string;
  fileSize: number | null;
  url: string | null;
  status: "ready" | "loading" | "error";
}

function buildInlineAttachmentPreviewUrl(
  attachment: MessageAttachmentDto,
  payload: AttachmentPayload | null | undefined
) {
  if (attachment.kind !== "image" || !payload?.contentBase64 || payload.mimeType !== attachment.mimeType) {
    return null;
  }

  return `data:${payload.mimeType};base64,${payload.contentBase64}`;
}

function formatAttachmentSize(fileSize: number | null): string | null {
  if (typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize < 0) {
    return null;
  }

  if (fileSize < 1024) {
    return `${fileSize} B`;
  }

  if (fileSize < 1024 * 1024) {
    return `${(fileSize / 1024).toFixed(1)} KB`;
  }

  return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
}

function MessageAttachments({
  sessionId,
  attachmentPayloads = [],
  attachments = [],
  inlineImages = []
}: {
  sessionId?: string;
  attachmentPayloads?: AttachmentPayload[] | null;
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
  attachmentPayloads?: AttachmentPayload[] | null;
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
            kind: attachment.kind,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            url: inlineUrl,
            status: "ready" as const
          };
        }

        const remoteSource = remotePreviewSources[attachment.id];

        return {
          id: attachment.id,
          kind: attachment.kind,
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
        kind: "image" as const,
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
            kind: attachment.kind,
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
            kind: attachment.kind,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            url: objectUrl,
            status: "ready" as const
          };
        } catch {
          return {
            id: attachment.id,
            kind: attachment.kind,
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
          const isImageAttachment = attachment.kind === "image";
          const previewLabel =
            attachment.status === "loading"
              ? t("conversation.attachmentPreviewLoading")
              : attachment.status === "error"
                ? t("conversation.attachmentPreviewUnavailable")
                : isImageAttachment
                  ? t("conversation.attachmentPreviewOpen")
                  : t("conversation.attachmentDownload");
          const attachmentSize = formatAttachmentSize(attachment.fileSize);
          const contentNode = (
            <div className="message-attachment-card">
              {isImageAttachment ? (
                attachment.url ? (
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
                )
              ) : (
                <div className="message-attachment-file-card">
                  <div className="message-attachment-file-icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                      <path d="M14 2v5h5" />
                      <path d="M9 13h6" />
                      <path d="M9 17h6" />
                    </svg>
                  </div>
                  <div className="message-attachment-file-meta">
                    <strong title={attachment.fileName}>{attachment.fileName}</strong>
                    <span>{attachmentSize ?? t("conversation.fileAttachmentLabel")}</span>
                  </div>
                </div>
              )}
            </div>
          );

          if (!isImageAttachment && attachment.url) {
            return (
              <a
                key={attachment.id}
                className="message-attachment-button"
                href={attachment.url}
                download={attachment.fileName}
                aria-label={`${attachment.fileName} - ${previewLabel}`}
                title={previewLabel}
              >
                {contentNode}
              </a>
            );
          }

          return (
            <button
              key={attachment.id}
              type="button"
              className="message-attachment-button"
              onClick={() => isImageAttachment && attachment.url && setPreviewAttachmentId(attachment.id)}
              disabled={!attachment.url}
              aria-label={`${attachment.fileName} - ${previewLabel}`}
              title={previewLabel}
            >
              {contentNode}
            </button>
          );
        })}
      </div>

      <DesktopModal
        open={Boolean(previewAttachment?.url)}
        title={t("conversation.imagePreviewTitle")}
        description={previewAttachment?.fileName}
        size="xwide"
        layout="viewer"
        className="message-image-modal"
        bodyClassName="message-image-modal-body"
        onClose={() => setPreviewAttachmentId(null)}
      >
        {previewAttachment?.url ? (
          <>
            <div className="message-image-modal-stage">
              <img
                className="message-image-modal-image"
                src={previewAttachment.url}
                alt={previewAttachment.fileName || t("conversation.attachmentPreviewAlt")}
              />
            </div>
            <p className="message-image-modal-hint">{t("conversation.imagePreviewHint")}</p>
          </>
        ) : null}
      </DesktopModal>
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
  preview,
  exportMode = false
}: {
  tool: ResolvedToolCall;
  preview: ApplyPatchPreview;
  exportMode?: boolean;
}) {
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(null);
  const selectedFile =
    selectedFileIndex === null
      ? null
      : preview.files[selectedFileIndex] ?? null;

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
          exportMode ? (
            <div
              key={buildApplyPatchFileRenderKey(file, index)}
              className="apply-patch-summary-row"
            >
              <span className="apply-patch-summary-label">{getApplyPatchActionLabel(file.action)}</span>
              <span className="apply-patch-summary-file" title={buildApplyPatchFullPathLabel(file)}>
                {getApplyPatchDisplayName(file.nextPath ?? file.path)}
              </span>
              {renderApplyPatchSummaryStats(file)}
            </div>
          ) : (
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
              {renderApplyPatchSummaryStats(file)}
            </button>
          )
        ))}
      </div>

      <DesktopModal
        open={selectedFile !== null}
        title={t("conversation.applyPatchDialogTitle")}
        description={t("conversation.applyPatchDialogDescription")}
        size="full"
        layout="viewer"
        className="apply-patch-modal"
        bodyClassName="apply-patch-modal-body"
        onClose={() => setSelectedFileIndex(null)}
      >
        {selectedFile ? (
          <>
            <div className="apply-patch-modal-totals">
              {renderApplyPatchModalStats(selectedFile)}
            </div>

            <section
              key={buildApplyPatchFileRenderKey(selectedFile, selectedFileIndex ?? 0)}
              className="apply-patch-file-panel"
            >
              <div className="apply-patch-file-panel-header">
                <div className="apply-patch-file-panel-title">
                  <span className="apply-patch-summary-label">{getApplyPatchActionLabel(selectedFile.action)}</span>
                  <strong>{buildApplyPatchFullPathLabel(selectedFile)}</strong>
                </div>
                {renderApplyPatchSummaryStats(selectedFile)}
              </div>
              <div className="apply-patch-diff-view">
                <div className="apply-patch-diff-scroll">
                  {selectedFile.lines.map((line, index) => (
                    <div
                      key={`${buildApplyPatchFullPathLabel(selectedFile)}:${index}`}
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
          </>
        ) : null}
      </DesktopModal>
    </>
  );
}

function ViewImageToolItem({
  tool,
  snapshot,
  sessionId,
  workspaceId,
  exportMode = false
}: {
  tool: ResolvedToolCall;
  snapshot: ViewImageToolSnapshot;
  sessionId?: string | null;
  workspaceId?: string | null;
  exportMode?: boolean;
}) {
  const platform = usePlatform();
  const [previewState, setPreviewState] = useState<ViewImagePreviewState>({ status: "idle", url: null });

  useEffect(() => {
    if (exportMode) {
      setPreviewState({ status: "idle", url: null });
      return undefined;
    }

    if (snapshot.inlineImageUrl) {
      setPreviewState({ status: "ready", url: snapshot.inlineImageUrl });
      return undefined;
    }

    if (!snapshot.previewTarget) {
      setPreviewState({ status: "idle", url: null });
      return undefined;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setPreviewState({ status: "loading", url: null });

    const previewPromise = snapshot.previewTarget.kind === "workspace_file"
      ? (workspaceId
        ? getFilePreviewLink(workspaceId, snapshot.previewTarget.relativePath).then((previewLink) => ({
            url: resolveToolImagePreviewAccessUrl(
              previewLink.previewPath,
              previewLink.previewUrl,
              platform.isDesktop
            )
          }))
        : Promise.reject(new Error("workspace preview requires workspaceId")))
      : snapshot.previewTarget.kind === "session_attachment"
        ? getSessionAttachmentBlob(
          snapshot.previewTarget.sessionId || sessionId || "",
          snapshot.previewTarget.attachmentId
        ).then((blob) => {
          objectUrl = URL.createObjectURL(blob);
          return { url: objectUrl };
        })
        : snapshot.previewTarget.kind === "office_artifact"
          ? getOfficeArtifactPreviewLink(snapshot.previewTarget.artifactId).then((previewLink) => ({
              url: resolveToolImagePreviewAccessUrl(
                previewLink.previewPath,
                previewLink.previewUrl,
                platform.isDesktop
              )
            }))
          : getOfficeTaskFilePreviewLink(snapshot.previewTarget.taskId, snapshot.previewTarget.fileName).then((previewLink) => ({
              url: resolveToolImagePreviewAccessUrl(
                previewLink.previewPath,
                previewLink.previewUrl,
                platform.isDesktop
              )
            }));

    void previewPromise
      .then(({ url }) => {
        if (cancelled) {
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
          }
          return;
        }

        setPreviewState(url ? { status: "ready", url } : { status: "error", url: null });
      })
      .catch(() => {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        if (!cancelled) {
          setPreviewState({ status: "error", url: null });
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [exportMode, platform.isDesktop, sessionId, snapshot.inlineImageUrl, snapshot.previewTarget, workspaceId]);

  return (
    <div className={`tool-call-item view-image-tool-item ${tool.status === "completed" ? "tool-result" : ""}`}>
      <div className="tool-call-header view-image-tool-header">
        <div className="tool-call-info">
          <span className="tool-call-name">{t("conversation.toolViewImageActiveLabel")}</span>
          <span className="tool-call-input-preview">{snapshot.displayPath}</span>
        </div>
      </div>
      {!exportMode ? (
        <div className="view-image-tool-preview">
          {previewState.status === "ready" ? (
            <img src={previewState.url} alt={snapshot.fileName || t("conversation.attachmentPreviewAlt")} />
          ) : (
            <div className="view-image-tool-placeholder">
              {previewState.status === "loading"
                ? t("conversation.attachmentPreviewLoading")
                : t("conversation.attachmentPreviewUnavailable")}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ToolCallItem({
  group,
  sessionId,
  workspaceId,
  workspacePath,
  exportMode = false,
  onSubmitStructuredQuestion = null,
  permissionRequests = [],
  replyingPermissionRequestId = null
}: {
  group: ToolMessageGroup;
  sessionId?: string | null;
  workspaceId?: string | null;
  workspacePath?: string | null;
  exportMode?: boolean;
  onSubmitStructuredQuestion?: ((payload: { messageId: string; answers: Record<string, string[]> }) => Promise<void> | void) | null;
  permissionRequests?: SessionPermissionRequestDto[];
  replyingPermissionRequestId?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const { navigationGroups } = useWorkbenchShell();
  const { tool, hasRequest, hasResult } = group;
  const toolDisplayName = getToolDisplayName(tool.name);
  const askUserQuestionPrompt = useMemo(
    () => resolveAskUserQuestionPrompt(tool),
    [tool]
  );
  const viewImageSnapshot = useMemo(
    () => resolveViewImageToolSnapshot(tool, workspacePath, sessionId),
    [sessionId, tool, workspacePath]
  );
  const assistantCapabilityLookup = useMemo(
    () => buildAssistantCapabilityNavigationLookup(navigationGroups),
    [navigationGroups]
  );
  const assistantCapabilitySnapshot = useMemo(
    () => buildAssistantCapabilitySnapshot(tool, assistantCapabilityLookup),
    [assistantCapabilityLookup, tool]
  );
  const assistantCliCommandSnapshot = useMemo(
    () => buildAssistantCliCommandSnapshot(tool, assistantCapabilityLookup),
    [assistantCapabilityLookup, tool]
  );
  const codexAgentToolSnapshot = useMemo(
    () => buildCodexAgentToolSnapshot(tool),
    [tool]
  );
  const claudeAgentToolSnapshot = useMemo(
    () => buildClaudeAgentToolSnapshot(tool),
    [tool]
  );
  const taskSnapshot = useMemo(
    () => buildConversationTaskSnapshotFromToolCall(tool, null, group.updatedAt),
    [group.updatedAt, tool]
  );
  const inlinePlanApprovalRequest = useMemo(
    () => resolveInlinePlanApprovalRequest(tool, permissionRequests),
    [permissionRequests, tool]
  );
  const applyPatchPreview = useMemo(
    () => buildEditableToolPreview(tool),
    [tool.input, tool.name]
  );

  if (askUserQuestionPrompt) {
    return (
      <StructuredQuestionResultCard
        prompt={askUserQuestionPrompt}
        tool={tool}
      />
    );
  }

  if (viewImageSnapshot) {
    return (
      <ViewImageToolItem
        tool={tool}
        snapshot={viewImageSnapshot}
        sessionId={sessionId}
        workspaceId={workspaceId}
        exportMode={exportMode}
      />
    );
  }

  if (applyPatchPreview) {
    return <ApplyPatchToolItem tool={tool} preview={applyPatchPreview} exportMode={exportMode} />;
  }

  if (assistantCapabilitySnapshot) {
    return (
      <AssistantCapabilityToolItem
        tool={tool}
        snapshot={assistantCapabilitySnapshot}
        expanded={expanded}
        hasRequest={hasRequest}
        hasResult={hasResult}
        exportMode={exportMode}
        onToggleExpanded={() => {
          setExpanded((current) => !current);
        }}
      />
    );
  }

  if (assistantCliCommandSnapshot) {
    return (
      <AssistantCapabilityToolItem
        tool={tool}
        snapshot={assistantCliCommandSnapshot}
        expanded={expanded}
        hasRequest={hasRequest}
        hasResult={hasResult}
        exportMode={exportMode}
        onToggleExpanded={() => {
          setExpanded((current) => !current);
        }}
      />
    );
  }

  if (codexAgentToolSnapshot) {
    return (
      <AssistantCapabilityToolItem
        tool={tool}
        snapshot={codexAgentToolSnapshot}
        expanded={expanded}
        hasRequest={hasRequest}
        hasResult={hasResult}
        exportMode={exportMode}
        onToggleExpanded={() => {
          setExpanded((current) => !current);
        }}
      />
    );
  }

  if (claudeAgentToolSnapshot) {
    return (
      <AssistantCapabilityToolItem
        tool={tool}
        snapshot={claudeAgentToolSnapshot}
        expanded={expanded}
        hasRequest={hasRequest}
        hasResult={hasResult}
        exportMode={exportMode}
        onToggleExpanded={() => {
          setExpanded((current) => !current);
        }}
      />
    );
  }

  if (taskSnapshot) {
    return (
      <TaskToolItem
        tool={tool}
        snapshot={taskSnapshot}
        expanded={expanded}
        hasRequest={hasRequest}
        hasResult={hasResult}
        exportMode={exportMode}
        hideClaudePlanNotes={Boolean(inlinePlanApprovalRequest)}
        onToggleExpanded={() => {
          setExpanded((current) => !current);
        }}
      />
    );
  }

  const preview = getToolPreview(resolveToolPreviewSource(tool, hasResult));
  const webSearchResult = parseWebSearchToolResult(tool);
  const hasDetails = Boolean(tool.input || tool.output || tool.error);
  const canToggleExpanded = hasDetails && !exportMode;
  const headerContent = (
    <>
      <div className="tool-call-info">
        <span className="tool-call-name">{toolDisplayName}</span>
        <span className="tool-call-input-preview">{preview}</span>
      </div>
      <div className="tool-call-meta">
        {canToggleExpanded && (
          <span className={`tool-call-toggle ${expanded ? "expanded" : ""}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        )}
      </div>
    </>
  );

  return (
    <div className={`tool-call-item ${hasResult ? "tool-result" : ""}`}>
      {exportMode ? (
        <div className="tool-call-header">
          {headerContent}
        </div>
      ) : (
        <button
          type="button"
          className="tool-call-header"
          onClick={() => hasDetails && setExpanded((current) => !current)}
        >
          {headerContent}
        </button>
      )}

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
              {webSearchResult && !tool.error ? (
                <div className="tool-web-search-result">
                  <p className="tool-web-search-detail">{webSearchResult.detail}</p>
                  {webSearchResult.query ? (
                    <div className="tool-web-search-meta">
                      <span className="tool-web-search-meta-label">{t("conversation.toolWebSearchQueryLabel")}</span>
                      <span className="tool-web-search-meta-value">{webSearchResult.query}</span>
                    </div>
                  ) : null}
                  {webSearchResult.sources.length > 0 ? (
                    <div className="tool-web-search-sources">
                      <div className="tool-web-search-sources-label">{t("conversation.toolWebSearchSourcesLabel")}</div>
                      <ul className="tool-web-search-source-list">
                        {webSearchResult.sources.map((source, index) => {
                          const key = `${source.url || source.title || "source"}-${index}`;
                          const title = source.title || source.url || t("conversation.toolWebSearchUntitledSource");
                          return (
                            <li key={key} className="tool-web-search-source-item">
                              {source.url ? (
                                <a
                                  className="tool-web-search-source-link"
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {title}
                                </a>
                              ) : (
                                <span className="tool-web-search-source-title">{title}</span>
                              )}
                              {source.url ? (
                                <span className="tool-web-search-source-url">{source.url}</span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <pre className={tool.error ? "tool-call-error" : undefined}>
                  {tool.error || tool.output || t("conversation.toolResultEmpty")}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MemoizedToolCallItem = memo(ToolCallItem, (previous, next) => {
  return previous.group === next.group
    && previous.sessionId === next.sessionId
    && previous.workspaceId === next.workspaceId
    && previous.workspacePath === next.workspacePath
    && previous.exportMode === next.exportMode
    && previous.onSubmitStructuredQuestion === next.onSubmitStructuredQuestion
    && previous.permissionRequests === next.permissionRequests
    && previous.replyingPermissionRequestId === next.replyingPermissionRequestId;
});

function AssistantCapabilityToolItem({
  tool,
  snapshot,
  expanded,
  hasRequest,
  hasResult,
  onToggleExpanded,
  exportMode = false
}: {
  tool: ResolvedToolCall;
  snapshot: AssistantCapabilitySnapshot;
  expanded: boolean;
  hasRequest: boolean;
  hasResult: boolean;
  onToggleExpanded: () => void;
  exportMode?: boolean;
}) {
  const rawLabel = expanded
    ? t("conversation.assistantCapabilityRawCollapse")
    : t("conversation.assistantCapabilityRawExpand");

  return (
    <div className="tool-call-item assistant-capability-item" data-kind={snapshot.kind}>
      <div className="assistant-capability-header">
        <div className="assistant-capability-heading">
          <span className="assistant-capability-icon">
            <AssistantCapabilityIcon kind={snapshot.kind} />
          </span>
          <div className="assistant-capability-heading-main">
            <span className="assistant-capability-badge">{snapshot.badge}</span>
            <strong>{snapshot.title}</strong>
            <span className="assistant-capability-summary">{snapshot.summary}</span>
          </div>
        </div>
        {!exportMode ? (
          <button
            type="button"
            className="task-tool-raw-toggle"
            onClick={onToggleExpanded}
          >
            {rawLabel}
          </button>
        ) : null}
      </div>

      {snapshot.rows.length > 0 ? (
        <div className="assistant-capability-list">
          {snapshot.rows.map((row) => (
            <div key={row.label} className="assistant-capability-row">
              <span className="assistant-capability-row-label">{row.label}</span>
              <span className="assistant-capability-row-value">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {!exportMode && expanded ? (
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

function SubagentNotificationReportCard({
  message,
  snapshot,
  actionState,
  onForkMessage,
  exportMode = false
}: {
  message: SessionMessageViewModel;
  snapshot: SubagentNotificationSnapshot;
  actionState: MessageActionState;
  onForkMessage?: ((message: SessionMessageViewModel) => Promise<void> | void) | null;
  exportMode?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const rawLabel = expanded
    ? t("conversation.assistantCapabilityRawCollapse")
    : t("conversation.assistantCapabilityRawExpand");

    return (
      <article
        className="message-item tool-message-row subagent-notification-row"
        data-message-id={message.id}
      >
      <div className="tool-call-item assistant-capability-item" data-kind="session">
        <div className="assistant-capability-header">
          <div className="assistant-capability-heading">
            <span className="assistant-capability-icon">
              <AssistantCapabilityIcon kind="session" />
            </span>
            <div className="assistant-capability-heading-main">
              <span className="assistant-capability-badge">{t("conversation.assistantCapabilityBadgeSubAgent")}</span>
              <strong>{t("conversation.subagentNotificationTitle")}</strong>
              <span className="assistant-capability-summary">{t("conversation.subagentNotificationSummary")}</span>
            </div>
          </div>
          {!exportMode ? (
            <button
              type="button"
              className="task-tool-raw-toggle"
              onClick={() => setExpanded((current) => !current)}
            >
              {rawLabel}
            </button>
          ) : null}
        </div>

        {snapshot.rows.length > 0 ? (
          <div className="assistant-capability-list">
            {snapshot.rows.map((row) => (
              <div key={row.label} className="assistant-capability-row">
                <span className="assistant-capability-row-label">{row.label}</span>
                <span className="assistant-capability-row-value">{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="subagent-notification-body">
          <MessageMarkdownBody
            content={snapshot.resultMarkdown}
            className="message-text message-content markdown-content"
            exportMode={exportMode}
          />
        </div>

        {!exportMode && expanded ? (
          <div className="tool-call-output">
            <div className="tool-call-section">
              <div className="tool-call-section-label">{t("conversation.toolInputLabel")}</div>
              <pre>{message.content}</pre>
            </div>
          </div>
        ) : null}

        <MessageMetadataBar
          text={snapshot.resultMarkdown}
          canCopy={actionState.canCopy}
          canFork={actionState.canFork && Boolean(onForkMessage && message.deliveryState === "sent")}
          onFork={onForkMessage ? () => onForkMessage(message) : null}
        />
      </div>
    </article>
  );
}

function TaskToolItem({
  tool,
  snapshot,
  expanded,
  hasRequest,
  hasResult,
  onToggleExpanded,
  exportMode = false,
  hideClaudePlanNotes = false
}: {
  tool: ResolvedToolCall;
  snapshot: ConversationTaskSnapshot;
  expanded: boolean;
  hasRequest: boolean;
  hasResult: boolean;
  onToggleExpanded: () => void;
  exportMode?: boolean;
  hideClaudePlanNotes?: boolean;
}) {
  return (
    <ConversationTaskProgressCard
      snapshot={snapshot}
      toolName={tool.name}
      expanded={expanded}
      exportMode={exportMode}
      hideClaudePlanNotes={hideClaudePlanNotes}
      onToggleExpanded={exportMode ? undefined : onToggleExpanded}
    >
      {!exportMode && expanded ? (
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
    </ConversationTaskProgressCard>
  );
}

function resolveInlinePlanApprovalRequest(
  tool: ResolvedToolCall,
  permissionRequests: SessionPermissionRequestDto[]
): SessionPermissionRequestDto | null {
  const normalizedToolName = tool.name.trim().toLowerCase();

  if (normalizedToolName !== "exitplanmode") {
    return null;
  }

  const inputText = tool.input?.trim() ?? "";

  return permissionRequests.find((request) => {
    if (request.kind !== "plan_approval" || request.status !== "pending") {
      return false;
    }

    if (request.toolName?.trim().toLowerCase() !== "exitplanmode") {
      return false;
    }

    if (!inputText) {
      return true;
    }

    return request.detail?.includes(inputText) ?? false;
  }) ?? null;
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

function renderApplyPatchSummaryStats(file: ApplyPatchFileChange) {
  if (!file.statsKnown) {
    return (
      <span className="apply-patch-summary-stats">
        <span className="apply-patch-summary-edited">{t("conversation.applyPatchEditedStat")}</span>
      </span>
    );
  }

  return (
    <span className="apply-patch-summary-stats">
      <span className="apply-patch-summary-added">+{file.additions}</span>
      <span className="apply-patch-summary-removed">-{file.deletions}</span>
    </span>
  );
}

function renderApplyPatchModalStats(file: ApplyPatchFileChange) {
  if (!file.statsKnown) {
    return (
      <span className="apply-patch-stat-pill neutral">
        {t("conversation.applyPatchEditedStat")}
      </span>
    );
  }

  return (
    <>
      <span className="apply-patch-stat-pill positive">
        {t("conversation.applyPatchAddedStat")} +{file.additions}
      </span>
      <span className="apply-patch-stat-pill negative">
        {t("conversation.applyPatchRemovedStat")} -{file.deletions}
      </span>
    </>
  );
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
  onForkMessage,
  forceExpanded = false,
  exportMode = false
}: {
  message: SessionMessageViewModel;
  kind: FoldedPromptKind;
  tone: "user-message" | "assistant-message" | "system-message";
  actionState: MessageActionState;
  onRetry: (clientRequestId: string) => void;
  onForkMessage?: ((message: SessionMessageViewModel) => Promise<void> | void) | null;
  forceExpanded?: boolean;
  exportMode?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = getFoldedPromptSummary(kind, message.content);
  const isUser = tone === "user-message";
  const resolvedExpanded = forceExpanded || expanded;
  const title =
    kind === "system_prompt"
      ? t("conversation.systemPromptTitle")
      : kind === "skill_context"
        ? t("conversation.skillContextTitle")
      : t("conversation.rulesMessageTitle");
  const hint =
    kind === "system_prompt"
      ? t("conversation.systemPromptHint")
      : kind === "skill_context"
        ? t("conversation.skillContextHint")
      : t("conversation.rulesMessageHint");
  const actionLabel =
    resolvedExpanded
      ? kind === "system_prompt"
        ? t("conversation.systemPromptCollapse")
        : kind === "skill_context"
          ? t("conversation.skillContextCollapse")
        : t("conversation.rulesMessageCollapse")
      : kind === "system_prompt"
        ? t("conversation.systemPromptExpand")
        : kind === "skill_context"
          ? t("conversation.skillContextExpand")
        : t("conversation.rulesMessageExpand");

    return (
      <article
        className={`message-item ${tone} rules-message-row`}
        data-message-id={message.id}
      >
      <div className="message-content-wrapper">
        <div className="rules-message-card">
          {forceExpanded ? (
            <div className="rules-message-toggle" aria-expanded={resolvedExpanded}>
              <div className="rules-message-heading">
                <span className="rules-message-badge">{title}</span>
                <span className="rules-message-summary">{summary}</span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="rules-message-toggle"
              aria-expanded={resolvedExpanded}
              onClick={() => setExpanded((current) => !current)}
            >
              <div className="rules-message-heading">
                <span className="rules-message-badge">{title}</span>
                <span className="rules-message-summary">{summary}</span>
              </div>
              <span className="rules-message-action">{actionLabel}</span>
            </button>
          )}

          <p className="rules-message-hint">{hint}</p>

          {resolvedExpanded && (
            <div className="rules-message-body">
              <MessageMarkdownBody
                content={message.content}
                className="message-text message-content markdown-content"
                exportMode={exportMode}
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
  interruptedSource = null,
  foldedPromptKind = null,
  actionState,
  onRetry,
  onForkMessage,
  assistantAvatar,
  exportMode = false,
  onSubmitStructuredQuestion
}: {
  message: SessionMessageViewModel;
  provider: ProviderId | null;
  interruptedSource?: SessionInterruptSource | null;
  foldedPromptKind?: FoldedPromptKind | null;
  actionState: MessageActionState;
  onRetry: (clientRequestId: string) => void;
  onForkMessage?: ((message: SessionMessageViewModel) => Promise<void> | void) | null;
  assistantAvatar?: ReactNode;
  exportMode?: boolean;
  onSubmitStructuredQuestion?: ((payload: { messageId: string; answers: Record<string, string[]> }) => Promise<void> | void) | null;
}) {
  const isUser = message.role === "user";
  const isThinking = message.kind === "thinking";
  const isAssistantText = message.role === "assistant" && message.kind === "text";
  const turnAborted =
    provider === "codex" && message.kind === "text"
      ? parseTurnAbortedMessage(message.content)
      : null;
  const promptKind: FoldedPromptKind | null =
    foldedPromptKind ??
    (looksLikeRulesMessage(provider, message.content)
      ? "rules"
      : looksLikeSkillContextMessage(provider, message.content)
        ? "skill_context"
        : null);
  const richContent = useMemo(() => parseMessageRichContent(message.content), [message.content]);
  const visibleContent = richContent.text;
  const inlineImages = richContent.inlineImages;
  const structuredQuestions = richContent.structuredQuestions;
  const subagentNotification = useMemo(
    () => (isUser ? parseSubagentNotificationMessage(message.content) : null),
    [isUser, message.content]
  );
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
          forceExpanded={exportMode}
          exportMode={exportMode}
        />
      );
  }

  if (turnAborted) {
    const abortedText = resolveTurnAbortedMessageText(interruptedSource);
    const displayText = turnAborted.detail ? `${abortedText}\n\n${turnAborted.detail}` : abortedText;

    return (
      <article className="message-item assistant-message" data-message-id={message.id}>
        <div className="message-avatar">{assistantAvatar ?? <DefaultAssistantAvatar />}</div>
        <div className="message-content-wrapper">
          <MessageMarkdownBody
            content={displayText}
            className="message-text message-content markdown-content"
            exportMode={exportMode}
          />
          <MessageMetadataBar
            text={displayText}
            canCopy={actionState.canCopy}
            canFork={false}
            onFork={null}
          />
        </div>
      </article>
    );
  }

  if (subagentNotification) {
    return (
      <SubagentNotificationReportCard
        message={message}
        snapshot={subagentNotification}
        actionState={actionState}
        onForkMessage={onForkMessage}
        exportMode={exportMode}
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
              exportMode={exportMode}
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
      <article
        className="message-item assistant-message thinking-message-row"
        data-message-id={message.id}
      >
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
              exportMode={exportMode}
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
              exportMode={exportMode}
            />
          )}
          {structuredQuestions ? (
            <StructuredQuestionPromptPreviewCard prompt={structuredQuestions} />
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
            <CopyableContentBlock language="text" content={visibleContent} exportMode={exportMode} />
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

const MemoizedMessageItem = memo(MessageItem, (previous, next) => {
  return previous.message === next.message
    && previous.provider === next.provider
    && previous.interruptedSource === next.interruptedSource
    && previous.foldedPromptKind === next.foldedPromptKind
    && previous.actionState === next.actionState
    && previous.onRetry === next.onRetry
    && previous.onForkMessage === next.onForkMessage
    && previous.assistantAvatar === next.assistantAvatar
    && previous.exportMode === next.exportMode
    && previous.onSubmitStructuredQuestion === next.onSubmitStructuredQuestion;
});

function StructuredQuestionPromptPreviewCard({
  prompt
}: {
  prompt: StructuredQuestionPrompt;
}) {
  return (
    <section className="permission-request-card permission-request-card-inline permission-request-card-readonly">
      <header className="permission-request-card-header">
        <div className="permission-request-provider">
          <div className="permission-request-provider-copy">
            <strong>{t("conversation.permissionQuestionPendingTitle")}</strong>
            <span>{t("conversation.permissionQuestionPendingDescription")}</span>
          </div>
        </div>
        <span className="permission-request-kind">{t("conversation.permissionRequestKindUserInput")}</span>
      </header>
      <div className="permission-request-card-body">
        <div className="permission-request-question-result-list">
          {prompt.questions.map((question) => (
            <div key={question.id} className="permission-request-question-result">
              <span>{question.question}</span>
              <strong>{t("conversation.permissionQuestionPendingEmpty")}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StructuredQuestionResultCard({
  prompt,
  tool
}: {
  prompt: StructuredQuestionPrompt;
  tool: ResolvedToolCall;
}) {
  const answers = resolveStructuredQuestionResultAnswers(prompt, tool);
  const hasAnswered = answers.some((answer) => Boolean(answer.answer.trim()));

  return (
    <section className="permission-request-card permission-request-card-inline permission-request-card-readonly">
      <header className="permission-request-card-header">
        <div className="permission-request-provider">
          <div className="permission-request-provider-copy">
            <strong>{hasAnswered ? t("conversation.permissionQuestionResultTitle") : t("conversation.permissionQuestionPendingTitle")}</strong>
            <span>{hasAnswered ? t("conversation.permissionQuestionResultDescription") : t("conversation.permissionQuestionPendingDescription")}</span>
          </div>
        </div>
        <span className="permission-request-kind">{t("conversation.permissionRequestKindUserInput")}</span>
      </header>
      <div className="permission-request-card-body">
        <div className="permission-request-question-result-list">
          {answers.map((answer) => (
            <div key={answer.questionId} className="permission-request-question-result">
              <span>{answer.question}</span>
              <strong>{answer.answer || t("conversation.permissionQuestionPendingEmpty")}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StructuredQuestionCard({
  messageId,
  prompt,
  onSubmit
}: {
  messageId: string;
  prompt: StructuredQuestionPrompt;
  onSubmit: (payload: { messageId: string; answers: Record<string, string[]> }) => Promise<void> | void;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const disableSubmit = prompt.questions.some(
    (question) =>
      (answers[question.id]?.filter(Boolean).length ?? 0) === 0 &&
      !otherAnswers[question.id]?.trim()
  );

  return (
    <section className="permission-request-card permission-request-card-inline">
      <header className="permission-request-card-header">
        <div className="permission-request-provider">
          <div className="permission-request-provider-copy">
            <strong>{t("conversation.permissionRequestQuestionsLabel")}</strong>
            <span>{t("conversation.permissionRequestSectionDescription")}</span>
          </div>
        </div>
        <span className="permission-request-kind">{t("conversation.permissionRequestKindUserInput")}</span>
      </header>

      <div className="permission-request-card-body">
        <div className="permission-request-block">
          <div className="permission-request-block-label">
            {t("conversation.permissionRequestQuestionsLabel")}
          </div>
          <div className="permission-request-question-list">
            {prompt.questions.map((question) => (
              <div key={`${messageId}:${question.id}`} className="permission-request-question">
                <div className="permission-request-question-header">{question.header}</div>
                <p>{question.question}</p>
                <div className="permission-request-question-options">
                  {question.options.map((option) => {
                    const checked = answers[question.id]?.includes(option.label) ?? false;
                    const inputType = question.multiSelect ? "checkbox" : "radio";

                    return (
                      <label key={`${question.id}:${option.label}`} className="permission-request-question-option">
                        <input
                          type={inputType}
                          name={`${messageId}:${question.id}`}
                          checked={checked}
                          onChange={() => {
                            setOtherAnswers((current) => ({
                              ...current,
                              [question.id]: ""
                            }));
                            setAnswers((current) => ({
                              ...current,
                              [question.id]: question.multiSelect
                                ? toggleStructuredQuestionAnswer(current[question.id] ?? [], option.label)
                                : [option.label]
                            }));
                          }}
                        />
                        <span>
                          <strong>{option.label}</strong>
                          {option.description ? <small>{option.description}</small> : null}
                        </span>
                      </label>
                    );
                  })}
                  {question.allowOther ? (
                    <label className="permission-request-question-option permission-request-question-option-other">
                      <input
                        type="radio"
                        name={`${messageId}:${question.id}`}
                        checked={Boolean(otherAnswers[question.id]?.trim())}
                        onChange={() => {
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: []
                          }));
                        }}
                      />
                      <span>
                        <strong>{t("conversation.permissionRequestQuestionOtherLabel")}</strong>
                        <input
                          className="permission-request-question-other-input"
                          type={question.secret ? "password" : "text"}
                          value={otherAnswers[question.id] ?? ""}
                          placeholder={t("conversation.permissionRequestQuestionOtherPlaceholder")}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setOtherAnswers((current) => ({
                              ...current,
                              [question.id]: value
                            }));
                            setAnswers((current) => ({
                              ...current,
                              [question.id]: []
                            }));
                          }}
                        />
                      </span>
                    </label>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="permission-request-card-footer">
        <button
          type="button"
          className="primary-button permission-request-action"
          disabled={submitting || disableSubmit}
          onClick={async () => {
            setSubmitting(true);

            try {
              await onSubmit({
                messageId,
                answers: mergeStructuredQuestionAnswers(answers, otherAnswers)
              });
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? t("conversation.permissionRequestSubmitting") : t("common.confirm")}
        </button>
      </footer>
    </section>
  );
}

function resolveStructuredQuestionResultAnswers(
  prompt: StructuredQuestionPrompt,
  tool: ResolvedToolCall
): Array<{ questionId: string; question: string; answer: string }> {
  const inputRecord = parseToolJsonObject(tool.input);
  const outputRecord = parseToolJsonObject(tool.output);
  const inputAnswers = isRecord(inputRecord?.answers) ? inputRecord.answers : null;
  const outputAnswers = isRecord(outputRecord?.answers) ? outputRecord.answers : null;
  const answersRecord = outputAnswers ?? inputAnswers;

  return prompt.questions.map((question, index) => {
    const value = answersRecord
      ? readStructuredQuestionAnswerValue(answersRecord, [
          question.question,
          question.id,
          String(index)
        ])
      : tool.output?.trim() ?? "";

    return {
      questionId: question.id,
      question: question.question,
      answer: value
    };
  });
}

function readStructuredQuestionAnswerValue(
  answers: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const raw = answers[key];

    if (Array.isArray(raw)) {
      const values = raw
        .map((item) => (typeof item === "string" || typeof item === "number" ? String(item).trim() : ""))
        .filter(Boolean);

      if (values.length > 0) {
        return values.join(", ");
      }
    }

    if (typeof raw === "string" || typeof raw === "number") {
      const value = String(raw).trim();

      if (value) {
        return value;
      }
    }
  }

  return "";
}

function resolveAskUserQuestionPrompt(tool: ResolvedToolCall): StructuredQuestionPrompt | null {
  if (tool.name.trim().toLowerCase() !== "askuserquestion") {
    return null;
  }

  const parsed = parseMessageRichContent(tool.input).structuredQuestions;

  if (!parsed) {
    return null;
  }

  return {
    questions: parsed.questions.map((question) => ({
      ...question,
      allowOther: true
    }))
  };
}

function toggleStructuredQuestionAnswer(values: string[], nextValue: string): string[] {
  if (values.includes(nextValue)) {
    return values.filter((value) => value !== nextValue);
  }

  return [...values, nextValue];
}

function mergeStructuredQuestionAnswers(
  selectedAnswers: Record<string, string[]>,
  otherAnswers: Record<string, string>
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};

  for (const [questionId, values] of Object.entries(selectedAnswers)) {
    const normalizedValues = values.filter(Boolean);

    if (normalizedValues.length > 0) {
      merged[questionId] = normalizedValues;
    }
  }

  for (const [questionId, value] of Object.entries(otherAnswers)) {
    const normalized = value.trim();

    if (normalized) {
      merged[questionId] = [normalized];
    }
  }

  return merged;
}

function renderRuntimeThinkingItem(item: Extract<TimelineRenderItem, { type: "runtime_thinking" }>) {
  return (
    <div
      key={item.key}
      className="timeline-status timeline-status-inline thinking-status-inline"
      data-runtime-thinking-placeholder="true"
    >
      <span
        className="status-text thinking-status-text"
        aria-label={item.label}
      >
        <span>{stripThinkingTrailingDots(item.label) || item.label}</span>
        <span className="thinking-status-dots" aria-hidden="true">...</span>
      </span>
    </div>
  );
}

function renderSessionErrorItem(item: Extract<TimelineRenderItem, { type: "session_error" }>) {
  return (
    <article
      key={item.key}
      className="message-item assistant-message session-runtime-error-row"
    >
      <div className="session-runtime-error-row__spacer" aria-hidden="true" />
      <section
        className="message-content-wrapper session-runtime-error-panel"
        role="status"
        aria-label={item.error.title}
      >
        <div className="session-runtime-error-panel__header">
          <div className="session-runtime-error-panel__title-group">
            <span className="session-runtime-error-panel__dot" aria-hidden="true" />
            <strong>{item.error.title}</strong>
          </div>
          {item.error.code ? (
            <code className="session-runtime-error-panel__code">{item.error.code}</code>
          ) : null}
        </div>
        {item.error.summary ? (
          <p className="session-runtime-error-panel__summary">
            {tokenizeSessionErrorSummary(item.error.summary).map((segment, index) => {
              if (segment.type === "text") {
                return <span key={`${item.key}:text:${index}`}>{segment.text}</span>;
              }

              return (
                <mark
                  key={`${item.key}:${segment.type}:${index}`}
                  className={`session-runtime-error-panel__summary-token session-runtime-error-panel__summary-token--${segment.type}`}
                >
                  {segment.text}
                </mark>
              );
            })}
          </p>
        ) : null}
      </section>
    </article>
  );
}

function renderRuntimeNoticeItem(item: Extract<TimelineRenderItem, { type: "runtime_notice" }>) {
  return (
    <article key={item.key} className="message-item assistant-message">
      <div className="message-avatar"><DefaultAssistantAvatar /></div>
      <section className="permission-request-card permission-request-card-inline permission-request-card-readonly runtime-notice-card">
        <header className="permission-request-card-header">
          <div className="permission-request-provider">
            <div className="permission-request-provider-copy">
              <strong>{item.notice.title}</strong>
              <span>{t("conversation.runtimeNoticeDescription")}</span>
            </div>
          </div>
          <span className="permission-request-kind">{item.notice.kindLabel}</span>
        </header>
        <div className="permission-request-card-body">
          <p className="permission-request-summary">{item.notice.summary}</p>
        </div>
      </section>
    </article>
  );
}

export function ConversationTranscriptExport({
  sessionId,
  sessionSummary = null,
  workspaceId = null,
  workspacePath = null,
  items,
  provider,
  interruptedSource = null,
  assistantAvatar
}: {
  sessionId?: string;
  sessionSummary?: SessionSummaryDto | null;
  workspaceId?: string | null;
  workspacePath?: string | null;
  items: ConversationTimelineSourceItem[];
  provider: ProviderId | null;
  interruptedSource?: SessionInterruptSource | null;
  assistantAvatar?: ReactNode;
}) {
  const timelineViewModel = useMemo(
    () => buildTimelineViewModel({
      sessionSummary,
      items,
      provider
    }),
    [items, provider, sessionSummary]
  );
  const renderItems = timelineViewModel.renderItems;
  const leadingSystemPromptMessageIds = timelineViewModel.leadingSystemPromptMessageIds;

  return (
    <section className="message-timeline message-timeline-export" aria-label={t("conversation.exportPrintContainerTitle")}>
      <div className="message-list message-list-export" data-export-mode="true">
        {renderItems.length === 0 ? (
          <div className="timeline-empty">
            <p className="status-text">{t("conversation.timelineEmpty")}</p>
          </div>
        ) : null}

        {renderItems.map((item) =>
          item.type === "tool_group" ? (
            <article key={item.key} className="message-item tool-message-row">
              <MemoizedToolCallItem
                group={item.group}
                sessionId={sessionId}
                workspaceId={workspaceId}
                workspacePath={workspacePath}
                exportMode
                onSubmitStructuredQuestion={null}
              />
            </article>
          ) : item.type === "runtime_thinking" ? (
            renderRuntimeThinkingItem(item)
          ) : item.type === "runtime_notice" ? (
            renderRuntimeNoticeItem(item)
          ) : item.type === "session_error" ? (
            renderSessionErrorItem(item)
          ) : (
            <MemoizedMessageItem
              key={item.key}
              message={item.message}
              provider={provider}
              foldedPromptKind={
                leadingSystemPromptMessageIds.has(item.message.id)
                  ? "system_prompt"
                  : null
              }
              actionState={DEFAULT_MESSAGE_ACTION_STATE}
              onRetry={() => undefined}
              onForkMessage={null}
              interruptedSource={interruptedSource}
              assistantAvatar={assistantAvatar}
              exportMode
            />
          )
        )}
      </div>
    </section>
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
  sessionSummary = null,
  workspaceId = null,
  workspacePath = null,
  items,
  historyState,
  loadingOlderMessages = false,
  hasOlderMessages = false,
  onLoadOlderMessages = () => {},
  onRetryMessage,
  onForkMessage,
  provider,
  interruptedSource = null,
  assistantAvatar,
  followTailUpdates = false,
  onSubmitStructuredQuestion,
  permissionRequests = [],
  replyingPermissionRequestId = null
}: MessageTimelineProps) {
  const { showToast } = useToast();
  const platform = usePlatform();
  const persistScrollState = !followTailUpdates;
  const listRef = useRef<HTMLDivElement | null>(null);
  useTransientScrollbarVisibility(listRef);
  const previousSessionIdRef = useRef(sessionId);
  const previousMessageCountRef = useRef(0);
  const previousLastMessageSignatureRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const pendingOlderLoadOffsetRef = useRef<number | null>(null);
  const pendingOlderLoadHeadSignatureRef = useRef<string | null>(null);
  const olderLoadLockRef = useRef(false);
  const pendingRestoreStateRef = useRef(
    followTailUpdates ? null : readPersistedConversationScrollState(sessionId)
  );
  const restoredTailSignatureRef = useRef<string | null>(
    followTailUpdates
      ? null
      : readPersistedConversationScrollState(sessionId)?.lastMessageSignature ?? null
  );
  const currentScrollStateRef = useRef(
    followTailUpdates ? null : readPersistedConversationScrollState(sessionId)
  );
  const scrollPersistTimerRef = useRef<number | null>(null);
  const manualRestoreTimerRef = useRef<number | null>(null);
  const manualRestoreTargetRef = useRef<number | null>(null);
  const manualRestoreDeadlineRef = useRef(0);
  const manualRestoreInProgressRef = useRef(false);
  const lastProgrammaticRestoreScrollTopRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const previousRuntimeThinkingPlaceholderRef = useRef<string | null>(null);
  const renderCycleIdRef = useRef(0);
  const renderCountForSessionRef = useRef(0);
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const hasNewMessagesBelowRef = useRef(false);
  const previousRenderMessageIdsRef = useRef<string[] | null>(null);
  const manualRestoreDurationMs = platform.isMobile ? 0 : MANUAL_RESTORE_DURATION_MS;
  const deferredItems = useDeferredValue(items);
  const deferredSessionSummary = useDeferredValue(sessionSummary);
  const messages = useMemo(
    () => extractConversationTimelineMessages(deferredItems),
    [deferredItems]
  );
  const runtimeThinkingPlaceholder = useMemo(
    () => findConversationTimelineRuntimeThinkingLabel(deferredItems),
    [deferredItems]
  );
  const timelineViewModel = useMemo(
    () => buildTimelineViewModel({
      sessionSummary: deferredSessionSummary,
      items: deferredItems,
      provider
    }),
    [deferredItems, deferredSessionSummary, provider]
  );
  const visibleMessages = timelineViewModel.visibleMessages;
  const renderItems = timelineViewModel.renderItems;
  const leadingSystemPromptMessageIds = timelineViewModel.leadingSystemPromptMessageIds;
  const actionStateByMessageId = timelineViewModel.actionStateByMessageId;
  const showTimelineSkeleton = historyState === "loading" && messages.length === 0;

  useEffect(() => {
    renderCycleIdRef.current += 1;
    renderCountForSessionRef.current = 0;
    logPerfDebug("timeline.session_cycle.start", {
      sessionId,
      renderCycleId: renderCycleIdRef.current,
      followTailUpdates,
      historyState,
      rawMessagesLength: messages.length,
      visibleMessagesLength: visibleMessages.length,
      renderItemsLength: renderItems.length
    });
  }, [sessionId]);

  function summarizeMessageSignature(signature: string | null): Record<string, unknown> | null {
    if (!signature) {
      return null;
    }

    try {
      const parsed = JSON.parse(signature) as {
        type?: unknown;
        key?: unknown;
        id?: unknown;
        timestamp?: unknown;
        deliveryState?: unknown;
        content?: unknown;
        label?: unknown;
        summary?: unknown;
        messageIds?: unknown;
        attachments?: unknown;
        toolCall?: {
          status?: unknown;
          output?: unknown;
          error?: unknown;
        } | null;
      };

      return {
        type: typeof parsed.type === "string" ? parsed.type : "message",
        key: typeof parsed.key === "string" ? parsed.key : null,
        id: typeof parsed.id === "string" ? parsed.id : null,
        timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : null,
        deliveryState: typeof parsed.deliveryState === "string" ? parsed.deliveryState : null,
        contentLength: typeof parsed.content === "string" ? parsed.content.length : 0,
        labelLength: typeof parsed.label === "string" ? parsed.label.length : 0,
        summaryLength: typeof parsed.summary === "string" ? parsed.summary.length : 0,
        messageIdCount: Array.isArray(parsed.messageIds) ? parsed.messageIds.length : 0,
        attachmentCount: Array.isArray(parsed.attachments) ? parsed.attachments.length : 0,
        toolStatus: typeof parsed.toolCall?.status === "string" ? parsed.toolCall.status : null,
        hasToolOutput:
          typeof parsed.toolCall?.output === "string" ? parsed.toolCall.output.length > 0 : false,
        hasToolError:
          typeof parsed.toolCall?.error === "string" ? parsed.toolCall.error.length > 0 : false
      };
    } catch {
      return {
        parseError: true,
        length: signature.length
      };
    }
  }

  function summarizeTimelineMessage(
    message: SessionMessageViewModel
  ): Record<string, unknown> {
    return {
      id: message.id,
      rawRef: message.rawRef,
      role: message.role,
      kind: message.kind,
      deliveryState: message.deliveryState,
      timestamp: message.timestamp,
      sequence: message.sequence,
      attachmentCount: message.attachments?.length ?? 0,
      contentPreview:
        parseMessageRichContent(message.content).text.replace(/\r\n/g, "\n").trimEnd().slice(0, 120)
    };
  }

  function summarizeTimelineRenderItem(
    item: TimelineRenderItem
  ): Record<string, unknown> {
    if (item.type === "message") {
      return {
        type: item.type,
        key: item.key,
        message: summarizeTimelineMessage(item.message)
      };
    }

    if (item.type === "runtime_thinking") {
      return {
        type: item.type,
        key: item.key,
        labelPreview: item.label.slice(0, 80)
      };
    }

    if (item.type === "session_error") {
      return {
        type: item.type,
        key: item.key,
        code: item.error.code,
        summary: item.error.summary
      };
    }

    if (item.type === "runtime_notice") {
      return {
        type: item.type,
        key: item.key,
        summary: item.notice.summary
      };
    }

    return {
      type: item.type,
      key: item.key,
      callId: item.group.tool.callId,
      name: item.group.tool.name,
      hasRequest: item.group.hasRequest,
      hasResult: item.group.hasResult,
      updatedAt: item.group.updatedAt
    };
  }

  function summarizeDomRect(
    list: HTMLDivElement,
    element: HTMLElement
  ): Record<string, unknown> {
    const listRect = list.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const visibleTop = Math.max(elementRect.top, listRect.top);
    const visibleBottom = Math.min(elementRect.bottom, listRect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);

    return {
      top: Math.round(elementRect.top),
      bottom: Math.round(elementRect.bottom),
      height: Math.round(elementRect.height),
      relativeTop: Math.round(elementRect.top - listRect.top),
      relativeBottom: Math.round(elementRect.bottom - listRect.top),
      bottomGap: Math.round(listRect.bottom - elementRect.bottom),
      visibleHeight: Math.round(visibleHeight),
      fullyVisible:
        elementRect.top >= listRect.top
        && elementRect.bottom <= listRect.bottom
    };
  }

  function summarizeTimelineDomItem(
    list: HTMLDivElement,
    element: HTMLElement
  ): Record<string, unknown> {
    const messageId = element.dataset.messageId ?? null;
    const message = messageId
      ? visibleMessages.find((item) => item.id === messageId) ?? null
      : null;

    return {
      messageId,
      role: message?.role ?? null,
      kind: message?.kind ?? null,
      className: element.className,
      textLength: element.textContent?.length ?? 0,
      rect: summarizeDomRect(list, element)
    };
  }

  function summarizeTimelineDom(list: HTMLDivElement | null): Record<string, unknown> | null {
    if (!list) {
      return null;
    }

    const listRect = list.getBoundingClientRect();
    const messageElements = Array.from(list.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains("message-item")
    );
    const runtimeThinkingElement = list.querySelector<HTMLElement>(
      "[data-runtime-thinking-placeholder='true']"
    );

    return {
      listRect: {
        top: Math.round(listRect.top),
        bottom: Math.round(listRect.bottom),
        height: Math.round(listRect.height)
      },
      messageElementCount: messageElements.length,
      tailDomItems: messageElements.slice(-5).map((element) =>
        summarizeTimelineDomItem(list, element)
      ),
      runtimeThinkingPlaceholderDom: runtimeThinkingElement
        ? {
            textLength: runtimeThinkingElement.textContent?.length ?? 0,
            rect: summarizeDomRect(list, runtimeThinkingElement)
          }
        : null
    };
  }

  function buildTimelineScrollDebugDetail(
    list: HTMLDivElement | null,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const firstMessage = visibleMessages[0] ?? null;
    const lastMessage = visibleMessages.at(-1) ?? null;
    const tailItem = renderItems.at(-1) ?? null;
    const pendingRestoreState = pendingRestoreStateRef.current;
    const currentScrollState = currentScrollStateRef.current;
    const distanceToBottom =
      list ? list.scrollHeight - list.clientHeight - list.scrollTop : null;

    return {
      sessionId,
      historyState,
      followTailUpdates,
      messagesLength: visibleMessages.length,
      rawMessagesLength: messages.length,
      renderItemsLength: renderItems.length,
      firstMessageId: firstMessage?.id ?? null,
      firstMessageRole: firstMessage?.role ?? null,
      lastMessageId: lastMessage?.id ?? null,
      lastMessageRole: lastMessage?.role ?? null,
      lastMessageKind: lastMessage?.kind ?? null,
      lastMessageTimestamp: lastMessage?.timestamp ?? null,
      runtimeThinkingPlaceholderVisible: Boolean(runtimeThinkingPlaceholder),
      runtimeThinkingPlaceholderLength: runtimeThinkingPlaceholder?.length ?? 0,
      runtimeThinkingPlaceholderPreview: runtimeThinkingPlaceholder?.slice(0, 80) ?? null,
      tailItemType: tailItem?.type ?? null,
      tailItemKey: tailItem?.key ?? null,
      tailToolCallId:
        tailItem && tailItem.type === "tool_group" ? tailItem.group.tool.callId : null,
      scrollTop: list?.scrollTop ?? null,
      scrollHeight: list?.scrollHeight ?? null,
      clientHeight: list?.clientHeight ?? null,
      distanceToBottom,
      stickToBottomRef: stickToBottomRef.current,
      hasNewMessagesBelow: hasNewMessagesBelowRef.current,
      previousMessageCount: previousMessageCountRef.current,
      previousLastMessage: summarizeMessageSignature(previousLastMessageSignatureRef.current),
      hiddenMessageIds: timelineViewModel.hiddenMessageIds,
      validationIssues: timelineViewModel.validationIssues,
      tailMessages: visibleMessages.slice(-5).map(summarizeTimelineMessage),
      tailRenderItems: renderItems.slice(-5).map(summarizeTimelineRenderItem),
      dom: summarizeTimelineDom(list),
      pendingRestoreState:
        pendingRestoreState === null
          ? null
          : {
              scrollTop: pendingRestoreState.scrollTop,
              stickToBottom: pendingRestoreState.stickToBottom,
              lastMessage: summarizeMessageSignature(pendingRestoreState.lastMessageSignature)
            },
      currentScrollState:
        currentScrollState === null
          ? null
          : {
              scrollTop: currentScrollState.scrollTop,
              stickToBottom: currentScrollState.stickToBottom,
              lastMessage: summarizeMessageSignature(currentScrollState.lastMessageSignature)
            },
      restoredTailMessage: summarizeMessageSignature(restoredTailSignatureRef.current),
      ...extra
    };
  }

  function emitTimelineScrollDebug(
    scope: string,
    list: HTMLDivElement | null,
    extra: Record<string, unknown> = {}
  ) {
    if (!isTimelineScrollDebugEnabled()) {
      return;
    }

    logTimelineScrollDebug(scope, buildTimelineScrollDebugDetail(list, extra));
  }

  function buildPersistedTailMessageSignature(): string | null {
    return buildMessageSignature(visibleMessages.at(-1) ?? null);
  }

  function buildCurrentScrollState(list: HTMLDivElement) {
    const distanceToBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
    const stickToBottom = distanceToBottom <= STICK_TO_BOTTOM_DISTANCE_PX;

    return {
      scrollTop: list.scrollTop,
      stickToBottom,
      lastMessageSignature:
        hasNewMessagesBelowRef.current && !stickToBottom
          ? restoredTailSignatureRef.current
          : buildPersistedTailMessageSignature()
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
      restoredTailSignatureRef.current = buildPersistedTailMessageSignature();
      setHasNewMessagesBelow(false);
    }
    setShowScrollToBottomButton(
      renderItems.length > 0
      && (
        distanceToBottom > SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX
        || hasNewMessagesBelowRef.current
      )
    );
    rememberCurrentScrollState(list);
    emitTimelineScrollDebug("affordance.sync", list, {
      distanceToBottom,
      nextStickToBottom
    });
  }

  function persistCurrentScrollState(list: HTMLDivElement | null = listRef.current) {
    if (!persistScrollState) {
      return;
    }

    if (list) {
      rememberCurrentScrollState(list);
    }

    if (!currentScrollStateRef.current) {
      return;
    }

    persistConversationScrollState(sessionId, currentScrollStateRef.current);
  }

  function persistCachedScrollState(targetSessionId: string) {
    if (!persistScrollState) {
      return;
    }

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
    if (!persistScrollState) {
      return;
    }

    clearPersistScrollTimer();
    scrollPersistTimerRef.current = window.setTimeout(() => {
      scrollPersistTimerRef.current = null;
      persistCurrentScrollState();
    }, SCROLL_STATE_PERSIST_DELAY_MS);
  }

  function jumpToBottom(
    list: HTMLDivElement,
    reason: string,
    extra: Record<string, unknown> = {}
  ) {
    emitTimelineScrollDebug("jump_to_bottom.before", list, {
      reason,
      ...extra
    });
    list.scrollTop = list.scrollHeight;
    emitTimelineScrollDebug("jump_to_bottom.after", list, {
      reason,
      ...extra
    });
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
    lastProgrammaticRestoreScrollTopRef.current = null;
  }

  function applyManualRestorePosition(list: HTMLDivElement, targetScrollTop: number) {
    const maxScrollableTop = Math.max(0, list.scrollHeight - list.clientHeight);
    const nextScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollableTop));

    lastProgrammaticRestoreScrollTopRef.current = nextScrollTop;
    list.scrollTop = nextScrollTop;
    stickToBottomRef.current = false;
    emitTimelineScrollDebug("manual_restore.apply", list, {
      targetScrollTop,
      maxScrollableTop,
      nextScrollTop
    });
    setShowScrollToBottomButton(
      renderItems.length > 0
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
    if (manualRestoreDurationMs <= 0) {
      applyManualRestorePosition(list, targetScrollTop);
      finishManualRestore();
      return;
    }

    manualRestoreInProgressRef.current = true;
    manualRestoreTargetRef.current = targetScrollTop;
    manualRestoreDeadlineRef.current = Date.now() + manualRestoreDurationMs;
    applyManualRestorePosition(list, targetScrollTop);
    scheduleManualRestoreFrame();
  }

  function interruptManualRestore() {
    if (!manualRestoreInProgressRef.current) {
      return;
    }

    emitTimelineScrollDebug("manual_restore.interrupt", listRef.current);
    finishManualRestore();
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
    pendingOlderLoadHeadSignatureRef.current = buildMessageSignature(renderItems[0] ?? null);
    emitTimelineScrollDebug("older_history.prefetch", list, {
      pendingOlderLoadOffset: pendingOlderLoadOffsetRef.current,
      pendingOlderLoadHeadMessage: summarizeMessageSignature(pendingOlderLoadHeadSignatureRef.current)
    });
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
      const previousSessionId = previousSessionIdRef.current;

      persistCachedScrollState(previousSessionId);
      previousSessionIdRef.current = sessionId;
      previousMessageCountRef.current = 0;
      previousLastMessageSignatureRef.current = null;
      pendingRestoreStateRef.current = followTailUpdates
        ? null
        : readPersistedConversationScrollState(sessionId);
      restoredTailSignatureRef.current = pendingRestoreStateRef.current?.lastMessageSignature ?? null;
      currentScrollStateRef.current = pendingRestoreStateRef.current;
      stickToBottomRef.current = followTailUpdates
        ? true
        : pendingRestoreStateRef.current?.stickToBottom ?? true;
      pendingOlderLoadOffsetRef.current = null;
      pendingOlderLoadHeadSignatureRef.current = null;
      finishManualRestore();
      hasNewMessagesBelowRef.current = false;
      setHasNewMessagesBelow(false);
      setShowScrollToBottomButton(false);
      emitTimelineScrollDebug("session.switch", listRef.current, {
        previousSessionId,
        nextSessionId: sessionId
      });
    }
  }, [followTailUpdates, persistScrollState, sessionId]);

  useLayoutEffect(() => {
    return () => {
      clearPersistScrollTimer();
      finishManualRestore();
      persistCachedScrollState(previousSessionIdRef.current);
    };
  }, [persistScrollState, sessionId]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const currentTailRenderSignature = buildMessageSignature(renderItems.at(-1) ?? null);
    const currentPersistedTailSignature = buildPersistedTailMessageSignature();

    if (!list) {
      previousMessageCountRef.current = renderItems.length;
      previousLastMessageSignatureRef.current = currentTailRenderSignature;
      return;
    }

    const previousCount = previousMessageCountRef.current;
    const previousLastSignature = previousLastMessageSignatureRef.current;
    const pendingRestoreState = pendingRestoreStateRef.current;
    const hasTailUpdate =
      previousCount === 0 ||
      renderItems.length !== previousCount ||
      currentTailRenderSignature !== previousLastSignature;

    emitTimelineScrollDebug("messages.effect.start", list, {
      previousCount,
      previousLastMessage: summarizeMessageSignature(previousLastSignature),
      currentLastMessage: summarizeMessageSignature(currentTailRenderSignature),
      currentPersistedTailMessage: summarizeMessageSignature(currentPersistedTailSignature),
      hasTailUpdate
    });

    // 会话切回来时先恢复阅读位置；是否有新消息是另一件事，用 NEW 提示，不要强行把用户踢到底部。
    if (pendingRestoreState && historyState === "ready") {
      const hasTailUpdates =
        !pendingRestoreState.stickToBottom
        && pendingRestoreState.lastMessageSignature !== null
        && currentPersistedTailSignature !== null
        && pendingRestoreState.lastMessageSignature !== currentPersistedTailSignature;

      if (pendingRestoreState.stickToBottom) {
        finishManualRestore();
        jumpToBottom(list, "restore_ready_stick_to_bottom", {
          hasTailUpdates
        });
      } else {
        startManualRestore(pendingRestoreState.scrollTop, list);
        emitTimelineScrollDebug("restore_ready.manual", list, {
          hasTailUpdates,
          targetScrollTop: pendingRestoreState.scrollTop
        });
      }

      hasNewMessagesBelowRef.current = hasTailUpdates;
      restoredTailSignatureRef.current = pendingRestoreState.lastMessageSignature;
      setHasNewMessagesBelow(hasTailUpdates);
      pendingRestoreStateRef.current = null;
      syncScrollAffordance(list);
      previousMessageCountRef.current = renderItems.length;
      previousLastMessageSignatureRef.current = currentTailRenderSignature;
      rememberCurrentScrollState(list);
      return;
    }

    if (pendingRestoreState && historyState === "error") {
      if (pendingRestoreState.stickToBottom) {
        finishManualRestore();
        jumpToBottom(list, "restore_error_stick_to_bottom");
      } else {
        startManualRestore(pendingRestoreState.scrollTop, list);
        emitTimelineScrollDebug("restore_error.manual", list, {
          targetScrollTop: pendingRestoreState.scrollTop
        });
      }

      pendingRestoreStateRef.current = null;
      syncScrollAffordance(list);
      previousMessageCountRef.current = renderItems.length;
      previousLastMessageSignatureRef.current = currentTailRenderSignature;
      rememberCurrentScrollState(list);
      return;
    }

    if (manualRestoreInProgressRef.current) {
      applyManualRestorePosition(list, manualRestoreTargetRef.current ?? list.scrollTop);
      previousMessageCountRef.current = renderItems.length;
      previousLastMessageSignatureRef.current = currentTailRenderSignature;
      rememberCurrentScrollState(list);
      return;
    }

    const currentHeadSignature = buildMessageSignature(renderItems[0] ?? null);
    const pendingOlderLoadOffset = pendingOlderLoadOffsetRef.current;
    const pendingOlderLoadHeadSignature = pendingOlderLoadHeadSignatureRef.current;
    const shouldRestoreOlderLoadOffset =
      pendingOlderLoadOffset !== null
      && !loadingOlderMessages
      && pendingOlderLoadHeadSignature !== null
      && pendingOlderLoadHeadSignature !== currentHeadSignature
      && renderItems.length >= previousCount;
    const shouldFollowTailUpdate =
      hasTailUpdate
      && (followTailUpdates || stickToBottomRef.current);

    emitTimelineScrollDebug("messages.effect.decision", list, {
      currentHeadMessage: summarizeMessageSignature(currentHeadSignature),
      pendingOlderLoadOffset,
      pendingOlderLoadHeadMessage: summarizeMessageSignature(pendingOlderLoadHeadSignature),
      shouldRestoreOlderLoadOffset,
      shouldFollowTailUpdate,
      loadingOlderMessages
    });

    if (shouldRestoreOlderLoadOffset) {
      list.scrollTop = Math.max(0, list.scrollHeight - pendingOlderLoadOffset);
      pendingOlderLoadOffsetRef.current = null;
      pendingOlderLoadHeadSignatureRef.current = null;
    } else if (pendingOlderLoadOffsetRef.current !== null && !loadingOlderMessages) {
      pendingOlderLoadOffsetRef.current = null;
      pendingOlderLoadHeadSignatureRef.current = null;
      if (shouldFollowTailUpdate) {
        // 并行 pane 是观察面板，尾部有更新时必须跟上最新输出。
        jumpToBottom(list, "older_load_offset_cleared_follow_tail", {
          pendingOlderLoadOffset
        });
      }
    } else if (shouldFollowTailUpdate) {
      jumpToBottom(list, "tail_update_follow");
    }

    syncScrollAffordance(list);
    previousMessageCountRef.current = renderItems.length;
    previousLastMessageSignatureRef.current = currentTailRenderSignature;
  }, [historyState, loadingOlderMessages, renderItems, sessionId]);

  useEffect(() => {
    if (!hasOlderMessages) {
      olderLoadLockRef.current = false;
      return;
    }

    if (!loadingOlderMessages && pendingOlderLoadOffsetRef.current === null) {
      olderLoadLockRef.current = false;
    }
  }, [hasOlderMessages, loadingOlderMessages, visibleMessages.length]);

  useLayoutEffect(() => {
    const previousPlaceholder = previousRuntimeThinkingPlaceholderRef.current;

    if (previousPlaceholder === runtimeThinkingPlaceholder) {
      return;
    }

    emitTimelineScrollDebug("runtime_thinking.placeholder_change", listRef.current, {
      previousVisible: Boolean(previousPlaceholder),
      nextVisible: Boolean(runtimeThinkingPlaceholder),
      previousLength: previousPlaceholder?.length ?? 0,
      nextLength: runtimeThinkingPlaceholder?.length ?? 0,
      note:
        "Codex 思考中占位符已经并入统一 timeline source item 列表；调试时直接看 renderItems 尾部即可。"
    });
    previousRuntimeThinkingPlaceholderRef.current = runtimeThinkingPlaceholder;
  }, [runtimeThinkingPlaceholder, sessionId]);

  useEffect(() => {
    const list = listRef.current;

    if (!isTimelineScrollDebugEnabled() || !list || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      emitTimelineScrollDebug("list.resize", list);
    });

    observer.observe(list);

    return () => {
      observer.disconnect();
    };
  }, [sessionId, visibleMessages.length]);

  useEffect(() => {
    renderCountForSessionRef.current += 1;
    logPerfDebug("timeline.render_cycle", {
      sessionId,
      renderCycleId: renderCycleIdRef.current,
      renderCountForSession: renderCountForSessionRef.current,
      followTailUpdates,
      historyState,
      rawMessagesLength: messages.length,
      visibleMessagesLength: visibleMessages.length,
      renderItemsLength: renderItems.length,
      hiddenMessageCount: timelineViewModel.hiddenMessageIds.length,
      validationIssueCount: timelineViewModel.validationIssues.length,
      tailItemType: renderItems.at(-1)?.type ?? null
    });

    const currentRenderMessageIds = collectRenderItemMessageIds(renderItems);
    const assistantRenderMoves = collectAssistantRenderMoves(
      previousRenderMessageIdsRef.current,
      currentRenderMessageIds,
      visibleMessages
    );
    const shouldLogRenderState =
      timelineViewModel.hiddenMessageIds.length > 0
      || timelineViewModel.validationIssues.length > 0
      || assistantRenderMoves.length > 0;

    if (shouldLogRenderState) {
      logConversationTimelineDebug("timeline.render", {
        sessionId,
        hiddenMessageIds: timelineViewModel.hiddenMessageIds,
        validationIssues: timelineViewModel.validationIssues,
        assistantRenderMoves,
        rawTailMessages: messages.slice(-6).map(summarizeTimelineMessage),
        visibleTailMessages: visibleMessages.slice(-6).map(summarizeTimelineMessage),
        renderTailItems: renderItems.slice(-6).map(summarizeTimelineRenderItem)
      });
    }

    previousRenderMessageIdsRef.current = currentRenderMessageIds;
  }, [messages, renderItems, sessionId, timelineViewModel.hiddenMessageIds, timelineViewModel.validationIssues, visibleMessages]);

  function handleScroll() {
    const list = listRef.current;

    if (!list) {
      return;
    }

    if (manualRestoreInProgressRef.current) {
      const lastProgrammaticScrollTop = lastProgrammaticRestoreScrollTopRef.current;

      if (
        lastProgrammaticScrollTop !== null
        && Math.abs(list.scrollTop - lastProgrammaticScrollTop) <= 1
      ) {
        lastProgrammaticRestoreScrollTopRef.current = null;
      } else {
        // 只要用户滚出了程序最后一次写入的位置，就说明用户已经接管，不再继续强制恢复。
        interruptManualRestore();
      }
    }

    syncScrollAffordance(list);
    schedulePersistCurrentScrollState();
    emitTimelineScrollDebug("scroll", list);

    if (
      triggerOlderMessagesPrefetch(list)
    ) {
      return;
    }
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.deltaY !== 0) {
      // 用户已经主动接管滚动，不要再把列表强拉回记忆位置。
      interruptManualRestore();
    }

    if (event.deltaY >= 0) {
      return;
    }

    const list = listRef.current;

    if (!list) {
      return;
    }

    triggerOlderMessagesPrefetch(list);
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    interruptManualRestore();
    touchStartYRef.current = event.touches[0]?.clientY ?? null;
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    const startY = touchStartYRef.current;
    const currentY = event.touches[0]?.clientY ?? null;

    if (startY === null || currentY === null) {
      return;
    }

    if (currentY - startY < OLDER_HISTORY_TOUCH_DRAG_THRESHOLD_PX) {
      return;
    }

    interruptManualRestore();

    const list = listRef.current;

    if (!list) {
      return;
    }

    triggerOlderMessagesPrefetch(list);
  }

  function handleTouchEnd() {
    touchStartYRef.current = null;
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
        data-scrollbar-autohide="true"
        onScroll={handleScroll}
        onPointerDown={interruptManualRestore}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
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
              <MemoizedToolCallItem
                group={item.group}
                sessionId={sessionId}
                workspaceId={workspaceId}
                workspacePath={workspacePath}
                onSubmitStructuredQuestion={onSubmitStructuredQuestion}
                permissionRequests={permissionRequests}
                replyingPermissionRequestId={replyingPermissionRequestId}
              />
            </article>
          ) : item.type === "runtime_thinking" ? (
            renderRuntimeThinkingItem(item)
          ) : item.type === "runtime_notice" ? (
            renderRuntimeNoticeItem(item)
          ) : item.type === "session_error" ? (
            renderSessionErrorItem(item)
          ) : (
            <MemoizedMessageItem
              key={item.key}
              message={item.message}
              provider={provider}
              foldedPromptKind={
                leadingSystemPromptMessageIds.has(item.message.id)
                  ? "system_prompt"
                  : null
              }
              actionState={
                actionStateByMessageId.get(item.message.id)
                ?? (item.message.role === "user"
                  ? DEFAULT_USER_MESSAGE_ACTION_STATE
                  : DEFAULT_MESSAGE_ACTION_STATE)
              }
              onRetry={onRetryMessage}
              onForkMessage={onForkMessage}
              interruptedSource={interruptedSource}
              assistantAvatar={assistantAvatar}
              onSubmitStructuredQuestion={onSubmitStructuredQuestion}
            />
          )
        )}
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
            jumpToBottom(list, "scroll_button_click");
            hasNewMessagesBelowRef.current = false;
            restoredTailSignatureRef.current = buildPersistedTailMessageSignature();
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

function buildMessageSignature(
  item: SessionMessageViewModel | TimelineRenderItem | null
): string | null {
  if (!item) {
    return null;
  }

  if ("type" in item) {
    if (item.type === "message") {
      return buildMessageSignature(item.message);
    }

    if (item.type === "tool_group") {
      return JSON.stringify({
        type: item.type,
        key: item.key,
        messageIds: item.group.messageIds,
        timestamp: item.group.updatedAt,
        toolCall: {
          status: item.group.tool.status,
          output: item.group.tool.output,
          error: item.group.tool.error
        }
      });
    }

    if (item.type === "runtime_thinking") {
      return JSON.stringify({
        type: item.type,
        key: item.key,
        label: item.label
      });
    }

    if (item.type === "runtime_notice") {
      return JSON.stringify({
        type: item.type,
        key: item.key,
        title: item.notice.title,
        summary: item.notice.summary,
        kindLabel: item.notice.kindLabel
      });
    }

    return JSON.stringify({
      type: item.type,
      key: item.key,
      summary: item.error.summary,
      code: item.error.code
    });
  }

  return JSON.stringify({
    type: "message",
    id: item.id,
    content: item.content,
    attachments: item.attachments,
    timestamp: item.timestamp,
    deliveryState: item.deliveryState,
    toolCall: item.toolCall
      ? {
          status: item.toolCall.status,
          output: item.toolCall.output,
          error: item.toolCall.error
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

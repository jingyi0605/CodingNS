import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { HistoryPage, ProviderId, SyncStatus } from "@codingns/session-sync-core";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import type {
  SessionActivitySource,
  SessionActivityState,
  SessionRunningState,
  SessionProviderConfigMode,
  SessionBinding
} from "../../types/domain.js";
import type { SessionProviderConfigService } from "../sessions/session-provider-config-service.js";
import type { WorkspaceService } from "./workspace-service.js";

const LIGHTWEIGHT_PROVIDER_IDS = new Set<ProviderId>(["codex", "claude-code"]);
const LIGHTWEIGHT_STORAGE_VERSION = 1;
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-5.4";
const ANTHROPIC_API_VERSION = "2023-06-01";
const LIGHTWEIGHT_SESSION_TMP_FILE_SUFFIX = ".tmp";
const LIGHTWEIGHT_SESSION_READ_RETRY_DELAYS_MS = [12, 40] as const;
const LIGHTWEIGHT_SYSTEM_PROMPT = [
  "你是 CodingNS 的事务轻量会话。",
  "你的职责是快速问答、联网搜索、轻量分析。",
  "你没有本地文件、终端、浏览器自动化、工作区读写、MCP、本地工具权限。",
  "如果用户要求你读取本地目录、执行命令、修改文件、调用本地工具，必须明确说当前轻量模式做不到，并建议切到 Agent 会话。",
  "需要最新信息时，优先使用联网搜索，再给结论。",
  "回答必须使用标准 Markdown：标题写成 `## 标题`，列表写成 `- 条目`，段落之间保留空行，不要把标题、列表和正文挤在同一行。",
  "回答直接、清楚、少废话。"
].join("\n");

export interface AffairsLightweightSessionSummary {
  sessionId: string;
  workspaceId: string;
  sourceWorkspaceId?: string;
  provider: ProviderId;
  providerSessionId: string;
  rawStoreRef: string;
  providerConfigMode?: SessionProviderConfigMode;
  providerPresetId?: string | null;
  parentSessionId?: string | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
  isArchived?: boolean;
  isFavorite?: boolean;
  title: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus | null;
  syncCursor: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  resumedAt: string | null;
  runningState: SessionRunningState | null;
  activitySource: SessionActivitySource;
  lastEventAt: string | null;
  completedAt: string | null;
  lastSeenAt: string | null;
  activityState: SessionActivityState;
}

export interface AffairsLightweightSessionDocument {
  version: number;
  userId: string;
  session: AffairsLightweightSessionSummary;
  messages: HistoryPage["messages"];
}

export interface AffairsLightweightAttachmentInput {
  id?: string | null;
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
}

interface AffairsLightweightRuntimeAttachment extends AffairsLightweightAttachmentInput {
  id: string;
}

export interface StartAffairsLightweightSessionInput {
  workspaceId: string;
  sourceWorkspaceId?: string | null;
  userId: string;
  provider: ProviderId;
  content: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  providerConfigMode?: SessionProviderConfigMode | null;
  providerPresetId?: string | null;
  attachments?: AffairsLightweightAttachmentInput[];
}

export interface SendAffairsLightweightSessionMessageInput {
  workspaceId: string;
  sourceWorkspaceId?: string | null;
  userId: string;
  sessionId: string;
  content: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  providerConfigMode?: SessionProviderConfigMode | null;
  providerPresetId?: string | null;
  attachments?: AffairsLightweightAttachmentInput[];
}

export interface AffairsLightweightSessionTurnResult {
  session: AffairsLightweightSessionSummary;
  acceptedAt: string;
  clientRequestId: string;
  userMessage: HistoryPage["messages"][number];
  assistantMessage: HistoryPage["messages"][number];
  messages: HistoryPage["messages"];
}

interface LightweightToolLifecycleEvent {
  toolCallId: string;
  toolName: string;
  status: "running" | "completed" | "failed";
  detail: string | null;
  input: string | null;
  output: string | null;
}

export type AffairsLightweightSessionStreamEvent =
  | {
      type: "started";
      session: AffairsLightweightSessionSummary;
      acceptedAt: string;
      clientRequestId: string;
      userMessage: HistoryPage["messages"][number];
    }
  | ({
      type: "tool";
    } & LightweightToolLifecycleEvent)
  | {
      type: "delta";
      delta: string;
    }
  | {
      type: "completed";
      result: AffairsLightweightSessionTurnResult;
    }
  | {
      type: "error";
      errorCode: string;
      detail: string;
    };

interface LightweightProviderBinding {
  provider: SessionBinding["provider"];
  providerConfigMode: SessionProviderConfigMode;
  providerPresetId: string | null;
  runtimeHomeDir: string | null;
}

interface OpenAiRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface AnthropicRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface LightweightRuntimeConfigFile {
  openai?: {
    apiKey?: string | null;
    baseUrl?: string | null;
    model?: string | null;
  } | null;
  anthropic?: {
    apiKey?: string | null;
    baseUrl?: string | null;
    model?: string | null;
  } | null;
}

export class AffairsLightweightSessionService {
  private readonly sessionLocks = new Map<string, Promise<unknown>>();
  private readonly sessionDocumentCache = new Map<string, AffairsLightweightSessionDocument>();
  private teableMirrorSyncNotifier: ((userId: string, reason: string) => void) | null = null;

  constructor(
    private readonly hostDataRootDir: string,
    private readonly sessionProviderConfigService: Pick<SessionProviderConfigService, "prepareSessionBinding" | "resolveLaunchContext"> | null = null,
    private readonly workspaceService: Pick<WorkspaceService, "getWorkspaceOrThrow"> | null = null
  ) {}

  configureTeableMirrorSyncNotifier(notifier: (userId: string, reason: string) => void): void {
    this.teableMirrorSyncNotifier = notifier;
  }

  async listSessions(workspaceId: string, userId: string): Promise<AffairsLightweightSessionSummary[]> {
    const workspaceDir = this.resolveWorkspaceDir(workspaceId);
    const entries = await safeReadDir(workspaceDir);
    const sessions = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const document = await this.readSessionDocumentByPath(path.join(workspaceDir, entry.name));
        return document?.userId === userId ? document.session : null;
      }));

    return sessions
      .filter((item): item is AffairsLightweightSessionSummary => Boolean(item))
      .sort((left, right) => {
        const leftValue = left.lastMessageAt ?? left.updatedAt;
        const rightValue = right.lastMessageAt ?? right.updatedAt;
        return rightValue.localeCompare(leftValue);
      });
  }

  async getSession(workspaceId: string, sessionId: string, userId: string): Promise<AffairsLightweightSessionSummary> {
    const document = await this.requireSessionDocument(workspaceId, sessionId, userId);
    return document.session;
  }

  async readMessages(workspaceId: string, sessionId: string, userId: string): Promise<HistoryPage> {
    const document = await this.requireSessionDocument(workspaceId, sessionId, userId);
    return {
      messages: document.messages,
      cursor: null,
      nextCursor: null,
      total: document.messages.length
    };
  }

  async markSessionSeen(
    workspaceId: string,
    sessionId: string,
    userId: string,
    seenAt?: string | null
  ): Promise<void> {
    await this.waitForSessionIdle(sessionId);
    const document = await this.requireSessionDocument(workspaceId, sessionId, userId);
    const normalizedSeenAt = normalizeOptionalTimestamp(seenAt) ?? new Date().toISOString();
    const nextActivityState = document.session.activityState === "completed_unread"
      ? "idle"
      : document.session.activityState;
    await this.writeSessionDocument({
      ...document,
      session: {
        ...document.session,
        lastSeenAt: normalizedSeenAt,
        activityState: nextActivityState
      }
    });
  }

  async renameSessionTitle(
    workspaceId: string,
    sessionId: string,
    userId: string,
    title: string
  ): Promise<AffairsLightweightSessionSummary> {
    await this.waitForSessionIdle(sessionId);
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "事务轻量会话标题不能为空",
        field: "title"
      });
    }
    return this.updateSessionSummary(workspaceId, sessionId, userId, (session) => ({
      ...session,
      title: normalizedTitle
    }), "session_title_renamed");
  }

  async updateSessionArchiveState(
    workspaceId: string,
    sessionId: string,
    userId: string,
    archived: boolean
  ): Promise<AffairsLightweightSessionSummary> {
    await this.waitForSessionIdle(sessionId);
    return this.updateSessionSummary(workspaceId, sessionId, userId, (session) => ({
      ...session,
      isArchived: archived
    }), "session_archive_changed");
  }

  async updateSessionFavoriteState(
    workspaceId: string,
    sessionId: string,
    userId: string,
    favorite: boolean
  ): Promise<AffairsLightweightSessionSummary> {
    await this.waitForSessionIdle(sessionId);
    return this.updateSessionSummary(workspaceId, sessionId, userId, (session) => ({
      ...session,
      isFavorite: favorite
    }), "session_favorite_changed");
  }

  async deleteSession(workspaceId: string, sessionId: string, userId: string): Promise<void> {
    await this.waitForSessionIdle(sessionId);
    await this.requireSessionDocument(workspaceId, sessionId, userId);
    await fs.unlink(this.resolveSessionFilePath(workspaceId, sessionId));
    this.sessionDocumentCache.delete(sessionId);
    this.notifyTeableSessionChanged(userId, `session_deleted:${workspaceId}:${sessionId}`);
  }

  async startSession(input: StartAffairsLightweightSessionInput): Promise<AffairsLightweightSessionTurnResult> {
    const sessionId = createId();
    const clientRequestId = normalizeClientRequestId(input.clientRequestId);
    const acceptedAt = new Date().toISOString();
    const sessionFilePath = this.resolveSessionFilePath(input.workspaceId, sessionId);
    const providerSessionId = `affairs-lightweight:${input.provider}:${sessionId}`;
    const providerBinding = this.prepareLightweightProviderBinding({
      sessionId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: input.provider,
      providerConfigMode: input.providerConfigMode ?? null,
      providerPresetId: input.providerPresetId ?? null
    });
    const session: AffairsLightweightSessionSummary = {
      sessionId,
      workspaceId: input.workspaceId,
      sourceWorkspaceId: input.sourceWorkspaceId?.trim() || input.workspaceId,
      provider: input.provider,
      providerSessionId,
      rawStoreRef: sessionFilePath,
      providerConfigMode: providerBinding.providerConfigMode,
      providerPresetId: providerBinding.providerPresetId,
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: buildDraftTitle(input.content),
      messageCount: 0,
      lastMessageAt: null,
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "starting",
      activitySource: "runtime",
      lastEventAt: acceptedAt,
      completedAt: null,
      lastSeenAt: null,
      activityState: "running"
    };
    const document: AffairsLightweightSessionDocument = {
      version: LIGHTWEIGHT_STORAGE_VERSION,
      userId: input.userId,
      session,
      messages: []
    };

    await this.writeSessionDocument(document);
    this.notifyTeableSessionChanged(input.userId, `session_started:${input.workspaceId}:${sessionId}`);
    return this.runTurn(document, {
      workspaceId: input.workspaceId,
      sourceWorkspaceId: input.sourceWorkspaceId ?? null,
      userId: input.userId,
      sessionId,
      content: input.content,
      clientRequestId,
      model: input.model ?? null,
      reasoningLevel: input.reasoningLevel ?? null,
      providerConfigMode: input.providerConfigMode ?? null,
      providerPresetId: input.providerPresetId ?? null,
      attachments: input.attachments ?? []
    });
  }

  async sendMessage(input: SendAffairsLightweightSessionMessageInput): Promise<AffairsLightweightSessionTurnResult> {
    const document = await this.requireSessionDocument(input.workspaceId, input.sessionId, input.userId);
    return this.runTurn(document, {
      ...input,
      clientRequestId: normalizeClientRequestId(input.clientRequestId)
    });
  }

  async startSessionStream(
    input: StartAffairsLightweightSessionInput,
    onEvent: (event: AffairsLightweightSessionStreamEvent) => Promise<void> | void
  ): Promise<void> {
    const sessionId = createId();
    const clientRequestId = normalizeClientRequestId(input.clientRequestId);
    const acceptedAt = new Date().toISOString();
    const sessionFilePath = this.resolveSessionFilePath(input.workspaceId, sessionId);
    const providerSessionId = `affairs-lightweight:${input.provider}:${sessionId}`;
    const providerBinding = this.prepareLightweightProviderBinding({
      sessionId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: input.provider,
      providerConfigMode: input.providerConfigMode ?? null,
      providerPresetId: input.providerPresetId ?? null
    });
    const session: AffairsLightweightSessionSummary = {
      sessionId,
      workspaceId: input.workspaceId,
      sourceWorkspaceId: input.sourceWorkspaceId?.trim() || input.workspaceId,
      provider: input.provider,
      providerSessionId,
      rawStoreRef: sessionFilePath,
      providerConfigMode: providerBinding.providerConfigMode,
      providerPresetId: providerBinding.providerPresetId,
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title: buildDraftTitle(input.content),
      messageCount: 0,
      lastMessageAt: null,
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "starting",
      activitySource: "runtime",
      lastEventAt: acceptedAt,
      completedAt: null,
      lastSeenAt: null,
      activityState: "running"
    };
    const document: AffairsLightweightSessionDocument = {
      version: LIGHTWEIGHT_STORAGE_VERSION,
      userId: input.userId,
      session,
      messages: []
    };

    await this.writeSessionDocument(document);
    await this.runTurn(document, {
      workspaceId: input.workspaceId,
      sourceWorkspaceId: input.sourceWorkspaceId ?? null,
      userId: input.userId,
      sessionId,
      content: input.content,
      clientRequestId,
      model: input.model ?? null,
      reasoningLevel: input.reasoningLevel ?? null,
      providerConfigMode: input.providerConfigMode ?? null,
      providerPresetId: input.providerPresetId ?? null,
      attachments: input.attachments ?? []
    }, onEvent);
  }

  async sendMessageStream(
    input: SendAffairsLightweightSessionMessageInput,
    onEvent: (event: AffairsLightweightSessionStreamEvent) => Promise<void> | void
  ): Promise<void> {
    const document = await this.requireSessionDocument(input.workspaceId, input.sessionId, input.userId);
    await this.runTurn(document, {
      ...input,
      clientRequestId: normalizeClientRequestId(input.clientRequestId)
    }, onEvent);
  }

  private async runTurn(
    baseDocument: AffairsLightweightSessionDocument,
    input: SendAffairsLightweightSessionMessageInput & { clientRequestId: string },
    onEvent?: (event: AffairsLightweightSessionStreamEvent) => Promise<void> | void
  ): Promise<AffairsLightweightSessionTurnResult> {
    const existingLock = this.sessionLocks.get(baseDocument.session.sessionId);
    if (existingLock) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SESSION_BUSY",
        detail: "当前轻量会话还在回复上一条消息"
      });
    }

    const job = this.runTurnInternal(baseDocument, input, onEvent)
      .finally(() => {
        this.sessionLocks.delete(baseDocument.session.sessionId);
      });

    this.sessionLocks.set(baseDocument.session.sessionId, job);
    return job;
  }

  private async runTurnInternal(
    baseDocument: AffairsLightweightSessionDocument,
    input: SendAffairsLightweightSessionMessageInput & { clientRequestId: string },
    onEvent?: (event: AffairsLightweightSessionStreamEvent) => Promise<void> | void
  ): Promise<AffairsLightweightSessionTurnResult> {
    validateLightweightProvider(baseDocument.session.provider);
    const now = new Date().toISOString();
    const document = await this.requireSessionDocument(input.workspaceId, input.sessionId, input.userId);
    const provider = document.session.provider;
    const providerBinding = this.prepareLightweightProviderBinding({
      sessionId: document.session.sessionId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider,
      providerConfigMode: input.providerConfigMode ?? document.session.providerConfigMode ?? null,
      providerPresetId: input.providerPresetId ?? document.session.providerPresetId ?? null
    });
    const userMessage = createUserMessage({
      provider,
      providerSessionId: document.session.providerSessionId,
      sessionId: document.session.sessionId,
      content: input.content,
      clientRequestId: input.clientRequestId,
      sequence: document.messages.length + 1,
      timestamp: now,
      rawStoreRef: document.session.rawStoreRef,
      attachments: normalizeLightweightMessageAttachments(input.attachments ?? [], input.clientRequestId)
    });

    const runningDocument: AffairsLightweightSessionDocument = {
      ...document,
      session: {
        ...document.session,
        updatedAt: now,
        lastMessageAt: now,
        lastEventAt: now,
        runningState: "running",
        activityState: "running",
        providerConfigMode: providerBinding.providerConfigMode,
        providerPresetId: providerBinding.providerPresetId,
        completedAt: null,
        syncStatus: "syncing",
        lastSyncAt: now,
        lastErrorCode: null,
        lastErrorDetail: null,
        messageCount: document.messages.length + 1,
        title: document.session.messageCount === 0 ? buildDraftTitle(input.content) : document.session.title
      },
      messages: [...document.messages, userMessage]
    };

    await this.writeSessionDocument(runningDocument);
    await onEvent?.({
      type: "started",
      session: runningDocument.session,
      acceptedAt: now,
      clientRequestId: input.clientRequestId,
      userMessage
    });

    let workingDocument = runningDocument;
    try {
      const handleToolEvent = async (event: LightweightToolLifecycleEvent) => {
        workingDocument = upsertToolLifecycleMessage({
          document: workingDocument,
          event,
          observedAt: new Date().toISOString()
        });
        await this.writeSessionDocument(workingDocument);
        await onEvent?.({ type: "tool", ...event });
      };
      const assistantContent = provider === "codex"
        ? await this.generateOpenAiResponse(
            runningDocument,
            input,
            onEvent
              ? async (delta) => {
                  await onEvent({ type: "delta", delta });
                }
              : undefined,
            handleToolEvent
          )
        : await this.generateAnthropicResponse(
            runningDocument,
            input,
            onEvent
              ? async (delta) => {
                  await onEvent({ type: "delta", delta });
                }
              : undefined,
            handleToolEvent
          );
      const completedAt = new Date().toISOString();
      const assistantMessage = createAssistantMessage({
        provider,
        providerSessionId: workingDocument.session.providerSessionId,
        sessionId: workingDocument.session.sessionId,
        content: assistantContent,
        sequence: workingDocument.messages.length + 1,
        timestamp: completedAt,
        rawStoreRef: workingDocument.session.rawStoreRef
      });
      const completedDocument: AffairsLightweightSessionDocument = {
        ...workingDocument,
        session: {
          ...workingDocument.session,
          updatedAt: completedAt,
          lastMessageAt: completedAt,
          lastEventAt: completedAt,
          completedAt,
          runningState: "completed",
          activityState: "completed_unread",
          syncStatus: "idle",
          lastSyncAt: completedAt,
          messageCount: workingDocument.messages.length + 1
        },
        messages: [...workingDocument.messages, assistantMessage]
      };
      await this.writeSessionDocument(completedDocument);
      this.notifyTeableSessionChanged(input.userId, `session_completed:${input.workspaceId}:${baseDocument.session.sessionId}`);
      const result = {
        session: completedDocument.session,
        acceptedAt: now,
        clientRequestId: input.clientRequestId,
        userMessage,
        assistantMessage,
        messages: completedDocument.messages
      };
      await onEvent?.({
        type: "completed",
        result
      });
      return result;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failureMessage = getErrorMessage(error);
      const failedDocument: AffairsLightweightSessionDocument = {
        ...workingDocument,
        session: {
          ...workingDocument.session,
          updatedAt: failedAt,
          lastEventAt: failedAt,
          completedAt: failedAt,
          runningState: "failed",
          activityState: "completed_unread",
          syncStatus: "error",
          lastSyncAt: failedAt,
          lastErrorCode: error instanceof AppError ? error.errorCode : "LIGHTWEIGHT_RUNTIME_FAILED",
          lastErrorDetail: failureMessage,
          messageCount: workingDocument.messages.length
        }
      };
      await this.writeSessionDocument(failedDocument);
      this.notifyTeableSessionChanged(input.userId, `session_failed:${input.workspaceId}:${baseDocument.session.sessionId}`);
      await onEvent?.({
        type: "error",
        errorCode: error instanceof AppError ? error.errorCode : "LIGHTWEIGHT_RUNTIME_FAILED",
        detail: failureMessage
      });
      throw error;
    }
  }

  private async generateOpenAiResponse(
    document: AffairsLightweightSessionDocument,
    input: SendAffairsLightweightSessionMessageInput & { clientRequestId: string },
    onDelta?: (delta: string) => Promise<void> | void,
    onTool?: (event: Extract<AffairsLightweightSessionStreamEvent, { type: "tool" }>) => Promise<void> | void
  ): Promise<string> {
    if (onDelta) {
      const streamed = await this.generateOpenAiResponseStream(document, input, onDelta, onTool);
      if (streamed) {
        return streamed;
      }
    }
    return this.generateOpenAiResponseSync(document, input);
  }

  private async generateAnthropicResponse(
    document: AffairsLightweightSessionDocument,
    input: SendAffairsLightweightSessionMessageInput & { clientRequestId: string },
    onDelta?: (delta: string) => Promise<void> | void,
    onTool?: (event: Extract<AffairsLightweightSessionStreamEvent, { type: "tool" }>) => Promise<void> | void
  ): Promise<string> {
    if (onDelta) {
      const streamed = await this.generateAnthropicResponseStream(document, input, onDelta, onTool);
      if (streamed) {
        return streamed;
      }
    }
    return this.generateAnthropicResponseSync(document, input);
  }

  private async generateOpenAiResponseSync(
    document: AffairsLightweightSessionDocument,
    input: SendAffairsLightweightSessionMessageInput & { clientRequestId: string }
  ): Promise<string> {
    const runtime = await this.readOpenAiRuntimeConfig(document.session, input.model?.trim() || null, input.userId);
    const responsePayload = createOpenAiResponsesPayload({
      model: runtime.model,
      messages: document.messages,
      reasoningLevel: input.reasoningLevel ?? null,
      activeClientRequestId: input.clientRequestId,
      attachments: normalizeLightweightRuntimeAttachments(input.attachments ?? [], input.clientRequestId)
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${runtime.apiKey}`
    };

    const response = await postJsonWithFallbacks({
      baseUrl: runtime.baseUrl,
      pathCandidates: ["responses", "v1/responses"],
      init: {
        method: "POST",
        headers,
        body: JSON.stringify(responsePayload)
      }
    });
    const body = await parseJsonResponse(response);
    if (!response.ok) {
      throw createUpstreamError("OPENAI_LIGHTWEIGHT_FAILED", body, response.status);
    }

    const outputText = extractOpenAiResponseText(body);
    if (outputText) {
      return outputText;
    }

    const fallbackResponse = await postJsonWithFallbacks({
      baseUrl: runtime.baseUrl,
      pathCandidates: ["v1/chat/completions", "chat/completions"],
      init: {
        method: "POST",
        headers,
        body: JSON.stringify(createOpenAiChatPayload({
          model: runtime.model,
          messages: document.messages,
          activeClientRequestId: input.clientRequestId,
          attachments: normalizeLightweightRuntimeAttachments(input.attachments ?? [], input.clientRequestId)
        }))
      }
    });
    const fallbackBody = await parseJsonResponse(fallbackResponse);
    if (!fallbackResponse.ok) {
      throw createUpstreamError("OPENAI_LIGHTWEIGHT_FAILED", fallbackBody, fallbackResponse.status);
    }
    const fallbackText = extractOpenAiResponseText(fallbackBody);
    if (!fallbackText) {
      throw new AppError({
        statusCode: 502,
        errorCode: "OPENAI_LIGHTWEIGHT_EMPTY",
        detail: "轻量 Codex 没有返回正文"
      });
    }
    return fallbackText;
  }

  private async generateAnthropicResponseSync(
    document: AffairsLightweightSessionDocument,
    input: SendAffairsLightweightSessionMessageInput & { clientRequestId: string }
  ): Promise<string> {
    const runtime = await this.readAnthropicRuntimeConfig(document.session, input.model?.trim() || null, input.userId);
    let messages = document.messages.map((message) => createAnthropicMessagePayload(
      message,
      input.clientRequestId,
      normalizeLightweightRuntimeAttachments(input.attachments ?? [], input.clientRequestId)
    ));
    let finalBody: any = null;

    for (let index = 0; index < 4; index += 1) {
      const response = await postJsonWithFallbacks({
        baseUrl: runtime.baseUrl,
        pathCandidates: ["v1/messages", "messages"],
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "anthropic-version": ANTHROPIC_API_VERSION,
            "x-api-key": runtime.apiKey
          },
          body: JSON.stringify({
            model: runtime.model,
            max_tokens: 2048,
            system: LIGHTWEIGHT_SYSTEM_PROMPT,
            messages,
            tools: [
              {
                type: "web_search_20250305",
                name: "web_search",
                max_uses: 5
              }
            ]
          })
        }
      });
      const body = await parseJsonResponse(response);
      if (!response.ok) {
        throw createUpstreamError("ANTHROPIC_LIGHTWEIGHT_FAILED", body, response.status);
      }

      finalBody = body;
      const stopReason = normalizeText(body?.stop_reason);
      const assistantContent = Array.isArray(body?.content) ? body.content : [];
      if (stopReason === "pause_turn") {
        messages = [
          ...messages,
          {
            role: "assistant",
            content: assistantContent
          }
        ];
        continue;
      }
      break;
    }

    const outputText = extractAnthropicOutputText(finalBody?.content);
    if (!outputText) {
      throw new AppError({
        statusCode: 502,
        errorCode: "ANTHROPIC_LIGHTWEIGHT_EMPTY",
        detail: "轻量 Claude Code 没有返回正文"
      });
    }

    return outputText;
  }

  private async generateOpenAiResponseStream(
    document: AffairsLightweightSessionDocument,
    input: SendAffairsLightweightSessionMessageInput & { clientRequestId: string },
    onDelta: (delta: string) => Promise<void> | void,
    onTool?: (event: Extract<AffairsLightweightSessionStreamEvent, { type: "tool" }>) => Promise<void> | void
  ): Promise<string | null> {
    const runtime = await this.readOpenAiRuntimeConfig(document.session, input.model?.trim() || null, input.userId);
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${runtime.apiKey}`
    };
    const responsePayload = {
      ...createOpenAiResponsesPayload({
        model: runtime.model,
        messages: document.messages,
        reasoningLevel: input.reasoningLevel ?? null,
        activeClientRequestId: input.clientRequestId,
        attachments: normalizeLightweightRuntimeAttachments(input.attachments ?? [], input.clientRequestId)
      }),
      stream: true
    };
    const response = await postJsonWithFallbacks({
      baseUrl: runtime.baseUrl,
      pathCandidates: ["responses", "v1/responses"],
      init: {
        method: "POST",
        headers,
        body: JSON.stringify(responsePayload)
      }
    });
    if (!response.ok) {
      const body = await parseJsonResponse(response);
      throw createUpstreamError("OPENAI_LIGHTWEIGHT_FAILED", body, response.status);
    }

    const streamedText = await streamOpenAiSseText(response, onDelta, onTool);
    if (streamedText) {
      return streamedText;
    }

    const fallbackResponse = await postJsonWithFallbacks({
      baseUrl: runtime.baseUrl,
      pathCandidates: ["v1/chat/completions", "chat/completions"],
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...createOpenAiChatPayload({
            model: runtime.model,
            messages: document.messages,
            activeClientRequestId: input.clientRequestId,
            attachments: normalizeLightweightRuntimeAttachments(input.attachments ?? [], input.clientRequestId)
          }),
          stream: true
        })
      }
    });
    if (!fallbackResponse.ok) {
      const fallbackBody = await parseJsonResponse(fallbackResponse);
      throw createUpstreamError("OPENAI_LIGHTWEIGHT_FAILED", fallbackBody, fallbackResponse.status);
    }
    return await streamOpenAiSseText(fallbackResponse, onDelta, onTool);
  }

  private async generateAnthropicResponseStream(
    document: AffairsLightweightSessionDocument,
    input: SendAffairsLightweightSessionMessageInput & { clientRequestId: string },
    onDelta: (delta: string) => Promise<void> | void,
    onTool?: (event: Extract<AffairsLightweightSessionStreamEvent, { type: "tool" }>) => Promise<void> | void
  ): Promise<string | null> {
    const runtime = await this.readAnthropicRuntimeConfig(document.session, input.model?.trim() || null, input.userId);
    const response = await postJsonWithFallbacks({
      baseUrl: runtime.baseUrl,
      pathCandidates: ["v1/messages", "messages"],
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": ANTHROPIC_API_VERSION,
          "x-api-key": runtime.apiKey
        },
        body: JSON.stringify({
          model: runtime.model,
          max_tokens: 2048,
          system: LIGHTWEIGHT_SYSTEM_PROMPT,
          messages: document.messages.map((message) => createAnthropicMessagePayload(
            message,
            input.clientRequestId,
            normalizeLightweightRuntimeAttachments(input.attachments ?? [], input.clientRequestId)
          )),
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 5
            }
          ],
          stream: true
        })
      }
    });
    if (!response.ok) {
      const body = await parseJsonResponse(response);
      throw createUpstreamError("ANTHROPIC_LIGHTWEIGHT_FAILED", body, response.status);
    }

    return await streamAnthropicSseText(response, onDelta, onTool);
  }

  private async requireSessionDocument(
    workspaceId: string,
    sessionId: string,
    userId: string
  ): Promise<AffairsLightweightSessionDocument> {
    const document = await this.readSessionDocument(workspaceId, sessionId);
    if (!document || document.userId !== userId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "AFFAIRS_LIGHTWEIGHT_SESSION_NOT_FOUND",
        detail: "未找到对应的事务轻量会话"
      });
    }
    return document;
  }

  private async readSessionDocument(
    workspaceId: string,
    sessionId: string
  ): Promise<AffairsLightweightSessionDocument | null> {
    return this.readSessionDocumentByPath(this.resolveSessionFilePath(workspaceId, sessionId), sessionId);
  }

  private async readSessionDocumentByPath(
    filePath: string,
    expectedSessionId: string | null = inferSessionIdFromSessionFilePath(filePath)
  ): Promise<AffairsLightweightSessionDocument | null> {
    for (let attemptIndex = 0; attemptIndex <= LIGHTWEIGHT_SESSION_READ_RETRY_DELAYS_MS.length; attemptIndex += 1) {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as AffairsLightweightSessionDocument | null;
        if (!parsed || typeof parsed !== "object") {
          return this.readCachedSessionDocument(expectedSessionId);
        }
        if (!parsed.session || !Array.isArray(parsed.messages)) {
          return this.readCachedSessionDocument(expectedSessionId);
        }
        this.cacheSessionDocument(parsed);
        return parsed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        if (!shouldRetrySessionDocumentRead(error) || attemptIndex >= LIGHTWEIGHT_SESSION_READ_RETRY_DELAYS_MS.length) {
          const cached = this.readCachedSessionDocument(expectedSessionId);
          if (cached) {
            return cached;
          }
          throw error;
        }
        await sleep(LIGHTWEIGHT_SESSION_READ_RETRY_DELAYS_MS[attemptIndex]!);
      }
    }

    return this.readCachedSessionDocument(expectedSessionId);
  }

  private async writeSessionDocument(document: AffairsLightweightSessionDocument): Promise<void> {
    const filePath = document.session.rawStoreRef;
    const tempFilePath = `${filePath}.${process.pid}.${createId()}${LIGHTWEIGHT_SESSION_TMP_FILE_SUFFIX}`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tempFilePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await fs.rename(tempFilePath, filePath);
    this.cacheSessionDocument(document);
  }

  private async updateSessionSummary(
    workspaceId: string,
    sessionId: string,
    userId: string,
    updater: (session: AffairsLightweightSessionSummary) => AffairsLightweightSessionSummary,
    reason?: string
  ): Promise<AffairsLightweightSessionSummary> {
    const document = await this.requireSessionDocument(workspaceId, sessionId, userId);
    const nextSession = updater(document.session);
    await this.writeSessionDocument({
      ...document,
      session: nextSession
    });
    this.notifyTeableSessionChanged(userId, `${reason ?? "session_updated"}:${workspaceId}:${sessionId}`);
    return nextSession;
  }

  private async waitForSessionIdle(sessionId: string): Promise<void> {
    const inflight = this.sessionLocks.get(sessionId);
    if (inflight) {
      await inflight;
    }
  }

  private cacheSessionDocument(document: AffairsLightweightSessionDocument): void {
    const sessionId = document.session.sessionId?.trim();
    if (!sessionId) {
      return;
    }
    this.sessionDocumentCache.set(sessionId, cloneSessionDocument(document));
  }

  private notifyTeableSessionChanged(userId: string, reason: string): void {
    this.teableMirrorSyncNotifier?.(userId, reason);
  }

  private readCachedSessionDocument(sessionId: string | null): AffairsLightweightSessionDocument | null {
    const normalizedSessionId = sessionId?.trim() ?? "";
    if (!normalizedSessionId) {
      return null;
    }
    const cached = this.sessionDocumentCache.get(normalizedSessionId);
    return cached ? cloneSessionDocument(cached) : null;
  }

  private async readOpenAiRuntimeConfig(
    session: Pick<
      AffairsLightweightSessionSummary,
      "sessionId" | "workspaceId" | "sourceWorkspaceId" | "provider" | "providerConfigMode" | "providerPresetId"
    >,
    modelOverride: string | null,
    userId: string
  ): Promise<OpenAiRuntimeConfig> {
    const injectedConfig = await this.readLightweightRuntimeConfigFile();
    const providerBinding = this.resolveLightweightProviderBinding({
      ...session,
      userId
    });
    const providerLaunchContext = providerBinding
      ? this.sessionProviderConfigService?.resolveLaunchContext(providerBinding) ?? null
      : null;
    const runtimeEnv = providerLaunchContext?.runtimeEnv ?? {};
    const runtimeHomeDir = providerLaunchContext?.runtimeHomeDir?.trim() || null;
    const authPath = path.join(runtimeHomeDir ?? path.join(os.homedir(), ".codex"), "auth.json");
    const configPath = path.join(runtimeHomeDir ?? path.join(os.homedir(), ".codex"), "config.toml");
    const auth = await readJsonFile<Record<string, unknown>>(authPath);
    const toml = await safeReadTextFile(configPath);
    const parsed = parseCodexTomlConfig(toml);
    const key = pickFirstText(
      process.env.CODINGNS_LIGHTWEIGHT_OPENAI_API_KEY,
      runtimeEnv.OPENAI_API_KEY,
      process.env.OPENAI_API_KEY,
      injectedConfig?.openai?.apiKey,
      String(auth?.OPENAI_API_KEY ?? "")
    );
    const baseUrl = normalizeBaseUrl(
      pickFirstText(
        process.env.CODINGNS_LIGHTWEIGHT_OPENAI_BASE_URL,
        runtimeEnv.OPENAI_BASE_URL,
        injectedConfig?.openai?.baseUrl,
        process.env.OPENAI_BASE_URL,
        parsed.baseUrl,
        "https://api.openai.com/v1"
      ) ?? "https://api.openai.com/v1"
    );
    const model = modelOverride
      || pickFirstText(
        process.env.CODINGNS_LIGHTWEIGHT_OPENAI_MODEL,
        runtimeEnv.OPENAI_MODEL,
        injectedConfig?.openai?.model,
        process.env.OPENAI_MODEL,
        parsed.model,
        DEFAULT_OPENAI_MODEL
      )
      || DEFAULT_OPENAI_MODEL;

    if (!key) {
      throw new AppError({
        statusCode: 500,
        errorCode: "OPENAI_LIGHTWEIGHT_AUTH_MISSING",
        detail: `未找到 Codex 轻量会话可用的 API key。优先检查 ~/.codex/auth.json，或在 ${this.getLightweightRuntimeConfigPath()} 写入 openai.apiKey。`
      });
    }
    return {
      apiKey: key,
      baseUrl,
      model
    };
  }

  private async readAnthropicRuntimeConfig(
    session: Pick<
      AffairsLightweightSessionSummary,
      "sessionId" | "workspaceId" | "sourceWorkspaceId" | "provider" | "providerConfigMode" | "providerPresetId"
    >,
    modelOverride: string | null,
    userId: string
  ): Promise<AnthropicRuntimeConfig> {
    const injectedConfig = await this.readLightweightRuntimeConfigFile();
    const providerBinding = this.resolveLightweightProviderBinding({
      ...session,
      userId
    });
    const providerLaunchContext = providerBinding
      ? this.sessionProviderConfigService?.resolveLaunchContext(providerBinding) ?? null
      : null;
    const runtimeEnv = providerLaunchContext?.runtimeEnv ?? {};
    const runtimeHomeDir = providerLaunchContext?.runtimeHomeDir?.trim() || null;
    const settingsPath = path.join(runtimeHomeDir ?? path.join(os.homedir(), ".claude"), "settings.json");
    const configPath = path.join(runtimeHomeDir ?? path.join(os.homedir(), ".claude"), "config.json");
    const settings = await readJsonFile<Record<string, any>>(settingsPath);
    const config = await readJsonFile<Record<string, unknown>>(configPath);
    const env = typeof settings?.env === "object" && settings.env ? settings.env : {};
    const inferredWorkspaceModel = modelOverride
      ? null
      : await this.readLatestClaudeWorkspaceRuntimeModel(
          session.sourceWorkspaceId?.trim() || session.workspaceId
        );
    const key = pickFirstText(
      process.env.CODINGNS_LIGHTWEIGHT_ANTHROPIC_API_KEY,
      runtimeEnv.ANTHROPIC_AUTH_TOKEN,
      runtimeEnv.ANTHROPIC_API_KEY,
      process.env.ANTHROPIC_API_KEY,
      injectedConfig?.anthropic?.apiKey,
      String(env.ANTHROPIC_AUTH_TOKEN ?? config?.primaryApiKey ?? "")
    );
    const baseUrl = normalizeBaseUrl(
      pickFirstText(
        process.env.CODINGNS_LIGHTWEIGHT_ANTHROPIC_BASE_URL,
        runtimeEnv.ANTHROPIC_BASE_URL,
        injectedConfig?.anthropic?.baseUrl,
        String(env.ANTHROPIC_BASE_URL ?? ""),
        process.env.ANTHROPIC_BASE_URL,
        "https://api.anthropic.com"
      ) ?? "https://api.anthropic.com"
    );
    const model = modelOverride
      || pickFirstText(
        process.env.CODINGNS_LIGHTWEIGHT_ANTHROPIC_MODEL,
        runtimeEnv.ANTHROPIC_MODEL,
        injectedConfig?.anthropic?.model,
        String(env.ANTHROPIC_MODEL ?? ""),
        inferredWorkspaceModel,
        DEFAULT_CLAUDE_MODEL
      )
      || DEFAULT_CLAUDE_MODEL;

    if (!key) {
      throw new AppError({
        statusCode: 500,
        errorCode: "ANTHROPIC_LIGHTWEIGHT_AUTH_MISSING",
        detail: `未找到 Claude Code 轻量会话可用的 API key。优先检查 ~/.claude/settings.json 或 ~/.claude/config.json，或在 ${this.getLightweightRuntimeConfigPath()} 写入 anthropic.apiKey。`
      });
    }
    return {
      apiKey: key,
      baseUrl,
      model
    };
  }

  private prepareLightweightProviderBinding(input: {
    sessionId: string;
    workspaceId: string;
    userId: string;
    provider: ProviderId;
    providerConfigMode?: SessionProviderConfigMode | null;
    providerPresetId?: string | null;
  }): LightweightProviderBinding {
    if (!this.sessionProviderConfigService) {
      return {
        provider: input.provider as SessionBinding["provider"],
        providerConfigMode: input.providerConfigMode ?? "global-default",
        providerPresetId: input.providerPresetId?.trim() || null,
        runtimeHomeDir: null
      };
    }

    const binding = this.sessionProviderConfigService.prepareSessionBinding({
      sessionId: input.sessionId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      provider: input.provider as SessionBinding["provider"],
      providerConfigMode: input.providerConfigMode ?? null,
      providerPresetId: input.providerPresetId ?? null
    });

    return {
      provider: input.provider as SessionBinding["provider"],
      providerConfigMode: binding.providerConfigMode,
      providerPresetId: binding.providerPresetId,
      runtimeHomeDir: binding.runtimeHomeDir
    };
  }

  private resolveLightweightProviderBinding(
    session: Pick<
      AffairsLightweightSessionSummary,
      "sessionId" | "workspaceId" | "sourceWorkspaceId" | "provider" | "providerConfigMode" | "providerPresetId"
    > & { userId: string }
  ): LightweightProviderBinding | null {
    if (!this.sessionProviderConfigService) {
      return null;
    }

    return this.prepareLightweightProviderBinding({
      sessionId: session.sessionId,
      workspaceId: session.sourceWorkspaceId?.trim() || session.workspaceId,
      userId: session.userId,
      provider: session.provider,
      providerConfigMode: session.providerConfigMode ?? "global-default",
      providerPresetId: session.providerPresetId ?? null
    });
  }

  private async readLatestClaudeWorkspaceRuntimeModel(workspaceId: string): Promise<string | null> {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId || !this.workspaceService) {
      return null;
    }

    const workspace = this.workspaceService.getWorkspaceOrThrow(normalizedWorkspaceId);
    const targetWorkspacePath = normalizeWorkspacePathForMatch(workspace.path);
    const runtimeRootDir = path.join(this.hostDataRootDir, "workspace-session-runtime", normalizedWorkspaceId);
    const runtimeEntries = await safeReadDir(runtimeRootDir);
    let matchedModel: { model: string; timestamp: string } | null = null;

    for (const runtimeEntry of runtimeEntries) {
      if (!runtimeEntry.isFile()) {
        const projectsRootDir = path.join(runtimeRootDir, runtimeEntry.name, "projects");
        const projectFiles = await collectJsonlFiles(projectsRootDir);

        for (const filePath of projectFiles) {
          const candidate = await readLatestClaudeTranscriptModelCandidate(filePath, targetWorkspacePath);
          if (!candidate) {
            continue;
          }
          if (!matchedModel || candidate.timestamp > matchedModel.timestamp) {
            matchedModel = candidate;
          }
        }
      }
    }

    return matchedModel?.model ?? null;
  }

  private resolveWorkspaceDir(workspaceId: string): string {
    return path.join(this.hostDataRootDir, "affairs-lightweight-sessions", workspaceId);
  }

  private resolveSessionFilePath(workspaceId: string, sessionId: string): string {
    return path.join(this.resolveWorkspaceDir(workspaceId), `${sessionId}.json`);
  }

  private getLightweightRuntimeConfigPath(): string {
    return path.join(this.hostDataRootDir, "lightweight-runtime.json");
  }

  private async readLightweightRuntimeConfigFile(): Promise<LightweightRuntimeConfigFile | null> {
    const configPath = this.getLightweightRuntimeConfigPath();
    const content = await safeReadTextFile(configPath);
    if (!content) {
      return null;
    }
    try {
      const parsed = JSON.parse(content) as LightweightRuntimeConfigFile | null;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      throw new AppError({
        statusCode: 500,
        errorCode: "LIGHTWEIGHT_RUNTIME_CONFIG_INVALID",
        detail: `事务轻量会话配置文件不是合法 JSON：${configPath}`
      });
    }
  }
}

function validateLightweightProvider(provider: string): asserts provider is ProviderId {
  if (!LIGHTWEIGHT_PROVIDER_IDS.has(provider as ProviderId)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "事务轻量会话只支持 Codex 和 Claude Code",
      field: "provider"
    });
  }
}

function normalizeClientRequestId(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized || createId();
}

function normalizeOptionalTimestamp(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function buildDraftTitle(content: string): string {
  const singleLine = content.replace(/\s+/g, " ").trim();
  if (!singleLine) {
    return "新对话";
  }
  return singleLine.length > 24 ? `${singleLine.slice(0, 24)}…` : singleLine;
}

function createUserMessage(input: {
  provider: ProviderId;
  providerSessionId: string;
  sessionId: string;
  content: string;
  clientRequestId: string;
  sequence: number;
  timestamp: string;
  rawStoreRef: string;
  attachments?: NonNullable<HistoryPage["messages"][number]["attachments"]>;
}): HistoryPage["messages"][number] {
  return {
    messageId: `lightweight-user-${input.clientRequestId}`,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    role: "user",
    kind: "text",
    content: input.content,
    toolCall: null,
    timestamp: input.timestamp,
    attachments: input.attachments ?? [],
    sequence: input.sequence,
    rawRef: `${input.rawStoreRef}#${input.clientRequestId}`
  };
}

function createAssistantMessage(input: {
  provider: ProviderId;
  providerSessionId: string;
  sessionId: string;
  content: string;
  sequence: number;
  timestamp: string;
  rawStoreRef: string;
}): HistoryPage["messages"][number] {
  return {
    messageId: `lightweight-assistant-${createId()}`,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    role: "assistant",
    kind: "text",
    content: input.content,
    toolCall: null,
    timestamp: input.timestamp,
    sequence: input.sequence,
    rawRef: `${input.rawStoreRef}#assistant-${input.sequence}`
  };
}

function createToolLifecycleMessage(input: {
  provider: ProviderId;
  providerSessionId: string;
  timestamp: string;
  rawStoreRef: string;
  sequence: number;
  event: LightweightToolLifecycleEvent;
}): HistoryPage["messages"][number] {
  const content = normalizeText(input.event.detail)
    || normalizeText(input.event.output)
    || normalizeText(input.event.input)
    || input.event.toolName;
  return {
    messageId: `lightweight-tool-${input.event.toolCallId}`,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    role: "tool",
    kind: input.event.status === "running" ? "tool_call" : "tool_result",
    content,
    toolCall: {
      callId: input.event.toolCallId,
      name: input.event.toolName,
      input: input.event.input ?? "",
      output: input.event.output,
      error: input.event.status === "failed"
        ? (normalizeText(input.event.detail) || normalizeText(input.event.output) || null)
        : null,
      status: input.event.status
    },
    timestamp: input.timestamp,
    sequence: input.sequence,
    rawRef: `${input.rawStoreRef}#tool-${input.event.toolCallId}`
  };
}

function upsertToolLifecycleMessage(input: {
  document: AffairsLightweightSessionDocument;
  event: LightweightToolLifecycleEvent;
  observedAt?: string | null;
}): AffairsLightweightSessionDocument {
  const timestamp = input.observedAt ?? new Date().toISOString();
  const existingIndex = input.document.messages.findIndex((message) => {
    if (message.role !== "tool" || !message.toolCall) {
      return false;
    }
    return message.toolCall.callId === input.event.toolCallId;
  });

  if (existingIndex >= 0) {
    const existing = input.document.messages[existingIndex];
    const nextMessage = createToolLifecycleMessage({
      provider: input.document.session.provider,
      providerSessionId: input.document.session.providerSessionId,
      timestamp,
      rawStoreRef: input.document.session.rawStoreRef,
      sequence: existing.sequence,
      event: input.event
    });
    const nextMessages = [...input.document.messages];
    nextMessages[existingIndex] = {
      ...nextMessage,
      timestamp: existing.timestamp,
      sequence: existing.sequence,
      rawRef: existing.rawRef,
      messageId: existing.messageId
    };
    return {
      ...input.document,
      messages: nextMessages,
      session: {
        ...input.document.session,
        updatedAt: timestamp,
        lastEventAt: timestamp,
        messageCount: nextMessages.length
      }
    };
  }

  const assistantIndex = input.document.messages.findIndex((message) => message.role === "assistant");
  const insertAt = assistantIndex >= 0 ? assistantIndex : input.document.messages.length;
  const sequence = insertAt > 0
    ? input.document.messages[insertAt - 1].sequence + 1
    : 1;
  const nextMessage = createToolLifecycleMessage({
    provider: input.document.session.provider,
    providerSessionId: input.document.session.providerSessionId,
    timestamp,
    rawStoreRef: input.document.session.rawStoreRef,
    sequence,
    event: input.event
  });
  const nextMessages = [
    ...input.document.messages.slice(0, insertAt),
    nextMessage,
    ...input.document.messages.slice(insertAt).map((message) => ({
      ...message,
      sequence: message.sequence + 1,
      rawRef: message.role === "assistant"
        ? `${input.document.session.rawStoreRef}#assistant-${message.sequence + 1}`
        : message.rawRef
    }))
  ];
  return {
    ...input.document,
    messages: nextMessages,
    session: {
      ...input.document.session,
      updatedAt: timestamp,
      lastEventAt: timestamp,
      messageCount: nextMessages.length
    }
  };
}

function normalizeOpenAiReasoning(reasoningLevel: string | null | undefined) {
  const normalized = reasoningLevel?.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return { effort: normalized };
  }
  if (normalized === "xhigh") {
    return { effort: "high" };
  }
  return { effort: "medium" };
}

function createOpenAiResponsesPayload(input: {
  model: string;
  messages: HistoryPage["messages"];
  reasoningLevel: string | null;
  activeClientRequestId?: string | null;
  attachments?: AffairsLightweightRuntimeAttachment[];
}) {
  return {
    model: input.model,
    reasoning: normalizeOpenAiReasoning(input.reasoningLevel),
    tools: [
      {
        type: "web_search",
        user_location: {
          type: "approximate",
          country: "US"
        }
      }
    ],
    tool_choice: "auto",
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "system",
        content: LIGHTWEIGHT_SYSTEM_PROMPT
      },
      ...input.messages.map((message) => ({
        role: message.role,
        content: createOpenAiResponsesMessageContent(message, input.activeClientRequestId, input.attachments ?? [])
      }))
    ]
  };
}

function createOpenAiChatPayload(input: {
  model: string;
  messages: HistoryPage["messages"];
  activeClientRequestId?: string | null;
  attachments?: AffairsLightweightRuntimeAttachment[];
}) {
  return {
    model: input.model,
    messages: [
      {
        role: "system",
        content: LIGHTWEIGHT_SYSTEM_PROMPT
      },
      ...input.messages.map((message) => ({
        role: message.role,
        content: createOpenAiChatMessageContent(message, input.activeClientRequestId, input.attachments ?? [])
      }))
    ],
    temperature: 0.2
  };
}

function normalizeLightweightRuntimeAttachments(
  attachments: AffairsLightweightAttachmentInput[],
  clientRequestId: string
): AffairsLightweightRuntimeAttachment[] {
  return attachments.map((attachment, index) => {
    const kind: "image" | "file" = attachment.kind === "image" ? "image" : "file";
    return {
      id: attachment.id?.trim() || `lightweight-attachment-${clientRequestId}-${index + 1}`,
      kind,
    fileName: attachment.fileName.trim(),
    mimeType: attachment.mimeType.trim(),
      fileSize: Number(attachment.fileSize),
      contentBase64: attachment.contentBase64.trim()
    };
  }).filter((attachment) => (
    attachment.fileName.length > 0
    && attachment.mimeType.length > 0
    && attachment.contentBase64.length > 0
    && Number.isFinite(attachment.fileSize)
    && attachment.fileSize > 0
  ));
}

function normalizeLightweightMessageAttachments(
  attachments: AffairsLightweightAttachmentInput[],
  clientRequestId: string
): NonNullable<HistoryPage["messages"][number]["attachments"]> {
  return normalizeLightweightRuntimeAttachments(attachments, clientRequestId).map((attachment) => ({
    id: attachment.id,
    kind: attachment.kind,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize
  }));
}

function shouldAttachRuntimePayloadToMessage(
  message: HistoryPage["messages"][number],
  activeClientRequestId: string | null | undefined,
  attachments: AffairsLightweightRuntimeAttachment[]
): boolean {
  return message.role === "user"
    && attachments.length > 0
    && Boolean(activeClientRequestId?.trim())
    && message.rawRef.includes(activeClientRequestId!.trim());
}

function createOpenAiResponsesMessageContent(
  message: HistoryPage["messages"][number],
  activeClientRequestId: string | null | undefined,
  attachments: AffairsLightweightRuntimeAttachment[]
) {
  if (!shouldAttachRuntimePayloadToMessage(message, activeClientRequestId, attachments)) {
    return message.content;
  }

  return [
    { type: "input_text", text: message.content.trim() || "请根据附件回答。" },
    ...attachments.flatMap((attachment) => createOpenAiResponsesAttachmentBlocks(attachment))
  ];
}

function createOpenAiChatMessageContent(
  message: HistoryPage["messages"][number],
  activeClientRequestId: string | null | undefined,
  attachments: AffairsLightweightRuntimeAttachment[]
) {
  if (!shouldAttachRuntimePayloadToMessage(message, activeClientRequestId, attachments)) {
    return message.content;
  }

  return [
    { type: "text", text: message.content.trim() || "请根据附件回答。" },
    ...attachments.flatMap((attachment) => createOpenAiChatAttachmentBlocks(attachment))
  ];
}

function createAnthropicMessagePayload(
  message: HistoryPage["messages"][number],
  activeClientRequestId: string | null | undefined,
  attachments: AffairsLightweightRuntimeAttachment[]
) {
  if (!shouldAttachRuntimePayloadToMessage(message, activeClientRequestId, attachments)) {
    return {
      role: message.role,
      content: message.content
    };
  }

  return {
    role: message.role,
    content: [
      { type: "text", text: message.content.trim() || "请根据附件回答。" },
      ...attachments.flatMap((attachment) => createAnthropicAttachmentBlocks(attachment))
    ]
  };
}

function createOpenAiResponsesAttachmentBlocks(attachment: AffairsLightweightRuntimeAttachment): any[] {
  if (attachment.kind === "image") {
    return [{
      type: "input_image",
      image_url: buildAttachmentDataUrl(attachment)
    }];
  }
  return [{ type: "input_text", text: buildAttachmentTextBlock(attachment) }];
}

function createOpenAiChatAttachmentBlocks(attachment: AffairsLightweightRuntimeAttachment): any[] {
  if (attachment.kind === "image") {
    return [{
      type: "image_url",
      image_url: { url: buildAttachmentDataUrl(attachment) }
    }];
  }
  return [{ type: "text", text: buildAttachmentTextBlock(attachment) }];
}

function createAnthropicAttachmentBlocks(attachment: AffairsLightweightRuntimeAttachment): any[] {
  if (attachment.kind === "image") {
    return [{
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType,
        data: attachment.contentBase64
      }
    }];
  }
  return [{ type: "text", text: buildAttachmentTextBlock(attachment) }];
}

function buildAttachmentDataUrl(attachment: AffairsLightweightRuntimeAttachment): string {
  return `data:${attachment.mimeType};base64,${attachment.contentBase64}`;
}

function buildAttachmentTextBlock(attachment: AffairsLightweightRuntimeAttachment): string {
  const decoded = decodeTextAttachment(attachment);
  const header = [
    `附件文件：${attachment.fileName}`,
    `类型：${attachment.mimeType}`,
    `大小：${attachment.fileSize} bytes`
  ].join("\n");

  if (!decoded) {
    return `${header}\n内容：这个文件不是可直接读取的文本格式。请根据文件名、类型和用户问题判断；如果必须读取原始内容，请建议切换到 Agent 会话。`;
  }

  const preview = decoded.length > 20_000 ? `${decoded.slice(0, 20_000)}\n...（内容过长，已截断）` : decoded;
  return `${header}\n内容：\n${preview}`;
}

function decodeTextAttachment(attachment: AffairsLightweightRuntimeAttachment): string | null {
  const mimeType = attachment.mimeType.toLowerCase();
  const fileName = attachment.fileName.toLowerCase();
  const looksText = mimeType.startsWith("text/")
    || ["application/json", "application/xml", "application/javascript", "application/typescript", "application/x-yaml"].includes(mimeType)
    || /\.(txt|md|csv|json|xml|yaml|yml|log|ts|tsx|js|jsx|css|html|sql)$/i.test(fileName);
  if (!looksText) {
    return null;
  }

  try {
    return Buffer.from(attachment.contentBase64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function extractOpenAiResponseText(body: any): string | null {
  return normalizeText(body?.output_text)
    ?? extractOpenAiOutputText(body?.output)
    ?? extractOpenAiChoiceText(body);
}

function extractOpenAiOutputText(output: unknown): string | null {
  if (!Array.isArray(output)) {
    return null;
  }

  const segments: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = Array.isArray((item as any).content) ? (item as any).content : [];
    for (const part of content) {
      const text = normalizeText((part as any)?.text);
      if (text) {
        segments.push(text);
      }
    }
  }

  return segments.length > 0 ? segments.join("\n\n") : null;
}

function extractOpenAiChoiceText(body: any): string | null {
  const rawContent = body?.choices?.[0]?.message?.content;
  if (typeof rawContent === "string") {
    return normalizeText(rawContent);
  }
  if (!Array.isArray(rawContent)) {
    return null;
  }
  const segments = rawContent
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      return normalizeText(item?.text);
    })
    .filter((item): item is string => Boolean(item));
  return segments.length > 0 ? segments.join("\n\n") : null;
}

function extractAnthropicOutputText(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }

  const segments = content
    .map((item) => normalizeText((item as any)?.text))
    .filter((item): item is string => Boolean(item));

  return segments.length > 0 ? segments.join("\n\n") : null;
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeStreamingTextDelta(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pickFirstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function streamOpenAiSseText(
  response: Response,
  onDelta: (delta: string) => Promise<void> | void,
  onTool?: (event: Extract<AffairsLightweightSessionStreamEvent, { type: "tool" }>) => Promise<void> | void
): Promise<string | null> {
  let accumulated = "";
  await consumeSseResponse(response, async ({ event, data }) => {
    if (!data || data === "[DONE]") {
      return;
    }
    let payload: any = null;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    const toolEvent = extractOpenAiSseToolEvent(event, payload);
    if (toolEvent) {
      await onTool?.(toolEvent);
    }
    const chunks = extractOpenAiSseDeltaChunks(payload);
    for (const chunk of chunks) {
      if (!chunk) {
        continue;
      }
      accumulated += chunk;
      await onDelta(chunk);
    }
  });
  return normalizeText(accumulated);
}

async function streamAnthropicSseText(
  response: Response,
  onDelta: (delta: string) => Promise<void> | void,
  onTool?: (event: Extract<AffairsLightweightSessionStreamEvent, { type: "tool" }>) => Promise<void> | void
): Promise<string | null> {
  let accumulated = "";
  await consumeSseResponse(response, async ({ event, data }) => {
    if (!data) {
      return;
    }
    let payload: any = null;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    const eventType = event || payload?.type;
    const toolEvent = extractAnthropicSseToolEvent(eventType, payload);
    if (toolEvent) {
      await onTool?.(toolEvent);
    }
    if (eventType === "content_block_delta" && payload?.delta?.type === "text_delta") {
      const chunk = normalizeStreamingTextDelta(payload?.delta?.text);
      if (chunk !== null) {
        accumulated += chunk;
        await onDelta(chunk);
      }
      return;
    }
    if (eventType === "content_block_start" && payload?.content_block?.type === "text") {
      const chunk = normalizeStreamingTextDelta(payload?.content_block?.text);
      if (chunk !== null) {
        accumulated += chunk;
        await onDelta(chunk);
      }
    }
  });
  return normalizeText(accumulated);
}

async function consumeSseResponse(
  response: Response,
  onEvent: (event: { event: string; data: string }) => Promise<void> | void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentDataLines: string[] = [];

  const flushEvent = async () => {
    if (!currentEvent && currentDataLines.length === 0) {
      return;
    }
    const payload = {
      event: currentEvent,
      data: currentDataLines.join("\n")
    };
    currentEvent = "";
    currentDataLines = [];
    await onEvent(payload);
  };

  while (true) {
    const next = await reader.read();
    buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }
      const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      if (!rawLine) {
        await flushEvent();
        continue;
      }
      if (rawLine.startsWith(":")) {
        continue;
      }
      if (rawLine.startsWith("event:")) {
        currentEvent = rawLine.slice("event:".length).trim();
        continue;
      }
      if (rawLine.startsWith("data:")) {
        currentDataLines.push(rawLine.slice("data:".length).trimStart());
      }
    }

    if (next.done) {
      break;
    }
  }

  if (buffer.trim()) {
    const trailingLine = buffer.replace(/\r$/, "");
    if (trailingLine.startsWith("data:")) {
      currentDataLines.push(trailingLine.slice("data:".length).trimStart());
    }
  }
  await flushEvent();
}

function extractOpenAiSseDeltaChunks(payload: any): string[] {
  const chunks: string[] = [];
  const responseDelta = normalizeStreamingTextDelta(payload?.delta);
  if (responseDelta !== null) {
    chunks.push(responseDelta);
  }

  const outputTextDelta = normalizeStreamingTextDelta(payload?.text);
  if (payload?.type === "response.output_text.delta" && outputTextDelta !== null) {
    chunks.push(outputTextDelta);
  }

  const chatDelta = payload?.choices?.[0]?.delta?.content;
  if (typeof chatDelta === "string" && chatDelta.length > 0) {
    chunks.push(chatDelta);
  }

  return chunks;
}

function extractOpenAiSseToolEvent(
  eventName: string,
  payload: any
): Extract<AffairsLightweightSessionStreamEvent, { type: "tool" }> | null {
  const payloadType = normalizeText(payload?.type) ?? "";
  const resolvedEvent = normalizeText(eventName) ?? payloadType;
  const isDirectWebSearchEvent = resolvedEvent.includes("web_search_call");
  const isOutputItemWebSearchEvent = resolvedEvent === "response.output_item.done"
    && normalizeText(payload?.item?.type) === "web_search_call";
  const isOutputItemAddedWebSearchEvent = resolvedEvent === "response.output_item.added"
    && normalizeText(payload?.item?.type) === "web_search_call";

  if (!isDirectWebSearchEvent && !isOutputItemWebSearchEvent && !isOutputItemAddedWebSearchEvent) {
    return null;
  }

  const toolCallId =
    normalizeText(payload?.item_id)
    || normalizeText(payload?.item?.id)
    || normalizeText(payload?.call_id)
    || normalizeText(payload?.id)
    || "web_search";
  const status = isOutputItemWebSearchEvent
    ? "completed"
    : resolvedEvent.endsWith(".completed")
      ? "completed"
      : resolvedEvent.endsWith(".failed")
        ? "failed"
        : "running";
  const sources = readWebSearchSources(payload);
  const sourceCount = sources.length;
  const input = readWebSearchQuery(payload);
  const detail =
    status === "completed"
      ? (sourceCount > 0 ? `联网搜索完成，找到 ${sourceCount} 个来源` : "联网搜索完成")
      : status === "failed"
        ? normalizeText(payload?.error?.message) || "联网搜索失败"
        : resolvedEvent.endsWith(".searching")
          ? "正在联网搜索"
          : "正在准备联网搜索";

  return {
    type: "tool",
    toolCallId,
    toolName: "web_search",
    status,
    detail,
    input,
    output: status === "completed"
      ? JSON.stringify({
          detail,
          query: input,
          sources
        }, null, 2)
      : status === "failed"
        ? detail
        : null
  };
}

function extractAnthropicSseToolEvent(
  eventType: string,
  payload: any
): Extract<AffairsLightweightSessionStreamEvent, { type: "tool" }> | null {
  const block = payload?.content_block;
  const delta = payload?.delta;
  const blockType = normalizeText(block?.type) ?? normalizeText(delta?.type) ?? "";
  const toolName =
    normalizeText(block?.name)
    || normalizeText(payload?.name)
    || normalizeText(delta?.name)
    || (blockType.includes("web_search") ? "web_search" : null);
  if (toolName !== "web_search") {
    return null;
  }

  const status = eventType === "content_block_stop" || eventType === "message_stop"
    ? "completed"
    : eventType === "error"
      ? "failed"
      : "running";
  const input = readWebSearchQuery(payload);
  const sources = readWebSearchSources(payload);
  const detail = status === "completed"
    ? (sources.length > 0 ? `联网搜索完成，找到 ${sources.length} 个来源` : "联网搜索完成")
    : status === "failed"
      ? normalizeText(payload?.error?.message) || "联网搜索失败"
      : "正在联网搜索";

  return {
    type: "tool",
    toolCallId: normalizeText(block?.id) || normalizeText(payload?.id) || normalizeText(delta?.id) || "web_search",
    toolName,
    status,
    detail,
    input,
    output: status === "completed"
      ? JSON.stringify({
          detail,
          query: input,
          sources
        }, null, 2)
      : status === "failed"
        ? detail
        : null
  };
}

function readSourceCount(payload: any): number {
  return readWebSearchSources(payload).length;
}

function readWebSearchQuery(payload: any): string | null {
  return pickFirstText(
    payload?.action?.query,
    payload?.action?.search_query,
    payload?.item?.action?.query,
    payload?.item?.action?.search_query,
    payload?.item?.query,
    payload?.query,
    payload?.search_query,
    payload?.input,
    payload?.arguments?.query,
    payload?.arguments?.search_query,
    payload?.content_block?.input?.query,
    payload?.content_block?.input?.search_query,
    payload?.delta?.partial_json,
    payload?.result?.query,
    payload?.web_search?.query
  );
}

function flattenWebSearchSourceCandidates(payload: any): any[] {
  const candidates = [
    payload?.action?.sources,
    payload?.item?.action?.sources,
    payload?.item?.sources,
    payload?.sources,
    payload?.result?.sources,
    payload?.web_search?.sources,
    payload?.content_block?.results,
    payload?.content_block?.sources,
    payload?.results
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

function readWebSearchSources(payload: any): Array<{ title: string | null; url: string | null }> {
  return flattenWebSearchSourceCandidates(payload)
    .map((item: any) => ({
      title: pickFirstText(item?.title, item?.name, item?.text),
      url: pickFirstText(item?.url, item?.link, item?.uri)
    }))
    .filter((item) => item.title || item.url)
    .slice(0, 8);
}

async function safeReadTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await safeReadTextFile(filePath);
  if (!content) {
    return {} as T;
  }
  return JSON.parse(content) as T;
}

function parseCodexTomlConfig(content: string | null): { model: string | null; baseUrl: string | null } {
  if (!content) {
    return { model: null, baseUrl: null };
  }

  const model = matchTomlString(content, /^model\s*=\s*"([^"]+)"/m);
  const providerId = matchTomlString(content, /^model_provider\s*=\s*"([^"]+)"/m);
  if (!providerId) {
    return { model, baseUrl: null };
  }

  const marker = `[model_providers.${JSON.stringify(providerId).slice(1, -1)}]`;
  const sectionStart = content.indexOf(marker);
  if (sectionStart < 0) {
    return { model, baseUrl: null };
  }
  const nextSection = content.indexOf("\n[", sectionStart + marker.length);
  const section = nextSection >= 0 ? content.slice(sectionStart, nextSection) : content.slice(sectionStart);
  const baseUrl = matchTomlString(section, /^base_url\s*=\s*"([^"]+)"/m);
  return { model, baseUrl };
}

function matchTomlString(content: string, pattern: RegExp): string | null {
  const matched = content.match(pattern);
  return matched?.[1]?.trim() || null;
}

async function safeReadDir(dirPath: string): Promise<Array<{ name: string; isFile(): boolean }>> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function collectJsonlFiles(rootDir: string): Promise<string[]> {
  const entries = await safeReadDir(rootDir);
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isFile()) {
      if (entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
      continue;
    }

    results.push(...await collectJsonlFiles(fullPath));
  }

  return results;
}

async function readLatestClaudeTranscriptModelCandidate(
  filePath: string,
  targetWorkspacePath: string
): Promise<{ model: string; timestamp: string } | null> {
  const content = await safeReadTextFile(filePath);
  if (!content) {
    return null;
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  let latest: { model: string; timestamp: string } | null = null;

  for (const line of lines) {
    let parsed: Record<string, any> | null = null;
    try {
      parsed = JSON.parse(line) as Record<string, any>;
    } catch {
      continue;
    }

    const cwd = normalizeWorkspacePathForMatch(String(parsed?.cwd ?? ""));
    if (!cwd || cwd !== targetWorkspacePath) {
      continue;
    }

    const model = pickFirstText(
      parsed?.message?.model,
      parsed?.model
    );
    const timestamp = normalizeOptionalTimestamp(String(parsed?.timestamp ?? "")) ?? "";
    if (!model || !timestamp) {
      continue;
    }

    if (!latest || timestamp > latest.timestamp) {
      latest = { model, timestamp };
    }
  }

  return latest;
}

function normalizeWorkspacePathForMatch(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed.replaceAll("\\", "/");
  if (/^[a-z]:(?:\/|$)/i.test(normalized) || normalized.startsWith("//")) {
    return normalized.replace(/\/+$/, "").toLowerCase();
  }
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

async function postJsonWithFallbacks(input: {
  baseUrl: string;
  pathCandidates: string[];
  init: RequestInit;
}): Promise<Response> {
  let lastResponse: Response | null = null;
  for (const candidate of input.pathCandidates) {
    const url = buildRequestUrl(input.baseUrl, candidate);
    const response = await fetch(url, input.init);
    if (response.status !== 404) {
      return response;
    }
    lastResponse = response;
  }
  if (lastResponse) {
    return lastResponse;
  }
  throw new AppError({
    statusCode: 502,
    errorCode: "LIGHTWEIGHT_RUNTIME_UNREACHABLE",
    detail: "轻量会话上游地址不可达"
  });
}

function buildRequestUrl(baseUrl: string, candidate: string): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedPath = candidate.replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
}

function inferSessionIdFromSessionFilePath(filePath: string): string | null {
  const baseName = path.basename(filePath);
  if (!baseName.endsWith(".json")) {
    return null;
  }
  const sessionId = baseName.slice(0, -".json".length).trim();
  return sessionId || null;
}

function cloneSessionDocument(
  document: AffairsLightweightSessionDocument
): AffairsLightweightSessionDocument {
  return {
    ...document,
    session: {
      ...document.session
    },
    messages: document.messages.map((message) => ({
      ...message,
      toolCall: message.toolCall
        ? {
            ...message.toolCall
          }
        : null
    }))
  };
}

function shouldRetrySessionDocumentRead(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error instanceof SyntaxError || /Unexpected end of JSON input/i.test(error.message);
}

async function sleep(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function createUpstreamError(code: string, body: any, status: number): AppError {
  return new AppError({
    statusCode: 502,
    errorCode: code,
    detail:
      normalizeText(body?.error?.message)
      || normalizeText(body?.error?.detail)
      || normalizeText(body?.detail)
      || normalizeText(body?.raw)
      || `上游轻量会话接口返回 ${status}`
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "未知错误";
}

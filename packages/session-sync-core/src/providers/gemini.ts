import { execFile as nodeExecFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import type {
  DetectSessionsOptions,
  HistoryDirection,
  HistoryPage,
  NormalizedMessage,
  ProviderAdapter,
  ProviderArchiveUpdateResult,
  ProviderCapabilities,
  ProviderId,
  ProviderRealtimeEvent,
  ProviderSessionDiscovery,
  ProviderSessionSummary,
  ProviderSubscription,
  ResumeSessionResult,
  SendMessageResult,
  StartSessionOptions,
  StartSessionResult
} from "../types.js";
import { buildApplyPatchFromStructuredFileTool } from "../patch-builder.js";
import {
  ensureText,
  extractTextBlocks,
  messageIdFromRawRef,
  nextTimestamp,
  normalizeWorkspacePath,
  sliceHistory,
  stringifyStructuredValue
} from "./utils.js";

const execFile = promisify(nodeExecFile);
const GEMINI_RAW_STORE_PREFIX = "gemini://session/";
const DEFAULT_GEMINI_TITLE_LENGTH = 48;

type GeminiRole = "user" | "assistant" | "tool" | "system";

interface GeminiAdapterOptions {
  homeDir: string;
  commandPath?: string;
  listSessions?: () => Promise<GeminiCliSessionRecord[]>;
}

interface GeminiCliSessionRecord {
  providerSessionId: string;
  workspacePath: string | null;
  title: string | null;
  lastMessageAt: string | null;
  messageCount: number | null;
}

interface GeminiLocalSessionRecord {
  providerSessionId: string;
  workspacePath: string | null;
  title: string;
  lastMessageAt: string | null;
  messageCount: number;
  filePath: string;
  sourceMtimeMs: number;
  sourceSizeBytes: number;
}

interface GeminiParsedChat {
  providerSessionId: string;
  workspacePath: string | null;
  title: string;
  lastMessageAt: string | null;
  messages: NormalizedMessage[];
  sourceMtimeMs: number;
  sourceSizeBytes: number;
}

interface GeminiMessageDescriptor {
  role: GeminiRole;
  kind: NormalizedMessage["kind"];
  content: string;
  toolCall: NormalizedMessage["toolCall"];
  timestamp: string | null;
}

interface ParsedSessionRef {
  providerSessionId: string | null;
  fromRawStoreRef: boolean;
}

export class GeminiAdapter implements ProviderAdapter {
  readonly providerId: ProviderId = "gemini";

  constructor(private readonly options: GeminiAdapterOptions) {}

  async detectSessions(
    workspacePath: string,
    options?: DetectSessionsOptions
  ): Promise<ProviderSessionSummary[]> {
    const discovery = await this.detectSessionsDetailed(workspacePath, options);
    return discovery.sessions;
  }

  async detectSessionsDetailed(
    workspacePath: string,
    options?: DetectSessionsOptions
  ): Promise<ProviderSessionDiscovery> {
    const targetPath = normalizeWorkspacePath(workspacePath);
    const knownSessions = (options?.knownSessions ?? []).filter(
      (session) => session.provider === this.providerId
    );
    const knownByProviderSessionId = new Map(
      knownSessions.map((session) => [session.providerSessionId, session] as const)
    );
    const localSessions = this.readLocalSessions();
    const cliResult = await this.readCliSessions(workspacePath);
    const mergedByProviderSessionId = new Map<string, ProviderSessionSummary>();

    for (const localSession of localSessions) {
      const known = knownByProviderSessionId.get(localSession.providerSessionId);
      const resolvedWorkspacePath =
        localSession.workspacePath || ensureNonEmptyText(known?.workspacePath);

      if (!this.matchesWorkspace(resolvedWorkspacePath, targetPath)) {
        continue;
      }

      mergedByProviderSessionId.set(localSession.providerSessionId, {
        provider: this.providerId,
        providerSessionId: localSession.providerSessionId,
        title: localSession.title,
        workspacePath: resolvedWorkspacePath || workspacePath,
        rawStoreRef: buildGeminiRawStoreRef(localSession.providerSessionId),
        lastMessageAt: localSession.lastMessageAt ?? known?.lastMessageAt ?? null,
        messageCount: localSession.messageCount,
        sourceMtimeMs: localSession.sourceMtimeMs,
        sourceSizeBytes: localSession.sourceSizeBytes
      });
    }

    for (const cliSession of cliResult.sessions) {
      const known = knownByProviderSessionId.get(cliSession.providerSessionId);
      const local = mergedByProviderSessionId.get(cliSession.providerSessionId);
      const resolvedWorkspacePath =
        cliSession.workspacePath ||
        local?.workspacePath ||
        ensureNonEmptyText(known?.workspacePath);

      if (!this.matchesWorkspace(resolvedWorkspacePath, targetPath)) {
        continue;
      }

      mergedByProviderSessionId.set(cliSession.providerSessionId, {
        provider: this.providerId,
        providerSessionId: cliSession.providerSessionId,
        title:
          local?.title ||
          cliSession.title ||
          known?.title ||
          cliSession.providerSessionId,
        workspacePath: resolvedWorkspacePath || workspacePath,
        rawStoreRef: buildGeminiRawStoreRef(cliSession.providerSessionId),
        lastMessageAt:
          local?.lastMessageAt ??
          cliSession.lastMessageAt ??
          known?.lastMessageAt ??
          null,
        messageCount:
          local?.messageCount ??
          cliSession.messageCount ??
          known?.messageCount ??
          0,
        sourceMtimeMs: local?.sourceMtimeMs ?? known?.sourceMtimeMs,
        sourceSizeBytes: local?.sourceSizeBytes ?? known?.sourceSizeBytes
      });
    }

    // 当 CLI 临时失败时，用 knownSessions 补回最近一次已发现的会话，避免列表突然丢失。
    if (!cliResult.isComplete) {
      for (const known of knownSessions) {
        if (mergedByProviderSessionId.has(known.providerSessionId)) {
          continue;
        }

        if (!this.matchesWorkspace(known.workspacePath, targetPath)) {
          continue;
        }

        mergedByProviderSessionId.set(known.providerSessionId, known);
      }
    }

    return {
      sessions: [...mergedByProviderSessionId.values()].sort((left, right) =>
        (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? "")
      ),
      isComplete: cliResult.isComplete
    };
  }

  async readSessionHistory(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward"
  ): Promise<HistoryPage> {
    const resolvedProviderSessionId = this.resolveProviderSessionId(
      providerSessionId,
      rawStoreRef
    );
    const parsedChat = this.readParsedChatBySessionId(resolvedProviderSessionId);
    return sliceHistory(parsedChat.messages, cursor, limit, direction);
  }

  subscribeSession(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    onEvent: (event: ProviderRealtimeEvent) => Promise<void> | void
  ): ProviderSubscription {
    const sessionRef = this.resolveSessionRef(providerSessionId, rawStoreRef);
    let currentCursor = cursor;
    let lastSeenSignature = "";
    let closed = false;

    const timer = setInterval(() => {
      if (closed || !sessionRef.providerSessionId) {
        return;
      }

      let page: HistoryPage;

      try {
        page = this.readSessionHistorySync(
          sessionRef.providerSessionId,
          rawStoreRef,
          currentCursor,
          limit
        );
      } catch {
        return;
      }

      if (page.messages.length === 0) {
        return;
      }

      const signature = `${page.messages.at(-1)?.messageId ?? ""}:${page.cursor ?? ""}`;

      if (signature === lastSeenSignature) {
        return;
      }

      lastSeenSignature = signature;
      currentCursor = page.cursor;

      void onEvent({
        messages: page.messages,
        cursor: page.cursor
      });
    }, 700);

    return {
      close() {
        closed = true;
        clearInterval(timer);
      }
    };
  }

  async resumeSession(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ResumeSessionResult> {
    const resolvedProviderSessionId = this.resolveProviderSessionId(
      providerSessionId,
      rawStoreRef
    );
    this.readParsedChatBySessionId(resolvedProviderSessionId);

    return {
      provider: this.providerId,
      providerSessionId: resolvedProviderSessionId,
      resumedAt: nextTimestamp(),
      rawStoreRef: buildGeminiRawStoreRef(resolvedProviderSessionId)
    };
  }

  async startSession(
    _workspacePath: string,
    _options: StartSessionOptions
  ): Promise<StartSessionResult> {
    throw new Error("GEMINI_READ_ONLY_PROVIDER");
  }

  async sendMessage(
    _providerSessionId: string,
    _rawStoreRef: string,
    _content: string,
    _clientRequestId: string | null,
    _permissionMode?: string | null
  ): Promise<SendMessageResult> {
    throw new Error("GEMINI_READ_ONLY_PROVIDER");
  }

  async readSessionTitle(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<string> {
    const resolvedProviderSessionId = this.resolveProviderSessionId(
      providerSessionId,
      rawStoreRef
    );
    const parsedChat = this.readParsedChatBySessionId(resolvedProviderSessionId);
    return parsedChat.title;
  }

  async renameSessionTitle(
    _providerSessionId: string,
    _rawStoreRef: string,
    _title: string
  ): Promise<string> {
    throw new Error("GEMINI_READ_ONLY_PROVIDER");
  }

  async updateSessionArchiveState(
    _providerSessionId: string,
    _rawStoreRef: string,
    _isArchived: boolean
  ): Promise<ProviderArchiveUpdateResult> {
    throw new Error("GEMINI_ARCHIVE_NOT_SUPPORTED");
  }

  getProviderCapabilities(): ProviderCapabilities {
    return {
      provider: this.providerId,
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: false,
      supportsAttachments: false,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      limitations: [
        "当前 Gemini 仅接入会话发现与历史只读能力，运行时链路尚未启用",
        "本地 chats schema 属于非稳定公开协议，升级 CLI 后需要通过 fixture 回归"
      ]
    };
  }

  async getSessionCapabilities(_providerSessionId: string): Promise<ProviderCapabilities> {
    return this.getProviderCapabilities();
  }

  private readSessionHistorySync(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward"
  ): HistoryPage {
    const resolvedProviderSessionId = this.resolveProviderSessionId(
      providerSessionId,
      rawStoreRef
    );
    const parsedChat = this.readParsedChatBySessionId(resolvedProviderSessionId);
    return sliceHistory(parsedChat.messages, cursor, limit, direction);
  }

  private resolveProviderSessionId(providerSessionId: string, rawStoreRef: string): string {
    const sessionRef = this.resolveSessionRef(providerSessionId, rawStoreRef);

    if (!sessionRef.providerSessionId) {
      throw new Error("PROVIDER_SESSION_ID_REQUIRED");
    }

    return sessionRef.providerSessionId;
  }

  private resolveSessionRef(providerSessionId: string, rawStoreRef: string): ParsedSessionRef {
    const trimmedProviderSessionId = providerSessionId.trim();

    if (trimmedProviderSessionId) {
      return {
        providerSessionId: trimmedProviderSessionId,
        fromRawStoreRef: false
      };
    }

    return {
      providerSessionId: parseGeminiRawStoreRef(rawStoreRef),
      fromRawStoreRef: true
    };
  }

  private async readCliSessions(workspacePath: string): Promise<{
    sessions: GeminiCliSessionRecord[];
    isComplete: boolean;
  }> {
    try {
      const sessions = this.options.listSessions
        ? await this.options.listSessions()
        : await this.readCliSessionsFromCommand(workspacePath);

      return {
        sessions,
        isComplete: true
      };
    } catch {
      return {
        sessions: [],
        isComplete: false
      };
    }
  }

  private async readCliSessionsFromCommand(
    workspacePath: string
  ): Promise<GeminiCliSessionRecord[]> {
    const commandPath = this.options.commandPath?.trim() || "gemini";
    const env = {
      ...process.env,
      GEMINI_HOME: this.options.homeDir
    };
    const attempts = [
      ["--list-sessions", "--output-format", "json"],
      ["--list-sessions"]
    ];
    let lastError: unknown = null;

    for (const args of attempts) {
      try {
        const result = await execFile(commandPath, args, {
          env,
          cwd: workspacePath,
          timeout: 8_000,
          windowsHide: true,
          shell: shouldUseShellForCommand(commandPath)
        });
        return parseGeminiCliSessionOutput(result.stdout, workspacePath);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("GEMINI_LIST_SESSIONS_FAILED");
  }

  private readLocalSessions(): GeminiLocalSessionRecord[] {
    const sessions: GeminiLocalSessionRecord[] = [];
    const latestByProviderSessionId = new Map<string, GeminiLocalSessionRecord>();

    for (const filePath of listGeminiChatFiles(this.options.homeDir)) {
      let parsedChat: GeminiParsedChat;

      try {
        parsedChat = this.parseLocalChatFile(filePath);
      } catch {
        continue;
      }

      const existing = latestByProviderSessionId.get(parsedChat.providerSessionId);

      if (
        existing &&
        (existing.sourceMtimeMs > parsedChat.sourceMtimeMs ||
          (
            existing.sourceMtimeMs === parsedChat.sourceMtimeMs &&
            existing.sourceSizeBytes >= parsedChat.sourceSizeBytes
          ))
      ) {
        continue;
      }

      latestByProviderSessionId.set(parsedChat.providerSessionId, {
        providerSessionId: parsedChat.providerSessionId,
        workspacePath: parsedChat.workspacePath,
        title: parsedChat.title,
        lastMessageAt: parsedChat.lastMessageAt,
        messageCount: parsedChat.messages.length,
        filePath,
        sourceMtimeMs: parsedChat.sourceMtimeMs,
        sourceSizeBytes: parsedChat.sourceSizeBytes
      });
    }

    sessions.push(...latestByProviderSessionId.values());
    return sessions;
  }

  private readParsedChatBySessionId(providerSessionId: string): GeminiParsedChat {
    const sessionId = providerSessionId.trim();

    if (!sessionId) {
      throw new Error("PROVIDER_SESSION_ID_REQUIRED");
    }

    const chatFiles = listGeminiChatFiles(this.options.homeDir);
    let matchedByName: string | null = null;

    for (const filePath of chatFiles) {
      if (basename(filePath, ".json") === sessionId) {
        matchedByName = filePath;
      }

      let parsed: GeminiParsedChat;

      try {
        parsed = this.parseLocalChatFile(filePath);
      } catch (error) {
        if (basename(filePath, ".json") === sessionId) {
          throw wrapGeminiSchemaError(filePath, error);
        }
        continue;
      }

      if (parsed.providerSessionId === sessionId) {
        return parsed;
      }
    }

    if (matchedByName) {
      try {
        return this.parseLocalChatFile(matchedByName);
      } catch (error) {
        throw wrapGeminiSchemaError(matchedByName, error);
      }
    }

    throw new Error("GEMINI_CHAT_NOT_FOUND");
  }

  private parseLocalChatFile(filePath: string): GeminiParsedChat {
    const stats = statSync(filePath);
    const raw = readFileSync(filePath, "utf8").trim();

    if (!raw) {
      throw new Error("GEMINI_CHAT_SCHEMA_INVALID");
    }

    let parsedRaw: unknown;

    try {
      parsedRaw = JSON.parse(raw) as unknown;
    } catch (error) {
      throw wrapGeminiSchemaError(filePath, error);
    }

    const parsedRecord = toRecord(parsedRaw);
    const providerSessionId = this.resolveLocalProviderSessionId(parsedRecord, filePath);
    const messageNodes = readMessageNodes(parsedRecord);
    const messages = normalizeMessageNodes({
      sessionId: providerSessionId,
      filePath,
      messageNodes
    });
    const title =
      resolveStringField(parsedRecord, ["title", "name", "chatTitle"]) ||
      messages.find((message) => message.role === "user")?.content.slice(
        0,
        DEFAULT_GEMINI_TITLE_LENGTH
      ) ||
      providerSessionId;
    const workspacePath = resolveWorkspacePath(parsedRecord, messageNodes, filePath);
    const lastMessageAt =
      messages.at(-1)?.timestamp ||
      resolveStringField(parsedRecord, [
        "updatedAt",
        "updated_at",
        "lastUpdated",
        "last_updated",
        "lastMessageAt",
        "last_message_at",
        "startTime",
        "start_time",
        "createdAt",
        "created_at"
      ]) ||
      null;

    return {
      providerSessionId,
      workspacePath,
      title,
      lastMessageAt,
      messages,
      sourceMtimeMs: stats.mtimeMs,
      sourceSizeBytes: stats.size
    };
  }

  private resolveLocalProviderSessionId(record: Record<string, unknown>, filePath: string): string {
    const sessionId =
      resolveStringField(record, [
        "sessionId",
        "session_id",
        "id",
        "chatId",
        "conversationId",
        "conversation_id"
      ]) || basename(filePath, ".json");

    if (!sessionId.trim()) {
      throw new Error("GEMINI_CHAT_SCHEMA_INVALID");
    }

    return sessionId.trim();
  }

  private matchesWorkspace(workspacePath: string | null | undefined, targetPath: string): boolean {
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath ?? "");

    if (!normalizedWorkspacePath) {
      return false;
    }

    return normalizedWorkspacePath === targetPath;
  }
}

function parseGeminiRawStoreRef(rawStoreRef: string): string | null {
  const trimmed = rawStoreRef.trim();

  if (!trimmed.startsWith(GEMINI_RAW_STORE_PREFIX)) {
    return null;
  }

  const rawSessionId = trimmed.slice(GEMINI_RAW_STORE_PREFIX.length).split(/[?#]/, 1)[0];
  return rawSessionId ? decodeURIComponent(rawSessionId) : null;
}

function buildGeminiRawStoreRef(providerSessionId: string): string {
  return `${GEMINI_RAW_STORE_PREFIX}${encodeURIComponent(providerSessionId)}`;
}

function listGeminiChatFiles(homeDir: string): string[] {
  const tmpRoot = join(homeDir, "tmp");

  if (!existsSync(tmpRoot)) {
    return [];
  }

  const queue = [tmpRoot];
  const chatFiles: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      if (!isGeminiChatFile(entryPath)) {
        continue;
      }

      chatFiles.push(entryPath);
    }
  }

  return chatFiles;
}

function isGeminiChatFile(filePath: string): boolean {
  return filePath.replaceAll("\\", "/").includes("/chats/");
}

function parseGeminiCliSessionOutput(
  stdout: string,
  workspacePathFallback: string | null = null
): GeminiCliSessionRecord[] {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return [];
  }

  const parsedAsWhole = parseJsonSafe(trimmed);
  const normalizedWhole = normalizeCliSessionsPayload(parsedAsWhole, workspacePathFallback);

  if (normalizedWhole.length > 0) {
    return normalizedWhole;
  }

  const normalizedText = parseGeminiPlainTextSessions(trimmed, workspacePathFallback);

  if (normalizedText.length > 0) {
    return normalizedText;
  }

  const sessions: GeminiCliSessionRecord[] = [];

  for (const line of trimmed.split(/\r?\n/)) {
    const parsedLine = parseJsonSafe(line.trim());

    if (!parsedLine) {
      continue;
    }

    sessions.push(...normalizeCliSessionsPayload(parsedLine, workspacePathFallback));
  }

  return dedupeCliSessions(sessions);
}

function normalizeCliSessionsPayload(
  payload: unknown,
  workspacePathFallback: string | null
): GeminiCliSessionRecord[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return dedupeCliSessions(
      payload
        .map((item) => normalizeCliSessionRecord(item, workspacePathFallback))
        .filter((item): item is GeminiCliSessionRecord => item !== null)
    );
  }

  const record = toRecord(payload);
  const wrappedArray =
    arrayFromUnknown(record.sessions) ||
    arrayFromUnknown(record.items) ||
    arrayFromUnknown(record.data);

  if (wrappedArray) {
    return dedupeCliSessions(
      wrappedArray
        .map((item) => normalizeCliSessionRecord(item, workspacePathFallback))
        .filter((item): item is GeminiCliSessionRecord => item !== null)
    );
  }

  const single = normalizeCliSessionRecord(record, workspacePathFallback);
  return single ? [single] : [];
}

function normalizeCliSessionRecord(
  payload: unknown,
  workspacePathFallback: string | null
): GeminiCliSessionRecord | null {
  const record = toRecord(payload);
  const providerSessionId = resolveStringField(record, [
    "sessionId",
    "session_id",
    "id",
    "conversationId",
    "conversation_id"
  ]);

  if (!providerSessionId) {
    return null;
  }

  const messageCountValue = resolveNumberField(record, ["messageCount", "message_count"]);

  return {
    providerSessionId,
    workspacePath:
      resolveStringField(record, [
        "workspacePath",
        "workspace_path",
        "cwd",
        "directory",
        "projectPath",
        "project_path"
      ]) || workspacePathFallback,
    title: resolveStringField(record, ["title", "name", "summary"]) || null,
    lastMessageAt:
      resolveStringField(record, [
        "updatedAt",
        "updated_at",
        "lastUpdated",
        "last_updated",
        "lastMessageAt",
        "last_message_at",
        "startTime",
        "start_time",
        "createdAt",
        "created_at"
      ]) || null,
    messageCount: messageCountValue === null ? null : messageCountValue
  };
}

function dedupeCliSessions(sessions: GeminiCliSessionRecord[]): GeminiCliSessionRecord[] {
  const deduped = new Map<string, GeminiCliSessionRecord>();

  for (const session of sessions) {
    const existing = deduped.get(session.providerSessionId);

    if (
      !existing ||
      (existing.lastMessageAt ?? "").localeCompare(session.lastMessageAt ?? "") < 0
    ) {
      deduped.set(session.providerSessionId, session);
    }
  }

  return [...deduped.values()];
}

function resolveWorkspacePath(
  record: Record<string, unknown>,
  messageNodes: unknown[],
  filePath: string
): string | null {
  const directWorkspace = resolveStringField(record, [
    "workspacePath",
    "workspace_path",
    "cwd",
    "projectPath",
    "project_path"
  ]);

  if (directWorkspace) {
    return directWorkspace;
  }

  for (const node of messageNodes) {
    const nodeRecord = toRecord(node);
    const workspace = resolveStringField(nodeRecord, [
      "workspacePath",
      "workspace_path",
      "cwd",
      "projectPath",
      "project_path"
    ]);

    if (workspace) {
      return workspace;
    }
  }

  return resolveWorkspacePathFromChatFile(filePath);
}

function readMessageNodes(record: Record<string, unknown>): unknown[] {
  const candidates: unknown[] = [
    record.messages,
    record.history,
    record.events,
    record.contents,
    record.turns,
    toRecord(record.chat).messages,
    toRecord(record.conversation).messages,
    toRecord(record.transcript).messages
  ];

  for (const candidate of candidates) {
    const array = arrayFromUnknown(candidate);

    if (array && array.length > 0) {
      return array;
    }
  }

  return [];
}

function normalizeMessageNodes(input: {
  sessionId: string;
  filePath: string;
  messageNodes: unknown[];
}): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];
  let sequence = 0;

  for (let index = 0; index < input.messageNodes.length; index += 1) {
    const node = input.messageNodes[index];
    const nodeRecord = toRecord(node);
    const role = resolveGeminiRole(nodeRecord);
    const timestamp = resolveMessageTimestamp(nodeRecord);
    const descriptors = readMessageDescriptors(nodeRecord, role);

    if (descriptors.length === 0) {
      continue;
    }

    for (let descriptorIndex = 0; descriptorIndex < descriptors.length; descriptorIndex += 1) {
      const descriptor = descriptors[descriptorIndex];
      sequence += 1;
      const rawRef = buildGeminiMessageRawRef(
        input.sessionId,
        input.filePath,
        index,
        descriptorIndex
      );

      messages.push({
        messageId: messageIdFromRawRef(rawRef),
        provider: "gemini",
        providerSessionId: input.sessionId,
        role: descriptor.role,
        kind: descriptor.kind,
        content: descriptor.content,
        toolCall: descriptor.toolCall,
        timestamp: descriptor.timestamp ?? timestamp,
        sequence,
        rawRef
      });
    }
  }

  return messages;
}

function readMessageDescriptors(
  nodeRecord: Record<string, unknown>,
  fallbackRole: GeminiRole
): GeminiMessageDescriptor[] {
  const descriptors: GeminiMessageDescriptor[] = [];
  descriptors.push(...readGeminiThoughtDescriptors(nodeRecord));
  descriptors.push(...readGeminiToolCallDescriptors(nodeRecord));

  const parts =
    arrayFromUnknown(nodeRecord.parts) ||
    arrayFromUnknown(nodeRecord.content) ||
    arrayFromUnknown(toRecord(nodeRecord.message).parts) ||
    null;
  const partDescriptors: GeminiMessageDescriptor[] = [];

  if (parts && parts.length > 0) {
    for (const part of parts) {
      const descriptor = normalizeMessagePart(part, fallbackRole);

      if (descriptor) {
        partDescriptors.push(descriptor);
      }
    }
  }

  if (partDescriptors.length > 0) {
    descriptors.push(...partDescriptors);
    return descriptors;
  }

  const fallbackDescriptor = normalizeMessagePart(nodeRecord, fallbackRole);

  if (fallbackDescriptor) {
    descriptors.push(fallbackDescriptor);
  }

  return descriptors;
}

function normalizeMessagePart(
  value: unknown,
  fallbackRole: GeminiRole
): GeminiMessageDescriptor | null {
  const record = toRecord(value);
  const toolCallPayload =
    maybeRecord(record.tool_use) ??
    maybeRecord(record.toolUse) ??
    maybeRecord(record.functionCall) ??
    (record.type === "tool_use" || record.type === "function_call" ? record : null);

  if (toolCallPayload) {
    const timestamp = resolveOptionalMessageTimestamp(record);
    const patchText = buildGeminiApplyPatchFromInput(toolCallPayload);
    const callId =
      resolveStringField(toolCallPayload, ["id", "toolCallId", "call_id"]) || "gemini-call";
    const name = patchText
      ? "apply_patch"
      : resolveStringField(toolCallPayload, ["name", "toolName", "tool_name"]) || "unknown_tool";
    const inputPayload =
      toolCallPayload.input ??
      toolCallPayload.arguments ??
      toolCallPayload.args ??
      null;
    const inputText = patchText || stringifyStructuredValue(inputPayload);

    return {
      role: patchText ? "tool" : "assistant",
      kind: "tool_call",
      content: inputText,
      toolCall: {
        callId,
        name,
        input: inputText,
        output: null,
        error: null,
        status: "running"
      },
      timestamp
    };
  }

  const toolResultPayload =
    maybeRecord(record.tool_result) ??
    maybeRecord(record.toolResult) ??
    maybeRecord(record.functionResponse) ??
    (record.type === "tool_result" || record.type === "function_response" ? record : null);

  if (toolResultPayload) {
    const timestamp = resolveOptionalMessageTimestamp(record);
    const errorDetail = resolveStringField(toolResultPayload, ["error", "error_message"]);
    const outputPayload =
      toolResultPayload.output ??
      toolResultPayload.result ??
      toolResultPayload.content ??
      null;
    const normalizedName =
      resolveStringField(toolResultPayload, [
        "name",
        "tool_name",
        "toolName"
      ]) || "unknown_tool";
    const name = isGeminiEditableToolName(normalizedName) ? "apply_patch" : normalizedName;

    return {
      role: "tool",
      kind: "tool_result",
      content: extractTextBlocks(outputPayload).trim() || stringifyStructuredValue(outputPayload),
      toolCall: {
        callId:
          resolveStringField(toolResultPayload, [
            "tool_use_id",
            "toolUseId",
            "call_id",
            "callId"
          ]) || "gemini-tool-result",
        name,
        input: "",
        output: stringifyStructuredValue(outputPayload),
        error: errorDetail,
        status: errorDetail ? "failed" : "completed"
      },
      timestamp
    };
  }

  const text = extractTextBlocks(
    record.text ??
      record.content ??
      record.output ??
      record.message ??
      value
  ).trim();

  if (!text) {
    return null;
  }

  const partType = ensureText(record.type).toLowerCase();
  const kind = partType.includes("think") ? "thinking" : "text";

  return {
    role: fallbackRole,
    kind,
    content: text,
    toolCall: null,
    timestamp: resolveOptionalMessageTimestamp(record)
  };
}

function readGeminiThoughtDescriptors(
  nodeRecord: Record<string, unknown>
): GeminiMessageDescriptor[] {
  const thoughts =
    arrayFromUnknown(nodeRecord.thoughts) ??
    arrayFromUnknown(nodeRecord.reasoning) ??
    null;

  if (!thoughts || thoughts.length === 0) {
    return [];
  }

  return thoughts
    .map((thought) => normalizeGeminiThoughtDescriptor(thought))
    .filter((descriptor): descriptor is GeminiMessageDescriptor => descriptor !== null);
}

function normalizeGeminiThoughtDescriptor(value: unknown): GeminiMessageDescriptor | null {
  const record = toRecord(value);
  const subject = resolveStringField(record, ["subject", "title", "name"]);
  const description = resolveStringField(record, [
    "description",
    "content",
    "text",
    "message"
  ]);
  const content = [subject, description].filter((item): item is string => Boolean(item)).join("\n\n").trim();

  if (!content) {
    return null;
  }

  return {
    role: "assistant",
    kind: "thinking",
    content,
    toolCall: null,
    timestamp: resolveOptionalMessageTimestamp(record)
  };
}

function readGeminiToolCallDescriptors(
  nodeRecord: Record<string, unknown>
): GeminiMessageDescriptor[] {
  const toolCalls =
    arrayFromUnknown(nodeRecord.toolCalls) ??
    arrayFromUnknown(nodeRecord.tool_calls) ??
    null;

  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }

  const descriptors: GeminiMessageDescriptor[] = [];

  for (let index = 0; index < toolCalls.length; index += 1) {
    const descriptorSet = normalizeGeminiToolCall(toolCalls[index], index);

    if (descriptorSet.call) {
      descriptors.push(descriptorSet.call);
    }

    if (descriptorSet.result) {
      descriptors.push(descriptorSet.result);
    }
  }

  return descriptors;
}

function normalizeGeminiToolCall(
  value: unknown,
  index: number
): {
  call: GeminiMessageDescriptor | null;
  result: GeminiMessageDescriptor | null;
} {
  const record = toRecord(value);
  const timestamp = resolveOptionalMessageTimestamp(record);
  const patchText = buildGeminiApplyPatchFromInput(record);
  const callId =
    resolveStringField(record, ["id", "toolCallId", "call_id"]) ||
    `gemini-tool-call-${index + 1}`;
  const rawName =
    resolveStringField(record, ["name", "toolName", "tool_name", "displayName"]) || "tool";
  const name = patchText ? "apply_patch" : rawName;
  const inputPayload = record.args ?? record.input ?? record.arguments ?? null;
  const inputText = patchText || stringifyStructuredValue(inputPayload);
  const callDescriptor: GeminiMessageDescriptor = {
    role: patchText ? "tool" : "assistant",
    kind: "tool_call",
    content: inputText || name,
    toolCall: {
      callId,
      name,
      input: inputText,
      output: null,
      error: null,
      status: "running"
    },
    timestamp
  };

  return {
    call: callDescriptor,
    result: normalizeGeminiToolCallResult(record, callId, name, timestamp)
  };
}

function normalizeGeminiToolCallResult(
  record: Record<string, unknown>,
  callId: string,
  name: string,
  fallbackTimestamp: string | null
): GeminiMessageDescriptor | null {
  const output = extractGeminiToolCallOutput(record);
  const error = extractGeminiToolCallError(record);
  const hasResultPayload =
    Array.isArray(record.result) ||
    record.result !== undefined ||
    record.output !== undefined ||
    record.resultDisplay !== undefined ||
    error !== null;

  if (!hasResultPayload) {
    return null;
  }

  const status = normalizeGeminiToolCallStatus(record, error);
  const content = output || error || name;

  if (!content.trim()) {
    return null;
  }

  return {
    role: "tool",
    kind: "tool_result",
    content,
    toolCall: {
      callId,
      name,
      input: "",
      output: output || null,
      error,
      status
    },
    timestamp:
      resolveStringField(record, [
        "timestamp",
        "updatedAt",
        "updated_at",
        "lastUpdated",
        "last_updated"
      ]) || fallbackTimestamp
  };
}

function extractGeminiToolCallOutput(record: Record<string, unknown>): string {
  const resultItems = arrayFromUnknown(record.result) ?? [];

  for (const item of resultItems) {
    const itemRecord = toRecord(item);
    const functionResponse = toRecord(itemRecord.functionResponse);
    const response = toRecord(functionResponse.response);
    const outputText = extractTextBlocks(
      response.output ??
      itemRecord.output ??
      itemRecord.result ??
      itemRecord.content
    ).trim();

    if (outputText) {
      return outputText;
    }
  }

  const directOutput = extractTextBlocks(
    record.output ??
    record.result ??
    toRecord(record.resultDisplay).fileDiff ??
    toRecord(record.resultDisplay).newContent
  ).trim();

  return directOutput;
}

function extractGeminiToolCallError(record: Record<string, unknown>): string | null {
  const directError = resolveStringField(record, [
    "error",
    "error_message",
    "failure",
    "description"
  ]);

  if (directError && normalizeGeminiToolCallStatus(record, null) === "failed") {
    return directError;
  }

  return null;
}

function normalizeGeminiToolCallStatus(
  record: Record<string, unknown>,
  error: string | null
): "running" | "completed" | "failed" {
  if (error) {
    return "failed";
  }

  const normalizedStatus = ensureText(record.status).trim().toLowerCase();

  if (!normalizedStatus || normalizedStatus === "success" || normalizedStatus === "completed") {
    return "completed";
  }

  if (["error", "failed", "failure", "cancelled", "canceled"].includes(normalizedStatus)) {
    return "failed";
  }

  return "completed";
}

function buildGeminiApplyPatchFromInput(value: unknown): string | null {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  if (!input) {
    return null;
  }

  const candidates = [toRecord(input.input), toRecord(input.arguments), toRecord(input.args), input];

  for (const candidate of candidates) {
    const patchText = buildApplyPatchFromStructuredFileTool(candidate);

    if (patchText) {
      return patchText;
    }
  }

  return null;
}

function isGeminiEditableToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();

  return [
    "write_file",
    "writefile",
    "create_file",
    "edit_file",
    "replace",
    "replace_file",
    "update_file",
    "multi_edit",
    "multiedit"
  ].includes(normalized);
}

function resolveGeminiRole(record: Record<string, unknown>): GeminiRole {
  const candidate = resolveStringField(record, [
    "role",
    "author",
    "sender",
    "source",
    "participant",
    "type"
  ])?.toLowerCase();

  if (!candidate) {
    return "assistant";
  }

  if (candidate.includes("user") || candidate.includes("human")) {
    return "user";
  }

  if (candidate.includes("tool")) {
    return "tool";
  }

  if (candidate.includes("system")) {
    return "system";
  }

  if (
    candidate.includes("assistant")
    || candidate.includes("model")
    || candidate.includes("gemini")
  ) {
    return "assistant";
  }

  return "assistant";
}

function resolveMessageTimestamp(record: Record<string, unknown>): string {
  const direct = resolveStringField(record, [
    "timestamp",
    "time",
    "createdAt",
    "created_at",
    "updatedAt",
    "updated_at"
  ]);

  if (direct) {
    return direct;
  }

  return nextTimestamp();
}

function resolveOptionalMessageTimestamp(record: Record<string, unknown>): string | null {
  return resolveStringField(record, [
    "timestamp",
    "time",
    "createdAt",
    "created_at",
    "updatedAt",
    "updated_at",
    "lastUpdated",
    "last_updated"
  ]);
}

function buildGeminiMessageRawRef(
  sessionId: string,
  filePath: string,
  messageIndex: number,
  partIndex: number
): string {
  return `${GEMINI_RAW_STORE_PREFIX}${encodeURIComponent(sessionId)}#file=${
    encodeURIComponent(filePath.replaceAll("\\", "/"))
  }&index=${messageIndex}&part=${partIndex}`;
}

function resolveStringField(
  record: Record<string, unknown>,
  fieldNames: string[]
): string | null {
  for (const fieldName of fieldNames) {
    const value = ensureNonEmptyText(record[fieldName]);

    if (value) {
      return value;
    }
  }

  const metadata = toRecord(record.metadata);

  for (const fieldName of fieldNames) {
    const value = ensureNonEmptyText(metadata[fieldName]);

    if (value) {
      return value;
    }
  }

  return null;
}

function resolveNumberField(
  record: Record<string, unknown>,
  fieldNames: string[]
): number | null {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];

    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }

    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);

      if (Number.isFinite(parsed)) {
        return Math.max(0, parsed);
      }
    }
  }

  return null;
}

function parseGeminiPlainTextSessions(
  stdout: string,
  workspacePathFallback: string | null
): GeminiCliSessionRecord[] {
  const sessions = stdout
    .split(/\r?\n/)
    .map((line) => normalizePlainTextCliSessionLine(line, workspacePathFallback))
    .filter((item): item is GeminiCliSessionRecord => item !== null);

  return dedupeCliSessions(sessions);
}

function normalizePlainTextCliSessionLine(
  line: string,
  workspacePathFallback: string | null
): GeminiCliSessionRecord | null {
  const trimmed = line.trim();

  if (!trimmed) {
    return null;
  }

  const sessionIdMatch = trimmed.match(/\[([^\]]+)\]\s*$/);

  if (!sessionIdMatch?.[1]) {
    return null;
  }

  const providerSessionId = sessionIdMatch[1].trim();

  if (!providerSessionId) {
    return null;
  }

  let prefix = trimmed.slice(0, sessionIdMatch.index).trim();
  prefix = prefix.replace(/^\d+\.\s*/, "").trim();

  const timeSuffixMatch = prefix.match(/\(([^()]*)\)\s*$/);
  const title = (
    timeSuffixMatch && typeof timeSuffixMatch.index === "number"
      ? prefix.slice(0, timeSuffixMatch.index)
      : prefix
  ).trim() || providerSessionId;

  return {
    providerSessionId,
    workspacePath: workspacePathFallback,
    title,
    lastMessageAt: null,
    messageCount: null
  };
}

function ensureNonEmptyText(value: unknown): string | null {
  const text = ensureText(value).trim();
  return text.length > 0 ? text : null;
}

function parseJsonSafe(value: string): unknown | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function arrayFromUnknown(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function maybeRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function resolveWorkspacePathFromChatFile(filePath: string): string | null {
  const projectRootFile = join(dirname(dirname(filePath)), ".project_root");

  if (!existsSync(projectRootFile)) {
    return null;
  }

  try {
    return ensureNonEmptyText(readFileSync(projectRootFile, "utf8"));
  } catch {
    return null;
  }
}

function shouldUseShellForCommand(commandPath: string): boolean {
  return process.platform === "win32" && [".cmd", ".bat"].includes(extname(commandPath).toLowerCase());
}

function wrapGeminiSchemaError(filePath: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : ensureText(error);
  return new Error(
    `GEMINI_CHAT_SCHEMA_INVALID: file=${filePath.replaceAll("\\", "/")} detail=${detail}`
  );
}

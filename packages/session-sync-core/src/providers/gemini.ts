import { execFile as nodeExecFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
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
  partIndex: number;
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
    const cliResult = await this.readCliSessions();
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
      canStartSession: false,
      canResumeSession: true,
      canSendMessage: false,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: false,
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

  private async readCliSessions(): Promise<{
    sessions: GeminiCliSessionRecord[];
    isComplete: boolean;
  }> {
    try {
      const sessions = this.options.listSessions
        ? await this.options.listSessions()
        : await this.readCliSessionsFromCommand();

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

  private async readCliSessionsFromCommand(): Promise<GeminiCliSessionRecord[]> {
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
          timeout: 8_000
        });
        return parseGeminiCliSessionOutput(result.stdout);
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
    const workspacePath = resolveWorkspacePath(parsedRecord, messageNodes);
    const lastMessageAt =
      messages.at(-1)?.timestamp ||
      resolveStringField(parsedRecord, [
        "updatedAt",
        "updated_at",
        "lastMessageAt",
        "last_message_at",
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

function parseGeminiCliSessionOutput(stdout: string): GeminiCliSessionRecord[] {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return [];
  }

  const parsedAsWhole = parseJsonSafe(trimmed);
  const normalizedWhole = normalizeCliSessionsPayload(parsedAsWhole);

  if (normalizedWhole.length > 0) {
    return normalizedWhole;
  }

  const sessions: GeminiCliSessionRecord[] = [];

  for (const line of trimmed.split(/\r?\n/)) {
    const parsedLine = parseJsonSafe(line.trim());

    if (!parsedLine) {
      continue;
    }

    sessions.push(...normalizeCliSessionsPayload(parsedLine));
  }

  return dedupeCliSessions(sessions);
}

function normalizeCliSessionsPayload(payload: unknown): GeminiCliSessionRecord[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return dedupeCliSessions(
      payload
        .map((item) => normalizeCliSessionRecord(item))
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
        .map((item) => normalizeCliSessionRecord(item))
        .filter((item): item is GeminiCliSessionRecord => item !== null)
    );
  }

  const single = normalizeCliSessionRecord(record);
  return single ? [single] : [];
}

function normalizeCliSessionRecord(payload: unknown): GeminiCliSessionRecord | null {
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
      ]) || null,
    title: resolveStringField(record, ["title", "name", "summary"]) || null,
    lastMessageAt:
      resolveStringField(record, [
        "updatedAt",
        "updated_at",
        "lastMessageAt",
        "last_message_at",
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
  messageNodes: unknown[]
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

  return null;
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

    for (const descriptor of descriptors) {
      sequence += 1;
      const rawRef = buildGeminiMessageRawRef(
        input.sessionId,
        input.filePath,
        index,
        descriptor.partIndex
      );

      messages.push({
        messageId: messageIdFromRawRef(rawRef),
        provider: "gemini",
        providerSessionId: input.sessionId,
        role: descriptor.role,
        kind: descriptor.kind,
        content: descriptor.content,
        toolCall: descriptor.toolCall,
        timestamp,
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
  const parts =
    arrayFromUnknown(nodeRecord.parts) ||
    arrayFromUnknown(nodeRecord.content) ||
    arrayFromUnknown(toRecord(nodeRecord.message).parts) ||
    null;
  const descriptors: GeminiMessageDescriptor[] = [];

  if (parts && parts.length > 0) {
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const descriptor = normalizeMessagePart(parts[partIndex], fallbackRole, partIndex);

      if (descriptor) {
        descriptors.push(descriptor);
      }
    }
  }

  if (descriptors.length > 0) {
    return descriptors;
  }

  const fallbackDescriptor = normalizeMessagePart(nodeRecord, fallbackRole, 0);
  return fallbackDescriptor ? [fallbackDescriptor] : [];
}

function normalizeMessagePart(
  value: unknown,
  fallbackRole: GeminiRole,
  partIndex: number
): GeminiMessageDescriptor | null {
  const record = toRecord(value);
  const toolCallPayload =
    maybeRecord(record.tool_use) ??
    maybeRecord(record.toolUse) ??
    maybeRecord(record.functionCall) ??
    (record.type === "tool_use" || record.type === "function_call" ? record : null);

  if (toolCallPayload) {
    const callId =
      resolveStringField(toolCallPayload, ["id", "toolCallId", "call_id"]) ||
      `gemini-call-${partIndex + 1}`;
    const name =
      resolveStringField(toolCallPayload, ["name", "toolName", "tool_name"]) || "unknown_tool";
    const inputPayload =
      toolCallPayload.input ??
      toolCallPayload.arguments ??
      toolCallPayload.args ??
      null;

    return {
      role: "assistant",
      kind: "tool_call",
      content: stringifyStructuredValue(inputPayload),
      toolCall: {
        callId,
        name,
        input: stringifyStructuredValue(inputPayload),
        output: null,
        error: null,
        status: "running"
      },
      partIndex
    };
  }

  const toolResultPayload =
    maybeRecord(record.tool_result) ??
    maybeRecord(record.toolResult) ??
    maybeRecord(record.functionResponse) ??
    (record.type === "tool_result" || record.type === "function_response" ? record : null);

  if (toolResultPayload) {
    const errorDetail = resolveStringField(toolResultPayload, ["error", "error_message"]);
    const outputPayload =
      toolResultPayload.output ??
      toolResultPayload.result ??
      toolResultPayload.content ??
      null;

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
          ]) || `gemini-tool-result-${partIndex + 1}`,
        name:
          resolveStringField(toolResultPayload, [
            "name",
            "tool_name",
            "toolName"
          ]) || "unknown_tool",
        input: "",
        output: stringifyStructuredValue(outputPayload),
        error: errorDetail,
        status: errorDetail ? "failed" : "completed"
      },
      partIndex
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
    partIndex
  };
}

function resolveGeminiRole(record: Record<string, unknown>): GeminiRole {
  const candidate = resolveStringField(record, [
    "role",
    "author",
    "sender",
    "source",
    "participant"
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

function wrapGeminiSchemaError(filePath: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : ensureText(error);
  return new Error(
    `GEMINI_CHAT_SCHEMA_INVALID: file=${filePath.replaceAll("\\", "/")} detail=${detail}`
  );
}

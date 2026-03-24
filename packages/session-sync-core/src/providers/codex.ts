import { basename, join } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import crypto from "node:crypto";

import type {
  HistoryDirection,
  HistoryPage,
  NormalizedMessage,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderId,
  ProviderRealtimeEvent,
  ProviderSessionSummary,
  ProviderSubscription,
  ResumeSessionResult,
  SendMessageResult,
  StartSessionOptions,
  StartSessionResult
} from "../types.js";
import {
  appendJsonLine,
  createRawRef,
  encodeCursor,
  ensureDirectory,
  extractTextBlocks,
  ensureText,
  messageIdFromRawRef,
  nextTimestamp,
  normalizeWorkspacePath,
  readJsonLines,
  safeDate,
  sliceHistory,
  stringifyStructuredValue,
  walkJsonlFiles
} from "./utils.js";

interface CodexAdapterOptions {
  homeDir: string;
}

type CodexMessageSource = "event_msg" | "response_item";

export class CodexAdapter implements ProviderAdapter {
  readonly providerId: ProviderId = "codex";

  constructor(private readonly options: CodexAdapterOptions) {}

  async detectSessions(workspacePath: string): Promise<ProviderSessionSummary[]> {
    const targetPath = normalizeWorkspacePath(workspacePath);
    const files = this.listSessionFiles();
    const threadNameIndex = this.readThreadNameIndex();
    const sessionsByProviderSessionId = new Map<string, ProviderSessionSummary>();

    for (const filePath of files) {
      const records = readJsonLines(filePath).map((record) => record.data);
      const meta = records.find((record) => record.type === "session_meta");
      const metaPayload = (meta?.payload ?? {}) as Record<string, unknown>;
      const cwd = ensureText(metaPayload.cwd);

      if (normalizeWorkspacePath(cwd) !== targetPath) {
        continue;
      }

      const providerSessionId = basename(filePath, ".jsonl");
      const messages = this.parseMessages(filePath, records, providerSessionId);
      const codexSessionId = this.resolveCodexSessionId(metaPayload, providerSessionId);
      const title =
        this.resolveIndexedTitle(threadNameIndex, codexSessionId) ??
        messages.find((message) => message.role === "user")?.content.slice(0, 48) ??
        providerSessionId;
      const lastMessageAt =
        messages.at(-1)?.timestamp ?? (ensureText(metaPayload.timestamp) || null);

      sessionsByProviderSessionId.set(providerSessionId, {
        provider: this.providerId,
        providerSessionId,
        title,
        workspacePath,
        rawStoreRef: filePath,
        lastMessageAt,
        messageCount: messages.length
      });
    }

    return [...sessionsByProviderSessionId.values()].sort((left, right) =>
      (left.lastMessageAt ?? "").localeCompare(right.lastMessageAt ?? "")
    );
  }

  async readSessionHistory(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    direction: HistoryDirection = "forward"
  ): Promise<HistoryPage> {
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    const records = readJsonLines(resolvedStoreRef).map((record) => record.data);
    const messages = this.parseMessages(rawStoreRef, records, providerSessionId);
    return sliceHistory(messages, cursor, limit, direction);
  }

  subscribeSession(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    onEvent: (event: ProviderRealtimeEvent) => Promise<void> | void
  ): ProviderSubscription {
    let currentCursor = cursor;
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    let lastMtime = statSync(resolvedStoreRef).mtimeMs;

    const timer = setInterval(async () => {
      const nextStat = statSync(resolvedStoreRef);

      if (nextStat.mtimeMs <= lastMtime) {
        return;
      }

      lastMtime = nextStat.mtimeMs;

      const page = await this.readSessionHistory(providerSessionId, rawStoreRef, currentCursor, limit);

      if (page.messages.length === 0) {
        return;
      }

      currentCursor = page.cursor;

      await onEvent({
        messages: page.messages,
        cursor: page.cursor
      });
    }, 300);

    return {
      close() {
        clearInterval(timer);
      }
    };
  }

  async resumeSession(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ResumeSessionResult> {
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    statSync(resolvedStoreRef);

    return {
      provider: this.providerId,
      providerSessionId,
      resumedAt: nextTimestamp(),
      rawStoreRef: resolvedStoreRef
    };
  }

  async startSession(
    workspacePath: string,
    options: StartSessionOptions
  ): Promise<StartSessionResult> {
    const now = new Date();
    const sessionId = `rollout-${now.toISOString().replaceAll(":", "-")}-${crypto.randomUUID()}`;
    const folder = join(
      this.options.homeDir,
      "sessions",
      `${now.getUTCFullYear()}`,
      `${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
      `${String(now.getUTCDate()).padStart(2, "0")}`
    );

    ensureDirectory(folder);

    const filePath = join(folder, `${sessionId}.jsonl`);
    const nowIso = nextTimestamp();

    appendJsonLine(filePath, {
      timestamp: nowIso,
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: nowIso,
        cwd: workspacePath,
        originator: "CodingNS Host",
        source: "codingns"
      }
    });

    if (options.initialPrompt) {
      appendJsonLine(filePath, {
        timestamp: nextTimestamp(),
        type: "event_msg",
        payload: {
          type: "user_message",
          message: options.initialPrompt
        }
      });
    }

    return {
      session: {
        provider: this.providerId,
        providerSessionId: sessionId,
        title: options.initialPrompt?.slice(0, 48) || "New Codex session",
        workspacePath,
        rawStoreRef: filePath,
        lastMessageAt: nextTimestamp(),
        messageCount: options.initialPrompt ? 1 : 0
      },
      initialCursor: encodeCursor(options.initialPrompt ? 1 : 0)
    };
  }

  async sendMessage(
    providerSessionId: string,
    rawStoreRef: string,
    content: string,
    clientRequestId: string | null
  ): Promise<SendMessageResult> {
    const resolvedStoreRef = this.resolveSessionFilePath(rawStoreRef, providerSessionId);
    const lineNumber = readJsonLines(resolvedStoreRef).length + 1;
    const acceptedAt = nextTimestamp();

    appendJsonLine(resolvedStoreRef, {
      timestamp: acceptedAt,
      type: "event_msg",
      payload: {
        type: "user_message",
        message: content,
        clientRequestId
      }
    });

    const rawRef = createRawRef(this.providerId, rawStoreRef, lineNumber);

    return {
      acceptedAt,
      clientRequestId,
      message: {
        messageId: messageIdFromRawRef(rawRef),
        provider: this.providerId,
        providerSessionId,
        role: "user",
        kind: "text",
        content,
        toolCall: null,
        timestamp: acceptedAt,
        sequence: this.parseMessages(
          rawStoreRef,
          readJsonLines(resolvedStoreRef).map((record) => record.data),
          providerSessionId
        ).length,
        rawRef
      }
    };
  }

  getProviderCapabilities(): ProviderCapabilities {
    return {
      provider: this.providerId,
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: false,
      supportsAttachments: false,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      limitations: ["当前实现只维护原生会话文件，不负责直接驱动 Codex CLI 进程执行。"]
    };
  }

  async getSessionCapabilities(): Promise<ProviderCapabilities> {
    return this.getProviderCapabilities();
  }

  private readThreadNameIndex(): Map<string, string> {
    const indexPath = join(this.options.homeDir, "session_index.jsonl");

    if (!existsSync(indexPath)) {
      return new Map();
    }

    const lines = readFileSync(indexPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const index = new Map<string, string>();

    // 这里容忍单行脏数据，避免某一条坏记录把整个会话列表拖死。
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as {
          id?: unknown;
          thread_name?: unknown;
        };
        const id = ensureText(record.id).trim();
        const threadName = ensureText(record.thread_name).trim();

        if (id.length > 0 && threadName.length > 0) {
          index.set(id, threadName);
        }
      } catch {
        continue;
      }
    }

    return index;
  }

  private listSessionFiles(): string[] {
    const activeFiles = walkJsonlFiles(join(this.options.homeDir, "sessions"));
    const archivedFiles = walkJsonlFiles(join(this.options.homeDir, "archived_sessions"));
    return [...activeFiles, ...archivedFiles];
  }

  private resolveSessionFilePath(rawStoreRef: string, providerSessionId: string): string {
    if (existsSync(rawStoreRef)) {
      return rawStoreRef;
    }

    const fileName = basename(rawStoreRef) || `${providerSessionId}.jsonl`;
    const match = fileName.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T.+\.jsonl$/);
    const candidates = [
      join(this.options.homeDir, "archived_sessions", fileName),
      match
        ? join(this.options.homeDir, "sessions", match[1], match[2], match[3], fileName)
        : null
    ].filter((value): value is string => value !== null);

    const matchedPath = candidates.find((candidate) => existsSync(candidate));

    if (matchedPath) {
      return matchedPath;
    }

    return rawStoreRef;
  }

  private resolveCodexSessionId(
    metaPayload: Record<string, unknown>,
    providerSessionId: string
  ): string {
    const metaId = ensureText(metaPayload.id).trim();

    if (metaId.length > 0) {
      return metaId;
    }

    const matched = providerSessionId.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
    );

    return matched?.[1] ?? providerSessionId;
  }

  private resolveIndexedTitle(index: Map<string, string>, sessionId: string): string | null {
    return index.get(sessionId)?.trim() || null;
  }

  private parseMessages(
    filePath: string,
    records: Array<Record<string, unknown>>,
    providerSessionId: string
  ): NormalizedMessage[] {
    const messages: Array<{
      source: CodexMessageSource;
      dedupeKey: string;
      message: NormalizedMessage;
    }> = [];
    const messageIndexesByKey = new Map<string, number[]>();
    const toolNameById = new Map<string, string>();
    let sequence = 0;

    const pushMessage = (
      source: CodexMessageSource,
      message: Omit<NormalizedMessage, "sequence">
    ) => {
      const dedupeKey = buildCodexMessageDedupeKey(message);
      const candidateIndexes = messageIndexesByKey.get(dedupeKey) ?? [];

      for (let index = candidateIndexes.length - 1; index >= 0; index -= 1) {
        const existingIndex = candidateIndexes[index];
        const existing = messages[existingIndex];

        if (!isEquivalentCodexMessage(existing.message, message)) {
          continue;
        }

        // 同一条逻辑消息如果被 event_msg 和 response_item 同时记录，
        // 优先保留结构更稳定的 response_item，避免时间线重复。
        if (codexMessageSourcePriority(source) > codexMessageSourcePriority(existing.source)) {
          messages[existingIndex] = {
            source,
            dedupeKey,
            message: {
              ...message,
              sequence: existing.message.sequence
            }
          };
        }

        return;
      }

      sequence += 1;
      messageIndexesByKey.set(dedupeKey, [...candidateIndexes, messages.length]);
      messages.push({
        source,
        dedupeKey,
        message: {
          ...message,
          sequence
        }
      });
    };

    records.forEach((record, index) => {
      const lineNumber = index + 1;
      const rawRef = createRawRef(this.providerId, filePath, lineNumber);

      if (record.type === "event_msg") {
        const payload = (record.payload ?? {}) as Record<string, unknown>;
        const eventType = ensureText(payload.type);

        if (eventType === "user_message") {
          const content = ensureText(payload.message);

          if (content.length > 0) {
            pushMessage("event_msg", {
              messageId: messageIdFromRawRef(rawRef),
              provider: this.providerId,
              providerSessionId,
              role: "user",
              kind: "text",
              content,
              toolCall: null,
              timestamp: safeDate(record.timestamp, nextTimestamp()),
              rawRef
            });
          }
        }

        if (eventType === "agent_message") {
          const content = ensureText(payload.message);

          if (content.length > 0) {
            pushMessage("event_msg", {
              messageId: messageIdFromRawRef(rawRef),
              provider: this.providerId,
              providerSessionId,
              role: "assistant",
              kind: "text",
              content,
              toolCall: null,
              timestamp: safeDate(record.timestamp, nextTimestamp()),
              rawRef
            });
          }
        }

        if (eventType === "agent_reasoning") {
          const content = extractTextBlocks(payload.text ?? payload.message).trim();

          if (content.length > 0) {
            pushMessage("event_msg", {
              messageId: messageIdFromRawRef(rawRef),
              provider: this.providerId,
              providerSessionId,
              role: "assistant",
              kind: "thinking",
              content,
              toolCall: null,
              timestamp: safeDate(record.timestamp, nextTimestamp()),
              rawRef
            });
          }
        }
      }

      if (record.type === "response_item") {
        const payload = (record.payload ?? {}) as {
          type?: unknown;
          role?: unknown;
          content?: Array<Record<string, unknown>>;
          summary?: Array<Record<string, unknown>>;
          name?: unknown;
          arguments?: unknown;
          call_id?: unknown;
          input?: unknown;
          output?: unknown;
        };
        const payloadType = ensureText(payload.type);

        if (payloadType === "reasoning") {
          const content = extractTextFromArray(payload.summary);

          if (content.length === 0) {
            return;
          }

          pushMessage("response_item", {
            messageId: messageIdFromRawRef(rawRef),
            provider: this.providerId,
            providerSessionId,
            role: "assistant",
            kind: "thinking",
            content,
            toolCall: null,
            timestamp: safeDate(record.timestamp, nextTimestamp()),
            rawRef
          });
          return;
        }

        if (payloadType === "function_call" || payloadType === "custom_tool_call") {
          const callId = ensureText(payload.call_id).trim() || rawRef;
          const name = ensureText(payload.name).trim() || "tool";
          const inputSource = payloadType === "custom_tool_call" ? payload.input : payload.arguments;
          const input = stringifyStructuredValue(inputSource);
          toolNameById.set(callId, name);

          pushMessage("response_item", {
            messageId: messageIdFromRawRef(rawRef),
            provider: this.providerId,
            providerSessionId,
            role: "tool",
            kind: "tool_call",
            content: input,
            toolCall: {
              callId,
              name,
              input,
              output: null,
              error: null,
              status: "running"
            },
            timestamp: safeDate(record.timestamp, nextTimestamp()),
            rawRef
          });
          return;
        }

        if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
          const callId = ensureText(payload.call_id).trim() || rawRef;
          const name = toolNameById.get(callId) ?? "tool";
          const output = extractTextBlocks(payload.output).trim() || stringifyStructuredValue(payload.output);
          const resultState = resolveToolResultState(payload, output);

          pushMessage("response_item", {
            messageId: messageIdFromRawRef(rawRef),
            provider: this.providerId,
            providerSessionId,
            role: "tool",
            kind: "tool_result",
            content: output,
            toolCall: {
              callId,
              name,
              input: "",
              output: resultState.status === "failed" ? null : output,
              error: resultState.status === "failed" ? output : null,
              status: resultState.status
            },
            timestamp: safeDate(record.timestamp, nextTimestamp()),
            rawRef
          });
          return;
        }

        if (payloadType !== "message") {
          return;
        }

        const role = ensureText(payload.role);
        const content = extractTextFromArray(payload.content);

        if (content.length === 0 || (role !== "assistant" && role !== "user")) {
          return;
        }

        pushMessage("response_item", {
          messageId: messageIdFromRawRef(rawRef),
          provider: this.providerId,
          providerSessionId,
          role,
          kind: "text",
          content,
          toolCall: null,
          timestamp: safeDate(record.timestamp, nextTimestamp()),
          rawRef
        });
      }
    });

    return messages.map((entry) => entry.message);
  }
}

function buildCodexMessageDedupeKey(message: Omit<NormalizedMessage, "sequence">): string {
  const comparable = toComparableCodexMessage(message);

  return JSON.stringify({
    role: comparable.role,
    kind: comparable.kind,
    content: comparable.content,
    toolCall: comparable.toolCall
      ? {
          callId: comparable.toolCall.callId,
          name: comparable.toolCall.name,
          input: comparable.toolCall.input,
          output: comparable.toolCall.output,
          error: comparable.toolCall.error,
          status: comparable.toolCall.status
        }
      : null
  });
}

function codexMessageSourcePriority(source: CodexMessageSource): number {
  return source === "response_item" ? 2 : 1;
}

function isEquivalentCodexMessage(
  left: Pick<NormalizedMessage, "role" | "kind" | "content" | "timestamp" | "toolCall">,
  right: Pick<NormalizedMessage, "role" | "kind" | "content" | "timestamp" | "toolCall">
): boolean {
  const comparableLeft = toComparableCodexMessage(left);
  const comparableRight = toComparableCodexMessage(right);

  if (
    comparableLeft.role !== comparableRight.role ||
    comparableLeft.kind !== comparableRight.kind ||
    comparableLeft.content !== comparableRight.content
  ) {
    return false;
  }

  if (JSON.stringify(comparableLeft.toolCall) !== JSON.stringify(comparableRight.toolCall)) {
    return false;
  }

  return areCodexTimestampsNear(left.timestamp, right.timestamp);
}

function toComparableCodexMessage<
  T extends Pick<NormalizedMessage, "role" | "kind" | "content" | "toolCall">
>(message: T): {
  role: T["role"];
  kind: T["kind"];
  content: string;
  toolCall:
    | {
        callId: string;
        name: string;
        input: string;
        output: string | null;
        error: string | null;
        status: NonNullable<T["toolCall"]>["status"];
      }
    | null;
} {
  return {
    role: message.role,
    kind: message.kind,
    content: normalizeComparableCodexContent(message.kind, message.content),
    toolCall: message.toolCall
      ? {
          callId: message.toolCall.callId,
          name: message.toolCall.name,
          input: normalizeComparableCodexLineEndings(message.toolCall.input),
          output:
            message.toolCall.output === null
              ? null
              : normalizeComparableCodexLineEndings(message.toolCall.output),
          error:
            message.toolCall.error === null
              ? null
              : normalizeComparableCodexLineEndings(message.toolCall.error),
          status: message.toolCall.status
        }
      : null
  };
}

function normalizeComparableCodexContent(
  kind: NormalizedMessage["kind"],
  content: string
): string {
  const normalized = normalizeComparableCodexLineEndings(content);

  if (kind === "text" || kind === "thinking") {
    return normalized.trimEnd();
  }

  return normalized;
}

function normalizeComparableCodexLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function areCodexTimestampsNear(left: string, right: string): boolean {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);

  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return left === right;
  }

  return Math.abs(leftMs - rightMs) <= 1000;
}

function extractTextFromArray(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => extractTextBlocks(item).trim())
    .filter((item) => item.length > 0)
    .join("\n");
}

function resolveToolResultState(
  payload: Record<string, unknown>,
  output: string
): { status: "completed" | "failed" } {
  const statusText = ensureText(payload.status).trim().toLowerCase();

  if (statusText === "failed" || statusText === "error") {
    return { status: "failed" };
  }

  if (statusText === "completed" || statusText === "success" || statusText === "succeeded") {
    return { status: "completed" };
  }

  if (typeof payload.success === "boolean") {
    return {
      status: payload.success ? "completed" : "failed"
    };
  }

  if (typeof payload.is_error === "boolean") {
    return {
      status: payload.is_error ? "failed" : "completed"
    };
  }

  if (typeof payload.exit_code === "number") {
    return {
      status: payload.exit_code === 0 ? "completed" : "failed"
    };
  }

  const exitCodeMatch = output.match(/(?:^|\n)Exit code:\s*(-?\d+)/i);

  if (exitCodeMatch) {
    return {
      status: Number(exitCodeMatch[1]) === 0 ? "completed" : "failed"
    };
  }

  if (payload.error != null) {
    return { status: "failed" };
  }

  return { status: "completed" };
}

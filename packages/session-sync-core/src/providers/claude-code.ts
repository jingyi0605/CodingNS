import { basename, join } from "node:path";
import { statSync } from "node:fs";
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
  walkJsonlFiles,
  workspaceSlug
} from "./utils.js";

interface ClaudeCodeAdapterOptions {
  homeDir: string;
}

interface ClaudeMessageEnvelope {
  type: "user" | "assistant";
  timestamp: unknown;
  message: {
    content?: Array<Record<string, unknown>>;
  };
}

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly providerId: ProviderId = "claude-code";

  constructor(private readonly options: ClaudeCodeAdapterOptions) {}

  async detectSessions(workspacePath: string): Promise<ProviderSessionSummary[]> {
    const targetPath = normalizeWorkspacePath(workspacePath);
    const files = walkJsonlFiles(join(this.options.homeDir, "projects"));
    const sessions: ProviderSessionSummary[] = [];

    for (const filePath of files) {
      const records = readJsonLines(filePath);
      const typedRecords = records.map((record) => record.data);
      const matchesWorkspace = typedRecords.some(
        (record) => normalizeWorkspacePath(ensureText(record.cwd)) === targetPath
      );

      if (!matchesWorkspace) {
        continue;
      }

      const messages = this.parseMessages(filePath, typedRecords);
      const title =
        this.resolveClaudeTitle(typedRecords) ||
        messages.find((message) => message.role === "user")?.content.slice(0, 48) ||
        basename(filePath, ".jsonl");
      const lastMessageAt =
        messages.at(-1)?.timestamp ??
        (ensureText(typedRecords.at(-1)?.timestamp) || null);

      sessions.push({
        provider: this.providerId,
        providerSessionId: basename(filePath, ".jsonl"),
        title,
        workspacePath,
        rawStoreRef: filePath,
        lastMessageAt,
        messageCount: messages.length
      });
    }

    return sessions.sort((left, right) =>
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
    const records = readJsonLines(rawStoreRef).map((record) => record.data);
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
    let lastMtime = statSync(rawStoreRef).mtimeMs;

    const timer = setInterval(async () => {
      const nextStat = statSync(rawStoreRef);

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
    statSync(rawStoreRef);

    return {
      provider: this.providerId,
      providerSessionId,
      resumedAt: nextTimestamp(),
      rawStoreRef
    };
  }

  async startSession(
    workspacePath: string,
    options: StartSessionOptions
  ): Promise<StartSessionResult> {
    const sessionId = crypto.randomUUID();
    const projectDir = join(this.options.homeDir, "projects", workspaceSlug(workspacePath));
    ensureDirectory(projectDir);

    const filePath = join(projectDir, `${sessionId}.jsonl`);
    const now = nextTimestamp();

    appendJsonLine(filePath, {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: now,
      sessionId
    });

    if (options.initialPrompt) {
      appendJsonLine(filePath, {
        parentUuid: null,
        isSidechain: false,
        promptId: crypto.randomUUID(),
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: options.initialPrompt }]
        },
        uuid: crypto.randomUUID(),
        timestamp: now,
        cwd: workspacePath,
        sessionId
      });
    }

    appendJsonLine(filePath, {
      type: "ai-title",
      sessionId,
      aiTitle: options.initialPrompt?.slice(0, 48) || "New Claude Code session"
    });

    return {
      session: {
        provider: this.providerId,
        providerSessionId: sessionId,
        title: options.initialPrompt?.slice(0, 48) || "New Claude Code session",
        workspacePath,
        rawStoreRef: filePath,
        lastMessageAt: now,
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
    const records = readJsonLines(rawStoreRef).map((record) => record.data);
    const lineNumber = records.length + 1;
    const acceptedAt = nextTimestamp();
    const cwd =
      records
        .map((record) => ensureText(record.cwd))
        .find((value) => value.length > 0) ?? "";

    appendJsonLine(rawStoreRef, {
      parentUuid: null,
      isSidechain: false,
      promptId: crypto.randomUUID(),
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: content }]
      },
      uuid: crypto.randomUUID(),
      timestamp: acceptedAt,
      cwd,
      sessionId: providerSessionId,
      clientRequestId
    });

    const rawRef = createRawRef(this.providerId, rawStoreRef, lineNumber, 0);

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
          readJsonLines(rawStoreRef).map((record) => record.data),
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
      supportsSubagents: true,
      supportsInterrupt: false,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: false,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      limitations: ["当前实现只读取原生 jsonl，会话恢复不负责拉起外部 Claude 进程。"]
    };
  }

  async getSessionCapabilities(): Promise<ProviderCapabilities> {
    return this.getProviderCapabilities();
  }

  private resolveClaudeTitle(records: Array<Record<string, unknown>>): string {
    // Claude 会在会话过程中多次刷新 ai-title，取最后一个有效值才是当前标题。
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];

      if (record?.type !== "ai-title") {
        continue;
      }

      const title = ensureText(record.aiTitle).trim();

      if (title.length > 0) {
        return title;
      }
    }

    return "";
  }

  private parseMessages(
    filePath: string,
    records: Array<Record<string, unknown>>,
    providerSessionId = basename(filePath, ".jsonl")
  ): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];
    const toolNameById = new Map<string, string>();
    let sequence = 0;

    records.forEach((record, index) => {
      const lineNumber = index + 1;

      this.collectMessageEnvelopes(record).forEach((envelope) => {
        const parts = Array.isArray(envelope.message.content)
          ? envelope.message.content
          : [];

        parts.forEach((part, partIndex) => {
          const partType = ensureText(part.type);
          const rawRef = createRawRef(this.providerId, filePath, lineNumber, partIndex);

          if (envelope.type === "user") {
            if (partType === "tool_result") {
              const callId = ensureText(part.tool_use_id).trim() || rawRef;
              const toolName = toolNameById.get(callId) ?? "tool";
              const output = extractTextBlocks(part.content).trim() || stringifyStructuredValue(part.content);
              const isError = Boolean(part.is_error);

              if (output.length === 0) {
                return;
              }

              sequence += 1;
              messages.push({
                messageId: messageIdFromRawRef(rawRef),
                provider: this.providerId,
                providerSessionId,
                role: "tool",
                kind: "tool_result",
                content: output,
                toolCall: {
                  callId,
                  name: toolName,
                  input: "",
                  output: isError ? null : output,
                  error: isError ? output : null,
                  status: isError ? "failed" : "completed"
                },
                timestamp: safeDate(envelope.timestamp, nextTimestamp()),
                sequence,
                rawRef
              });
              return;
            }

            const content = extractTextBlocks(part).trim();

            if (content.length === 0) {
              return;
            }

            sequence += 1;
            messages.push({
              messageId: messageIdFromRawRef(rawRef),
              provider: this.providerId,
              providerSessionId,
              role: "user",
              kind: "text",
              content,
              toolCall: null,
              timestamp: safeDate(envelope.timestamp, nextTimestamp()),
              sequence,
              rawRef
            });
            return;
          }

          if (partType === "tool_use") {
            const callId = ensureText(part.id).trim() || rawRef;
            const name = ensureText(part.name).trim() || "tool";
            const input = stringifyStructuredValue(part.input);
            toolNameById.set(callId, name);

            if (name.length === 0 && input.length === 0) {
              return;
            }

            sequence += 1;
            messages.push({
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
              timestamp: safeDate(envelope.timestamp, nextTimestamp()),
              sequence,
              rawRef
            });
            return;
          }

          const content =
            partType === "thinking"
              ? extractTextBlocks(part.thinking).trim()
              : extractTextBlocks(part).trim();

          if (content.length === 0) {
            return;
          }

          sequence += 1;
          messages.push({
            messageId: messageIdFromRawRef(rawRef),
            provider: this.providerId,
            providerSessionId,
            role: "assistant",
            kind: partType === "thinking" ? "thinking" : "text",
            content,
            toolCall: null,
            timestamp: safeDate(envelope.timestamp, nextTimestamp()),
            sequence,
            rawRef
          });
        });
      });
    });

    return messages;
  }

  private collectMessageEnvelopes(record: Record<string, unknown>): ClaudeMessageEnvelope[] {
    const envelopes: ClaudeMessageEnvelope[] = [];
    const directType = ensureText(record.type);

    if (directType === "user" || directType === "assistant") {
      envelopes.push({
        type: directType,
        timestamp: record.timestamp,
        message: ((record.message ?? {}) as ClaudeMessageEnvelope["message"])
      });
    }

    const progressMessage = this.readProgressEnvelope(record);

    if (progressMessage) {
      envelopes.push(progressMessage);
    }

    return envelopes;
  }

  private readProgressEnvelope(record: Record<string, unknown>): ClaudeMessageEnvelope | null {
    if (ensureText(record.type) !== "progress") {
      return null;
    }

    const nested = (((record.data ?? {}) as Record<string, unknown>).message ?? {}) as Record<string, unknown>;
    const nestedType = ensureText(nested.type);

    if (nestedType !== "user" && nestedType !== "assistant") {
      return null;
    }

    return {
      type: nestedType,
      timestamp: nested.timestamp ?? record.timestamp,
      message: ((nested.message ?? {}) as ClaudeMessageEnvelope["message"])
    };
  }
}

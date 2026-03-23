import { basename, join } from "node:path";
import { statSync } from "node:fs";
import crypto from "node:crypto";

import type {
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
  ensureText,
  messageIdFromRawRef,
  nextTimestamp,
  normalizeWorkspacePath,
  readJsonLines,
  safeDate,
  sliceHistory,
  walkJsonlFiles,
  workspaceSlug
} from "./utils.js";

interface ClaudeCodeAdapterOptions {
  homeDir: string;
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
      const titleRecord = typedRecords.find((record) => record.type === "ai-title");
      const title = ensureText(titleRecord?.aiTitle) || basename(filePath, ".jsonl");
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
    limit: number
  ): Promise<HistoryPage> {
    const records = readJsonLines(rawStoreRef).map((record) => record.data);
    const messages = this.parseMessages(rawStoreRef, records, providerSessionId);
    return sliceHistory(messages, cursor, limit);
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
        content,
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

  private parseMessages(
    filePath: string,
    records: Array<Record<string, unknown>>,
    providerSessionId = basename(filePath, ".jsonl")
  ): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];
    let sequence = 0;

    records.forEach((record, index) => {
      const lineNumber = index + 1;

      if (record.type === "user") {
        const message = (record.message ?? {}) as {
          content?: Array<Record<string, unknown>>;
        };
        const parts = Array.isArray(message.content)
          ? message.content
          : [];

        parts.forEach((part, partIndex) => {
          const partType = ensureText(part.type);
          const role = partType === "tool_result" ? "tool" : "user";
          const content = ensureText(part.text ?? part.content);
          const rawRef = createRawRef(this.providerId, filePath, lineNumber, partIndex);

          if (content.length === 0) {
            return;
          }

          sequence += 1;
          messages.push({
            messageId: messageIdFromRawRef(rawRef),
            provider: this.providerId,
            providerSessionId,
            role,
            content,
            timestamp: safeDate(record.timestamp, nextTimestamp()),
            sequence,
            rawRef
          });
        });
      }

      if (record.type === "assistant") {
        const message = (record.message ?? {}) as {
          content?: Array<Record<string, unknown>>;
        };
        const parts = Array.isArray(message.content)
          ? message.content
          : [];

        parts.forEach((part, partIndex) => {
          const partType = ensureText(part.type);
          const rawRef = createRawRef(this.providerId, filePath, lineNumber, partIndex);
          let role: NormalizedMessage["role"] = "assistant";
          let content = "";

          if (partType === "text") {
            content = ensureText(part.text);
          } else if (partType === "thinking") {
            content = ensureText(part.thinking);
          } else if (partType === "tool_use") {
            role = "tool";
            content = `[${ensureText(part.name)}] ${ensureText(part.input)}`;
          }

          if (content.length === 0) {
            return;
          }

          sequence += 1;
          messages.push({
            messageId: messageIdFromRawRef(rawRef),
            provider: this.providerId,
            providerSessionId,
            role,
            content,
            timestamp: safeDate(record.timestamp, nextTimestamp()),
            sequence,
            rawRef
          });
        });
      }
    });

    return messages;
  }
}

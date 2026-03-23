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
  walkJsonlFiles
} from "./utils.js";

interface CodexAdapterOptions {
  homeDir: string;
}

export class CodexAdapter implements ProviderAdapter {
  readonly providerId: ProviderId = "codex";

  constructor(private readonly options: CodexAdapterOptions) {}

  async detectSessions(workspacePath: string): Promise<ProviderSessionSummary[]> {
    const targetPath = normalizeWorkspacePath(workspacePath);
    const files = walkJsonlFiles(join(this.options.homeDir, "sessions"));
    const sessions: ProviderSessionSummary[] = [];

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
      const title =
        messages.find((message) => message.role === "user")?.content.slice(0, 48) ||
        providerSessionId;
      const lastMessageAt =
        messages.at(-1)?.timestamp ?? (ensureText(metaPayload.timestamp) || null);

      sessions.push({
        provider: this.providerId,
        providerSessionId,
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
    const lineNumber = readJsonLines(rawStoreRef).length + 1;
    const acceptedAt = nextTimestamp();

    appendJsonLine(rawStoreRef, {
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

  private parseMessages(
    filePath: string,
    records: Array<Record<string, unknown>>,
    providerSessionId: string
  ): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];
    let sequence = 0;

    records.forEach((record, index) => {
      const lineNumber = index + 1;
      const rawRef = createRawRef(this.providerId, filePath, lineNumber);

      if (record.type === "event_msg") {
        const payload = (record.payload ?? {}) as Record<string, unknown>;
        const eventType = ensureText(payload.type);

        if (eventType === "user_message") {
          const content = ensureText(payload.message);

          if (content.length > 0) {
            sequence += 1;
            messages.push({
              messageId: messageIdFromRawRef(rawRef),
              provider: this.providerId,
              providerSessionId,
              role: "user",
              content,
              timestamp: safeDate(record.timestamp, nextTimestamp()),
              sequence,
              rawRef
            });
          }
        }

        if (eventType === "agent_message") {
          const content = ensureText(payload.message);

          if (content.length > 0) {
            sequence += 1;
            messages.push({
              messageId: messageIdFromRawRef(rawRef),
              provider: this.providerId,
              providerSessionId,
              role: "assistant",
              content,
              timestamp: safeDate(record.timestamp, nextTimestamp()),
              sequence,
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
        };
        const payloadType = ensureText(payload.type);

        if (payloadType !== "message") {
          return;
        }

        const role = ensureText(payload.role);
        const contentArray = Array.isArray(payload.content)
          ? payload.content
          : [];
        const content = contentArray
          .map((item) => ensureText(item.text))
          .filter((item) => item.length > 0)
          .join("\n");

        if (content.length === 0 || (role !== "assistant" && role !== "user")) {
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
      }
    });

    return messages;
  }
}

import type Database from "better-sqlite3";

import {
  CapabilityService,
  ClaudeCodeAdapter,
  CodexAdapter,
  ProviderRegistry,
  SessionSyncService,
  type HistoryPage,
  type ProviderCapabilities,
  type ProviderRealtimeEvent,
  type SendMessageResult,
  type ProviderSubscription
} from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { SessionListItem, SessionStatusSnapshot } from "../../types/domain.js";
import type { SessionBindingRepository } from "../../storage/repositories/session-binding-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionStatusSnapshotRepository } from "../../storage/repositories/session-status-snapshot-repository.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";

interface StartSessionInput {
  workspaceId: string;
  provider: string;
  initialPrompt?: string;
}

interface RealtimeEnvelope {
  type: "session.backfill" | "session.delta";
  sessionId: string;
  cursor: string | null;
  messages: HistoryPage["messages"];
}

export class SessionRuntimeService {
  private readonly providerRegistry: ProviderRegistry;
  private readonly sessionSyncService: SessionSyncService;
  private readonly capabilityService: CapabilityService;

  constructor(
    private readonly db: Database.Database,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly sessionBindingRepository: SessionBindingRepository,
    private readonly sessionIndexRepository: SessionIndexRepository,
    private readonly sessionStatusSnapshotRepository: SessionStatusSnapshotRepository,
    config: HostConfig
  ) {
    this.providerRegistry = new ProviderRegistry([
      new ClaudeCodeAdapter({ homeDir: config.claudeCodeHomeDir }),
      new CodexAdapter({ homeDir: config.codexHomeDir })
    ]);
    this.sessionSyncService = new SessionSyncService(this.providerRegistry);
    this.capabilityService = new CapabilityService(this.providerRegistry);
  }

  async discoverWorkspaceSessions(workspaceId: string): Promise<SessionListItem[]> {
    const workspace = this.getWorkspaceOrThrow(workspaceId);
    const sessions = await this.sessionSyncService
      .discoverWorkspaceSessions(workspace.path)
      .catch((error) => {
        throw this.mapProviderError(error);
      });
    const timestamp = nowIso();

    const persist = this.db.transaction(() => {
      for (const session of sessions) {
        const existing = this.sessionBindingRepository.findByProviderSession(
          session.provider,
          session.providerSessionId
        );
        const currentSnapshot = existing
          ? this.sessionStatusSnapshotRepository.findBySessionId(existing.sessionId)
          : null;
        const sessionId = existing?.sessionId ?? createId();
        const createdAt = existing?.createdAt ?? timestamp;

        this.sessionBindingRepository.upsert({
          sessionId,
          workspaceId: workspace.id,
          provider: session.provider,
          providerSessionId: session.providerSessionId,
          rawStoreRef: session.rawStoreRef,
          createdAt,
          updatedAt: timestamp
        });
        this.sessionIndexRepository.upsert({
          sessionId,
          workspaceId: workspace.id,
          provider: session.provider,
          title: session.title,
          messageCount: session.messageCount,
          lastMessageAt: session.lastMessageAt,
          createdAt,
          updatedAt: timestamp
        });
        this.sessionStatusSnapshotRepository.upsert({
          sessionId,
          syncStatus: currentSnapshot?.syncStatus ?? "idle",
          syncCursor: currentSnapshot?.syncCursor ?? null,
          lastSyncAt: currentSnapshot?.lastSyncAt ?? null,
          lastErrorCode: currentSnapshot?.lastErrorCode ?? null,
          lastErrorDetail: currentSnapshot?.lastErrorDetail ?? null,
          resumedAt: currentSnapshot?.resumedAt ?? null,
          updatedAt: timestamp
        });
      }
    });

    persist();
    return this.sessionIndexRepository.listByWorkspace(workspaceId);
  }

  async readSessionHistory(
    sessionId: string,
    cursor: string | null,
    limit: number
  ): Promise<HistoryPage> {
    const binding = this.getBindingOrThrow(sessionId);
    const current = this.sessionStatusSnapshotRepository.findBySessionId(sessionId);

    this.upsertSnapshot(sessionId, {
      syncStatus: "syncing",
      syncCursor: current?.syncCursor ?? cursor,
      lastSyncAt: current?.lastSyncAt ?? null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: current?.resumedAt ?? null
    });

    try {
      const page = await this.sessionSyncService.readHistory(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        cursor,
        clampLimit(limit)
      );

      this.upsertSnapshot(sessionId, {
        syncStatus: "idle",
        syncCursor: page.cursor,
        lastSyncAt: nowIso(),
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: current?.resumedAt ?? null
      });

      return page;
    } catch (error) {
      this.markSessionError(sessionId, "PROVIDER_READ_FAILED", error);
      throw this.mapProviderError(error);
    }
  }

  getSession(sessionId: string): SessionListItem {
    return this.getSessionListItemOrThrow(sessionId);
  }

  getProviderCapabilities(provider: string): ProviderCapabilities {
    try {
      return this.capabilityService.getProviderCapabilities(provider);
    } catch (error) {
      throw this.mapProviderError(error);
    }
  }

  async getSessionCapabilities(sessionId: string): Promise<ProviderCapabilities> {
    const binding = this.getBindingOrThrow(sessionId);

    return this.capabilityService
      .getSessionCapabilities(binding.provider, binding.providerSessionId)
      .catch((error) => {
        throw this.mapProviderError(error);
      });
  }

  async resumeSession(sessionId: string): Promise<{
    sessionId: string;
    provider: string;
    providerSessionId: string;
    resumedAt: string;
  }> {
    const binding = this.getBindingOrThrow(sessionId);

    try {
      const result = await this.sessionSyncService.resumeSession(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef
      );

      this.upsertSnapshot(sessionId, {
        syncStatus: "idle",
        syncCursor:
          this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.syncCursor ?? null,
        lastSyncAt: result.resumedAt,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: result.resumedAt
      });

      return {
        sessionId,
        provider: result.provider,
        providerSessionId: result.providerSessionId,
        resumedAt: result.resumedAt
      };
    } catch (error) {
      this.markSessionError(sessionId, "RESUME_FAILED", error);
      throw this.mapProviderError(error);
    }
  }

  async startSession(input: StartSessionInput): Promise<SessionListItem> {
    const workspace = this.getWorkspaceOrThrow(input.workspaceId);

    try {
      const result = await this.sessionSyncService.startSession(input.provider, workspace.path, {
        initialPrompt: input.initialPrompt
      });
      const sessionId = createId();
      const timestamp = nowIso();

      const persist = this.db.transaction(() => {
        this.sessionBindingRepository.upsert({
          sessionId,
          workspaceId: workspace.id,
          provider: result.session.provider,
          providerSessionId: result.session.providerSessionId,
          rawStoreRef: result.session.rawStoreRef,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        this.sessionIndexRepository.upsert({
          sessionId,
          workspaceId: workspace.id,
          provider: result.session.provider,
          title: result.session.title,
          messageCount: result.session.messageCount,
          lastMessageAt: result.session.lastMessageAt,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        this.sessionStatusSnapshotRepository.upsert({
          sessionId,
          syncStatus: "idle",
          syncCursor: result.initialCursor,
          lastSyncAt: timestamp,
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          updatedAt: timestamp
        });
      });

      persist();
      return this.getSessionListItemOrThrow(sessionId);
    } catch (error) {
      throw this.mapProviderError(error);
    }
  }

  async sendMessage(
    sessionId: string,
    content: string,
    clientRequestId: string | null
  ): Promise<SendMessageResult & { sessionId: string }> {
    const binding = this.getBindingOrThrow(sessionId);
    const result = await this.sessionSyncService
      .sendMessage(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        content,
        clientRequestId
      )
      .catch((error) => {
        this.markSessionError(sessionId, "SEND_FAILED", error);
        throw this.mapProviderError(error);
      });

    const existing = this.sessionIndexRepository.findBySessionId(sessionId);

    this.sessionIndexRepository.upsert({
      sessionId,
      workspaceId: binding.workspaceId,
      provider: binding.provider,
      title: existing?.title ?? result.message.content.slice(0, 48),
      messageCount: (existing?.messageCount ?? 0) + 1,
      lastMessageAt: result.message.timestamp,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: result.message.timestamp
    });
    this.upsertSnapshot(sessionId, {
      syncStatus: "idle",
      syncCursor: this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.syncCursor ?? null,
      lastSyncAt: result.acceptedAt,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt:
        this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
    });

    return {
      sessionId,
      ...result
    };
  }

  async subscribeSession(
    sessionId: string,
    cursor: string | null,
    limit: number,
    onEnvelope: (envelope: RealtimeEnvelope) => Promise<void> | void
  ): Promise<ProviderSubscription> {
    const binding = this.getBindingOrThrow(sessionId);
    const sentMessageIds = new Set<string>();
    const safeLimit = clampLimit(limit);
    let currentCursor = cursor;
    const current = this.sessionStatusSnapshotRepository.findBySessionId(sessionId);

    this.upsertSnapshot(sessionId, {
      syncStatus: "syncing",
      syncCursor: current?.syncCursor ?? cursor,
      lastSyncAt: current?.lastSyncAt ?? null,
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: current?.resumedAt ?? null
    });

    while (true) {
      const page = await this.readPage(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        currentCursor,
        safeLimit
      );
      const messages = page.messages.filter((message) => {
        if (sentMessageIds.has(message.messageId)) {
          return false;
        }

        sentMessageIds.add(message.messageId);
        return true;
      });

      if (messages.length > 0) {
        this.upsertSnapshot(sessionId, {
          syncStatus: "idle",
          syncCursor: page.cursor,
          lastSyncAt: nowIso(),
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt:
            this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
        });

        await onEnvelope({
          type: "session.backfill",
          sessionId,
          cursor: page.cursor,
          messages
        });
      }

      currentCursor = page.cursor;

      if (!page.nextCursor) {
        break;
      }
    }

    try {
      return this.sessionSyncService.subscribe(
        binding.provider,
        binding.providerSessionId,
        binding.rawStoreRef,
        currentCursor,
        safeLimit,
        async (event: ProviderRealtimeEvent) => {
          const messages = event.messages.filter((message) => {
            if (sentMessageIds.has(message.messageId)) {
              return false;
            }

            sentMessageIds.add(message.messageId);
            return true;
          });

          if (messages.length === 0) {
            return;
          }

          this.upsertSnapshot(sessionId, {
            syncStatus: "idle",
            syncCursor: event.cursor,
            lastSyncAt: nowIso(),
            lastErrorCode: null,
            lastErrorDetail: null,
            resumedAt:
              this.sessionStatusSnapshotRepository.findBySessionId(sessionId)?.resumedAt ?? null
          });

          await onEnvelope({
            type: "session.delta",
            sessionId,
            cursor: event.cursor,
            messages
          });
        }
      );
    } catch (error) {
      this.markSessionError(sessionId, "SUBSCRIBE_FAILED", error);
      throw this.mapProviderError(error);
    }
  }

  private async readPage(
    provider: string,
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number
  ): Promise<HistoryPage> {
    return this.sessionSyncService
      .readHistory(provider, providerSessionId, rawStoreRef, cursor, limit)
      .catch((error) => {
        throw this.mapProviderError(error);
      });
  }

  private getWorkspaceOrThrow(workspaceId: string) {
    const workspace = this.workspaceRepository.findById(workspaceId);

    if (!workspace) {
      throw new AppError({
        statusCode: 404,
        errorCode: "WORKSPACE_NOT_FOUND",
        detail: "指定工作区不存在"
      });
    }

    return workspace;
  }

  private getBindingOrThrow(sessionId: string) {
    const binding = this.sessionBindingRepository.findBySessionId(sessionId);

    if (!binding) {
      throw new AppError({
        statusCode: 404,
        errorCode: "SESSION_NOT_FOUND",
        detail: "指定会话不存在"
      });
    }

    return binding;
  }

  private getSessionListItemOrThrow(sessionId: string): SessionListItem {
    const item = this.sessionIndexRepository.findBySessionId(sessionId);

    if (!item) {
      throw new AppError({
        statusCode: 500,
        errorCode: "SESSION_INDEX_MISSING",
        detail: "会话索引缺失"
      });
    }

    return item;
  }

  private upsertSnapshot(
    sessionId: string,
    input: Omit<SessionStatusSnapshot, "sessionId" | "updatedAt">
  ): void {
    this.sessionStatusSnapshotRepository.upsert({
      sessionId,
      ...input,
      updatedAt: nowIso()
    });
  }

  private markSessionError(sessionId: string, errorCode: string, error: unknown): void {
    const current = this.sessionStatusSnapshotRepository.findBySessionId(sessionId);

    this.sessionStatusSnapshotRepository.upsert({
      sessionId,
      syncStatus: "error",
      syncCursor: current?.syncCursor ?? null,
      lastSyncAt: current?.lastSyncAt ?? null,
      lastErrorCode: errorCode,
      lastErrorDetail: error instanceof Error ? error.message : "unknown",
      resumedAt: current?.resumedAt ?? null,
      updatedAt: nowIso()
    });
  }

  private mapProviderError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error && error.message === "PROVIDER_NOT_SUPPORTED") {
      return new AppError({
        statusCode: 400,
        errorCode: "PROVIDER_NOT_SUPPORTED",
        detail: "当前阶段只支持 claude-code 和 codex"
      });
    }

    if (error instanceof Error && error.message === "CURSOR_INVALID") {
      return new AppError({
        statusCode: 400,
        errorCode: "CURSOR_INVALID",
        detail: "分页游标无效",
        field: "cursor"
      });
    }

    return new AppError({
      statusCode: 502,
      errorCode: "PROVIDER_IO_ERROR",
      detail: error instanceof Error ? error.message : "provider 读写失败"
    });
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(Math.trunc(limit), 100));
}

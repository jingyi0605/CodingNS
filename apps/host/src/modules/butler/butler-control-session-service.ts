import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerControlSession,
  ButlerControlSessionPurpose,
  ButlerProfile,
  SessionListItem
} from "../../types/domain.js";
import type { ButlerControlSessionRepository } from "../../storage/repositories/butler-control-session-repository.js";
import {
  type ButlerProfileService
} from "./butler-profile-service.js";
import type { ButlerAuthService } from "./butler-auth-service.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import type { SessionMessageOriginRepository } from "../../storage/repositories/session-message-origin-repository.js";
import type { ButlerContextAggregator, ButlerPromptContext } from "./context-aggregator.js";
import type { SkillManagerService } from "../skills/skill-manager-service.js";
import { syncButlerWorkspaceContext } from "./butler-workspace-context.js";
import { recordButlerProxyMessageOrigin } from "../sessions/session-message-origin-utils.js";

export interface ButlerControlSessionView extends ButlerControlSession {
  session: SessionListItem;
}

export interface StartButlerControlSessionInput {
  content?: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
  purpose?: ButlerControlSessionPurpose;
  title?: string | null;
  sourceItemId?: string | null;
}

export interface SendButlerControlMessageInput extends StartButlerControlSessionInput {
  content?: string;
  controlSessionId?: string | null;
}

export class ButlerControlSessionService {
  constructor(
    private readonly butlerProfileService: ButlerProfileService,
    private readonly butlerControlSessionRepository: ButlerControlSessionRepository,
    private readonly workspaceService: Pick<WorkspaceService, "importWorkspace">,
    private readonly sessionHistoryService: Pick<
      SessionHistoryService,
      "getSession" | "resumeSession"
    >,
    private readonly sessionLiveRuntimeService: Pick<
      SessionLiveRuntimeService,
      "startLiveSession" | "sendLiveMessage"
    >,
    private readonly butlerContextAggregator: Pick<ButlerContextAggregator, "resolvePromptContext">,
    private readonly butlerAuthService: Pick<ButlerAuthService, "ensureWorkspaceCredential" | "getCredentialFilePath">,
    private readonly skillManagerService: Pick<SkillManagerService, "getOverview" | "importUnmanagedSkill">,
    private readonly codexHomeDir: string | null = null,
    private readonly sourceCodexHomeDir: string | null = null,
    private readonly claudeCodeHomeDir: string | null = null,
    private readonly sessionMessageOriginRepository: Pick<
      SessionMessageOriginRepository,
      "upsert"
    > | null = null
  ) {}

  getCurrentSession(userId: string): ButlerControlSessionView | null {
    const profile = this.butlerProfileService.ensureInitialized();
    const current = this.butlerControlSessionRepository.findLatestOpenByProvider(profile.providerId);

    if (!current) {
      return null;
    }

    return this.toView(current, userId);
  }

  getSession(controlSessionId: string, userId: string): ButlerControlSessionView | null {
    const current = this.butlerControlSessionRepository.findById(controlSessionId.trim());

    if (!current) {
      return null;
    }

    return this.toView(current, userId);
  }

  listSessions(userId: string): ButlerControlSessionView[] {
    const profile = this.butlerProfileService.ensureInitialized();
    return this.butlerControlSessionRepository
      .listByProvider(profile.providerId)
      .map((record) => this.toView(record, userId));
  }

  resetCurrentSession(): void {
    const profile = this.butlerProfileService.ensureInitialized();
    const current = this.butlerControlSessionRepository.findLatestOpenByProvider(profile.providerId);

    if (!current || current.status === "closed") {
      return;
    }

    this.butlerControlSessionRepository.update({
      ...current,
      status: "closed",
      updatedAt: nowIso()
    });
  }

  async startSession(
    userId: string,
    input: StartButlerControlSessionInput = {}
  ): Promise<ButlerControlSessionView> {
    const profile = this.butlerProfileService.ensureInitialized();
    const content = normalizeControlContent(input.content, "");
    const model = normalizeNullableText(input.model);
    const reasoningLevel = normalizeNullableText(input.reasoningLevel);
    const permissionMode = normalizeNullableText(input.permissionMode);
    const clientRequestId = normalizeNullableText(input.clientRequestId)
      ?? `assistant-origin:butler-control-start:${createId()}`;
    const promptContext = await this.butlerContextAggregator.resolvePromptContext(userId, input.content ?? null);
    const workspace = this.prepareWorkspace(profile, promptContext, userId);
    const current = this.butlerControlSessionRepository.findLatestOpenByProvider(profile.providerId);

    if (current && current.status !== "closed") {
      this.butlerControlSessionRepository.update({
        ...current,
        status: "closed",
        updatedAt: nowIso()
      });
    }

    const started = await this.sessionLiveRuntimeService.startLiveSession({
      workspaceId: workspace.id,
      userId,
      provider: profile.providerId,
      content,
      clientRequestId,
      runtimeOptions: {
        model,
        reasoningLevel,
        permissionMode,
        attachments: []
      }
    });
    recordButlerProxyMessageOrigin(this.sessionMessageOriginRepository, {
      sessionId: started.sessionId,
      clientRequestId,
      messageId: started.message?.messageId ?? null,
      content,
      createdAt: started.acceptedAt,
      fallbackKey: `butler-control-start:${started.sessionId}:${started.acceptedAt}`
    });
    const timestamp = started.acceptedAt;
    const created = this.butlerControlSessionRepository.create({
      id: createId(),
      providerId: profile.providerId,
      sessionId: started.sessionId,
      purpose: input.purpose ?? "chat",
      title: normalizeNullableText(input.title),
      sourceItemId: normalizeNullableText(input.sourceItemId),
      model,
      reasoningLevel,
      permissionMode,
      status: "running",
      lastContextVersion: promptContext.version,
      lastSummary: normalizeNullableText(input.title) ?? summarizeMessage(content),
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return this.toView(created, userId);
  }

  async resumeCurrentSession(
    userId: string
  ): Promise<ButlerControlSessionView & {
    resumedAt: string;
    provider: string;
    providerSessionId: string;
  }> {
    const profile = this.butlerProfileService.ensureInitialized();
    const current = this.requireCurrentSession(profile.providerId);
    const promptContext = await this.butlerContextAggregator.resolvePromptContext(userId, null);
    this.syncWorkspaceContext(profile, promptContext, userId);

    try {
      const resumed = await this.sessionHistoryService.resumeSession(current.sessionId);
      const updated = this.butlerControlSessionRepository.update({
        ...current,
        status: "running",
        lastContextVersion: promptContext.version,
        updatedAt: resumed.resumedAt
      });

      return {
        ...this.toView(updated, userId),
        resumedAt: resumed.resumedAt,
        provider: resumed.provider,
        providerSessionId: resumed.providerSessionId
      };
    } catch (error) {
      this.markFailed(current, "控制会话续接失败");
      throw error;
    }
  }

  async sendMessage(
    userId: string,
    input: SendButlerControlMessageInput
  ): Promise<{
    controlSession: ButlerControlSessionView;
    sessionId: string;
    provider: string;
    providerSessionId: string;
    acceptedAt: string;
    clientRequestId: string | null;
    message: Awaited<ReturnType<SessionLiveRuntimeService["sendLiveMessage"]>>["message"];
  }> {
    const profile = this.butlerProfileService.ensureInitialized();
    const current =
      input.controlSessionId?.trim()
        ? this.requireSessionById(input.controlSessionId, profile.providerId)
        : this.requireCurrentSession(profile.providerId);
    const content = normalizeControlContent(input.content, "");
    const requestedAt = nowIso();
    const clientRequestId = recordButlerProxyMessageOrigin(this.sessionMessageOriginRepository, {
      sessionId: current.sessionId,
      clientRequestId: normalizeNullableText(input.clientRequestId),
      content,
      createdAt: requestedAt,
      fallbackKey: `butler-control-send:${current.id}:${requestedAt}`
    });
    const model = normalizeNullableText(input.model) ?? current.model;
    const reasoningLevel = normalizeNullableText(input.reasoningLevel) ?? current.reasoningLevel;
    const permissionMode = normalizeNullableText(input.permissionMode) ?? current.permissionMode;
    const promptContext = await this.butlerContextAggregator.resolvePromptContext(userId, content);
    this.syncWorkspaceContext(profile, promptContext, userId);

    try {
      const result = await this.sessionLiveRuntimeService.sendLiveMessage({
        sessionId: current.sessionId,
        userId,
        content,
        clientRequestId,
        runtimeOptions: {
          model,
          reasoningLevel,
          permissionMode,
          attachments: []
        }
      });
      recordButlerProxyMessageOrigin(this.sessionMessageOriginRepository, {
        sessionId: current.sessionId,
        clientRequestId,
        messageId: result.message?.messageId ?? null,
        content,
        createdAt: result.acceptedAt,
        fallbackKey: `butler-control-send:${current.id}:${result.acceptedAt}`
      });
      const updated = this.butlerControlSessionRepository.update({
        ...current,
        model,
        reasoningLevel,
        permissionMode,
        status: "running",
        lastContextVersion: promptContext.version,
        lastSummary: summarizeMessage(content),
        updatedAt: result.acceptedAt
      });

      return {
        controlSession: this.toView(updated, userId),
        sessionId: result.sessionId,
        provider: result.provider,
        providerSessionId: result.providerSessionId,
        acceptedAt: result.acceptedAt,
        clientRequestId: result.clientRequestId,
        message: result.message
      };
    } catch (error) {
      this.markFailed(current, summarizeMessage(content));
      throw error;
    }
  }

  private requireCurrentSession(providerId: ButlerProfile["providerId"]): ButlerControlSession {
    const current = this.butlerControlSessionRepository.findLatestOpenByProvider(providerId);

    if (!current || current.status === "closed") {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_CONTROL_SESSION_NOT_FOUND",
        detail: "当前 provider 下还没有可用的助手控制会话"
      });
    }

    return current;
  }

  private requireSessionById(
    controlSessionId: string,
    providerId: ButlerProfile["providerId"]
  ): ButlerControlSession {
    const record = this.butlerControlSessionRepository.findById(controlSessionId.trim());

    if (!record || record.providerId !== providerId || record.status === "closed") {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_CONTROL_SESSION_NOT_FOUND",
        detail: "指定的助手会话不存在或已经关闭"
      });
    }

    return record;
  }

  private toView(record: ButlerControlSession, userId: string): ButlerControlSessionView {
    return {
      ...record,
      session: this.sessionHistoryService.getSession(record.sessionId, userId)
    };
  }

  private prepareWorkspace(profile: ButlerProfile, promptContext: ButlerPromptContext, userId: string) {
    this.syncWorkspaceContext(profile, promptContext, userId);
    return this.workspaceService.importWorkspace(profile.workspacePath, "代码助手");
  }

  private syncWorkspaceContext(profile: ButlerProfile, promptContext: ButlerPromptContext, userId: string): void {
    syncButlerWorkspaceContext({
      profile,
      promptContext,
      userId,
      butlerAuthService: this.butlerAuthService,
      skillManagerService: this.skillManagerService,
      codexHomeDir: this.codexHomeDir,
      sourceCodexHomeDir: this.sourceCodexHomeDir,
      claudeCodeHomeDir: this.claudeCodeHomeDir
    });
  }

  private markFailed(record: ButlerControlSession, fallbackSummary: string): void {
    this.butlerControlSessionRepository.update({
      ...record,
      status: "failed",
      lastSummary: record.lastSummary ?? fallbackSummary,
      updatedAt: nowIso()
    });
  }

  updateSessionStatusBySessionId(input: {
    sessionId: string;
    status: ButlerControlSession["status"];
    lastSummary?: string | null;
  }): ButlerControlSession | null {
    const current = this.butlerControlSessionRepository.findBySessionId(input.sessionId.trim());

    if (!current) {
      return null;
    }

    return this.butlerControlSessionRepository.update({
      ...current,
      status: input.status,
      lastSummary: normalizeNullableText(input.lastSummary) ?? current.lastSummary,
      updatedAt: nowIso()
    });
  }
}

function normalizeControlContent(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() ?? fallback.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "发送控制会话消息必须提供 content",
      field: "content"
    });
  }

  return normalized;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function summarizeMessage(content: string): string {
  return content.length > 120 ? `${content.slice(0, 117)}...` : content;
}

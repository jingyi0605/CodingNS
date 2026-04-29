import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerControlSession,
  ButlerControlSessionPurpose,
  ButlerProfile,
  ButlerProfileProviderId,
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
import type { AssistantSandboxService } from "./assistant-sandbox-service.js";
import type { SessionProviderUsageLimitGuardService } from "../sessions/session-provider-usage-guard-service.js";
import type { ProviderControlRepository } from "../../storage/repositories/provider-control-repository.js";
import { createProviderDisabledError } from "../provider/provider-disabled.js";

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

interface PreparedButlerWorkspace {
  workspaceId: string;
  sandboxId: string | null;
}

export class ButlerControlSessionService {
  private readonly providerControlRepository: Pick<ProviderControlRepository, "get">;

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
    private readonly skillManagerService: Pick<
      SkillManagerService,
      "getOverview" | "importUnmanagedSkill" | "listAssistantRuntimeSkillSources"
    >,
    private readonly codexHomeDir: string | null = null,
    private readonly sourceCodexHomeDir: string | null = null,
    private readonly claudeCodeHomeDir: string | null = null,
    private readonly sourceClaudeCodeHomeDir: string | null = null,
    private readonly sessionMessageOriginRepository: Pick<
      SessionMessageOriginRepository,
      "upsert"
    > | null = null,
    private readonly assistantSandboxService: Pick<
      AssistantSandboxService,
      "createSandbox" | "listSandboxes" | "markSandboxUsedByControlSession" | "removeSandbox"
    > | null = null,
    private readonly providerUsageLimitGuardService: Pick<
      SessionProviderUsageLimitGuardService,
      "resolveBlockingInspection" | "createBlockedAppError"
    > | null = null,
    providerControlRepository: Pick<ProviderControlRepository, "get"> | null = null
  ) {
    this.providerControlRepository = providerControlRepository ?? {
      get: (providerId: string) => ({
        providerId: providerId.trim(),
        enabled: true,
        updatedAt: ""
      })
    };
  }

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
    return this.startSessionInternal(userId, profile.providerId, input, {
      closeExistingCurrent: true
    });
  }

  async startSessionForProvider(
    userId: string,
    providerId: ButlerProfileProviderId,
    input: StartButlerControlSessionInput = {}
  ): Promise<ButlerControlSessionView> {
    return this.startSessionInternal(userId, providerId, input, {
      closeExistingCurrent: false
    });
  }

  private assertProviderEnabled(providerId: string): void {
    if (this.providerControlRepository.get(providerId).enabled) {
      return;
    }

    throw createProviderDisabledError(providerId, "providerId");
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
    await this.ensureSessionCanStartWork(current.sessionId, userId, "助手控制会话");
    const promptContext = await this.butlerContextAggregator.resolvePromptContext(userId, null);
    this.syncWorkspaceContext(
      profile,
      promptContext,
      userId,
      this.resolveControlSessionWorkspacePath(profile, current.id, userId)
    );

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
    return this.sendMessageInternal(userId, current, input);
  }

  async sendMessageToSession(
    userId: string,
    input: SendButlerControlMessageInput & {
      controlSessionId: string;
    }
  ): Promise<{
    controlSession: ButlerControlSessionView;
    sessionId: string;
    provider: string;
    providerSessionId: string;
    acceptedAt: string;
    clientRequestId: string | null;
    message: Awaited<ReturnType<SessionLiveRuntimeService["sendLiveMessage"]>>["message"];
  }> {
    const current = this.requireSessionByIdAnyProvider(input.controlSessionId);
    return this.sendMessageInternal(userId, current, input);
  }

  private async sendMessageInternal(
    userId: string,
    current: ButlerControlSession,
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
    this.assertProviderEnabled(current.providerId);
    await this.ensureSessionCanStartWork(current.sessionId, userId, "助手控制会话");
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
    this.syncWorkspaceContext(
      profile,
      promptContext,
      userId,
      this.resolveControlSessionWorkspacePath(profile, current.id, userId)
    );

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

  private async startSessionInternal(
    userId: string,
    providerId: ButlerProfileProviderId,
    input: StartButlerControlSessionInput,
    options: {
      closeExistingCurrent: boolean;
    }
  ): Promise<ButlerControlSessionView> {
    const profile = this.butlerProfileService.ensureInitialized();
    this.assertProviderEnabled(providerId);
    const content = normalizeControlContent(input.content, "");
    const model = normalizeNullableText(input.model);
    const reasoningLevel = normalizeNullableText(input.reasoningLevel);
    const permissionMode = normalizeNullableText(input.permissionMode);
    const clientRequestId = normalizeNullableText(input.clientRequestId)
      ?? `assistant-origin:butler-control-start:${createId()}`;
    const promptContext = await this.butlerContextAggregator.resolvePromptContext(userId, input.content ?? null);
    const preparedWorkspace = await this.prepareWorkspace(profile, promptContext, userId, {
      title: normalizeNullableText(input.title),
      content
    });
    const current = this.butlerControlSessionRepository.findLatestOpenByProvider(providerId);

    if (options.closeExistingCurrent && current && current.status !== "closed") {
      this.butlerControlSessionRepository.update({
        ...current,
        status: "closed",
        updatedAt: nowIso()
      });
    }

    try {
      const started = await this.sessionLiveRuntimeService.startLiveSession({
        workspaceId: preparedWorkspace.workspaceId,
        userId,
        provider: providerId,
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
        providerId,
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

      if (preparedWorkspace.sandboxId && this.assistantSandboxService) {
        this.assistantSandboxService.markSandboxUsedByControlSession(
          preparedWorkspace.sandboxId,
          userId,
          created.id
        );
      }

      return this.toView(created, userId);
    } catch (error) {
      if (preparedWorkspace.sandboxId && this.assistantSandboxService) {
        try {
          this.assistantSandboxService.removeSandbox(preparedWorkspace.sandboxId, userId);
        } catch {
          // 控制会话没真正启动成功时，尽量把新建的空白沙箱收口，避免残留无主目录。
        }
      }

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
    const record = this.requireSessionByIdAnyProvider(controlSessionId);

    if (record.providerId !== providerId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_CONTROL_SESSION_NOT_FOUND",
        detail: "指定的助手会话不存在或已经关闭"
      });
    }

    return record;
  }

  private requireSessionByIdAnyProvider(controlSessionId: string): ButlerControlSession {
    const record = this.butlerControlSessionRepository.findById(controlSessionId.trim());

    if (!record || record.status === "closed") {
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

  private async ensureSessionCanStartWork(
    sessionId: string,
    userId: string,
    sourceLabel: string
  ): Promise<void> {
    if (!this.providerUsageLimitGuardService) {
      return;
    }

    const blocked = await this.providerUsageLimitGuardService.resolveBlockingInspection([
      {
        sessionId,
        userId,
        sourceLabel
      }
    ], nowIso());

    if (blocked) {
      throw this.providerUsageLimitGuardService.createBlockedAppError(blocked);
    }
  }

  private async prepareWorkspace(
    profile: ButlerProfile,
    promptContext: ButlerPromptContext,
    userId: string,
    input: {
      title: string | null;
      content: string;
    }
  ): Promise<PreparedButlerWorkspace> {
    if (!this.assistantSandboxService) {
      this.syncWorkspaceContext(profile, promptContext, userId, profile.workspacePath);
      const workspace = this.workspaceService.importWorkspace(profile.workspacePath, "代码助手");

      return {
        workspaceId: workspace.id,
        sandboxId: null
      };
    }

    const sandbox = await this.assistantSandboxService.createSandbox({
      userId,
      title: inferControlSessionSandboxTitle(input.title, input.content),
      description: "当前助手会话独占的临时工作区",
      purpose: "butler_control_session",
      source: {
        kind: "blank",
        directoryName: `control-session-${createId().slice(0, 8)}`
      }
    });
    const workspacePath = sandbox.workspace?.path?.trim();

    if (!workspacePath) {
      throw new AppError({
        statusCode: 500,
        errorCode: "BUTLER_CONTROL_SANDBOX_UNAVAILABLE",
        detail: "已创建助手沙箱，但未能解析对应工作区路径"
      });
    }

    this.syncWorkspaceContext(profile, promptContext, userId, workspacePath);

    return {
      workspaceId: sandbox.workspaceId,
      sandboxId: sandbox.id
    };
  }

  private syncWorkspaceContext(
    profile: ButlerProfile,
    promptContext: ButlerPromptContext,
    userId: string,
    workspacePath: string
  ): void {
    syncButlerWorkspaceContext({
      profile,
      promptContext,
      userId,
      workspacePath,
      butlerAuthService: this.butlerAuthService,
      skillManagerService: this.skillManagerService,
      codexHomeDir: this.codexHomeDir,
      sourceCodexHomeDir: this.sourceCodexHomeDir,
      claudeCodeHomeDir: this.claudeCodeHomeDir,
      sourceClaudeCodeHomeDir: this.sourceClaudeCodeHomeDir
    });
  }

  private resolveControlSessionWorkspacePath(
    profile: ButlerProfile,
    controlSessionId: string,
    userId: string
  ): string {
    const sandboxWorkspacePath = this.assistantSandboxService
      ?.listSandboxes({
        userId,
        controlSessionId,
        statuses: ["active", "archived"],
        limit: 1
      })[0]
      ?.workspace
      ?.path
      ?.trim();

    return sandboxWorkspacePath || profile.workspacePath;
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

function inferControlSessionSandboxTitle(title: string | null, content: string): string {
  return title ?? summarizeMessage(content) ?? "助手临时工作区";
}

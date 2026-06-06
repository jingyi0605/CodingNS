import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { AppError, isAppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerProject,
  ButlerSession,
  ButlerSessionOwnershipMode,
  ButlerSessionRole,
  ButlerSessionStatus,
  SessionListItem,
  SessionRunningState
} from "../../types/domain.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";
import type { ButlerSessionRepository } from "../../storage/repositories/butler-session-repository.js";
import type { SessionBindingRepository } from "../../storage/repositories/session-binding-repository.js";
import type { SessionCheckpointRepository } from "../../storage/repositories/session-checkpoint-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionStateRepository } from "../../storage/repositories/session-state-repository.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionMessageOriginRepository } from "../../storage/repositories/session-message-origin-repository.js";
import { recordButlerProxyMessageOrigin } from "../sessions/session-message-origin-utils.js";
import type { SessionProviderUsageLimitGuardService } from "../sessions/session-provider-usage-guard-service.js";

export interface ButlerProjectSessionView {
  id: string;
  projectId: string;
  sessionId: string;
  provider: string | null;
  title: string | null;
  isArchived: boolean;
  isFavorite: boolean;
  role: ButlerSessionRole;
  ownershipMode: ButlerSessionOwnershipMode;
  status: ButlerSessionStatus;
  runningState: SessionRunningState | null;
  lastEventAt: string | null;
  completedAt: string | null;
  lastSeenAt: string | null;
  lastSummary: string | null;
  lastCheckpointAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportButlerSessionInput {
  sessionId: string;
  role?: ButlerSessionRole;
  ownershipMode?: ButlerSessionOwnershipMode;
}

export interface CaptureButlerSessionSnapshotInput {
  sourceKind?: "snapshot" | "manual";
}

export interface StartButlerSessionInput {
  providerId?: "codex" | "claude-code";
  role?: ButlerSessionRole;
  ownershipMode?: ButlerSessionOwnershipMode;
  content?: string;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
}

export interface RecoverManagedButlerSessionOptions {
  recoveryReferenceAt?: string | null;
}

export interface ResumeButlerSessionResult {
  session: ButlerProjectSessionView;
  resumedAt: string;
  provider: string;
  providerSessionId: string;
}

export interface ButlerSessionActionTarget {
  workspaceId: string;
  session: ButlerProjectSessionView;
}

export class ButlerSessionService {
  constructor(
    private readonly butlerProjectRepository: ButlerProjectRepository,
    private readonly butlerSessionRepository: ButlerSessionRepository,
    private readonly sessionCheckpointRepository: SessionCheckpointRepository,
    private readonly sessionBindingRepository: SessionBindingRepository,
    private readonly sessionIndexRepository: SessionIndexRepository,
    private readonly sessionStateRepository: SessionStateRepository,
    private readonly sessionLiveRuntimeService?: Pick<SessionLiveRuntimeService, "startLiveSession">,
    private readonly sessionHistoryService?: Pick<
      SessionHistoryService,
      "discoverWorkspaceSessions" | "listWorkspaceSessions" | "requestWorkspaceDiscovery" | "resumeSession"
    >,
    private readonly sessionMessageOriginRepository: Pick<
      SessionMessageOriginRepository,
      "upsert"
    > | null = null,
    private readonly providerUsageLimitGuardService: Pick<
      SessionProviderUsageLimitGuardService,
      "resolveBlockingInspection" | "createBlockedAppError"
    > | null = null
  ) {}

  async startSession(
    projectId: string,
    input: StartButlerSessionInput,
    userId: string
  ): Promise<ButlerProjectSessionView> {
    const project = this.getProjectOrThrow(projectId);

    if (!this.sessionLiveRuntimeService) {
      throw new AppError({
        statusCode: 500,
        errorCode: "BUTLER_SESSION_START_UNAVAILABLE",
        detail: "当前环境未启用 butler 会话创建能力"
      });
    }

    const providerId = input.providerId ?? resolveProviderId(project.defaultProvider);
    const content = input.content?.trim() || "请先梳理当前项目状态，并给出下一步建议。";
    const recoveryReferenceAt = nowIso();

    try {
      const launch = await this.sessionLiveRuntimeService.startLiveSession({
        workspaceId: project.workspaceId,
        userId,
        provider: providerId,
        content,
        clientRequestId: null,
        runtimeOptions: {
          model: normalizeNullableText(input.model),
          reasoningLevel: normalizeNullableText(input.reasoningLevel),
          permissionMode:
            normalizeNullableText(input.permissionMode)
            ?? (project.approvalMode === "readonly" ? "default" : "acceptEdits")
        }
      });
      recordButlerProxyMessageOrigin(this.sessionMessageOriginRepository, {
        sessionId: launch.sessionId,
        clientRequestId: launch.clientRequestId,
        messageId: launch.message?.messageId ?? null,
        content,
        createdAt: launch.acceptedAt,
        fallbackKey: `butler-session-start:${project.id}:${launch.sessionId}`
      });

      return this.createManagedSessionFromLaunch(project, input, providerId, launch);
    } catch (error) {
      if (isRecoverableSessionIndexMissing(error)) {
        const recovered = this.tryRecoverManagedSession(project, input, userId, {
          recoveryReferenceAt
        });

        if (recovered) {
          return recovered;
        }
      }

      throw error;
    }
  }

  recoverManagedSession(
    projectId: string,
    input: StartButlerSessionInput,
    userId: string,
    options: RecoverManagedButlerSessionOptions = {}
  ): ButlerProjectSessionView | null {
    return this.tryRecoverManagedSession(this.getProjectOrThrow(projectId), input, userId, options);
  }

  listByProject(
    projectId: string,
    userId: string,
    options?: {
      includeArchived?: boolean;
    }
  ): ButlerProjectSessionView[] {
    const project = this.getProjectOrThrow(projectId);
    const includeArchived = options?.includeArchived ?? false;

    return this.butlerSessionRepository.listByProject(project.id).flatMap((record) => {
      const canonicalSessionId = this.resolveCanonicalSessionId(record.sessionId);
      const binding = this.sessionBindingRepository.findBySessionId(canonicalSessionId);
      const index = this.sessionIndexRepository.findIndexRecordBySessionId(canonicalSessionId);
      const state = this.sessionStateRepository.findBySessionAndUser(canonicalSessionId, userId);
      const isArchived = index?.isArchived ?? false;

      if (!includeArchived && isArchived) {
        return [];
      }

      return [{
        id: record.id,
        projectId: record.projectId,
        sessionId: canonicalSessionId,
        provider: binding?.provider ?? null,
        title: index?.title ?? null,
        isArchived,
        isFavorite: state?.favorite ?? false,
        role: record.role,
        ownershipMode: record.ownershipMode,
        status: record.status,
        runningState: state?.runningState ?? null,
        lastEventAt: state?.lastEventAt ?? index?.updatedAt ?? record.updatedAt,
        completedAt: state?.completedAt ?? (record.status === "closed" ? record.updatedAt : null),
        lastSeenAt: state?.lastSeenAt ?? null,
        lastSummary: record.lastSummary,
        lastCheckpointAt: record.lastCheckpointAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }];
    });
  }

  importSession(projectId: string, input: ImportButlerSessionInput, userId: string): ButlerProjectSessionView {
    const project = this.getProjectOrThrow(projectId);
    const requestedSessionId = requireNonEmptyText(input.sessionId, "sessionId", "sessionId 不能为空");
    const sessionId = this.resolveCanonicalSessionId(requestedSessionId);
    const binding = this.sessionBindingRepository.findBySessionId(sessionId);

    if (!binding) {
      throw new AppError({
        statusCode: 404,
        errorCode: "SESSION_NOT_FOUND",
        detail: "目标 session 不存在"
      });
    }

    if (binding.workspaceId !== project.workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "目标 session 不属于当前项目所在工作区",
        field: "sessionId"
      });
    }

    const existing = this.butlerSessionRepository
      .listByProject(project.id)
      .find((record) => this.resolveCanonicalSessionId(record.sessionId) === sessionId);

    if (existing) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_SESSION_EXISTS",
        detail: "该 session 已经被代码助手纳管",
        field: "sessionId"
      });
    }

    const state = this.sessionStateRepository.findBySessionAndUser(sessionId, userId);
    const index = this.sessionIndexRepository.findIndexRecordBySessionId(sessionId);
    const timestamp = nowIso();
    const checkpointSummary = buildInitialCheckpointSummary(index?.title ?? null, state?.runningState ?? null);
    const checkpointProgressState = mapCheckpointProgressState(state?.runningState ?? null);
    const checkpointRiskFlags = buildCheckpointRiskFlags(state?.runningState ?? null);
    const checkpointActions = buildCheckpointNextActions(checkpointProgressState);

    const created = this.butlerSessionRepository.create({
      id: createId(),
      projectId: project.id,
      sessionId,
      role: input.role ?? "adhoc",
      ownershipMode: input.ownershipMode ?? "observed",
      status: mapButlerStatusFromRunningState(state?.runningState ?? null),
      lastSummary: checkpointSummary,
      lastCheckpointAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const latestCheckpointSeq = this.sessionCheckpointRepository.getLatestSeq(created.id);
    this.sessionCheckpointRepository.create({
      id: createId(),
      butlerSessionId: created.id,
      checkpointSeq: latestCheckpointSeq + 1,
      sourceKind: "manual",
      progressState: checkpointProgressState,
      summary: checkpointSummary,
      riskFlags: checkpointRiskFlags,
      nextActions: checkpointActions,
      capturedAt: timestamp
    });
    return {
      id: created.id,
      projectId: created.projectId,
      sessionId: created.sessionId,
      provider: binding.provider,
      title: index?.title ?? null,
      isArchived: index?.isArchived ?? false,
      isFavorite: state?.favorite ?? false,
      role: created.role,
      ownershipMode: created.ownershipMode,
      status: created.status,
      runningState: state?.runningState ?? null,
      lastEventAt: state?.lastEventAt ?? index?.updatedAt ?? created.updatedAt,
      completedAt: state?.completedAt ?? (created.status === "closed" ? created.updatedAt : null),
      lastSeenAt: state?.lastSeenAt ?? null,
      lastSummary: created.lastSummary,
      lastCheckpointAt: created.lastCheckpointAt,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    };
  }

  async ensureProjectSessionsSynced(
    projectId: string,
    userId: string,
    options?: {
      includeArchived?: boolean;
      force?: boolean;
      mode?: "blocking" | "background";
    }
  ): Promise<void> {
    const project = this.getProjectOrThrow(projectId);
    const mode = options?.mode ?? "blocking";

    if (!isWorkspaceAutoManagedProject(project) || !this.sessionHistoryService?.listWorkspaceSessions) {
      return;
    }

    if (
      mode === "blocking" &&
      this.sessionHistoryService.discoverWorkspaceSessions
    ) {
      await this.sessionHistoryService.discoverWorkspaceSessions(project.workspaceId, userId, {
        maxAgeMs: options?.force ? 0 : 15_000,
        force: options?.force ?? false,
        refreshStateMode: "inline"
      });
    } else if (this.sessionHistoryService.requestWorkspaceDiscovery) {
      this.sessionHistoryService.requestWorkspaceDiscovery(project.workspaceId, userId, {
        maxAgeMs: options?.force ? 0 : 15_000,
        force: options?.force ?? false,
        refreshStateMode: "deferred"
      });
    }

    this.importWorkspaceSessions(project, userId, options?.includeArchived ?? false);
  }

  captureSessionSnapshot(
    projectId: string,
    butlerSessionId: string,
    userId: string,
    input: CaptureButlerSessionSnapshotInput = {}
  ): ButlerProjectSessionView {
    const project = this.getProjectOrThrow(projectId);
    const record = this.butlerSessionRepository.findById(butlerSessionId);

    if (!record || record.projectId !== project.id) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_SESSION_NOT_FOUND",
        detail: "当前项目下不存在该会话",
        field: "butlerSessionId"
      });
    }

    const canonicalSessionId = this.resolveCanonicalSessionId(record.sessionId);
    const binding = this.sessionBindingRepository.findBySessionId(canonicalSessionId);
    const index = this.sessionIndexRepository.findIndexRecordBySessionId(canonicalSessionId);
    const state = this.sessionStateRepository.findBySessionAndUser(canonicalSessionId, userId);
    const timestamp = nowIso();
    const progressState = mapCheckpointProgressState(state?.runningState ?? null);
    const summary = buildSnapshotSummary(index?.title ?? null, state?.runningState ?? null, timestamp);
    const riskFlags = buildCheckpointRiskFlags(state?.runningState ?? null);
    const nextActions = buildCheckpointNextActions(progressState);

    const checkpointSeq = this.sessionCheckpointRepository.getLatestSeq(record.id) + 1;
    this.sessionCheckpointRepository.create({
      id: createId(),
      butlerSessionId: record.id,
      checkpointSeq,
      sourceKind: input.sourceKind ?? "snapshot",
      progressState,
      summary,
      riskFlags,
      nextActions,
      capturedAt: timestamp
    });

    const updatedRecord = this.butlerSessionRepository.update({
      ...record,
      status: mapButlerStatusFromRunningState(state?.runningState ?? null),
      lastSummary: summary,
      lastCheckpointAt: timestamp,
      updatedAt: timestamp
    }) ?? {
      ...record,
      status: mapButlerStatusFromRunningState(state?.runningState ?? null),
      lastSummary: summary,
      lastCheckpointAt: timestamp,
      updatedAt: timestamp
    };

    return {
      id: updatedRecord.id,
      projectId: updatedRecord.projectId,
      sessionId: canonicalSessionId,
      provider: binding?.provider ?? null,
      title: index?.title ?? null,
      isArchived: index?.isArchived ?? false,
      isFavorite: state?.favorite ?? false,
      role: updatedRecord.role,
      ownershipMode: updatedRecord.ownershipMode,
      status: updatedRecord.status,
      runningState: state?.runningState ?? null,
      lastEventAt: state?.lastEventAt ?? index?.updatedAt ?? updatedRecord.updatedAt,
      completedAt: state?.completedAt ?? (updatedRecord.status === "closed" ? updatedRecord.updatedAt : null),
      lastSeenAt: state?.lastSeenAt ?? null,
      lastSummary: updatedRecord.lastSummary,
      lastCheckpointAt: updatedRecord.lastCheckpointAt,
      createdAt: updatedRecord.createdAt,
      updatedAt: updatedRecord.updatedAt
    };
  }

  async resumeSession(
    projectId: string,
    butlerSessionId: string,
    userId: string
  ): Promise<ResumeButlerSessionResult> {
    const project = this.getProjectOrThrow(projectId);
    const record = this.butlerSessionRepository.findById(butlerSessionId);

    if (!record || record.projectId !== project.id) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_SESSION_NOT_FOUND",
        detail: "当前项目下不存在该会话",
        field: "butlerSessionId"
      });
    }

    if (!this.sessionHistoryService) {
      throw new AppError({
        statusCode: 500,
        errorCode: "BUTLER_SESSION_RESUME_UNAVAILABLE",
        detail: "当前环境未启用 butler 会话续接能力"
      });
    }

    if (this.providerUsageLimitGuardService) {
      const blocked = await this.providerUsageLimitGuardService.resolveBlockingInspection([
        {
          sessionId: this.resolveCanonicalSessionId(record.sessionId),
          userId,
          sourceLabel: "工作区会话"
        }
      ], nowIso());

      if (blocked) {
        throw this.providerUsageLimitGuardService.createBlockedAppError(blocked);
      }
    }

    const resumed = await this.sessionHistoryService.resumeSession(
      this.resolveCanonicalSessionId(record.sessionId)
    );
    const session = this.captureSessionSnapshot(projectId, butlerSessionId, userId, {
      sourceKind: "manual"
    });

    return {
      session,
      resumedAt: resumed.resumedAt,
      provider: resumed.provider,
      providerSessionId: resumed.providerSessionId
    };
  }

  getSessionWorkspaceId(sessionId: string): string {
    const canonicalSessionId = this.resolveCanonicalSessionId(sessionId);
    const binding = this.sessionBindingRepository.findBySessionId(canonicalSessionId);

    if (!binding) {
      throw new AppError({
        statusCode: 404,
        errorCode: "SESSION_NOT_FOUND",
        detail: "目标 session 不存在",
        field: "sessionId"
      });
    }

    return binding.workspaceId;
  }

  async resolveActionTarget(
    projectId: string,
    sessionId: string,
    userId: string
  ): Promise<ButlerSessionActionTarget> {
    const project = this.getProjectOrThrow(projectId);
    const normalizedSessionId = requireNonEmptyText(sessionId, "sessionId", "sessionId 不能为空");
    const canonicalSessionId = this.resolveCanonicalSessionId(normalizedSessionId);
    const workspaceId = this.getSessionWorkspaceId(canonicalSessionId);

    if (workspaceId !== project.workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "目标 session 不属于当前项目所在工作区",
        field: "sessionId"
      });
    }

    await this.ensureProjectSessionsSynced(project.id, userId, {
      includeArchived: true,
      force: true
    });

    const existing = this.listByProject(project.id, userId, {
      includeArchived: true
    }).find((item) => item.sessionId === canonicalSessionId);

    if (existing) {
      return {
        workspaceId,
        session: existing
      };
    }

    return {
      workspaceId,
      session: this.importSession(
        project.id,
        {
          sessionId: canonicalSessionId,
          role: "adhoc",
          ownershipMode: "observed"
        },
        userId
      )
    };
  }

  private getProjectOrThrow(projectId: string) {
    const project = this.butlerProjectRepository.findById(projectId);

    if (!project) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_PROJECT_NOT_FOUND",
        detail: "代码助手项目不存在"
      });
    }

    return project;
  }

  private createManagedSessionFromLaunch(
    project: ButlerProject,
    input: StartButlerSessionInput,
    providerId: "codex" | "claude-code",
    launch: {
      sessionId: string;
      acceptedAt: string;
    }
  ): ButlerProjectSessionView {
    const timestamp = launch.acceptedAt;
    const created = this.butlerSessionRepository.create({
      id: createId(),
      projectId: project.id,
      sessionId: launch.sessionId,
      role: input.role ?? "adhoc",
      ownershipMode: input.ownershipMode ?? "managed",
      status: "running",
      lastSummary: `已创建并启动托管会话，provider=${providerId}`,
      lastCheckpointAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    this.sessionCheckpointRepository.create({
      id: createId(),
      butlerSessionId: created.id,
      checkpointSeq: this.sessionCheckpointRepository.getLatestSeq(created.id) + 1,
      sourceKind: "manual",
      progressState: "working",
      summary: created.lastSummary ?? "已创建并启动托管会话",
      riskFlags: [],
      nextActions: ["等待会话执行后继续采集快照"],
      capturedAt: timestamp
    });

    return {
      id: created.id,
      projectId: created.projectId,
      sessionId: created.sessionId,
      provider: providerId,
      title: null,
      isArchived: false,
      isFavorite: false,
      role: created.role,
      ownershipMode: created.ownershipMode,
      status: created.status,
      runningState: "running",
      lastEventAt: timestamp,
      completedAt: null,
      lastSeenAt: null,
      lastSummary: created.lastSummary,
      lastCheckpointAt: created.lastCheckpointAt,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    };
  }

  private resolveCanonicalSessionId(sessionId: string): string {
    const binding = this.sessionBindingRepository.findBySessionId(sessionId);

    if (!binding) {
      return sessionId;
    }

    const aliasTargetSessionId =
      extractSessionAliasTargetSessionId(binding.providerSessionId)
      ?? extractSessionAliasTargetSessionId(binding.rawStoreRef);

    if (!aliasTargetSessionId || aliasTargetSessionId === sessionId) {
      return sessionId;
    }

    const targetBinding = this.sessionBindingRepository.findBySessionId(aliasTargetSessionId);

    if (
      !targetBinding
      || targetBinding.workspaceId !== binding.workspaceId
      || targetBinding.provider !== binding.provider
      || isPendingBindingValue(targetBinding.providerSessionId)
      || isPendingBindingValue(targetBinding.rawStoreRef)
    ) {
      return sessionId;
    }

    return aliasTargetSessionId;
  }

  private tryRecoverManagedSession(
    project: ButlerProject,
    input: StartButlerSessionInput,
    userId: string,
    options: RecoverManagedButlerSessionOptions
  ): ButlerProjectSessionView | null {
    const providerId = input.providerId ?? resolveProviderId(project.defaultProvider);
    const content = input.content?.trim() || "请先梳理当前项目状态，并给出下一步建议。";
    const candidate = this.findRecoverableWorkspaceSession(
      project,
      providerId,
      content,
      userId,
      options.recoveryReferenceAt?.trim() || null
    );

    if (!candidate) {
      return null;
    }

    const existing = this.butlerSessionRepository.findBySessionId(candidate.sessionId);

    if (existing) {
      return existing.projectId === project.id ? this.buildManagedSessionView(existing, userId) : null;
    }

    const timestamp = nowIso();
    const runningState = normalizeRunningState(
      this.sessionStateRepository.findBySessionAndUser(candidate.sessionId, userId)?.runningState
      ?? candidate.runningState
      ?? null
    );
    const created = this.butlerSessionRepository.create({
      id: createId(),
      projectId: project.id,
      sessionId: candidate.sessionId,
      role: input.role ?? "adhoc",
      ownershipMode: input.ownershipMode ?? "managed",
      status: mapButlerStatusFromRunningState(runningState),
      lastSummary: `检测到底层会话已存在，已自动回收并重新绑定托管会话，provider=${providerId}`,
      lastCheckpointAt: timestamp,
      createdAt: candidate.createdAt,
      updatedAt: timestamp
    });
    this.sessionCheckpointRepository.create({
      id: createId(),
      butlerSessionId: created.id,
      checkpointSeq: this.sessionCheckpointRepository.getLatestSeq(created.id) + 1,
      sourceKind: "manual",
      progressState: mapCheckpointProgressState(runningState),
      summary: created.lastSummary ?? "已自动回收并重新绑定托管会话",
      riskFlags: buildCheckpointRiskFlags(runningState),
      nextActions: ["继续沿当前会话推进实现，并补采当前执行快照"],
      capturedAt: timestamp
    });

    return {
      id: created.id,
      projectId: created.projectId,
      sessionId: candidate.sessionId,
      provider: candidate.provider,
      title: candidate.title,
      isArchived: candidate.isArchived,
      isFavorite: candidate.isFavorite,
      role: created.role,
      ownershipMode: created.ownershipMode,
      status: created.status,
      runningState,
      lastEventAt: candidate.lastEventAt,
      completedAt: candidate.completedAt,
      lastSeenAt: candidate.lastSeenAt,
      lastSummary: created.lastSummary,
      lastCheckpointAt: created.lastCheckpointAt,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    };
  }

  private findRecoverableWorkspaceSession(
    project: ButlerProject,
    providerId: "codex" | "claude-code",
    content: string,
    userId: string,
    referenceAt: string | null
  ): SessionListItem | null {
    const expectedTitle = buildManagedSessionTitle(content);
    const sessions = this.sessionIndexRepository.listByWorkspace(project.workspaceId, userId);
    const candidates = new Map<string, SessionListItem>();

    for (const session of sessions) {
      if (
        session.provider !== providerId
        || session.isArchived
        || session.isSubagent
        || session.title !== expectedTitle
      ) {
        continue;
      }

      const canonicalSessionId = this.resolveCanonicalSessionId(session.sessionId);
      const normalized = canonicalSessionId === session.sessionId
        ? session
        : this.sessionIndexRepository.findBySessionId(canonicalSessionId, userId) ?? session;

      if (!isRecoverableSessionTimestamp(normalized, referenceAt)) {
        continue;
      }

      const existing = candidates.get(canonicalSessionId);

      if (!existing || compareSessionRecency(normalized, existing) > 0) {
        candidates.set(canonicalSessionId, normalized);
      }
    }

    return [...candidates.values()].sort((left, right) => compareSessionRecency(right, left))[0] ?? null;
  }

  private buildManagedSessionView(record: ButlerSession, userId: string): ButlerProjectSessionView {
    const canonicalSessionId = this.resolveCanonicalSessionId(record.sessionId);
    const binding = this.sessionBindingRepository.findBySessionId(canonicalSessionId);
    const index = this.sessionIndexRepository.findIndexRecordBySessionId(canonicalSessionId);
    const state = this.sessionStateRepository.findBySessionAndUser(canonicalSessionId, userId);

    return {
      id: record.id,
      projectId: record.projectId,
      sessionId: canonicalSessionId,
      provider: binding?.provider ?? null,
      title: index?.title ?? null,
      isArchived: index?.isArchived ?? false,
      isFavorite: state?.favorite ?? false,
      role: record.role,
      ownershipMode: record.ownershipMode,
      status: record.status,
      runningState: state?.runningState ?? null,
      lastEventAt: state?.lastEventAt ?? index?.updatedAt ?? record.updatedAt,
      completedAt: state?.completedAt ?? (record.status === "closed" ? record.updatedAt : null),
      lastSeenAt: state?.lastSeenAt ?? null,
      lastSummary: record.lastSummary,
      lastCheckpointAt: record.lastCheckpointAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  private importWorkspaceSessions(
    project: ButlerProject,
    userId: string,
    includeArchived: boolean
  ): void {
    if (!this.sessionHistoryService?.listWorkspaceSessions) {
      return;
    }

    const existingSessionIds = new Set(
      this.butlerSessionRepository.listByProject(project.id).map((record) => record.sessionId)
    );
    const workspaceSessions = this.sessionHistoryService.listWorkspaceSessions(project.workspaceId, userId);

    for (const session of workspaceSessions) {
      const existing = this.butlerSessionRepository.findBySessionId(session.sessionId);

      if (
        session.isSubagent
        || (!includeArchived && session.isArchived)
        || existingSessionIds.has(session.sessionId)
        || Boolean(existing)
      ) {
        continue;
      }

      if (!shouldImportObservedSessionIntoProject(project, session)) {
        continue;
      }

      const created = this.createObservedSession(project, session, userId);

      if (created) {
        existingSessionIds.add(session.sessionId);
      }
    }
  }

  private createObservedSession(
    project: ButlerProject,
    session: ReturnType<SessionHistoryService["listWorkspaceSessions"]>[number],
    userId: string
  ): ButlerSession | null {
    const existing = this.butlerSessionRepository.findBySessionId(session.sessionId);

    if (existing) {
      return existing.projectId === project.id ? existing : null;
    }

    const state = this.sessionStateRepository.findBySessionAndUser(session.sessionId, userId);
    const normalizedRunningState = normalizeRunningState(session.runningState ?? state?.runningState ?? null);
    const timestamp = nowIso();
    const checkpointSummary = buildInitialCheckpointSummary(session.title, normalizedRunningState);
    const checkpointProgressState = mapCheckpointProgressState(normalizedRunningState);
    const checkpointRiskFlags = buildCheckpointRiskFlags(normalizedRunningState);
    const checkpointActions = buildCheckpointNextActions(checkpointProgressState);
    const recordId = createId();
    let created: ButlerSession;

    try {
      created = this.butlerSessionRepository.create({
        id: recordId,
        projectId: project.id,
        sessionId: session.sessionId,
        role: "adhoc",
        ownershipMode: "observed",
        status: mapButlerStatusFromRunningState(normalizedRunningState),
        lastSummary: checkpointSummary,
        lastCheckpointAt: timestamp,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      });
    } catch (error) {
      if (isButlerSessionUniqueConstraintError(error)) {
        return this.butlerSessionRepository.findBySessionId(session.sessionId);
      }

      throw error;
    }

    if (created.id !== recordId) {
      return created;
    }

    this.sessionCheckpointRepository.create({
      id: createId(),
      butlerSessionId: created.id,
      checkpointSeq: this.sessionCheckpointRepository.getLatestSeq(created.id) + 1,
      sourceKind: "snapshot",
      progressState: checkpointProgressState,
      summary: checkpointSummary,
      riskFlags: checkpointRiskFlags,
      nextActions: checkpointActions,
      capturedAt: timestamp
    });

    return created;
  }
}

function requireNonEmptyText(value: string | undefined, field: string, detail: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail,
      field
    });
  }

  return normalized;
}

function mapButlerStatusFromRunningState(runningState: SessionRunningState | null): ButlerSessionStatus {
  switch (runningState) {
    case "starting":
    case "running":
      return "running";
    case "failed":
      return "failed";
    case "interrupted":
      return "blocked";
    case "completed":
    case "idle":
    default:
      return "idle";
  }
}

function isButlerSessionUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = "code" in error ? (error as { code?: unknown }).code : null;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes("butler_sessions.session_id");
}

function mapCheckpointProgressState(
  runningState: SessionRunningState | null
): "unknown" | "working" | "blocked" | "done" {
  switch (runningState) {
    case "starting":
    case "running":
      return "working";
    case "failed":
    case "interrupted":
      return "blocked";
    case "completed":
    case "idle":
      return "done";
    default:
      return "unknown";
  }
}

function buildInitialCheckpointSummary(
  sessionTitle: string | null,
  runningState: SessionRunningState | null
): string {
  const title = sessionTitle ?? "未命名会话";
  const stateText = runningState ? `当前状态：${runningState}` : "当前状态未知";
  return `已登记会话「${title}」，${stateText}`;
}

function buildSnapshotSummary(
  sessionTitle: string | null,
  runningState: SessionRunningState | null,
  capturedAt: string
): string {
  const title = sessionTitle ?? "未命名会话";
  const stateText = runningState ?? "unknown";
  return `会话「${title}」状态快照：${stateText}（采集时间 ${capturedAt}）`;
}

function buildCheckpointRiskFlags(runningState: SessionRunningState | null): string[] {
  if (runningState === "failed") {
    return ["会话运行失败，需要排查 provider 错误"];
  }

  if (runningState === "interrupted") {
    return ["会话被中断，结果可能不完整"];
  }

  return [];
}

function buildCheckpointNextActions(progressState: "unknown" | "working" | "blocked" | "done"): string[] {
  switch (progressState) {
    case "working":
      return ["等待会话执行结束后继续采样"];
    case "blocked":
      return ["检查失败原因并评估是否需要续接会话"];
    case "done":
      return ["按需触发巡视任务生成结构化总结"];
    case "unknown":
    default:
      return ["补充会话上下文后重新采样"];
  }
}

function resolveProviderId(defaultProvider: string | null): "codex" | "claude-code" {
  if (defaultProvider === "claude-code") {
    return "claude-code";
  }

  return "codex";
}

function isWorkspaceAutoManagedProject(project: ButlerProject): boolean {
  return project.config.managedBy === "workspace-auto";
}

function normalizeRunningState(
  runningState: string | null
): SessionRunningState | null {
  switch (runningState) {
    case "idle":
    case "starting":
    case "running":
    case "completed":
    case "interrupted":
    case "failed":
      return runningState;
    default:
      return null;
  }
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function shouldImportObservedSessionIntoProject(
  project: ButlerProject,
  session: Pick<SessionListItem, "provider" | "providerSessionId" | "rawStoreRef">
): boolean {
  const observedWorkspacePath = resolveObservedSessionWorkspacePath(session);

  if (!observedWorkspacePath) {
    return true;
  }

  return normalizeComparablePath(observedWorkspacePath) === normalizeComparablePath(project.repoRoot);
}

function resolveObservedSessionWorkspacePath(
  session: Pick<SessionListItem, "provider" | "providerSessionId" | "rawStoreRef">
): string | null {
  const rawStoreRef = session.rawStoreRef?.trim() ?? "";

  if (!rawStoreRef || !existsSync(rawStoreRef)) {
    return null;
  }

  try {
    switch (session.provider) {
      case "codex":
        return readCodexObservedWorkspacePath(rawStoreRef, session.providerSessionId);
      case "claude-code":
        return readClaudeObservedWorkspacePath(rawStoreRef);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function readCodexObservedWorkspacePath(
  rawStoreRef: string,
  providerSessionId: string
): string | null {
  const lines = readLimitedJsonLines(rawStoreRef, 80);
  const sessionMetaRecord = lines.find((record) => record?.type === "session_meta");
  const metaPayload = isRecord(sessionMetaRecord?.payload) ? sessionMetaRecord.payload : null;
  const metaCwd = ensureNonEmptyText(metaPayload?.cwd);

  if (metaCwd) {
    return metaCwd;
  }

  const matchingCodexSessionRecord = lines.find((record) => {
    const payload = isRecord(record?.payload) ? record.payload : null;
    return record?.type === "session_meta"
      && ensureNonEmptyText(payload?.id) === providerSessionId;
  });
  const matchingPayload = isRecord(matchingCodexSessionRecord?.payload)
    ? matchingCodexSessionRecord.payload
    : null;
  const matchingCwd = ensureNonEmptyText(matchingPayload?.cwd);

  if (matchingCwd) {
    return matchingCwd;
  }

  for (const record of lines) {
    if (record?.type !== "event_msg") {
      continue;
    }
    const payload = isRecord(record.payload) ? record.payload : null;
    const cwd = ensureNonEmptyText(payload?.cwd);

    if (cwd) {
      return cwd;
    }
  }

  return null;
}

function readClaudeObservedWorkspacePath(rawStoreRef: string): string | null {
  const lines = readLimitedJsonLines(rawStoreRef, 80);

  for (const record of lines) {
    const cwd = ensureNonEmptyText(record?.cwd);

    if (cwd) {
      return cwd;
    }
  }

  return null;
}

function readLimitedJsonLines(rawStoreRef: string, maxLines: number): Array<Record<string, unknown>> {
  const content = readFileSync(rawStoreRef, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, Math.max(1, maxLines));

  const records: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);

      if (isRecord(parsed)) {
        records.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return records;
}

function normalizeComparablePath(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/g, "");
}

function ensureNonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildManagedSessionTitle(content: string): string {
  const title = content.trim().replace(/\s+/g, " ");
  return title.slice(0, 48) || "继续对话";
}

function compareSessionRecency(
  left: Pick<SessionListItem, "updatedAt" | "createdAt">,
  right: Pick<SessionListItem, "updatedAt" | "createdAt">
): number {
  const leftValue = left.updatedAt || left.createdAt;
  const rightValue = right.updatedAt || right.createdAt;

  if (leftValue === rightValue) {
    return left.createdAt.localeCompare(right.createdAt);
  }

  return leftValue.localeCompare(rightValue);
}

function isRecoverableSessionTimestamp(
  session: Pick<SessionListItem, "createdAt" | "updatedAt">,
  referenceAt: string | null
): boolean {
  if (!referenceAt) {
    return true;
  }

  const referenceMs = Date.parse(referenceAt);

  if (!Number.isFinite(referenceMs)) {
    return true;
  }

  const updatedMs = Date.parse(session.updatedAt || session.createdAt);
  const createdMs = Date.parse(session.createdAt);

  if (!Number.isFinite(updatedMs) || !Number.isFinite(createdMs)) {
    return true;
  }

  return updatedMs >= referenceMs - 5_000 || createdMs >= referenceMs - 5_000;
}

function isRecoverableSessionIndexMissing(error: unknown): boolean {
  return isAppError(error) && error.errorCode === "SESSION_INDEX_MISSING";
}

function isPendingBindingValue(value: string): boolean {
  return value.trim().toLowerCase().startsWith("pending://");
}

function extractPendingBindingTargetSessionId(value: string): string | null {
  if (!isPendingBindingValue(value)) {
    return null;
  }

  const normalizedValue = value.trim();
  const targetSessionId = normalizedValue.slice(normalizedValue.indexOf("/", "pending://".length) + 1).trim();
  return targetSessionId || null;
}

function extractAliasBindingTargetSessionId(value: string): string | null {
  const normalizedValue = value.trim();

  if (!normalizedValue.toLowerCase().startsWith("alias://")) {
    return null;
  }

  const pathStart = normalizedValue.indexOf("/", "alias://".length);

  if (pathStart < 0) {
    return null;
  }

  const targetAndSource = normalizedValue.slice(pathStart + 1).trim();

  if (targetAndSource.length === 0) {
    return null;
  }

  const [targetSessionId] = targetAndSource.split("/", 1);
  return targetSessionId?.trim() || null;
}

function extractSessionAliasTargetSessionId(value: string): string | null {
  return extractAliasBindingTargetSessionId(value) ?? extractPendingBindingTargetSessionId(value);
}

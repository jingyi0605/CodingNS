import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerProject,
  ButlerSession,
  ButlerSessionOwnershipMode,
  ButlerSessionRole,
  ButlerSessionStatus,
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

export interface ButlerProjectSessionView {
  id: string;
  projectId: string;
  sessionId: string;
  provider: string | null;
  title: string | null;
  isArchived: boolean;
  role: ButlerSessionRole;
  ownershipMode: ButlerSessionOwnershipMode;
  status: ButlerSessionStatus;
  runningState: SessionRunningState | null;
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
      "discoverWorkspaceSessions" | "listWorkspaceSessions" | "resumeSession"
    >
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
      role: created.role,
      ownershipMode: created.ownershipMode,
      status: created.status,
      runningState: "running",
      lastSummary: created.lastSummary,
      lastCheckpointAt: created.lastCheckpointAt,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    };
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
      const binding = this.sessionBindingRepository.findBySessionId(record.sessionId);
      const index = this.sessionIndexRepository.findIndexRecordBySessionId(record.sessionId);
      const state = this.sessionStateRepository.findBySessionAndUser(record.sessionId, userId);
      const isArchived = index?.isArchived ?? false;

      if (!includeArchived && isArchived) {
        return [];
      }

      return [{
        id: record.id,
        projectId: record.projectId,
        sessionId: record.sessionId,
        provider: binding?.provider ?? null,
        title: index?.title ?? null,
        isArchived,
        role: record.role,
        ownershipMode: record.ownershipMode,
        status: record.status,
        runningState: state?.runningState ?? null,
        lastSummary: record.lastSummary,
        lastCheckpointAt: record.lastCheckpointAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }];
    });
  }

  importSession(projectId: string, input: ImportButlerSessionInput, userId: string): ButlerProjectSessionView {
    const project = this.getProjectOrThrow(projectId);
    const sessionId = requireNonEmptyText(input.sessionId, "sessionId", "sessionId 不能为空");
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

    const existing = this.butlerSessionRepository.findBySessionId(sessionId);

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
      role: created.role,
      ownershipMode: created.ownershipMode,
      status: created.status,
      runningState: state?.runningState ?? null,
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
    }
  ): Promise<void> {
    const project = this.getProjectOrThrow(projectId);

    if (!isWorkspaceAutoManagedProject(project) || !this.sessionHistoryService?.listWorkspaceSessions) {
      return;
    }

    if (this.sessionHistoryService.discoverWorkspaceSessions) {
      await this.sessionHistoryService.discoverWorkspaceSessions(project.workspaceId, userId, {
        maxAgeMs: options?.force ? 0 : 15_000,
        force: options?.force ?? false,
        refreshStateMode: "inline"
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

    const binding = this.sessionBindingRepository.findBySessionId(record.sessionId);
    const index = this.sessionIndexRepository.findIndexRecordBySessionId(record.sessionId);
    const state = this.sessionStateRepository.findBySessionAndUser(record.sessionId, userId);
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
      sessionId: updatedRecord.sessionId,
      provider: binding?.provider ?? null,
      title: index?.title ?? null,
      isArchived: index?.isArchived ?? false,
      role: updatedRecord.role,
      ownershipMode: updatedRecord.ownershipMode,
      status: updatedRecord.status,
      runningState: state?.runningState ?? null,
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

    const resumed = await this.sessionHistoryService.resumeSession(record.sessionId);
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
    const binding = this.sessionBindingRepository.findBySessionId(sessionId);

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
    const workspaceId = this.getSessionWorkspaceId(normalizedSessionId);

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
    }).find((item) => item.sessionId === normalizedSessionId);

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
          sessionId: normalizedSessionId,
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
      if (
        session.isSubagent
        || (!includeArchived && session.isArchived)
        || existingSessionIds.has(session.sessionId)
      ) {
        continue;
      }

      this.createObservedSession(project, session, userId);
      existingSessionIds.add(session.sessionId);
    }
  }

  private createObservedSession(
    project: ButlerProject,
    session: ReturnType<SessionHistoryService["listWorkspaceSessions"]>[number],
    userId: string
  ): void {
    const state = this.sessionStateRepository.findBySessionAndUser(session.sessionId, userId);
    const normalizedRunningState = normalizeRunningState(session.runningState ?? state?.runningState ?? null);
    const timestamp = nowIso();
    const checkpointSummary = buildInitialCheckpointSummary(session.title, normalizedRunningState);
    const checkpointProgressState = mapCheckpointProgressState(normalizedRunningState);
    const checkpointRiskFlags = buildCheckpointRiskFlags(normalizedRunningState);
    const checkpointActions = buildCheckpointNextActions(checkpointProgressState);
    const created = this.butlerSessionRepository.create({
      id: createId(),
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

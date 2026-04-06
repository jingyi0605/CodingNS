import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerControlActionType,
  ButlerControlEvent,
  ButlerControlRelatedRef,
  ButlerControlSession,
  ButlerProfile
} from "../../types/domain.js";
import type { ButlerControlEventRepository } from "../../storage/repositories/butler-control-event-repository.js";
import type { ButlerControlSessionRepository } from "../../storage/repositories/butler-control-session-repository.js";
import type { ButlerProfileService } from "./butler-profile-service.js";
import type { ButlerProjectService } from "./butler-project-service.js";
import type {
  ButlerProjectSessionView,
  ButlerSessionService,
  ResumeButlerSessionResult
} from "./butler-session-service.js";
import type { PatrolExecutionService } from "./patrol-execution-service.js";
import type { PatrolRunService, PatrolRunView } from "./patrol-run-service.js";
import type { VerificationRunService, VerificationRunView } from "./verification-run-service.js";
import type {
  ButlerContextAggregator,
  ButlerProjectContext
} from "./context-aggregator.js";

export interface ButlerActionResult {
  event: ButlerControlEvent;
}

export interface OpenButlerProjectActionResult extends ButlerActionResult {
  context: ButlerProjectContext;
}

export interface ResumeButlerProjectSessionActionResult extends ButlerActionResult {
  resumed: ResumeButlerSessionResult;
}

export interface StartButlerPatrolActionResult extends ButlerActionResult {
  run: PatrolRunView;
}

export interface StartButlerVerificationActionResult extends ButlerActionResult {
  run: VerificationRunView;
}

export interface ResumeButlerProjectSessionActionInput {
  projectId: string;
  butlerSessionId: string;
}

export interface StartButlerPatrolActionInput {
  projectId: string;
  planId?: string | null;
  triggerRef?: string | null;
  butlerSessionId?: string | null;
  suggestions?: string[];
}

export interface StartButlerVerificationActionInput {
  projectId: string;
  verificationType?: "test" | "health" | "browser" | "visual" | "metric";
  targetRef?: string | null;
  butlerSessionId?: string | null;
  sourcePatrolRunId?: string | null;
  spec?: Record<string, unknown>;
}

export class ButlerControlActionService {
  constructor(
    private readonly butlerProfileService: Pick<ButlerProfileService, "ensureInitialized">,
    private readonly butlerControlSessionRepository: Pick<
      ButlerControlSessionRepository,
      "findLatestByProvider" | "update"
    >,
    private readonly butlerControlEventRepository: Pick<
      ButlerControlEventRepository,
      "create" | "listByControlSessionId"
    >,
    private readonly butlerProjectService: Pick<ButlerProjectService, "getById">,
    private readonly butlerSessionService: Pick<
      ButlerSessionService,
      "resumeSession"
    >,
    private readonly patrolRunService: Pick<PatrolRunService, "startRun">,
    private readonly patrolExecutionService: Pick<PatrolExecutionService, "executeQueuedRun">,
    private readonly verificationRunService: Pick<VerificationRunService, "startRun">,
    private readonly butlerContextAggregator: Pick<ButlerContextAggregator, "getProjectContext">
  ) {}

  listCurrentEvents(): ButlerControlEvent[] {
    const current = this.getCurrentControlSession();
    return current
      ? this.butlerControlEventRepository.listByControlSessionId(current.id)
      : [];
  }

  async openProject(projectId: string, userId: string): Promise<OpenButlerProjectActionResult> {
    const current = this.requireCurrentControlSession();
    const project = this.butlerProjectService.getById(projectId);

    try {
      const context = await this.butlerContextAggregator.getProjectContext(project.id, userId);
      const event = this.recordActionEvent(current, "open-project", {
        status: "succeeded",
        title: `已打开项目：${project.name}`,
        content: buildOpenProjectContent(context),
        relatedRefs: [
          createProjectRef(project.id, project.name, project.workspaceId),
          createWorkspaceRef(project.workspaceId)
        ]
      });

      return {
        event,
        context
      };
    } catch (error) {
      this.recordFailureEvent(current, "open-project", `打开项目失败：${project.name}`, error, [
        createProjectRef(project.id, project.name, project.workspaceId)
      ]);
      throw error;
    }
  }

  async resumeProjectSession(
    input: ResumeButlerProjectSessionActionInput,
    userId: string
  ): Promise<ResumeButlerProjectSessionActionResult> {
    const project = this.butlerProjectService.getById(input.projectId);
    const current = this.requireCurrentControlSession();

    try {
      const resumed = await this.butlerSessionService.resumeSession(
        input.projectId,
        input.butlerSessionId,
        userId
      );
      const event = this.recordActionEvent(current, "resume-session", {
        status: "succeeded",
        title: `已续接项目会话：${resumed.session.title ?? project.name}`,
        content: buildResumeSessionContent(project.name, resumed.session),
        relatedRefs: [
          createProjectRef(project.id, project.name, project.workspaceId),
          createButlerSessionRef(
            input.butlerSessionId,
            resumed.session.title ?? project.name,
            project.workspaceId,
            project.id
          ),
          createSessionRef(
            resumed.session.sessionId,
            resumed.session.title ?? resumed.session.sessionId,
            project.workspaceId,
            project.id
          )
        ]
      });

      return {
        event,
        resumed
      };
    } catch (error) {
      this.recordFailureEvent(
        current,
        "resume-session",
        `续接项目会话失败：${project.name}`,
        error,
        [createProjectRef(project.id, project.name, project.workspaceId)]
      );
      throw error;
    }
  }

  async startPatrol(
    input: StartButlerPatrolActionInput
  ): Promise<StartButlerPatrolActionResult> {
    const project = this.butlerProjectService.getById(input.projectId);
    const current = this.requireCurrentControlSession();

    try {
      const queuedRun = this.patrolRunService.startRun(input.projectId, {
        planId: normalizeNullableText(input.planId),
        triggeredBy: "user",
        triggerRef: normalizeNullableText(input.triggerRef) ?? "butler:control-action",
        butlerSessionId: normalizeNullableText(input.butlerSessionId),
        suggestions: input.suggestions ?? []
      });
      const run = await this.patrolExecutionService.executeQueuedRun(queuedRun.id);
      const event = this.recordActionEvent(current, "start-patrol", {
        status: "succeeded",
        title: `已发起巡视：${project.name}`,
        content: buildPatrolContent(project.name, run),
        relatedRefs: [
          createProjectRef(project.id, project.name, project.workspaceId),
          createPatrolRunRef(run.id, project.workspaceId, project.id)
        ]
      });

      return {
        event,
        run
      };
    } catch (error) {
      this.recordFailureEvent(
        current,
        "start-patrol",
        `发起巡视失败：${project.name}`,
        error,
        [createProjectRef(project.id, project.name, project.workspaceId)]
      );
      throw error;
    }
  }

  async startVerification(
    input: StartButlerVerificationActionInput
  ): Promise<StartButlerVerificationActionResult> {
    const project = this.butlerProjectService.getById(input.projectId);
    const current = this.requireCurrentControlSession();

    try {
      const run = await this.verificationRunService.startRun(input.projectId, {
        verificationType: input.verificationType,
        targetRef: normalizeNullableText(input.targetRef),
        butlerSessionId: normalizeNullableText(input.butlerSessionId),
        sourcePatrolRunId: normalizeNullableText(input.sourcePatrolRunId),
        spec: input.spec
      });
      const event = this.recordActionEvent(current, "start-verification", {
        status: "succeeded",
        title: `已发起验证：${project.name}`,
        content: buildVerificationContent(project.name, run),
        relatedRefs: [
          createProjectRef(project.id, project.name, project.workspaceId),
          createVerificationRunRef(run.id, project.workspaceId, project.id)
        ]
      });

      return {
        event,
        run
      };
    } catch (error) {
      this.recordFailureEvent(
        current,
        "start-verification",
        `发起验证失败：${project.name}`,
        error,
        [createProjectRef(project.id, project.name, project.workspaceId)]
      );
      throw error;
    }
  }

  private getCurrentControlSession(): ButlerControlSession | null {
    const profile = this.butlerProfileService.ensureInitialized();
    return this.butlerControlSessionRepository.findLatestByProvider(profile.providerId);
  }

  private requireCurrentControlSession(): ButlerControlSession {
    const profile = this.butlerProfileService.ensureInitialized();
    const current = this.butlerControlSessionRepository.findLatestByProvider(profile.providerId);

    if (!current || current.status === "closed") {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_CONTROL_SESSION_NOT_FOUND",
        detail: "当前 provider 下还没有可用的管家控制会话"
      });
    }

    return current;
  }

  private recordActionEvent(
    controlSession: ButlerControlSession,
    actionType: ButlerControlActionType,
    input: {
      status: ButlerControlEvent["status"];
      title: string;
      content: string;
      relatedRefs: ButlerControlRelatedRef[];
    }
  ): ButlerControlEvent {
    const timestamp = nowIso();
    const event = this.butlerControlEventRepository.create({
      id: createId(),
      controlSessionId: controlSession.id,
      kind: "action",
      actionType,
      status: input.status,
      title: input.title,
      content: input.content,
      relatedRefs: input.relatedRefs,
      createdAt: timestamp
    });

    this.butlerControlSessionRepository.update({
      ...controlSession,
      lastSummary: input.title,
      updatedAt: timestamp
    });

    return event;
  }

  private recordFailureEvent(
    controlSession: ButlerControlSession,
    actionType: ButlerControlActionType,
    title: string,
    error: unknown,
    relatedRefs: ButlerControlRelatedRef[]
  ): ButlerControlEvent {
    const detail = error instanceof Error ? error.message : String(error);

    return this.recordActionEvent(controlSession, actionType, {
      status: "failed",
      title,
      content: `${title}\n\n- 错误：${detail}`,
      relatedRefs
    });
  }
}

function buildOpenProjectContent(context: ButlerProjectContext): string {
  return [
    `已切换到项目 **${context.project.name}**。`,
    "",
    `- 风险级别：${context.project.riskLevel}`,
    `- 活跃会话：${context.project.activeSessionCount}/${context.project.sessionCount}`,
    `- 主要风险：${joinItems(context.topRisks, "暂无明显风险")}`,
    `- 建议下一步：${joinItems(context.nextActions, "暂无待办动作")}`
  ].join("\n");
}

function buildResumeSessionContent(
  projectName: string,
  session: ButlerProjectSessionView
): string {
  return [
    `已续接项目 **${projectName}** 的会话。`,
    "",
    `- 会话标题：${session.title ?? session.sessionId}`,
    `- provider：${session.provider ?? "unknown"}`,
    `- 当前状态：${session.status}`,
    `- 最近摘要：${session.lastSummary ?? "暂无"}`
  ].join("\n");
}

function buildPatrolContent(projectName: string, run: PatrolRunView): string {
  return [
    `已为项目 **${projectName}** 发起巡视。`,
    "",
    `- 运行状态：${run.status}`,
    `- 风险级别：${run.riskLevel ?? "unknown"}`,
    `- 摘要：${run.summary ?? "巡视已发起，等待更多结果"}`,
    `- 建议：${joinItems(run.suggestions, "暂无")}`
  ].join("\n");
}

function buildVerificationContent(projectName: string, run: VerificationRunView): string {
  return [
    `已为项目 **${projectName}** 发起验证。`,
    "",
    `- 验证类型：${run.verificationType}`,
    `- 运行状态：${run.status}`,
    `- 目标：${run.targetRef ?? "未指定"}`,
    `- 摘要：${run.summary ?? "验证已发起，等待更多结果"}`
  ].join("\n");
}

function joinItems(items: string[], fallback: string): string {
  return items.length > 0 ? items.join("；") : fallback;
}

function createProjectRef(projectId: string, label: string, workspaceId: string): ButlerControlRelatedRef {
  return {
    kind: "project",
    id: projectId,
    label,
    routePath: `/workspaces/${encodeURIComponent(workspaceId)}/butler?projectId=${encodeURIComponent(projectId)}`,
    workspaceId,
    projectId
  };
}

function createWorkspaceRef(workspaceId: string): ButlerControlRelatedRef {
  return {
    kind: "workspace",
    id: workspaceId,
    label: "打开工作区",
    routePath: `/workspaces/${encodeURIComponent(workspaceId)}`,
    workspaceId,
    projectId: null
  };
}

function createButlerSessionRef(
  butlerSessionId: string,
  label: string,
  workspaceId: string,
  projectId: string
): ButlerControlRelatedRef {
  return {
    kind: "butler-session",
    id: butlerSessionId,
    label,
    routePath: `/workspaces/${encodeURIComponent(workspaceId)}/butler?projectId=${encodeURIComponent(projectId)}&butlerSessionId=${encodeURIComponent(butlerSessionId)}`,
    workspaceId,
    projectId
  };
}

function createSessionRef(
  sessionId: string,
  label: string,
  workspaceId: string,
  projectId: string
): ButlerControlRelatedRef {
  return {
    kind: "session",
    id: sessionId,
    label,
    routePath: `/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`,
    workspaceId,
    projectId
  };
}

function createPatrolRunRef(runId: string, workspaceId: string, projectId: string): ButlerControlRelatedRef {
  return {
    kind: "patrol-run",
    id: runId,
    label: "查看巡视记录",
    routePath: `/workspaces/${encodeURIComponent(workspaceId)}/butler?projectId=${encodeURIComponent(projectId)}&patrolRunId=${encodeURIComponent(runId)}`,
    workspaceId,
    projectId
  };
}

function createVerificationRunRef(
  runId: string,
  workspaceId: string,
  projectId: string
): ButlerControlRelatedRef {
  return {
    kind: "verification-run",
    id: runId,
    label: "查看验证记录",
    routePath: `/workspaces/${encodeURIComponent(workspaceId)}/butler?projectId=${encodeURIComponent(projectId)}&verificationRunId=${encodeURIComponent(runId)}`,
    workspaceId,
    projectId
  };
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type {
  ButlerControlSessionService,
  SendButlerControlMessageInput,
  StartButlerControlSessionInput
} from "./butler-control-session-service.js";
import type {
  ButlerControlActionService,
  ResumeButlerProjectSessionActionInput,
  StartButlerPatrolActionInput,
  StartButlerVerificationActionInput
} from "./butler-control-action-service.js";
import type { ButlerProfilePatchInput, ButlerProfileService } from "./butler-profile-service.js";
import type {
  ButlerFollowUpService,
  CreateButlerFollowUpTaskInput
} from "./butler-follow-up-service.js";
import type { ButlerActionContextService } from "./butler-action-context-service.js";
import type { ButlerInboxService } from "./butler-inbox-service.js";
import type { ButlerNotificationService } from "./butler-notification-service.js";
import type { ButlerContextAggregator } from "./context-aggregator.js";
import type { ButlerProjectService } from "./butler-project-service.js";
import type { ButlerSessionService } from "./butler-session-service.js";
import type { PatrolPlanService } from "./patrol-plan-service.js";
import type { PatrolExecutionService } from "./patrol-execution-service.js";
import type { PatrolRunService } from "./patrol-run-service.js";
import type { ProjectMemoryService } from "./project-memory-service.js";
import type { VerificationRunService } from "./verification-run-service.js";

interface ButlerProjectListQuery {
  workspaceId?: string;
  status?: "active" | "paused" | "archived";
  riskLevel?: "low" | "medium" | "high";
}

interface ButlerSearchQuery {
  q?: string;
  projectId?: string;
  includeArchived?: string;
}

interface ButlerSessionTargetQuery {
  sessionId?: string;
}

interface ButlerSessionActionContextQuery {
  sessionId?: string;
}

interface ButlerInboxListQuery {
  workspaceId?: string;
  projectId?: string;
  status?: "pending" | "in_progress" | "closed";
  itemType?: "bug" | "feature" | "change" | "task";
}

interface ButlerFollowUpTaskListQuery {
  status?: "active" | "waiting_user" | "completed" | "failed" | "cancelled";
  projectId?: string;
  sessionId?: string;
}

interface ButlerProjectParams {
  projectId: string;
}

interface ButlerInboxItemParams {
  itemId: string;
}

interface ButlerNotificationParams {
  notificationId: string;
}

interface ButlerFollowUpTaskParams {
  taskId: string;
}

interface CancelButlerFollowUpTaskBody {
  reason?: string;
}

interface ButlerMemoryParams extends ButlerProjectParams {
  memoryId: string;
}

interface ButlerPlanParams extends ButlerProjectParams {
  planId: string;
}

interface ButlerRunParams extends ButlerProjectParams {
  runId: string;
}

interface ButlerVerificationParams extends ButlerProjectParams {
  verificationId: string;
}

interface ButlerSessionParams extends ButlerProjectParams {
  butlerSessionId: string;
}

interface CreateButlerProjectBody {
  workspaceId?: string;
  name?: string;
  repoRoot?: string;
  defaultProvider?: string;
  approvalMode?: "readonly" | "controlled" | "auto";
  config?: Record<string, unknown>;
}

interface UpdateButlerProjectBody {
  name?: string;
  defaultProvider?: string | null;
  approvalMode?: "readonly" | "controlled" | "auto";
  lifecycleStatus?: "active" | "paused" | "archived";
  riskLevel?: "low" | "medium" | "high";
  config?: Record<string, unknown>;
}

interface ImportButlerSessionBody {
  sessionId?: string;
  role?: "patrol" | "execution" | "verification" | "adhoc";
  ownershipMode?: "managed" | "observed";
}

interface StartButlerSessionBody {
  providerId?: "codex" | "claude-code";
  role?: "patrol" | "execution" | "verification" | "adhoc";
  ownershipMode?: "managed" | "observed";
  content?: string;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
}

interface CaptureButlerSessionSnapshotBody {
  sourceKind?: "snapshot" | "manual";
}

interface ButlerMemoryListQuery {
  status?: "candidate" | "active" | "superseded" | "archived";
  memoryType?: "arch" | "rule" | "decision" | "incident" | "verify" | "note";
  scopePath?: string;
  q?: string;
}

interface CreateButlerMemoryBody {
  title?: string;
  scopePath?: string | null;
  content?: string;
  tags?: string[];
  confidence?: number;
  status?: "candidate" | "active" | "superseded" | "archived";
  memoryType?: "arch" | "rule" | "decision" | "incident" | "verify" | "note";
  evidence?: Record<string, unknown>;
}

interface UpdateButlerMemoryBody extends CreateButlerMemoryBody {}

interface CreateButlerInboxItemBody {
  projectId?: string;
  itemType?: "bug" | "feature" | "change" | "task";
  title?: string;
  content?: string;
  priority?: "low" | "medium" | "high";
  status?: "pending" | "in_progress" | "closed";
}

interface UpdateButlerInboxItemBody extends CreateButlerInboxItemBody {}
interface UpdateButlerNotificationArchiveBody {
  archived?: boolean;
}
interface CreateButlerFollowUpTaskBody extends CreateButlerFollowUpTaskInput {}

interface ButlerPatrolPlanListQuery {
  enabled?: "true" | "false";
  executionMode?: "readonly" | "controlled";
}

interface CreatePatrolPlanBody {
  name?: string;
  triggerType?: "manual" | "interval" | "cron";
  triggerConfig?: Record<string, unknown>;
  executionMode?: "readonly" | "controlled";
  patrolScope?: Record<string, unknown>;
  enabled?: boolean;
}

interface UpdatePatrolPlanBody {
  name?: string;
  triggerConfig?: Record<string, unknown>;
  executionMode?: "readonly" | "controlled";
  patrolScope?: Record<string, unknown>;
  enabled?: boolean;
  lastScheduledAt?: string | null;
  nextRunAt?: string | null;
}

interface ButlerPatrolRunListQuery {
  status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
}

interface StartPatrolRunBody {
  planId?: string | null;
  triggeredBy?: "scheduler" | "user" | "system";
  triggerRef?: string | null;
  butlerSessionId?: string | null;
  suggestions?: string[];
}

interface ButlerVerificationListQuery {
  status?: "queued" | "running" | "passed" | "failed" | "skipped";
  verificationType?: "test" | "health" | "browser" | "visual" | "metric";
}

interface StartVerificationRunBody {
  verificationType?: "test" | "health" | "browser" | "visual" | "metric";
  targetRef?: string | null;
  butlerSessionId?: string | null;
  sourcePatrolRunId?: string | null;
  spec?: Record<string, unknown>;
}

interface StartButlerControlSessionBody extends StartButlerControlSessionInput {}
interface SendButlerControlMessageBody extends SendButlerControlMessageInput {}
interface OpenButlerProjectActionBody {
  projectId?: string;
}
interface ResumeButlerProjectSessionActionBody extends ResumeButlerProjectSessionActionInput {}
interface StartButlerPatrolActionBody extends StartButlerPatrolActionInput {}
interface StartButlerVerificationActionBody extends StartButlerVerificationActionInput {}

export class ButlerController {
  constructor(
    private readonly butlerProfileService: ButlerProfileService,
    private readonly butlerControlSessionService: ButlerControlSessionService,
    private readonly butlerControlActionService: Pick<
      ButlerControlActionService,
      | "listCurrentEvents"
      | "openProject"
      | "resumeProjectSession"
      | "startPatrol"
      | "startVerification"
    >,
    private readonly butlerContextAggregator: Pick<
      ButlerContextAggregator,
      "getOverview" | "getSnapshot" | "getProjectContext" | "searchSummaries"
    >,
    private readonly butlerFollowUpService: ButlerFollowUpService,
    private readonly butlerInboxService: ButlerInboxService,
    private readonly butlerNotificationService: ButlerNotificationService,
    private readonly butlerProjectService: ButlerProjectService,
    private readonly butlerSessionService: ButlerSessionService,
    private readonly projectMemoryService: ProjectMemoryService,
    private readonly patrolPlanService: PatrolPlanService,
    private readonly patrolRunService: PatrolRunService,
    private readonly patrolExecutionService: PatrolExecutionService,
    private readonly verificationRunService: VerificationRunService,
    private readonly butlerActionContextService?: Pick<
      ButlerActionContextService,
      "getSessionActionContext" | "invalidateSessionActionContext"
    >
  ) {}

  readonly getProfile = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const profile = this.butlerProfileService.getProfile();

    reply.send({
      initialized: profile !== null,
      profile
    });
  };

  readonly initProfile = async (
    request: FastifyRequest<{ Body: ButlerProfilePatchInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    const profile = this.butlerProfileService.initProfile(request.body ?? {});

    reply.status(201).send({
      initialized: true,
      profile
    });
  };

  readonly updateProfile = async (
    request: FastifyRequest<{ Body: ButlerProfilePatchInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    const profile = this.butlerProfileService.updateProfile(request.body ?? {});

    reply.send({
      initialized: true,
      profile
    });
  };

  readonly getCurrentControlSession = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      controlSession: this.butlerControlSessionService.getCurrentSession(requireUserId(request))
    });
  };

  readonly listControlSessionEvents = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.butlerControlActionService.listCurrentEvents()
    });
  };

  readonly resetControlSession = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    this.butlerControlSessionService.resetCurrentSession();
    reply.send({
      controlSession: null
    });
  };

  readonly startControlSession = async (
    request: FastifyRequest<{ Body: StartButlerControlSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const controlSession = await this.butlerControlSessionService.startSession(
      requireUserId(request),
      request.body ?? {}
    );

    reply.status(201).send({ controlSession });
  };

  readonly resumeControlSession = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.butlerControlSessionService.resumeCurrentSession(requireUserId(request))
    );
  };

  readonly sendControlMessage = async (
    request: FastifyRequest<{ Body: SendButlerControlMessageBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.status(202).send(
      await this.butlerControlSessionService.sendMessage(requireUserId(request), request.body ?? {})
    );
  };

  readonly getOverview = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      overview: await this.butlerContextAggregator.getOverview(requireUserId(request))
    });
  };

  readonly listInboxItems = async (
    request: FastifyRequest<{ Querystring: ButlerInboxListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.butlerInboxService.listItems({
        workspaceId: request.query.workspaceId,
        projectId: request.query.projectId,
        status: request.query.status,
        itemType: request.query.itemType
      })
    });
  };

  readonly listFollowUpTasks = async (
    request: FastifyRequest<{ Querystring: ButlerFollowUpTaskListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.butlerFollowUpService.listTasks({
        statuses: request.query.status ? [request.query.status] : undefined,
        projectId: request.query.projectId,
        sessionId: request.query.sessionId
      })
    });
  };

  readonly createFollowUpTask = async (
    request: FastifyRequest<{ Body: CreateButlerFollowUpTaskBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const task = await this.butlerFollowUpService.createTask(
      request.body ?? ({} as CreateButlerFollowUpTaskBody),
      requireUserId(request)
    );
    this.butlerActionContextService?.invalidateSessionActionContext(task.sessionId);

    reply.status(201).send({
      task
    });
  };

  readonly getFollowUpTask = async (
    request: FastifyRequest<{ Params: ButlerFollowUpTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      task: this.butlerFollowUpService.getTask(request.params.taskId)
    });
  };

  readonly cancelFollowUpTask = async (
    request: FastifyRequest<{ Params: ButlerFollowUpTaskParams; Body: CancelButlerFollowUpTaskBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const task = this.butlerFollowUpService.cancelTask(
      request.params.taskId,
      requireUserId(request)
    );
    this.butlerActionContextService?.invalidateSessionActionContext(task.sessionId);

    reply.send({
      task
    });
  };

  readonly createInboxItem = async (
    request: FastifyRequest<{ Body: CreateButlerInboxItemBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const item = this.butlerInboxService.createItem({
      projectId: request.body.projectId,
      itemType: request.body.itemType,
      title: request.body.title,
      content: request.body.content,
      priority: request.body.priority,
      status: request.body.status
    });

    reply.status(201).send({ item });
  };

  readonly updateInboxItem = async (
    request: FastifyRequest<{ Params: ButlerInboxItemParams; Body: UpdateButlerInboxItemBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      item: this.butlerInboxService.updateItem(request.params.itemId, {
        projectId: request.body.projectId,
        itemType: request.body.itemType,
        title: request.body.title,
        content: request.body.content,
        priority: request.body.priority,
        status: request.body.status
      })
    });
  };

  readonly deleteInboxItem = async (
    request: FastifyRequest<{ Params: ButlerInboxItemParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    this.butlerInboxService.deleteItem(request.params.itemId);
    reply.status(204).send();
  };

  readonly listNotificationArchives = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.butlerNotificationService.listArchivedNotifications(requireUserId(request))
    });
  };

  readonly updateNotificationArchive = async (
    request: FastifyRequest<{
      Params: ButlerNotificationParams;
      Body: UpdateButlerNotificationArchiveBody;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    const item = this.butlerNotificationService.setArchived(
      requireUserId(request),
      request.params.notificationId,
      request.body.archived === true
    );

    reply.send({ item });
  };

  readonly getContextSnapshot = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      snapshot: await this.butlerContextAggregator.getSnapshot(requireUserId(request))
    });
  };

  readonly getProjectContext = async (
    request: FastifyRequest<{ Params: ButlerProjectParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      context: await this.butlerContextAggregator.getProjectContext(
        request.params.projectId,
        requireUserId(request)
      )
    });
  };

  readonly searchSummaries = async (
    request: FastifyRequest<{ Querystring: ButlerSearchQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      result: await this.butlerContextAggregator.searchSummaries(
        requireUserId(request),
        request.query.q ?? "",
        {
          projectId: request.query.projectId?.trim() || null,
          includeArchived: request.query.includeArchived === "true"
        }
      )
    });
  };

  readonly getSessionTarget = async (
    request: FastifyRequest<{ Querystring: ButlerSessionTargetQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const sessionId = request.query.sessionId?.trim() ?? "";
    const userId = requireUserId(request);

    if (this.butlerActionContextService) {
      const context = await this.butlerActionContextService.getSessionActionContext(sessionId, userId);

      reply.send({
        target: {
          workspaceId: context.workspaceId,
          project: context.project,
          session: context.session
        }
      });
      return;
    }

    const workspaceId = this.butlerSessionService.getSessionWorkspaceId(sessionId);
    const project = this.butlerProjectService.resolveWorkspaceActionProject(workspaceId);
    const target = await this.butlerSessionService.resolveActionTarget(project.id, sessionId, userId);

    reply.send({
      target: {
        workspaceId: target.workspaceId,
        project,
        session: target.session
      }
    });
  };

  readonly getSessionActionContext = async (
    request: FastifyRequest<{ Querystring: ButlerSessionActionContextQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const sessionId = request.query.sessionId?.trim() ?? "";
    const userId = requireUserId(request);

    if (this.butlerActionContextService) {
      reply.send({
        context: await this.butlerActionContextService.getSessionActionContext(sessionId, userId)
      });
      return;
    }

    const workspaceId = this.butlerSessionService.getSessionWorkspaceId(sessionId);
    const project = this.butlerProjectService.resolveWorkspaceActionProject(workspaceId);
    const target = await this.butlerSessionService.resolveActionTarget(project.id, sessionId, userId);
    const latestFollowUpTask = this.butlerFollowUpService.listTasks({
      sessionId,
      limit: 1
    })[0] ?? null;

    reply.send({
      context: {
        workspaceId: target.workspaceId,
        project: {
          id: project.id,
          workspaceId: project.workspaceId,
          name: project.name,
          repoRoot: project.repoRoot,
          lifecycleStatus: project.lifecycleStatus,
          riskLevel: project.riskLevel
        },
        session: target.session,
        latestFollowUpTask
      }
    });
  };

  readonly openProjectAction = async (
    request: FastifyRequest<{ Body: OpenButlerProjectActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const projectId = request.body.projectId?.trim() ?? "";
    reply.send({
      result: await this.butlerControlActionService.openProject(projectId, requireUserId(request))
    });
  };

  readonly resumeProjectSessionAction = async (
    request: FastifyRequest<{ Body: ResumeButlerProjectSessionActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      result: await this.butlerControlActionService.resumeProjectSession(
        {
          projectId: request.body.projectId?.trim() ?? "",
          butlerSessionId: request.body.butlerSessionId?.trim() ?? ""
        },
        requireUserId(request)
      )
    });
  };

  readonly startPatrolAction = async (
    request: FastifyRequest<{ Body: StartButlerPatrolActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.status(201).send({
      result: await this.butlerControlActionService.startPatrol({
        projectId: request.body.projectId?.trim() ?? "",
        planId: request.body.planId?.trim() || null,
        triggerRef: request.body.triggerRef?.trim() || null,
        butlerSessionId: request.body.butlerSessionId?.trim() || null,
        suggestions: request.body.suggestions
      })
    });
  };

  readonly startVerificationAction = async (
    request: FastifyRequest<{ Body: StartButlerVerificationActionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.status(201).send({
      result: await this.butlerControlActionService.startVerification({
        projectId: request.body.projectId?.trim() ?? "",
        verificationType: request.body.verificationType,
        targetRef: request.body.targetRef?.trim() || null,
        butlerSessionId: request.body.butlerSessionId?.trim() || null,
        sourcePatrolRunId: request.body.sourcePatrolRunId?.trim() || null,
        spec: request.body.spec
      })
    });
  };

  readonly listProjects = async (
    request: FastifyRequest<{ Querystring: ButlerProjectListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.butlerProjectService.list({
        workspaceId: request.query.workspaceId?.trim() || undefined,
        lifecycleStatus: request.query.status,
        riskLevel: request.query.riskLevel
      })
    });
  };

  readonly createProject = async (
    request: FastifyRequest<{ Body: CreateButlerProjectBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const project = this.butlerProjectService.create({
      workspaceId: request.body.workspaceId?.trim() || "",
      name: request.body.name?.trim() || "",
      repoRoot: request.body.repoRoot?.trim() || "",
      defaultProvider: request.body.defaultProvider?.trim() || null,
      approvalMode: request.body.approvalMode,
      config: request.body.config
    });

    reply.status(201).send({ project });
  };

  readonly getProject = async (
    request: FastifyRequest<{ Params: ButlerProjectParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      project: this.butlerProjectService.getById(request.params.projectId)
    });
  };

  readonly updateProject = async (
    request: FastifyRequest<{ Params: ButlerProjectParams; Body: UpdateButlerProjectBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      project: this.butlerProjectService.update(request.params.projectId, {
        name: request.body.name?.trim(),
        defaultProvider:
          request.body.defaultProvider === undefined
            ? undefined
            : request.body.defaultProvider?.trim() || null,
        approvalMode: request.body.approvalMode,
        lifecycleStatus: request.body.lifecycleStatus,
        riskLevel: request.body.riskLevel,
        config: request.body.config
      })
    });
  };

  readonly getProjectOverview = async (
    request: FastifyRequest<{ Params: ButlerProjectParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    await this.butlerSessionService.ensureProjectSessionsSynced(request.params.projectId, userId);
    const overview = this.butlerProjectService.getOverview(request.params.projectId);

    reply.send({
      ...overview,
      activeSessions: this.butlerSessionService.listByProject(request.params.projectId, userId)
    });
  };

  readonly listProjectSessions = async (
    request: FastifyRequest<{ Params: ButlerProjectParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    await this.butlerSessionService.ensureProjectSessionsSynced(
      request.params.projectId,
      requireUserId(request)
    );
    reply.send({
      items: this.butlerSessionService.listByProject(request.params.projectId, requireUserId(request))
    });
  };

  readonly importProjectSession = async (
    request: FastifyRequest<{ Params: ButlerProjectParams; Body: ImportButlerSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const session = this.butlerSessionService.importSession(
      request.params.projectId,
      {
        sessionId: request.body.sessionId?.trim() || "",
        role: request.body.role,
        ownershipMode: request.body.ownershipMode
      },
      requireUserId(request)
    );

    reply.status(201).send({ session });
  };

  readonly startProjectSession = async (
    request: FastifyRequest<{ Params: ButlerProjectParams; Body: StartButlerSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const session = await this.butlerSessionService.startSession(
      request.params.projectId,
      {
        providerId: request.body.providerId,
        role: request.body.role,
        ownershipMode: request.body.ownershipMode,
        content: request.body.content,
        model: request.body.model,
        reasoningLevel: request.body.reasoningLevel,
        permissionMode: request.body.permissionMode
      },
      requireUserId(request)
    );

    reply.status(201).send({ session });
  };

  readonly captureProjectSessionSnapshot = async (
    request: FastifyRequest<{
      Params: ButlerSessionParams;
      Body: CaptureButlerSessionSnapshotBody;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    const session = this.butlerSessionService.captureSessionSnapshot(
      request.params.projectId,
      request.params.butlerSessionId,
      requireUserId(request),
      {
        sourceKind: request.body?.sourceKind
      }
    );

    reply.status(201).send({ session });
  };

  readonly resumeProjectSession = async (
    request: FastifyRequest<{ Params: ButlerSessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const resumed = await this.butlerSessionService.resumeSession(
      request.params.projectId,
      request.params.butlerSessionId,
      requireUserId(request)
    );

    reply.send(resumed);
  };

  readonly listProjectMemories = async (
    request: FastifyRequest<{ Params: ButlerProjectParams; Querystring: ButlerMemoryListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.projectMemoryService.listMemories(request.params.projectId, {
        status: request.query.status,
        memoryType: request.query.memoryType,
        scopePath: request.query.scopePath?.trim() || undefined,
        query: request.query.q?.trim() || undefined
      })
    });
  };

  readonly createProjectMemory = async (
    request: FastifyRequest<{ Params: ButlerProjectParams; Body: CreateButlerMemoryBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const memory = this.projectMemoryService.createMemory(request.params.projectId, {
      title: request.body.title,
      scopePath: request.body.scopePath?.trim() || null,
      content: request.body.content,
      tags: request.body.tags,
      confidence: request.body.confidence,
      status: request.body.status,
      memoryType: request.body.memoryType,
      evidence: request.body.evidence
    });

    reply.status(201).send({ memory });
  };

  readonly updateProjectMemory = async (
    request: FastifyRequest<{ Params: ButlerMemoryParams; Body: UpdateButlerMemoryBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      memory: this.projectMemoryService.updateMemory(request.params.projectId, request.params.memoryId, {
        title: request.body.title,
        scopePath: request.body.scopePath === undefined ? undefined : request.body.scopePath?.trim() || null,
        content: request.body.content,
        tags: request.body.tags,
        confidence: request.body.confidence,
        status: request.body.status,
        memoryType: request.body.memoryType,
        evidence: request.body.evidence
      })
    });
  };

  readonly listPatrolPlans = async (
    request: FastifyRequest<{ Params: ButlerProjectParams; Querystring: ButlerPatrolPlanListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.patrolPlanService.listPlans(request.params.projectId, {
        enabled:
          request.query.enabled === undefined
            ? undefined
            : request.query.enabled === "true",
        executionMode: request.query.executionMode
      })
    });
  };

  readonly createPatrolPlan = async (
    request: FastifyRequest<{ Params: ButlerProjectParams; Body: CreatePatrolPlanBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const plan = this.patrolPlanService.createPlan(request.params.projectId, {
      name: request.body.name?.trim() || "",
      triggerType: request.body.triggerType ?? "manual",
      triggerConfig: request.body.triggerConfig ?? {},
      executionMode: request.body.executionMode ?? "readonly",
      patrolScope: request.body.patrolScope ?? {},
      enabled: request.body.enabled
    });

    reply.status(201).send({ plan });
  };

  readonly updatePatrolPlan = async (
    request: FastifyRequest<{ Params: ButlerPlanParams; Body: UpdatePatrolPlanBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      plan: this.patrolPlanService.updatePlan(request.params.projectId, request.params.planId, {
        name: request.body.name,
        triggerConfig: request.body.triggerConfig,
        executionMode: request.body.executionMode,
        patrolScope: request.body.patrolScope,
        enabled: request.body.enabled,
        lastScheduledAt: request.body.lastScheduledAt ?? undefined,
        nextRunAt: request.body.nextRunAt ?? undefined
      })
    });
  };

  readonly listPatrolRuns = async (
    request: FastifyRequest<{ Params: ButlerProjectParams; Querystring: ButlerPatrolRunListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.patrolRunService.listRuns(request.params.projectId, {
        status: request.query.status
      })
    });
  };

  readonly startPatrolRun = async (
    request: FastifyRequest<{ Params: ButlerProjectParams; Body: StartPatrolRunBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const queuedRun = this.patrolRunService.startRun(request.params.projectId, {
      planId: request.body.planId?.trim() || null,
      triggeredBy: request.body.triggeredBy,
      triggerRef: request.body.triggerRef?.trim() || null,
      butlerSessionId: request.body.butlerSessionId?.trim() || null,
      suggestions: request.body.suggestions
    });
    const run = await this.patrolExecutionService.executeQueuedRun(queuedRun.id);

    reply.status(201).send({ run });
  };

  readonly getPatrolRun = async (
    request: FastifyRequest<{ Params: ButlerRunParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      run: this.patrolRunService.getRun(request.params.projectId, request.params.runId)
    });
  };

  readonly listVerificationRuns = async (
    request: FastifyRequest<{
      Params: ButlerProjectParams;
      Querystring: ButlerVerificationListQuery;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.verificationRunService.listRuns(request.params.projectId, {
        status: request.query.status,
        verificationType: request.query.verificationType
      })
    });
  };

  readonly startVerificationRun = async (
    request: FastifyRequest<{ Params: ButlerProjectParams; Body: StartVerificationRunBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const run = await this.verificationRunService.startRun(request.params.projectId, {
      verificationType: request.body.verificationType,
      targetRef: request.body.targetRef?.trim() || null,
      butlerSessionId: request.body.butlerSessionId?.trim() || null,
      sourcePatrolRunId: request.body.sourcePatrolRunId?.trim() || null,
      spec: request.body.spec
    });

    reply.status(201).send({ run });
  };

  readonly getVerificationRun = async (
    request: FastifyRequest<{ Params: ButlerVerificationParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      run: this.verificationRunService.getRun(request.params.projectId, request.params.verificationId)
    });
  };
}

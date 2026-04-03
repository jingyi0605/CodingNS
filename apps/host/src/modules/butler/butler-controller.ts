import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
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

interface ButlerProjectParams {
  projectId: string;
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

export class ButlerController {
  constructor(
    private readonly butlerProjectService: ButlerProjectService,
    private readonly butlerSessionService: ButlerSessionService,
    private readonly projectMemoryService: ProjectMemoryService,
    private readonly patrolPlanService: PatrolPlanService,
    private readonly patrolRunService: PatrolRunService,
    private readonly patrolExecutionService: PatrolExecutionService,
    private readonly verificationRunService: VerificationRunService
  ) {}

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

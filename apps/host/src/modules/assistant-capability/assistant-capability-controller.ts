import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { DebugServiceRole } from "../../types/domain.js";
import { requireUserId } from "../preferences/common.js";
import type { AssistantCapabilityService } from "./assistant-capability-service.js";

interface AssistantProjectListQuery {
  workspaceId?: string;
  status?: "active" | "paused" | "archived";
  riskLevel?: "low" | "medium" | "high";
}

interface AssistantProjectParams {
  projectId: string;
}

interface AssistantSessionParams {
  sessionId: string;
}

interface AssistantSandboxParams {
  sandboxId: string;
}

interface AssistantTerminalParams {
  terminalId: string;
}

interface AssistantTimerParams {
  timerId: string;
}

interface AssistantAutomationParams {
  automationId: string;
}

interface AssistantMessagesQuery {
  cursor?: string;
  limit?: string;
  direction?: string;
}

interface AssistantTimerListQuery {
  status?: "active" | "completed" | "cancelled" | "failed";
  controlSessionId?: string;
  limit?: string;
}

interface AssistantAutomationListQuery {
  status?: "active" | "completed" | "cancelled" | "failed";
  controlSessionId?: string;
  limit?: string;
}

interface AssistantAutomationRecentRunsQuery {
  controlSessionId?: string;
  limit?: string;
}

interface AssistantSandboxListQuery {
  status?: "active" | "archived" | "expired" | "deleted";
  controlSessionId?: string;
}

interface AssistantTerminalListQuery {
  workspaceId?: string;
  projectId?: string;
}

interface AssistantTerminalHistoryQuery {
  beforeSeq?: string;
  limit?: string;
}

interface AssistantDebugTargetParams {
  targetId: string;
}

interface AssistantDebugRuntimeParams {
  runtimeId: string;
}

interface AssistantDebugRuntimeHistoryQuery {
  limit?: string;
}

interface AssistantWorkspaceBrowseQuery {
  path?: string;
}

interface AssistantWorktreeTreeQuery {
  rootWorkspaceId?: string;
}

interface AssistantSendMessageBody {
  content?: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
}

interface AssistantStartProjectSessionBody {
  content?: string;
  providerId?: "codex" | "claude-code" | null;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
}

interface AssistantStartSessionBody extends AssistantStartProjectSessionBody {
  projectId?: string | null;
  workspaceId?: string | null;
  sandboxId?: string | null;
}

interface AssistantForkBody {
  sourceType?: "session" | "message";
  sourceMessageId?: string | null;
  strategy?: "auto" | "native-only" | "reconstruct-only";
  targetProvider?: string | null;
}

interface AssistantTerminalInputBody {
  content?: string;
}

interface AssistantCreateTimerBody {
  controlSessionId?: string | null;
  projectId?: string | null;
  targetSessionId?: string | null;
  title?: string | null;
  content?: string;
  dueAt?: string | null;
  afterSeconds?: number | string | null;
}

interface AssistantCreateAutomationBody {
  controlSessionId?: string | null;
  projectId?: string | null;
  targetSessionId?: string | null;
  title?: string | null;
  content?: string;
  triggerType?: "once" | "interval" | "cron" | "condition" | null;
  dueAt?: string | null;
  afterSeconds?: number | string | null;
  everySeconds?: number | string | null;
  everyMinutes?: number | string | null;
  everyHours?: number | string | null;
  stopAt?: string | null;
  cronMinute?: number | string | null;
  cronHour?: number | string | null;
  cronDaysOfWeek?: Array<number | string> | string | null;
  conditionKind?: "git.remote_tag_changed" | "session.runtime_idle" | null;
  repositoryUrl?: string | null;
  pollIntervalSeconds?: number | string | null;
  expiresAt?: string | null;
  maxChecks?: number | string | null;
  conditionSessionId?: string | null;
  includeTriggerContext?: boolean | null;
}

interface AssistantUpdateAutomationBody {
  title?: string | null;
  content?: string | null;
  includeTriggerContext?: boolean | null;
  dueAt?: string | null;
  everySeconds?: number | string | null;
  everyMinutes?: number | string | null;
  everyHours?: number | string | null;
  stopAt?: string | null;
  cronMinute?: number | string | null;
  cronHour?: number | string | null;
  cronDaysOfWeek?: Array<number | string> | string | null;
  pollIntervalSeconds?: number | string | null;
  expiresAt?: string | null;
  maxChecks?: number | string | null;
}

interface AssistantCreateSandboxBody {
  title?: string | null;
  description?: string | null;
  purpose?: string | null;
  expiresAt?: string | null;
  sourceKind?: "blank" | "clone" | null;
  repositoryUrl?: string | null;
  directoryName?: string | null;
  auth?:
    | { mode?: "none" }
    | { mode: "basic"; username?: string; password?: string }
    | { mode: "token"; username?: string; token?: string };
}

interface AssistantPromoteSandboxBody {
  mode?: "pin" | "project";
  projectName?: string | null;
  defaultProvider?: "codex" | "claude-code" | null;
}

interface AssistantCreateWorkspaceDirectoryBody {
  parentPath?: string;
  directoryName?: string;
}

interface AssistantImportWorkspaceBody {
  path?: string;
  name?: string | null;
}

interface AssistantCloneWorkspaceBody {
  repositoryUrl?: string;
  parentPath?: string;
  directoryName?: string | null;
  name?: string | null;
  auth?:
    | { mode?: "none" }
    | { mode: "basic"; username?: string; password?: string }
    | { mode: "token"; username?: string; token?: string };
}

interface AssistantReorderWorkspacesBody {
  workspaceIds?: string[];
}

interface AssistantWorkspaceParams {
  workspaceId: string;
}

interface AssistantWorkspaceNavigationStateBody {
  collapsed?: unknown;
  backgroundColor?: unknown;
}

interface AssistantCreateWorktreeBody {
  sourceWorkspaceId?: string;
  branchName?: string;
  displayName?: string | null;
  baseRef?: string | null;
}

interface AssistantWorktreeCleanupBody {
  deleteBranch?: boolean;
}

interface AssistantDebugTargetPortRequestBodyItem {
  serviceId?: string | null;
  role?: string | null;
  cwd?: string | null;
  name?: string | null;
  command?: string | null;
  port?: number | string | null;
}

interface AssistantAnalyzeDebugTargetBody {
  workspaceId?: string;
  rootPath?: string;
  commandHints?: unknown;
}

interface AssistantDebugTargetLaunchPlanBody {
  portRequests?: unknown;
}

interface AssistantRunDebugTargetBody extends AssistantDebugTargetLaunchPlanBody {
  shell?: string;
  runtimeType?: string | null;
}

export class AssistantCapabilityController {
  constructor(private readonly assistantCapabilityService: AssistantCapabilityService) {}

  readonly listCapabilities = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.listCapabilities());
  };

  readonly listProjects = async (
    request: FastifyRequest<{ Querystring: AssistantProjectListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.listProjects({
      workspaceId: request.query.workspaceId,
      lifecycleStatus: request.query.status,
      riskLevel: request.query.riskLevel
    }));
  };

  readonly getProject = async (
    request: FastifyRequest<{ Params: AssistantProjectParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.getProject(
      request.params.projectId,
      requireUserId(request)
    ));
  };

  readonly listProjectSessions = async (
    request: FastifyRequest<{ Params: AssistantProjectParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.listProjectSessions(
      request.params.projectId,
      requireUserId(request)
    ));
  };

  readonly startProjectSession = async (
    request: FastifyRequest<{
      Params: AssistantProjectParams;
      Body: AssistantStartProjectSessionBody;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.startProjectSession({
      projectId: request.params.projectId,
      userId: requireUserId(request),
      content: requireNonEmptyText(request.body.content, "content", "新建项目会话必须提供 content"),
      providerId: normalizeAssistantProviderId(request.body.providerId),
      model: normalizeNullableText(request.body.model),
      reasoningLevel: normalizeNullableText(request.body.reasoningLevel),
      permissionMode: normalizeNullableText(request.body.permissionMode)
    }));
  };

  readonly startSession = async (
    request: FastifyRequest<{ Body: AssistantStartSessionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.startSession({
      target: resolveAssistantSessionTarget(request.body),
      userId: requireUserId(request),
      content: requireNonEmptyText(request.body.content, "content", "新建会话必须提供 content"),
      providerId: normalizeAssistantProviderId(request.body.providerId),
      model: normalizeNullableText(request.body.model),
      reasoningLevel: normalizeNullableText(request.body.reasoningLevel),
      permissionMode: normalizeNullableText(request.body.permissionMode)
    }));
  };

  readonly getSession = async (
    request: FastifyRequest<{ Params: AssistantSessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.getSession(
      request.params.sessionId,
      requireUserId(request)
    ));
  };

  readonly deleteSession = async (
    request: FastifyRequest<{ Params: AssistantSessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.deleteSession(
      request.params.sessionId,
      requireUserId(request)
    ));
  };

  readonly listSessionMessages = async (
    request: FastifyRequest<{
      Params: AssistantSessionParams;
      Querystring: AssistantMessagesQuery;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.listSessionMessages({
      sessionId: request.params.sessionId,
      userId: requireUserId(request),
      cursor: request.query.cursor ?? null,
      limit: normalizePositiveInteger(request.query.limit, 40, 200, "limit"),
      direction: request.query.direction === "backward" ? "backward" : "forward"
    }));
  };

  readonly getSessionRuntime = async (
    request: FastifyRequest<{ Params: AssistantSessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.getSessionRuntime(
      request.params.sessionId,
      requireUserId(request)
    ));
  };

  readonly sendSessionMessage = async (
    request: FastifyRequest<{ Params: AssistantSessionParams; Body: AssistantSendMessageBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.sendSessionMessage({
      sessionId: request.params.sessionId,
      userId: requireUserId(request),
      content: requireNonEmptyText(request.body.content, "content", "发送会话消息必须提供 content"),
      clientRequestId: normalizeNullableText(request.body.clientRequestId),
      model: normalizeNullableText(request.body.model),
      reasoningLevel: normalizeNullableText(request.body.reasoningLevel),
      permissionMode: normalizeNullableText(request.body.permissionMode)
    }));
  };

  readonly forkSession = async (
    request: FastifyRequest<{ Params: AssistantSessionParams; Body: AssistantForkBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const sourceType = request.body.sourceType === "message" ? "message" : "session";

    reply.send(await this.assistantCapabilityService.forkSession({
      sessionId: request.params.sessionId,
      userId: requireUserId(request),
      sourceType,
      sourceMessageId: normalizeNullableText(request.body.sourceMessageId),
      strategy: request.body.strategy,
      targetProvider: normalizeNullableText(request.body.targetProvider)
    }));
  };

  readonly listTimers = async (
    request: FastifyRequest<{ Querystring: AssistantTimerListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.listTimers({
      userId: requireUserId(request),
      status: request.query.status,
      controlSessionId: normalizeNullableText(request.query.controlSessionId),
      limit: normalizeNullableInteger(request.query.limit, "limit")
    }));
  };

  readonly getTimer = async (
    request: FastifyRequest<{ Params: AssistantTimerParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.getTimer(
      request.params.timerId,
      requireUserId(request)
    ));
  };

  readonly createTimer = async (
    request: FastifyRequest<{ Body: AssistantCreateTimerBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.createTimer({
      userId: requireUserId(request),
      controlSessionId: normalizeNullableText(request.body.controlSessionId),
      projectId: normalizeNullableText(request.body.projectId),
      targetSessionId: normalizeNullableText(request.body.targetSessionId),
      title: normalizeNullableText(request.body.title),
      content: requireNonEmptyText(request.body.content, "content", "创建计时器必须提供 content"),
      dueAt: normalizeNullableText(request.body.dueAt),
      afterSeconds: normalizeNullableInteger(request.body.afterSeconds, "afterSeconds")
    }));
  };

  readonly cancelTimer = async (
    request: FastifyRequest<{ Params: AssistantTimerParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.cancelTimer(
      request.params.timerId,
      requireUserId(request)
    ));
  };

  readonly listAutomations = async (
    request: FastifyRequest<{ Querystring: AssistantAutomationListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.listAutomations({
      userId: requireUserId(request),
      status: request.query.status,
      controlSessionId: normalizeNullableText(request.query.controlSessionId),
      limit: normalizeNullableInteger(request.query.limit, "limit")
    }));
  };

  readonly getAutomation = async (
    request: FastifyRequest<{ Params: AssistantAutomationParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.getAutomation(
      request.params.automationId,
      requireUserId(request)
    ));
  };

  readonly createAutomation = async (
    request: FastifyRequest<{ Body: AssistantCreateAutomationBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.createAutomation({
      userId: requireUserId(request),
      controlSessionId: normalizeNullableText(request.body.controlSessionId),
      projectId: normalizeNullableText(request.body.projectId),
      targetSessionId: normalizeNullableText(request.body.targetSessionId),
      title: normalizeNullableText(request.body.title),
      content: requireNonEmptyText(request.body.content, "content", "创建自动化必须提供 content"),
      triggerType: normalizeAutomationTriggerType(request.body.triggerType),
      dueAt: normalizeNullableText(request.body.dueAt),
      afterSeconds: normalizeNullableInteger(request.body.afterSeconds, "afterSeconds"),
      everySeconds: normalizeNullableInteger(request.body.everySeconds, "everySeconds"),
      everyMinutes: normalizeNullableInteger(request.body.everyMinutes, "everyMinutes"),
      everyHours: normalizeNullableInteger(request.body.everyHours, "everyHours"),
      stopAt: normalizeNullableText(request.body.stopAt),
      cronMinute: normalizeNullableInteger(request.body.cronMinute, "cronMinute"),
      cronHour: normalizeNullableInteger(request.body.cronHour, "cronHour"),
      cronDaysOfWeek: normalizeNullableIntegerArray(request.body.cronDaysOfWeek, "cronDaysOfWeek"),
      conditionKind: normalizeConditionKind(request.body.conditionKind),
      repositoryUrl: normalizeNullableText(request.body.repositoryUrl),
      pollIntervalSeconds: normalizeNullableInteger(
        request.body.pollIntervalSeconds,
        "pollIntervalSeconds"
      ),
      expiresAt: normalizeNullableText(request.body.expiresAt),
      maxChecks: normalizeNullableInteger(request.body.maxChecks, "maxChecks"),
      conditionSessionId: normalizeNullableText(request.body.conditionSessionId),
      includeTriggerContext:
        typeof request.body.includeTriggerContext === "boolean"
          ? request.body.includeTriggerContext
          : undefined
    }));
  };

  readonly updateAutomation = async (
    request: FastifyRequest<{
      Params: AssistantAutomationParams;
      Body: AssistantUpdateAutomationBody;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.updateAutomation({
      automationId: request.params.automationId,
      userId: requireUserId(request),
      title:
        request.body.title !== undefined
          ? normalizeNullableText(request.body.title)
          : undefined,
      content:
        request.body.content !== undefined
          ? requireNonEmptyText(request.body.content, "content", "更新自动化必须提供 content")
          : undefined,
      includeTriggerContext:
        typeof request.body.includeTriggerContext === "boolean"
          ? request.body.includeTriggerContext
          : undefined,
      dueAt:
        request.body.dueAt !== undefined
          ? normalizeNullableText(request.body.dueAt)
          : undefined,
      everySeconds:
        request.body.everySeconds !== undefined
          ? normalizeNullableInteger(request.body.everySeconds, "everySeconds")
          : undefined,
      everyMinutes:
        request.body.everyMinutes !== undefined
          ? normalizeNullableInteger(request.body.everyMinutes, "everyMinutes")
          : undefined,
      everyHours:
        request.body.everyHours !== undefined
          ? normalizeNullableInteger(request.body.everyHours, "everyHours")
          : undefined,
      stopAt:
        request.body.stopAt !== undefined
          ? normalizeNullableText(request.body.stopAt)
          : undefined,
      cronMinute:
        request.body.cronMinute !== undefined
          ? normalizeNullableInteger(request.body.cronMinute, "cronMinute")
          : undefined,
      cronHour:
        request.body.cronHour !== undefined
          ? normalizeNullableInteger(request.body.cronHour, "cronHour")
          : undefined,
      cronDaysOfWeek:
        request.body.cronDaysOfWeek !== undefined
          ? normalizeNullableIntegerArray(request.body.cronDaysOfWeek, "cronDaysOfWeek")
          : undefined,
      pollIntervalSeconds:
        request.body.pollIntervalSeconds !== undefined
          ? normalizeNullableInteger(request.body.pollIntervalSeconds, "pollIntervalSeconds")
          : undefined,
      expiresAt:
        request.body.expiresAt !== undefined
          ? normalizeNullableText(request.body.expiresAt)
          : undefined,
      maxChecks:
        request.body.maxChecks !== undefined
          ? normalizeNullableInteger(request.body.maxChecks, "maxChecks")
          : undefined
    }));
  };

  readonly cancelAutomation = async (
    request: FastifyRequest<{ Params: AssistantAutomationParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.cancelAutomation(
      request.params.automationId,
      requireUserId(request)
    ));
  };

  readonly skipAutomationWait = async (
    request: FastifyRequest<{ Params: AssistantAutomationParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.skipAutomationWait(
      request.params.automationId,
      requireUserId(request)
    ));
  };

  readonly listAutomationRuns = async (
    request: FastifyRequest<{ Params: AssistantAutomationParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.listAutomationRuns(
      request.params.automationId,
      requireUserId(request)
    ));
  };

  readonly listRecentAutomationRuns = async (
    request: FastifyRequest<{ Querystring: AssistantAutomationRecentRunsQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.listRecentAutomationRuns({
      userId: requireUserId(request),
      controlSessionId: normalizeNullableText(request.query.controlSessionId),
      limit: normalizeNullableInteger(request.query.limit, "limit")
    }));
  };

  readonly listSandboxes = async (
    request: FastifyRequest<{ Querystring: AssistantSandboxListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.listSandboxes({
      userId: requireUserId(request),
      status: request.query.status,
      controlSessionId: normalizeNullableText(request.query.controlSessionId)
    }));
  };

  readonly createSandbox = async (
    request: FastifyRequest<{ Body: AssistantCreateSandboxBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.createSandbox({
      userId: requireUserId(request),
      title: normalizeNullableText(request.body.title),
      description: normalizeNullableText(request.body.description),
      purpose: normalizeNullableText(request.body.purpose),
      expiresAt: normalizeNullableText(request.body.expiresAt),
      sourceKind: request.body.sourceKind === "clone" ? "clone" : "blank",
      repositoryUrl: normalizeNullableText(request.body.repositoryUrl),
      directoryName: normalizeNullableText(request.body.directoryName),
      auth: normalizeAssistantCloneAuth(request.body.auth)
    }));
  };

  readonly promoteSandbox = async (
    request: FastifyRequest<{ Params: AssistantSandboxParams; Body: AssistantPromoteSandboxBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.promoteSandbox({
      sandboxId: request.params.sandboxId,
      userId: requireUserId(request),
      mode: request.body.mode,
      projectName: normalizeNullableText(request.body.projectName),
      defaultProvider: normalizeAssistantProviderId(request.body.defaultProvider)
    }));
  };

  readonly expireSandbox = async (
    request: FastifyRequest<{ Params: AssistantSandboxParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.expireSandbox(
      request.params.sandboxId,
      requireUserId(request)
    ));
  };

  readonly removeSandbox = async (
    request: FastifyRequest<{ Params: AssistantSandboxParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.removeSandbox(
      request.params.sandboxId,
      requireUserId(request)
    ));
  };

  readonly listTerminals = async (
    request: FastifyRequest<{ Querystring: AssistantTerminalListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const projectId = normalizeNullableText(request.query.projectId);
    const workspaceId = normalizeNullableText(request.query.workspaceId);

    if (!projectId && !workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "查询终端必须提供 projectId 或 workspaceId",
        field: "projectId"
      });
    }

    reply.send(await this.assistantCapabilityService.listTerminals({
      userId: requireUserId(request),
      projectId,
      workspaceId
    }));
  };

  readonly readTerminalHistory = async (
    request: FastifyRequest<{
      Params: AssistantTerminalParams;
      Querystring: AssistantTerminalHistoryQuery;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.readTerminalHistory({
      terminalId: request.params.terminalId,
      beforeSeq: normalizeOptionalInteger(request.query.beforeSeq, "beforeSeq"),
      limit: normalizePositiveIntegerWithUpperClamp(request.query.limit, 20, 100, "limit")
    }));
  };

  readonly sendTerminalInput = async (
    request: FastifyRequest<{ Params: AssistantTerminalParams; Body: AssistantTerminalInputBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.sendTerminalInput({
      terminalId: request.params.terminalId,
      content: requireNonEmptyText(request.body.content, "content", "终端输入必须提供 content")
    }));
  };

  readonly closeTerminal = async (
    request: FastifyRequest<{ Params: AssistantTerminalParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.closeTerminal(request.params.terminalId));
  };

  readonly listWorkspaces = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.listWorkspaces());
  };

  readonly browseWorkspaces = async (
    request: FastifyRequest<{ Querystring: AssistantWorkspaceBrowseQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.browseWorkspaces(
      normalizeNullableText(request.query.path)
    ));
  };

  readonly createWorkspaceDirectory = async (
    request: FastifyRequest<{ Body: AssistantCreateWorkspaceDirectoryBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.createWorkspaceDirectory({
      parentPath: requireNonEmptyText(request.body.parentPath, "parentPath", "创建目录必须提供 parentPath"),
      directoryName: requireNonEmptyText(
        request.body.directoryName,
        "directoryName",
        "创建目录必须提供 directoryName"
      )
    }));
  };

  readonly importWorkspace = async (
    request: FastifyRequest<{ Body: AssistantImportWorkspaceBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.importWorkspace({
      path: requireNonEmptyText(request.body.path, "path", "导入工作区必须提供 path"),
      name: normalizeNullableText(request.body.name)
    }));
  };

  readonly cloneWorkspace = async (
    request: FastifyRequest<{ Body: AssistantCloneWorkspaceBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.cloneWorkspace({
      repositoryUrl: requireNonEmptyText(
        request.body.repositoryUrl,
        "repositoryUrl",
        "克隆工作区必须提供 repositoryUrl"
      ),
      parentPath: requireNonEmptyText(request.body.parentPath, "parentPath", "克隆工作区必须提供 parentPath"),
      directoryName: normalizeNullableText(request.body.directoryName),
      name: normalizeNullableText(request.body.name),
      auth: request.body.auth
    }));
  };

  readonly reorderWorkspaces = async (
    request: FastifyRequest<{ Body: AssistantReorderWorkspacesBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.reorderWorkspaces(
      Array.isArray(request.body.workspaceIds) ? request.body.workspaceIds : []
    ));
  };

  readonly getWorkspaceManagementSummary = async (
    request: FastifyRequest<{ Params: AssistantWorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.getWorkspaceManagementSummary(
      request.params.workspaceId
    ));
  };

  readonly updateWorkspaceNavigationState = async (
    request: FastifyRequest<{
      Params: AssistantWorkspaceParams;
      Body: AssistantWorkspaceNavigationStateBody;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    const input: {
      workspaceId: string;
      userId: string;
      collapsed?: boolean;
      backgroundColor?: string | null;
    } = {
      workspaceId: request.params.workspaceId,
      userId: requireUserId(request)
    };

    if (typeof request.body?.collapsed === "boolean") {
      input.collapsed = request.body.collapsed;
    }

    if (request.body && Object.prototype.hasOwnProperty.call(request.body, "backgroundColor")) {
      const rawBackgroundColor = request.body.backgroundColor;

      if (rawBackgroundColor === null || typeof rawBackgroundColor === "string") {
        input.backgroundColor = rawBackgroundColor;
      }
    }

    reply.send(this.assistantCapabilityService.updateWorkspaceNavigationState(input));
  };

  readonly removeWorkspace = async (
    request: FastifyRequest<{ Params: AssistantWorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.removeWorkspace(request.params.workspaceId));
  };

  readonly getWorktreeTree = async (
    request: FastifyRequest<{ Querystring: AssistantWorktreeTreeQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const rootWorkspaceId = normalizeNullableText(request.query.rootWorkspaceId);

    if (!rootWorkspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "查询工作树必须提供 rootWorkspaceId",
        field: "rootWorkspaceId"
      });
    }

    reply.send(await this.assistantCapabilityService.getWorktreeTree(rootWorkspaceId));
  };

  readonly createWorktree = async (
    request: FastifyRequest<{ Body: AssistantCreateWorktreeBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.createWorktree({
      sourceWorkspaceId: requireNonEmptyText(
        request.body.sourceWorkspaceId,
        "sourceWorkspaceId",
        "创建工作树必须提供 sourceWorkspaceId"
      ),
      branchName: requireNonEmptyText(
        request.body.branchName,
        "branchName",
        "创建工作树必须提供 branchName"
      ),
      displayName: normalizeNullableText(request.body.displayName),
      baseRef: normalizeNullableText(request.body.baseRef)
    }));
  };

  readonly getWorktreeMergePreview = async (
    request: FastifyRequest<{ Params: AssistantWorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.getWorktreeMergePreview(
      request.params.workspaceId
    ));
  };

  readonly mergeWorktreeIntoParent = async (
    request: FastifyRequest<{ Params: AssistantWorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.mergeWorktreeIntoParent(
      request.params.workspaceId
    ));
  };

  readonly cleanupWorktree = async (
    request: FastifyRequest<{ Params: AssistantWorkspaceParams; Body: AssistantWorktreeCleanupBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.cleanupWorktree(
      request.params.workspaceId,
      requireUserId(request),
      {
        deleteBranch: request.body?.deleteBranch === true
      }
    ));
  };

  readonly getDebugCompatibilityMatrix = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.getDebugCompatibilityMatrix());
  };

  readonly analyzeDebugTarget = async (
    request: FastifyRequest<{ Body: AssistantAnalyzeDebugTargetBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.analyzeDebugTarget({
      workspaceId: requireNonEmptyText(
        request.body.workspaceId,
        "workspaceId",
        "分析调试目标必须提供 workspaceId"
      ),
      rootPath: requireNonEmptyText(
        request.body.rootPath,
        "rootPath",
        "分析调试目标必须提供 rootPath"
      ),
      commandHints: normalizeCommandHints(request.body.commandHints)
    }));
  };

  readonly getDebugFrameworkAnalysis = async (
    request: FastifyRequest<{ Params: AssistantDebugTargetParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.getDebugFrameworkAnalysis(request.params.targetId));
  };

  readonly refreshDebugFrameworkAnalysis = async (
    request: FastifyRequest<{ Params: AssistantDebugTargetParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.refreshDebugFrameworkAnalysis(request.params.targetId));
  };

  readonly createDebugLaunchPlan = async (
    request: FastifyRequest<{
      Params: AssistantDebugTargetParams;
      Body: AssistantDebugTargetLaunchPlanBody;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.createDebugLaunchPlan({
      targetId: request.params.targetId,
      userId: requireUserId(request),
      portRequests: normalizeDebugPortRequests(request.body?.portRequests)
    }));
  };

  readonly runDebugTarget = async (
    request: FastifyRequest<{
      Params: AssistantDebugTargetParams;
      Body: AssistantRunDebugTargetBody;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.runDebugTarget({
      targetId: request.params.targetId,
      userId: requireUserId(request),
      shell: normalizeNullableText(request.body?.shell),
      runtimeType: normalizeTerminalRuntimeType(request.body?.runtimeType),
      portRequests: normalizeDebugPortRequests(request.body?.portRequests)
    }));
  };

  readonly getLatestDebugRuntime = async (
    request: FastifyRequest<{ Params: AssistantDebugTargetParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.getLatestDebugRuntime(request.params.targetId));
  };

  readonly listDebugRuntimes = async (
    request: FastifyRequest<{
      Params: AssistantDebugTargetParams;
      Querystring: AssistantDebugRuntimeHistoryQuery;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.listDebugRuntimes({
      targetId: request.params.targetId,
      limit: normalizePositiveInteger(request.query.limit, 5, 50, "limit")
    }));
  };

  readonly getDebugRuntime = async (
    request: FastifyRequest<{ Params: AssistantDebugRuntimeParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.assistantCapabilityService.getDebugRuntime(request.params.runtimeId));
  };
}

function requireNonEmptyText(value: string | null | undefined, field: string, detail: string): string {
  const text = value?.trim();

  if (!text) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail,
      field
    });
  }

  return text;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function normalizePositiveInteger(
  value: string | undefined,
  fallback: number,
  max: number,
  field: string
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是 1 到 ${max} 之间的整数`,
      field
    });
  }

  return parsed;
}

function normalizePositiveIntegerWithUpperClamp(
  value: string | undefined,
  fallback: number,
  max: number,
  field: string
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是大于 0 的整数`,
      field
    });
  }

  return Math.min(parsed, max);
}

function normalizeOptionalInteger(value: string | undefined, field: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是正整数`,
      field
    });
  }

  return parsed;
}

function normalizeNullableInteger(value: number | string | null | undefined, field: string): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是正整数`,
      field
    });
  }

  return parsed;
}

function normalizeNullableIntegerArray(
  value: Array<number | string> | string | null | undefined,
  field: string
): number[] | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const items = Array.isArray(value)
    ? value
    : value.split(",");
  const normalized = items.map((item) => normalizeNullableInteger(item, field));

  if (normalized.some((item) => item === null)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须全部是整数`,
      field
    });
  }

  return Array.from(new Set(normalized as number[]));
}

function normalizeAutomationTriggerType(
  value: AssistantCreateAutomationBody["triggerType"]
): "once" | "interval" | "cron" | "condition" | undefined {
  const normalized = normalizeNullableText(value);

  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "once"
    || normalized === "interval"
    || normalized === "cron"
    || normalized === "condition"
  ) {
    return normalized;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: `不支持的 triggerType：${normalized}`,
    field: "triggerType"
  });
}

function normalizeConditionKind(
  value: AssistantCreateAutomationBody["conditionKind"]
): "git.remote_tag_changed" | "session.runtime_idle" | null {
  const normalized = normalizeNullableText(value);

  if (!normalized) {
    return null;
  }

  if (normalized === "git.remote_tag_changed" || normalized === "session.runtime_idle") {
    return normalized;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: `不支持的 conditionKind：${normalized}`,
    field: "conditionKind"
  });
}

function normalizeAssistantProviderId(
  value: "codex" | "claude-code" | null | undefined
): "codex" | "claude-code" | null {
  const normalized = normalizeNullableText(value);

  if (!normalized) {
    return null;
  }

  if (normalized === "codex" || normalized === "claude-code") {
    return normalized;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: `不支持的 providerId：${normalized}`,
    field: "providerId"
  });
}

function resolveAssistantSessionTarget(body: AssistantStartSessionBody):
  | { kind: "project"; projectId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "sandbox"; sandboxId: string }
  | null {
  const projectId = normalizeNullableText(body.projectId);
  const workspaceId = normalizeNullableText(body.workspaceId);
  const sandboxId = normalizeNullableText(body.sandboxId);
  const targets: Array<
    | { kind: "project"; projectId: string }
    | { kind: "workspace"; workspaceId: string }
    | { kind: "sandbox"; sandboxId: string }
  > = [
    projectId ? { kind: "project" as const, projectId } : null,
    workspaceId ? { kind: "workspace" as const, workspaceId } : null,
    sandboxId ? { kind: "sandbox" as const, sandboxId } : null
  ].filter((target): target is NonNullable<typeof target> => target !== null);

  if (targets.length > 1) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "启动真实会话最多只能提供 projectId、workspaceId、sandboxId 其中一个",
      field: "projectId"
    });
  }

  return targets[0] ?? null;
}

function normalizeAssistantCloneAuth(
  auth: AssistantCreateSandboxBody["auth"]
): AssistantCreateSandboxBody["auth"] | undefined {
  if (!auth || auth.mode === undefined || auth.mode === "none") {
    return auth?.mode === "none" ? { mode: "none" } : undefined;
  }

  if (auth.mode === "basic") {
    return {
      mode: "basic",
      username: normalizeNullableText(auth.username) ?? undefined,
      password: normalizeNullableText(auth.password) ?? undefined
    };
  }

  return {
    mode: "token",
    username: normalizeNullableText("username" in auth ? auth.username : undefined) ?? undefined,
    token: normalizeNullableText("token" in auth ? auth.token : undefined) ?? undefined
  };
}

function normalizeCommandHints(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTerminalRuntimeType(value?: string | null) {
  const normalized = normalizeNullableText(value);

  if (!normalized) {
    return null;
  }

  if (
    normalized === "embedded-pty"
    || normalized === "tmux"
    || normalized === "conpty-powershell"
    || normalized === "conpty-cmd"
    || normalized === "conpty-git-bash"
  ) {
    return normalized;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: `不支持的终端 runtimeType：${normalized}`,
    field: "runtimeType"
  });
}

function normalizeDebugPortRequests(value: unknown) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "portRequests 必须是数组",
      field: "portRequests"
    });
  }

  return value.map((item, index) => normalizeDebugPortRequestItem(item, index));
}

function normalizeDebugPortRequestItem(input: unknown, index: number) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `portRequests[${index}] 必须是对象`,
      field: "portRequests"
    });
  }

  const item = input as AssistantDebugTargetPortRequestBodyItem;

  return {
    serviceId: normalizeNullableText(item.serviceId),
    role: normalizeDebugPortRequestRole(item.role),
    cwd: normalizeNullableText(item.cwd),
    name: normalizeNullableText(item.name),
    command: normalizeNullableText(item.command),
    port: normalizeDebugPortRequestPort(item.port, index)
  };
}

function normalizeDebugPortRequestPort(value: number | string | null | undefined, index: number): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);

    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: `portRequests[${index}].port 必须是整数`,
    field: "portRequests"
  });
}

function normalizeDebugPortRequestRole(value?: string | null): DebugServiceRole | null {
  const normalized = normalizeNullableText(value);

  if (!normalized) {
    return null;
  }

  if (
    normalized === "frontend"
    || normalized === "backend"
    || normalized === "worker"
    || normalized === "mock"
    || normalized === "custom"
  ) {
    return normalized;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: `不支持的调试服务角色：${normalized}`,
    field: "portRequests"
  });
}

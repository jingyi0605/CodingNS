import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
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

interface AssistantTerminalParams {
  terminalId: string;
}

interface AssistantMessagesQuery {
  cursor?: string;
  limit?: string;
  direction?: string;
}

interface AssistantTerminalListQuery {
  workspaceId?: string;
  projectId?: string;
}

interface AssistantTerminalHistoryQuery {
  beforeSeq?: string;
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

interface AssistantForkBody {
  sourceType?: "session" | "message";
  sourceMessageId?: string | null;
  strategy?: "auto" | "native-only" | "reconstruct-only";
  targetProvider?: string | null;
}

interface AssistantTerminalInputBody {
  content?: string;
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

  readonly getSession = async (
    request: FastifyRequest<{ Params: AssistantSessionParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.assistantCapabilityService.getSession(
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
      limit: normalizePositiveInteger(request.query.limit, 20, 100, "limit")
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
}

function requireNonEmptyText(value: string | undefined, field: string, detail: string): string {
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

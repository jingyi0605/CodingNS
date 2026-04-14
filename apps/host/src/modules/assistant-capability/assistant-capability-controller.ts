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

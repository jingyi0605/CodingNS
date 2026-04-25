import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type {
  ParallelSessionGroupService,
  ParallelSessionMemberInput
} from "./parallel-session-group-service.js";
import type { SessionIsolatedWorkspaceService } from "./session-isolated-workspace-service.js";

interface SessionParams {
  sessionId: string;
}

interface WorkspaceParams {
  workspaceId: string;
}

interface GroupParams {
  groupId: string;
}

interface IsolatedWorkspaceParams {
  id: string;
}

interface ParallelMemberBody {
  provider?: string;
  model?: string | null;
  memberPrompt?: string | null;
  workspaceIsolationMode?: "none" | "temporary_worktree" | null;
}

interface CreateParallelGroupBody {
  sourceMessageId?: string | null;
  sharedPrompt?: string;
  permissionMode?: string | null;
  members?: ParallelMemberBody[];
}

function requireUserId(request: FastifyRequest): string {
  const userId = request.auth?.user.userId;

  if (!userId) {
    throw new AppError({
      statusCode: 401,
      errorCode: "UNAUTHORIZED",
      detail: "当前请求缺少有效登录态"
    });
  }

  return userId;
}

export class ParallelSessionController {
  constructor(
    private readonly parallelSessionGroupService: ParallelSessionGroupService,
    private readonly sessionIsolatedWorkspaceService: Pick<SessionIsolatedWorkspaceService, "promote">
  ) {}

  readonly createFromSession = async (
    request: FastifyRequest<{ Params: SessionParams; Body: CreateParallelGroupBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const result = await this.parallelSessionGroupService.createFromSession({
      sourceSessionId: request.params.sessionId,
      sourceMessageId: request.body.sourceMessageId?.trim() || null,
      sharedPrompt: request.body.sharedPrompt ?? "",
      permissionMode: request.body.permissionMode?.trim() || null,
      members: normalizeMembers(request.body.members),
      userId: requireUserId(request)
    });

    reply.status(result.members.length > 0 ? 201 : 409).send(result);
  };

  readonly createFromWorkspace = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: CreateParallelGroupBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const result = await this.parallelSessionGroupService.createFromWorkspace({
      workspaceId: request.params.workspaceId,
      sharedPrompt: request.body.sharedPrompt ?? "",
      permissionMode: request.body.permissionMode?.trim() || null,
      members: normalizeMembers(request.body.members),
      userId: requireUserId(request)
    });

    reply.status(result.members.length > 0 ? 201 : 409).send(result);
  };

  readonly appendMembers = async (
    request: FastifyRequest<{ Params: GroupParams; Body: CreateParallelGroupBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const result = await this.parallelSessionGroupService.appendMembers({
      groupId: request.params.groupId,
      permissionMode: request.body.permissionMode?.trim() || null,
      members: normalizeMembers(request.body.members),
      userId: requireUserId(request)
    });

    reply.status(201).send(result);
  };

  readonly getDetail = async (
    request: FastifyRequest<{ Params: GroupParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.parallelSessionGroupService.getGroup(
        request.params.groupId,
        requireUserId(request)
      )
    );
  };

  readonly deleteGroup = async (
    request: FastifyRequest<{ Params: GroupParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.parallelSessionGroupService.deleteGroup(
        request.params.groupId,
        requireUserId(request)
      )
    );
  };

  readonly promoteIsolatedWorkspace = async (
    request: FastifyRequest<{ Params: IsolatedWorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.sessionIsolatedWorkspaceService.promote(request.params.id));
  };
}

function normalizeMembers(input: CreateParallelGroupBody["members"]): ParallelSessionMemberInput[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((member) => ({
    provider: member?.provider?.trim() ?? "",
    model: member?.model?.trim() || null,
    memberPrompt: member?.memberPrompt?.trim() || null,
    workspaceIsolationMode:
      member?.workspaceIsolationMode === "temporary_worktree"
        ? "temporary_worktree"
        : "none"
  }));
}

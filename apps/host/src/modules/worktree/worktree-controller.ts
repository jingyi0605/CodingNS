import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type { WorktreeCleanupService } from "./worktree-cleanup-service.js";
import type { CreateWorktreeInput, WorktreeManager } from "./worktree-manager.js";
import type { WorktreeMergeService } from "./worktree-merge-service.js";
import type { WorktreeSyncService } from "./worktree-sync-service.js";

interface CreateWorktreeBody {
  sourceWorkspaceId?: string;
  branchName?: string;
  displayName?: string;
  baseRef?: string;
}

interface WorktreeTreeQuery {
  rootWorkspaceId?: string;
}

interface WorktreeParams {
  workspaceId?: string;
}

interface WorktreeCleanupBody {
  deleteBranch?: boolean;
}

export class WorktreeController {
  constructor(
    private readonly worktreeManager: WorktreeManager,
    private readonly worktreeSyncService: WorktreeSyncService,
    private readonly worktreeMergeService: WorktreeMergeService,
    private readonly worktreeCleanupService: WorktreeCleanupService
  ) {}

  readonly getTree = async (
    request: FastifyRequest<{ Querystring: WorktreeTreeQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    await this.worktreeSyncService.syncRoot(request.query.rootWorkspaceId?.trim() || "");

    reply.send({
      items: this.worktreeManager.getTree(request.query.rootWorkspaceId?.trim() || "")
    });
  };

  readonly create = async (
    request: FastifyRequest<{ Body: CreateWorktreeBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const input: CreateWorktreeInput = {
      sourceWorkspaceId: request.body.sourceWorkspaceId?.trim() || "",
      branchName: request.body.branchName?.trim() || "",
      displayName: request.body.displayName?.trim() || undefined,
      baseRef: request.body.baseRef?.trim() || undefined
    };

    reply.status(201).send(await this.worktreeManager.create(input));
  };

  readonly getMergePreview = async (
    request: FastifyRequest<{ Params: WorktreeParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.worktreeMergeService.preview(request.params.workspaceId?.trim() || ""));
  };

  readonly mergeIntoParent = async (
    request: FastifyRequest<{ Params: WorktreeParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.worktreeMergeService.apply(request.params.workspaceId?.trim() || ""));
  };

  readonly cleanup = async (
    request: FastifyRequest<{ Params: WorktreeParams; Body: WorktreeCleanupBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.worktreeCleanupService.cleanup(
        request.params.workspaceId?.trim() || "",
        requireUserId(request),
        {
          deleteBranch: request.body?.deleteBranch === true
        }
      )
    );
  };
}

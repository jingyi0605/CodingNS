import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type { WorkspaceService } from "./workspace-service.js";
import type { UpdateWorkspaceNavigationStateInput } from "./workspace-service.js";

interface ImportWorkspaceBody {
  path?: string;
  name?: string;
}

interface CloneWorkspaceBody {
  repositoryUrl?: string;
  parentPath?: string;
  directoryName?: string;
  name?: string;
  auth?:
    | {
        mode?: "none";
      }
    | {
        mode: "basic";
        username?: string;
        password?: string;
      }
    | {
        mode: "token";
        username?: string;
        token?: string;
      };
}

interface BrowseWorkspaceQuery {
  path?: string;
}

interface CreateWorkspaceDirectoryBody {
  parentPath?: string;
  directoryName?: string;
}

interface WorkspaceParams {
  workspaceId: string;
}

interface ReorderWorkspacesBody {
  workspaceIds?: string[];
}

interface UpdateWorkspaceNavigationStateBody {
  collapsed?: unknown;
  backgroundColor?: unknown;
}

export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  readonly list = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send({
      items: this.workspaceService.list()
    });
  };

  readonly browse = async (
    request: FastifyRequest<{ Querystring: BrowseWorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.workspaceService.browseDirectories(request.query.path?.trim()));
  };

  readonly createDirectory = async (
    request: FastifyRequest<{ Body: CreateWorkspaceDirectoryBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.status(201).send(
      this.workspaceService.createDirectory(
        request.body.parentPath?.trim() || "",
        request.body.directoryName?.trim() || ""
      )
    );
  };

  readonly import = async (
    request: FastifyRequest<{ Body: ImportWorkspaceBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspace = this.workspaceService.importWorkspace(
      request.body.path?.trim() || "",
      request.body.name?.trim()
    );

    reply.status(201).send(workspace);
  };

  readonly clone = async (
    request: FastifyRequest<{ Body: CloneWorkspaceBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspace = await this.workspaceService.cloneWorkspace({
      repositoryUrl: request.body.repositoryUrl?.trim() || "",
      parentPath: request.body.parentPath?.trim() || "",
      directoryName: request.body.directoryName?.trim() || undefined,
      name: request.body.name?.trim() || undefined,
      auth: request.body.auth
    });

    reply.status(201).send(workspace);
  };

  readonly getManagementSummary = async (
    request: FastifyRequest<{ Params: WorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.workspaceService.getManagementSummary(request.params.workspaceId));
  };

  readonly remove = async (
    request: FastifyRequest<{ Params: WorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.workspaceService.removeWorkspace(request.params.workspaceId));
  };

  readonly reorder = async (
    request: FastifyRequest<{ Body: ReorderWorkspacesBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.workspaceService.reorderWorkspaces(request.body.workspaceIds ?? [])
    });
  };

  readonly updateNavigationState = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: UpdateWorkspaceNavigationStateBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const input: UpdateWorkspaceNavigationStateInput = {};

    if (typeof request.body?.collapsed === "boolean") {
      input.collapsed = request.body.collapsed;
    }

    if (request.body && Object.prototype.hasOwnProperty.call(request.body, "backgroundColor")) {
      const rawBackgroundColor = request.body.backgroundColor;

      if (rawBackgroundColor === null || typeof rawBackgroundColor === "string") {
        input.backgroundColor = rawBackgroundColor;
      }
    }

    reply.send(
      this.workspaceService.updateNavigationState(
        request.params.workspaceId,
        requireUserId(request),
        input
      )
    );
  };
}

import type { FastifyReply, FastifyRequest } from "fastify";

import type { WorkspaceService } from "./workspace-service.js";

interface ImportWorkspaceBody {
  path?: string;
  name?: string;
}

interface BrowseWorkspaceQuery {
  path?: string;
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
}

import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type { TeableMirrorMode } from "../../types/domain.js";
import type { TeableGlobalBindingService } from "./teable-global-binding-service.js";

interface SaveTeableGlobalBindingBody {
  baseUrl?: string;
  spaceId?: string;
  baseId?: string;
  authRef?: string;
  authToken?: string;
  enabled?: boolean;
  mirrorMode?: TeableMirrorMode;
}

export class TeableGlobalBindingController {
  constructor(
    private readonly teableGlobalBindingService: TeableGlobalBindingService
  ) {}

  readonly getGlobalBinding = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.teableGlobalBindingService.getGlobalBinding(requireUserId(request)));
  };

  readonly saveGlobalBinding = async (
    request: FastifyRequest<{ Body: SaveTeableGlobalBindingBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.teableGlobalBindingService.saveGlobalBinding(requireUserId(request), {
        baseUrl: request.body.baseUrl?.trim() ?? "",
        spaceId: request.body.spaceId?.trim() ?? "",
        baseId: request.body.baseId?.trim() ?? "",
        authRef: request.body.authRef?.trim() ?? "",
        authToken: request.body.authToken?.trim() ?? "",
        enabled: request.body.enabled === true,
        mirrorMode: request.body.mirrorMode ?? "manual"
      })
    );
  };

  readonly getOverview = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.teableGlobalBindingService.getOverview(requireUserId(request)));
  };
}

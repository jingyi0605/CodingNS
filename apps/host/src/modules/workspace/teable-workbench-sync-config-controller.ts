import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type { TeableSyncSourceType } from "../../types/domain.js";
import type { TeableWorkbenchSyncConfigService } from "./teable-workbench-sync-config-service.js";

interface SaveTeableWorkbenchSyncConfigItemBody {
  sourceType?: TeableSyncSourceType;
  enabled?: boolean;
  scope?: Record<string, unknown>;
  targetTableId?: string | null;
}

interface SaveTeableWorkbenchSyncConfigBody {
  workspaceId?: string;
  items?: SaveTeableWorkbenchSyncConfigItemBody[];
}

export class TeableWorkbenchSyncConfigController {
  constructor(
    private readonly service: TeableWorkbenchSyncConfigService
  ) {}

  readonly getConfigs = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.service.getConfigs(requireUserId(request)));
  };

  readonly saveConfigs = async (
    request: FastifyRequest<{ Body: SaveTeableWorkbenchSyncConfigBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.service.saveConfigs(
        requireUserId(request),
        Array.isArray(request.body.items) ? request.body.items.map((item) => ({
          sourceType: item.sourceType ?? "tags",
          enabled: item.enabled === true,
          workspaceId: request.body.workspaceId?.trim() ?? "",
          scope: item.scope,
          targetTableId: item.targetTableId ?? null
        })) : []
      )
    );
  };
}

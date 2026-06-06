import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type { TeableSyncLogState, TeableSyncLogTriggerType, TeableSyncSourceType } from "../../types/domain.js";
import type { TeableMirrorSyncService } from "./teable-mirror-sync-service.js";

interface RequestTeableMirrorSyncBody {
  workspaceId?: string;
  workspaceIds?: string[];
  mirrorTypes?: TeableSyncSourceType[];
}

export class TeableMirrorSyncController {
  constructor(private readonly service: TeableMirrorSyncService) {}

  readonly getOverview = async (
    request: FastifyRequest<{ Querystring: { workspaceId?: string; workspaceIds?: string[] | string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.service.getOverview(
        requireUserId(request),
        normalizeWorkspaceIds(request.query.workspaceIds),
        request.query.workspaceId?.trim() ?? ""
      )
    );
  };

  readonly requestMirrorSync = async (
    request: FastifyRequest<{ Body: RequestTeableMirrorSyncBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.service.requestMirrorSync(requireUserId(request), {
        workspaceId: request.body.workspaceId?.trim() ?? "",
        workspaceIds: normalizeWorkspaceIds(request.body.workspaceIds),
        mirrorTypes: Array.isArray(request.body.mirrorTypes) ? request.body.mirrorTypes : undefined
      })
    );
  };

  readonly listSyncLogs = async (
    request: FastifyRequest<{ Querystring: { limit?: string; triggerType?: TeableSyncLogTriggerType; state?: TeableSyncLogState } }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.service.listSyncLogs(requireUserId(request), {
      limit: parseLimit(request.query.limit),
      triggerType: normalizeTriggerType(request.query.triggerType),
      state: normalizeState(request.query.state)
    }));
  };
}


function normalizeWorkspaceIds(value: string[] | string | undefined): string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
  }
  const normalized = value?.trim() ?? "";
  return normalized ? [normalized] : undefined;
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTriggerType(value: TeableSyncLogTriggerType | undefined): TeableSyncLogTriggerType | undefined {
  return value === "manual" || value === "local_change" || value === "retry" ? value : undefined;
}

function normalizeState(value: TeableSyncLogState | undefined): TeableSyncLogState | undefined {
  return value === "queued" || value === "running" || value === "succeeded" || value === "partial_failed" || value === "failed"
    ? value
    : undefined;
}

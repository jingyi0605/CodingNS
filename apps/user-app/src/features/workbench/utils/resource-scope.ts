import { normalizeTargetHostId } from "../../../shared/network/target-host";
import type { WorkspaceRef } from "../../conversation/api/conversation-api";

export { normalizeTargetHostId } from "../../../shared/network/target-host";

export interface ResourceScopeInput {
  workspaceId?: string | null;
  targetHostId?: string | null;
}

export function readSnapshotTargetHostId(snapshot: unknown): string | null {
  const value = (snapshot as { targetHostId?: unknown })?.targetHostId;
  return typeof value === "string" ? normalizeTargetHostId(value) : null;
}

export function isSameTargetHostId(left?: string | null, right?: string | null): boolean {
  return normalizeTargetHostId(left) === normalizeTargetHostId(right);
}

export function buildScopedSnapshotKey(prefix: string, input: ResourceScopeInput): string {
  const workspaceId = input.workspaceId?.trim() || "";
  const targetHostId = normalizeTargetHostId(input.targetHostId);
  const hostPart = targetHostId ? `host.${encodeURIComponent(targetHostId)}.` : "";
  return `${prefix}.${hostPart}${workspaceId}`;
}

export function buildScopedWorkspaceRef(
  workspaceId: string,
  targetHostId?: string | null
): WorkspaceRef {
  const normalizedTargetHostId = normalizeTargetHostId(targetHostId);

  return normalizedTargetHostId
    ? {
        hostId: normalizedTargetHostId,
        workspaceId
      }
    : {
        hostId: "current",
        workspaceId
      };
}

import { clientConfigStore } from "../../../config/client-config-store";
import { getEffectiveActiveHostId } from "../../../config/client-config-types";
import type { SessionDisplaySortMode } from "../../../preferences/local-ui-preference-store";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import type {
  WorkbenchSnapshotDto,
  WorkbenchWorktreeNodeDto,
  WorkspaceRef
} from "../../conversation/api/conversation-api";
import { normalizeTargetHostId } from "./resource-scope";
import {
  sortSessionSummaryList,
  sortWorkbenchWorktreeNodes
} from "./session-display-sort";
import type { WorkbenchNavigationGroup } from "./workbench-navigation";

export const WORKBENCH_NAVIGATION_SNAPSHOT_KEY = "workbench.navigation.snapshot";
export const WORKBENCH_NAVIGATION_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

const HOST_WORKBENCH_NAVIGATION_SNAPSHOT_KEY_PREFIX = "workbench.navigation.snapshot.host.";
const SCOPED_WORKSPACE_KEY_SEPARATOR = ":";

export interface CachedWorkbenchNavigationGroup extends WorkbenchNavigationGroup {
  childWorktrees: WorkbenchWorktreeNodeDto[];
}

export function buildHostWorkbenchNavigationSnapshotKey(hostId: string): string {
  return `${HOST_WORKBENCH_NAVIGATION_SNAPSHOT_KEY_PREFIX}${encodeScopedKeyPart(hostId)}`;
}

export function buildScopedWorkspaceKey(hostId: string, workspaceId: string): string {
  return `${encodeScopedKeyPart(hostId)}${SCOPED_WORKSPACE_KEY_SEPARATOR}${encodeScopedKeyPart(workspaceId)}`;
}

export function buildScopedWorkspaceKeyFromRef(workspaceRef: WorkspaceRef): string {
  return buildScopedWorkspaceKey(workspaceRef.hostId, workspaceRef.workspaceId);
}

export function resolveWorkbenchTargetHostId(targetHostId?: string | null): string | undefined {
  return normalizeTargetHostId(targetHostId) ?? undefined;
}

export function resolveWorkbenchScopeHostId(
  targetHostId?: string | null,
  fallbackHostId = getEffectiveActiveHostId(clientConfigStore.getState())
): string | null {
  return resolveWorkbenchTargetHostId(targetHostId) ?? fallbackHostId;
}

export function readWorkbenchNavigationSnapshot(
  maxAgeMs = WORKBENCH_NAVIGATION_CACHE_MAX_AGE_MS,
  hostId = getEffectiveActiveHostId(clientConfigStore.getState()),
  targetHostId?: string | null
): WorkbenchSnapshotDto | null {
  const scopedTargetHostId = resolveWorkbenchTargetHostId(targetHostId);
  hostId = resolveWorkbenchScopeHostId(scopedTargetHostId, hostId);

  if (hostId) {
    const hostSnapshot = readViewSnapshot<WorkbenchSnapshotDto>(
      buildHostWorkbenchNavigationSnapshotKey(hostId),
      maxAgeMs
    );

    if (hostSnapshot) {
      return hostSnapshot;
    }
  }

  if (scopedTargetHostId) {
    return null;
  }

  return readViewSnapshot<WorkbenchSnapshotDto>(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, maxAgeMs);
}

export function writeWorkbenchNavigationSnapshot(
  snapshot: WorkbenchSnapshotDto,
  hostId = getEffectiveActiveHostId(clientConfigStore.getState()),
  targetHostId?: string | null
): void {
  const scopedTargetHostId = resolveWorkbenchTargetHostId(targetHostId);
  hostId = resolveWorkbenchScopeHostId(scopedTargetHostId, hostId);

  if (!scopedTargetHostId) {
    writeViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, snapshot);
  }

  if (hostId) {
    writeViewSnapshot(buildHostWorkbenchNavigationSnapshotKey(hostId), snapshot);
  }
}

export function mapWorkbenchSnapshotToNavigationGroups(
  snapshot: WorkbenchSnapshotDto | null | undefined,
  sessionDisplaySortMode: SessionDisplaySortMode = "createdAt"
): CachedWorkbenchNavigationGroup[] {
  if (!snapshot || !Array.isArray(snapshot.items)) {
    return [];
  }

  return snapshot.items.map((item) => ({
    workspace: item.workspace,
    sessions: sortSessionSummaryList(item.sessions, sessionDisplaySortMode),
    childWorktrees: mapWorkbenchWorktreeNodes(item.childWorktrees, sessionDisplaySortMode)
  }));
}

function mapWorkbenchWorktreeNodes(
  nodes: readonly WorkbenchWorktreeNodeDto[] | null | undefined,
  sessionDisplaySortMode: SessionDisplaySortMode
): WorkbenchWorktreeNodeDto[] {
  return sortWorkbenchWorktreeNodes(nodes, sessionDisplaySortMode);
}

function encodeScopedKeyPart(value: string): string {
  return encodeURIComponent(value);
}

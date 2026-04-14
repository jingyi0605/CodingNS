import { clientConfigStore } from "../../../config/client-config-store";
import type { SessionDisplaySortMode } from "../../../preferences/local-ui-preference-store";
import { readViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import type {
  WorkbenchSnapshotDto,
  WorkbenchWorktreeNodeDto
} from "../../conversation/api/conversation-api";
import {
  sortSessionSummaryList,
  sortWorkbenchWorktreeNodes
} from "./session-display-sort";
import type { WorkbenchNavigationGroup } from "./workbench-navigation";

export const WORKBENCH_NAVIGATION_SNAPSHOT_KEY = "workbench.navigation.snapshot";
export const WORKBENCH_NAVIGATION_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

const HOST_WORKBENCH_NAVIGATION_SNAPSHOT_KEY_PREFIX = "workbench.navigation.snapshot.host.";

export interface CachedWorkbenchNavigationGroup extends WorkbenchNavigationGroup {
  childWorktrees: WorkbenchWorktreeNodeDto[];
}

export function buildHostWorkbenchNavigationSnapshotKey(hostId: string): string {
  return `${HOST_WORKBENCH_NAVIGATION_SNAPSHOT_KEY_PREFIX}${hostId}`;
}

export function readWorkbenchNavigationSnapshot(
  maxAgeMs = WORKBENCH_NAVIGATION_CACHE_MAX_AGE_MS,
  hostId = clientConfigStore.getState().activeHostId
): WorkbenchSnapshotDto | null {
  if (hostId) {
    const hostSnapshot = readViewSnapshot<WorkbenchSnapshotDto>(
      buildHostWorkbenchNavigationSnapshotKey(hostId),
      maxAgeMs
    );

    if (hostSnapshot) {
      return hostSnapshot;
    }
  }

  return readViewSnapshot<WorkbenchSnapshotDto>(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, maxAgeMs);
}

export function writeWorkbenchNavigationSnapshot(
  snapshot: WorkbenchSnapshotDto,
  hostId = clientConfigStore.getState().activeHostId
): void {
  writeViewSnapshot(WORKBENCH_NAVIGATION_SNAPSHOT_KEY, snapshot);

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

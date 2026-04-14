import type { ClientRuntimeConfig, HostProfile } from "../../../config/client-config-types";
import type { WorkspaceDto } from "../../conversation/api/conversation-api";
import {
  flattenMobileWorkspaceOptions,
  type MobileWorkspaceOption
} from "./mobile-workspace-tree";
import {
  mapWorkbenchSnapshotToNavigationGroups,
  readWorkbenchNavigationSnapshot
} from "./workbench-navigation-snapshot";

export const HOST_WORKSPACE_SWITCHER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface MobileHostSwitcherHostEntry {
  readonly kind: "host";
  readonly host: HostProfile;
  readonly workspaceCount: number;
}

export interface MobileHostSwitcherWorkspaceEntry {
  readonly kind: "workspace";
  readonly host: HostProfile;
  readonly workspace: WorkspaceDto;
  readonly option: MobileWorkspaceOption;
}

export type MobileHostSwitcherEntry =
  | MobileHostSwitcherHostEntry
  | MobileHostSwitcherWorkspaceEntry;

export function buildMobileHostSwitcherEntries(
  config: Pick<ClientRuntimeConfig, "hosts" | "activeHostId">,
  activeHostWorkspaceOptions: readonly MobileWorkspaceOption[]
): MobileHostSwitcherEntry[] {
  return sortHosts(config.hosts, config.activeHostId).flatMap((host) => {
    const workspaceOptions =
      host.id === config.activeHostId
        ? activeHostWorkspaceOptions
        : readCachedHostWorkspaceOptions(host.id);

    return [
      {
        kind: "host" as const,
        host,
        workspaceCount: workspaceOptions.length
      },
      ...workspaceOptions.map((option) => ({
        kind: "workspace" as const,
        host,
        workspace: option.workspace,
        option
      }))
    ];
  });
}

function sortHosts(hosts: readonly HostProfile[], activeHostId: string | null): HostProfile[] {
  return [...hosts].sort((left, right) => {
    if (left.id === activeHostId) {
      return -1;
    }

    if (right.id === activeHostId) {
      return 1;
    }

    const leftScore = left.lastConnectedAt ?? left.updatedAt ?? left.createdAt;
    const rightScore = right.lastConnectedAt ?? right.updatedAt ?? right.createdAt;
    return rightScore.localeCompare(leftScore);
  });
}

function readCachedHostWorkspaceOptions(hostId: string): MobileWorkspaceOption[] {
  const snapshot = readWorkbenchNavigationSnapshot(HOST_WORKSPACE_SWITCHER_CACHE_MAX_AGE_MS, hostId);

  if (!snapshot) {
    return [];
  }

  return flattenMobileWorkspaceOptions(mapWorkbenchSnapshotToNavigationGroups(snapshot));
}

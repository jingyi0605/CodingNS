import type { ClientRuntimeConfig, HostProfile } from "../../../config/client-config-types";
import type { ScopedWorkspaceDto, WorkspaceDto } from "../../conversation/api/conversation-api";
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
  readonly scopedKey: string;
  readonly hostStatus: ScopedWorkspaceDto["hostStatus"];
  readonly available: boolean;
  readonly workspaceCount: number;
}

export interface MobileHostSwitcherWorkspaceEntry {
  readonly kind: "workspace";
  readonly host: HostProfile;
  readonly source: "active" | "cached" | "scoped";
  readonly scopedKey: string;
  readonly workspaceRef: {
    readonly hostId: string;
    readonly workspaceId: string;
  };
  readonly hostStatus: ScopedWorkspaceDto["hostStatus"];
  readonly available: boolean;
  readonly workspace: WorkspaceDto;
  readonly option: MobileWorkspaceOption;
}

export type MobileHostSwitcherEntry =
  | MobileHostSwitcherHostEntry
  | MobileHostSwitcherWorkspaceEntry;

type MobileHostSwitcherWorkspaceSource = MobileHostSwitcherWorkspaceEntry["source"];

export function buildMobileHostSwitcherEntries(
  config: Pick<ClientRuntimeConfig, "hosts" | "activeHostId">,
  activeHostWorkspaceOptions: readonly MobileWorkspaceOption[],
  scopedWorkspaces: readonly ScopedWorkspaceDto[] = []
): MobileHostSwitcherEntry[] {
  return sortHosts(config.hosts, config.activeHostId).flatMap((host) => {
    const hostId = resolveSwitcherHostId(host.id, config.activeHostId);
    const scopedWorkspaceOptions = buildScopedWorkspaceOptions(hostId, scopedWorkspaces);
    const workspaceSource: MobileHostSwitcherWorkspaceSource =
      host.id === config.activeHostId
        ? "active"
        : scopedWorkspaceOptions.length > 0
          ? "scoped"
          : "cached";
    const workspaceOptions =
      host.id === config.activeHostId
        ? activeHostWorkspaceOptions
        : scopedWorkspaceOptions.length > 0
          ? scopedWorkspaceOptions
          : readCachedHostWorkspaceOptions(host.id);
    const hostStatus = resolveHostStatus(hostId, scopedWorkspaces, host.id === config.activeHostId);
    const available = isHostWorkspaceAvailable(hostStatus);

    return [
      {
        kind: "host" as const,
        host,
        scopedKey: buildHostScopedKey(hostId),
        hostStatus,
        available,
        workspaceCount: workspaceOptions.length
      },
      ...workspaceOptions.map((option) => ({
        kind: "workspace" as const,
        host,
        source: workspaceSource,
        scopedKey: buildWorkspaceScopedKey(hostId, option.workspace.id),
        workspaceRef: {
          hostId,
          workspaceId: option.workspace.id
        },
        hostStatus,
        available,
        workspace: option.workspace,
        option
      }))
    ];
  });
}

export function buildHostScopedKey(hostId: string): string {
  return `host:${encodeScopedKeyPart(hostId)}`;
}

export function buildWorkspaceScopedKey(hostId: string, workspaceId: string): string {
  return `workspace:${encodeScopedKeyPart(hostId)}:${encodeScopedKeyPart(workspaceId)}`;
}

export function isPeerHostWorkspaceEntry(
  item: MobileHostSwitcherEntry,
  activeHostId: string | null
): boolean {
  return item.kind === "workspace" && item.source === "scoped" && item.host.id !== activeHostId;
}

export function isHostWorkspaceAvailable(status: ScopedWorkspaceDto["hostStatus"]): boolean {
  return status === undefined || status === "current" || status === "reachable" || status === "unknown";
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

function resolveSwitcherHostId(hostId: string, activeHostId: string | null): string {
  return hostId === activeHostId ? "current" : hostId;
}

function resolveHostStatus(
  hostId: string,
  scopedWorkspaces: readonly ScopedWorkspaceDto[],
  active: boolean
): ScopedWorkspaceDto["hostStatus"] {
  if (active) {
    return "current";
  }

  const status = scopedWorkspaces.find((item) => item.hostId === hostId)?.hostStatus;
  return status ?? "unknown";
}

function buildScopedWorkspaceOptions(
  hostId: string,
  scopedWorkspaces: readonly ScopedWorkspaceDto[]
): MobileWorkspaceOption[] {
  return scopedWorkspaces
    .filter((item) => item.hostId === hostId)
    .map((item) => ({
      workspace: item.workspace,
      label: item.workspace.name,
      subtitle: item.workspace.path,
      depth: 0,
      kind: "workspace" as const,
      meta: null
    }));
}

function encodeScopedKeyPart(value: string): string {
  return encodeURIComponent(value);
}

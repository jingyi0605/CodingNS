import type { ClientRuntimeConfig, HostProfile } from "../../../config/client-config-types";

const HOST_ALIAS_MAX_LENGTH = 4;
const HOST_ALIAS_FALLBACK = "HOST";

export const HOST_TAG_COLOR_PRESETS = [
  "#34C759",
  "#22C55E",
  "#14B8A6",
  "#06B6D4",
  "#0EA5E9",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#A855F7",
  "#D946EF",
  "#EC4899",
  "#F43F5E",
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#EAB308",
  "#84CC16",
  "#10B981"
] as const;

export interface HostAliasTagView {
  label: string;
  color: string;
}

export function normalizeHostAliasLabel(value: string | null | undefined): string {
  const normalized = value?.match(/[A-Za-z]/g)?.join("").toUpperCase().slice(0, HOST_ALIAS_MAX_LENGTH);

  if (!normalized) {
    return HOST_ALIAS_FALLBACK;
  }

  return normalized;
}

export function resolveHostAliasTag(
  host: Pick<HostProfile, "id" | "alias" | "name" | "tagColor"> | null | undefined
): HostAliasTagView | null {
  if (!host) {
    return null;
  }

  return {
    label: normalizeHostAliasLabel(host.alias || host.name),
    color: host.tagColor ?? HOST_TAG_COLOR_PRESETS[hashHostId(host.id) % HOST_TAG_COLOR_PRESETS.length]
  };
}

export function listUsableWorkspaceHosts(
  config: Pick<ClientRuntimeConfig, "activeHostId" | "hosts">
): HostProfile[] {
  const activeHostId = config.activeHostId ?? config.hosts[0]?.id ?? null;

  return config.hosts.filter((host) => host.id === activeHostId || (host.peerEnabled && Boolean(host.peerHostId)));
}

export function resolveWorkspaceHostProfile(
  config: Pick<ClientRuntimeConfig, "activeHostId" | "hosts">,
  hostId: string | null | undefined
): HostProfile | null {
  const activeHostId = config.activeHostId ?? config.hosts[0]?.id ?? null;
  const resolvedHostId = hostId && hostId !== "current" ? hostId : activeHostId;

  if (!resolvedHostId) {
    return null;
  }

  return config.hosts.find((host) => host.id === resolvedHostId) ?? null;
}

function hashHostId(hostId: string): number {
  let hash = 0;

  for (const char of hostId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash;
}

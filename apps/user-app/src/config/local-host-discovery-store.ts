import { clientConfigStore } from "./client-config-store";
import type {
  ClientRuntimeConfig,
  DesktopLocalHostProcessHit,
  DiscoveredHostProfile,
  RuntimeHostProfile
} from "./client-config-types";
import { getEffectiveActiveHostId, isDiscoveredHostProfile } from "./client-config-types";
import { probeHost } from "../network/host-probe";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { normalizeServerBaseUrl } from "./server-config-shared";

export const LOCAL_HOST_DISCOVERY_COOLDOWN_MS = 10_000;

interface RefreshLocalHostDiscoveryOptions {
  force?: boolean;
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function normalizeDataDir(dataDir: string | null | undefined): string | null {
  if (typeof dataDir !== "string" || !dataDir.trim()) {
    return null;
  }

  return dataDir.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function buildDiscoveryKey(baseUrl: string, dataDir: string | null): string {
  return dataDir
    ? `local-discovered:${baseUrl}:${dataDir}`
    : `local-discovered:${baseUrl}`;
}

function buildHostDisplayName(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.host;
  } catch {
    return baseUrl;
  }
}

function preferProcessHit(
  current: DesktopLocalHostProcessHit,
  next: DesktopLocalHostProcessHit
): DesktopLocalHostProcessHit {
  if (!current.dataDir && next.dataDir) {
    return next;
  }

  if ((current.pid ?? Number.MAX_SAFE_INTEGER) > (next.pid ?? Number.MAX_SAFE_INTEGER)) {
    return next;
  }

  return current;
}

function dedupeProcessHits(hits: readonly DesktopLocalHostProcessHit[]): DesktopLocalHostProcessHit[] {
  const deduped = new Map<string, DesktopLocalHostProcessHit>();

  for (const hit of hits) {
    if (!hit.baseUrl) {
      continue;
    }

    let normalizedBaseUrl: string;

    try {
      normalizedBaseUrl = normalizeServerBaseUrl(hit.baseUrl);
    } catch {
      continue;
    }

    const current = deduped.get(normalizedBaseUrl);

    if (!current) {
      deduped.set(normalizedBaseUrl, {
        ...hit,
        baseUrl: normalizedBaseUrl
      });
      continue;
    }

    deduped.set(normalizedBaseUrl, preferProcessHit(current, { ...hit, baseUrl: normalizedBaseUrl }));
  }

  return Array.from(deduped.values());
}

async function probeDiscoveredHosts(
  hits: readonly DesktopLocalHostProcessHit[]
): Promise<DiscoveredHostProfile[]> {
  const dedupedHits = dedupeProcessHits(hits);
  const probeStartedAt = nowIsoString();
  const results = await Promise.all(
    dedupedHits.map(async (hit) => {
      const baseUrl = hit.baseUrl;

      if (!baseUrl) {
        return null;
      }

      const probeResult = await probeHost(baseUrl);

      if (!probeResult.reachable) {
        return null;
      }

      const normalizedDataDir = normalizeDataDir(hit.dataDir);
      const discoveryKey = buildDiscoveryKey(baseUrl, normalizedDataDir);

      return {
        id: discoveryKey,
        discoveryKey,
        name: buildHostDisplayName(baseUrl),
        baseUrl,
        kind: "local" as const,
        createdAt: probeStartedAt,
        updatedAt: probeStartedAt,
        lastConnectedAt: null,
        lastUserId: null,
        lastUsername: null,
        source: "desktop-process-scan" as const,
        pid: hit.pid ?? null,
        executable: hit.executable ?? null,
        dataDir: normalizedDataDir,
        discoveredAt: probeStartedAt,
        lastReachableAt: probeStartedAt
      } satisfies DiscoveredHostProfile;
    })
  );

  return results.filter((item) => item !== null);
}

export function getVisibleDiscoveredHosts(
  config: Pick<ClientRuntimeConfig, "hosts" | "discoveredHosts">
): DiscoveredHostProfile[] {
  const savedHostBaseUrls = new Set(config.hosts.map((host) => normalizeServerBaseUrl(host.baseUrl)));

  return config.discoveredHosts.filter((host) => !savedHostBaseUrls.has(normalizeServerBaseUrl(host.baseUrl)));
}

export function getLocalHostDiscoveryActiveHost(
  config: Pick<ClientRuntimeConfig, "activeHostId" | "activeDiscoveredHostId" | "hosts" | "discoveredHosts">
): RuntimeHostProfile | null {
  const activeHostId = getEffectiveActiveHostId(config);

  if (!activeHostId) {
    return null;
  }

  return (
    config.hosts.find((host) => host.id === activeHostId)
    ?? config.discoveredHosts.find((host) => host.id === activeHostId)
    ?? null
  );
}

class LocalHostDiscoveryStore {
  private inFlight: Promise<void> | null = null;

  initialize(): void {
    void this.refresh();
  }

  async refresh(options: RefreshLocalHostDiscoveryOptions = {}): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const task = this.performRefresh(options).finally(() => {
      if (this.inFlight === task) {
        this.inFlight = null;
      }
    });

    this.inFlight = task;
    return task;
  }

  setActiveDiscoveredHost(hostId: string | null): void {
    const currentState = clientConfigStore.getState();
    const resolvedHostId =
      hostId && currentState.discoveredHosts.some((host) => host.id === hostId) ? hostId : null;

    if (resolvedHostId === currentState.activeDiscoveredHostId) {
      return;
    }

    clientConfigStore.updateRuntime({
      activeDiscoveredHostId: resolvedHostId
    });
  }

  private async performRefresh({ force = false }: RefreshLocalHostDiscoveryOptions): Promise<void> {
    const adapter = createPlatformAdapter();
    const currentState = clientConfigStore.getState();

    if (!adapter.isDesktop || (adapter.ui.osFamily !== "windows" && adapter.ui.osFamily !== "macos")) {
      clientConfigStore.updateRuntime({
        discoveredHosts: [],
        activeDiscoveredHostId: null,
        localHostDiscovery: {
          status: "unsupported",
          lastScannedAt: currentState.localHostDiscovery.lastScannedAt,
          cooldownUntil: null,
          errorCode: "PLATFORM_NOT_SUPPORTED",
          errorDetail: "当前平台不支持本机 HOST 自动发现。"
        }
      });
      return;
    }

    const cooldownUntil = currentState.localHostDiscovery.cooldownUntil
      ? Date.parse(currentState.localHostDiscovery.cooldownUntil)
      : Number.NaN;

    if (!force && Number.isFinite(cooldownUntil) && cooldownUntil > Date.now()) {
      return;
    }

    clientConfigStore.updateRuntime({
      localHostDiscovery: {
        ...currentState.localHostDiscovery,
        status: "refreshing",
        errorCode: null,
        errorDetail: null
      }
    });

    const bridgeResult = await adapter.bridge.scanLocalHosts();
    const scannedAt = nowIsoString();
    const nextCooldownUntil = new Date(Date.now() + LOCAL_HOST_DISCOVERY_COOLDOWN_MS).toISOString();

    if (!bridgeResult.ok) {
      clientConfigStore.updateRuntime({
        localHostDiscovery: {
          status:
            bridgeResult.errorCode === "PLATFORM_NOT_SUPPORTED" ? "unsupported" : "failed",
          lastScannedAt: scannedAt,
          cooldownUntil: nextCooldownUntil,
          errorCode: bridgeResult.errorCode ?? "LOCAL_HOST_DISCOVERY_FAILED",
          errorDetail: bridgeResult.detail ?? "本机 HOST 扫描失败。"
        }
      });
      return;
    }

    const discoveredHosts = await probeDiscoveredHosts(bridgeResult.value ?? []);
    const previousActiveHost = getLocalHostDiscoveryActiveHost(clientConfigStore.getState());
    const nextActiveDiscoveredHostId =
      isDiscoveredHostProfile(previousActiveHost)
      && discoveredHosts.some((host) => host.id === previousActiveHost.id)
        ? previousActiveHost.id
        : null;

    clientConfigStore.updateRuntime({
      discoveredHosts,
      activeDiscoveredHostId: nextActiveDiscoveredHostId,
      localHostDiscovery: {
        status: "ready",
        lastScannedAt: scannedAt,
        cooldownUntil: nextCooldownUntil,
        errorCode: null,
        errorDetail: null
      }
    });
  }
}

export const localHostDiscoveryStore = new LocalHostDiscoveryStore();

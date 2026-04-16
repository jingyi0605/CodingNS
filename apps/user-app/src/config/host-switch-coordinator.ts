import { clientConfigStore } from "./client-config-store";
import { getEffectiveActiveHostId, getRuntimeHostById, isDiscoveredHostProfile } from "./client-config-types";
import { authStore } from "../features/auth/store/auth-store";
import { readRememberedLoginCredentials } from "../features/auth/store/remembered-login";
import { probeHost } from "../network/host-probe";
import { localHostDiscoveryStore } from "./local-host-discovery-store";

export class HostSwitchError extends Error {
  constructor(
    public readonly code: "HOST_NOT_FOUND" | "HOST_UNREACHABLE",
    message: string
  ) {
    super(message);
    this.name = "HostSwitchError";
  }
}

class HostSwitchCoordinator {
  private inFlight: Promise<void> | null = null;

  async switchHost(hostId: string): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
    }

    const task = this.performSwitch(hostId).finally(() => {
      if (this.inFlight === task) {
        this.inFlight = null;
      }
    });

    this.inFlight = task;
    await task;
  }

  private async performSwitch(hostId: string): Promise<void> {
    const currentConfig = clientConfigStore.getState();

    if (getEffectiveActiveHostId(currentConfig) === hostId) {
      return;
    }

    const targetHost = getRuntimeHostById(currentConfig, hostId);

    if (!targetHost) {
      throw new HostSwitchError("HOST_NOT_FOUND", `找不到 HOST：${hostId}`);
    }

    const probeResult = await probeHost(targetHost.baseUrl);

    if (!probeResult.reachable) {
      throw new HostSwitchError("HOST_UNREACHABLE", `目标 HOST 不可达：${targetHost.baseUrl}`);
    }

    const rememberedLogin = readRememberedLoginCredentials(targetHost.id);

    if (rememberedLogin) {
      try {
        await authStore.loginForHost(targetHost, {
          username: rememberedLogin.username,
          password: rememberedLogin.password
        });
      } catch {
        // 预登录失败时仍然允许切换过去，后续回到登录页让用户手动修正凭据。
      }
    }

    const nextConfig = clientConfigStore.getState();
    const switchedAt = new Date().toISOString();

    if (isDiscoveredHostProfile(targetHost)) {
      clientConfigStore.updateRuntime({
        discoveredHosts: nextConfig.discoveredHosts.map((host) =>
          host.id === hostId
            ? {
                ...host,
                lastConnectedAt: switchedAt,
                updatedAt: switchedAt
              }
            : host
        ),
        activeDiscoveredHostId: hostId
      });
      return;
    }

    localHostDiscoveryStore.setActiveDiscoveredHost(null);
    await clientConfigStore.update({
      hosts: nextConfig.hosts.map((host) =>
        host.id === hostId
          ? {
              ...host,
              lastConnectedAt: switchedAt,
              updatedAt: switchedAt
            }
          : host
      ),
      activeHostId: hostId
    });
  }
}

export const hostSwitchCoordinator = new HostSwitchCoordinator();

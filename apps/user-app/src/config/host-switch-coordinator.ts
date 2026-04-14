import { clientConfigStore } from "./client-config-store";
import { getHostProfileById } from "./client-config-types";
import { probeHost } from "../network/host-probe";

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

    if (currentConfig.activeHostId === hostId) {
      return;
    }

    const targetHost = getHostProfileById(currentConfig, hostId);

    if (!targetHost) {
      throw new HostSwitchError("HOST_NOT_FOUND", `找不到 HOST：${hostId}`);
    }

    const probeResult = await probeHost(targetHost.baseUrl);

    if (!probeResult.reachable) {
      throw new HostSwitchError("HOST_UNREACHABLE", `目标 HOST 不可达：${targetHost.baseUrl}`);
    }

    await clientConfigStore.update({
      hosts: currentConfig.hosts.map((host) =>
        host.id === hostId
          ? {
              ...host,
              lastConnectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          : host
      ),
      activeHostId: hostId
    });
  }
}

export const hostSwitchCoordinator = new HostSwitchCoordinator();

import { getBootstrapStatus, type BootstrapStatus } from "../features/auth/api/auth-api";

export interface HostProbeResult extends BootstrapStatus {
  reachable: boolean;
}

export async function probeHost(baseUrl?: string): Promise<HostProbeResult> {
  try {
    const status = await getBootstrapStatus(baseUrl);
    return {
      ...status,
      reachable: true
    };
  } catch {
    return {
      initialized: false,
      reachable: false
    };
  }
}

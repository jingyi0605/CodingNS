import { useSyncExternalStore } from "react";

import { clientConfigStore } from "./client-config-store";
import {
  getActiveHost,
  getEffectiveActiveHostId,
  type HostCandidateEndpoint
} from "./client-config-types";
import { authStore } from "../features/auth/store/auth-store";
import {
  probeAuthenticatedHostCandidateEndpoint,
  type HostCandidateProbeStatus
} from "../network/host-candidate-probe";

type Listener = () => void;

export interface HostRuntimeCandidateEndpointState extends HostCandidateEndpoint {
  status: "pending" | HostCandidateProbeStatus;
  checkedAt: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  responseHostBaseUrl: string | null;
  responseBindingId: string | null;
  responseHostFingerprint: string | null;
}

export interface HostRuntimeState {
  epoch: number;
  activeHostId: string | null;
  connectionSignature: string;
  candidateProbeSignature: string | null;
  candidateProbePhase: "idle" | "probing" | "ready";
  candidateProbeStartedAt: string | null;
  candidateProbeFinishedAt: string | null;
  candidateEndpoints: HostRuntimeCandidateEndpointState[];
  preferredCandidateEndpointId: string | null;
  preferredDirectCandidateEndpointId: string | null;
}

class HostRuntimeStore {
  private state: HostRuntimeState = {
    epoch: 0,
    activeHostId: getEffectiveActiveHostId(clientConfigStore.getState()),
    connectionSignature: buildConnectionSignature(clientConfigStore.getState()),
    candidateProbeSignature: null,
    candidateProbePhase: "idle",
    candidateProbeStartedAt: null,
    candidateProbeFinishedAt: null,
    candidateEndpoints: [],
    preferredCandidateEndpointId: null,
    preferredDirectCandidateEndpointId: null
  };

  private listeners = new Set<Listener>();
  private probeRunId = 0;

  constructor() {
    clientConfigStore.subscribe(() => {
      this.handleDependencyChange();
    });
    authStore.subscribe(() => {
      this.handleDependencyChange();
    });
    this.handleDependencyChange();
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  private handleDependencyChange(): void {
    const nextConfig = clientConfigStore.getState();
    const nextActiveHostId = getEffectiveActiveHostId(nextConfig);
    const nextConnectionSignature = buildConnectionSignature(nextConfig);
    const nextProbeInput = buildCandidateProbeInput(nextConfig, authStore.getState().session?.accessToken ?? null);
    const nextProbeSignature = nextProbeInput?.signature ?? null;
    let changed = false;
    let nextState = this.state;

    if (
      nextActiveHostId !== this.state.activeHostId
      || nextConnectionSignature !== this.state.connectionSignature
    ) {
      nextState = {
        ...nextState,
        epoch: this.state.epoch + 1,
        activeHostId: nextActiveHostId,
        connectionSignature: nextConnectionSignature
      };
      changed = true;
    }

    if (nextProbeSignature !== this.state.candidateProbeSignature) {
      this.probeRunId += 1;

      if (!nextProbeInput) {
        nextState = {
          ...nextState,
          candidateProbeSignature: null,
          candidateProbePhase: "idle",
          candidateProbeStartedAt: null,
          candidateProbeFinishedAt: null,
          candidateEndpoints: [],
          preferredCandidateEndpointId: null,
          preferredDirectCandidateEndpointId: null
        };
        changed = true;
      } else {
        const startedAt = new Date().toISOString();

        nextState = {
          ...nextState,
          candidateProbeSignature: nextProbeSignature,
          candidateProbePhase: "probing",
          candidateProbeStartedAt: startedAt,
          candidateProbeFinishedAt: null,
          candidateEndpoints: nextProbeInput.candidateEndpoints.map((endpoint) => ({
            ...endpoint,
            status: "pending",
            checkedAt: null,
            errorCode: null,
            errorDetail: null,
            responseHostBaseUrl: null,
            responseBindingId: null,
            responseHostFingerprint: null
          })),
          preferredCandidateEndpointId: null,
          preferredDirectCandidateEndpointId: null
        };
        changed = true;
        void this.runCandidateProbe(nextProbeInput, this.probeRunId);
      }
    }

    if (changed) {
      this.state = nextState;
      this.emit();
    }
  }

  private async runCandidateProbe(
    input: CandidateProbeInput,
    runId: number
  ): Promise<void> {
    const candidateEndpoints = await Promise.all(
      input.candidateEndpoints.map(async (endpoint) => {
        const result = await probeAuthenticatedHostCandidateEndpoint({
          baseUrl: endpoint.url,
          accessToken: input.accessToken,
          platform: input.platform,
          expectedBindingId: input.expectedBindingId,
          expectedHostFingerprint: input.expectedHostFingerprint
        });

        return {
          ...endpoint,
          status: result.status,
          checkedAt: result.checkedAt,
          errorCode: result.errorCode,
          errorDetail: result.errorDetail,
          responseHostBaseUrl: result.responseHostBaseUrl,
          responseBindingId: result.responseBindingId,
          responseHostFingerprint: result.responseHostFingerprint
        } satisfies HostRuntimeCandidateEndpointState;
      })
    );

    if (runId !== this.probeRunId) {
      return;
    }

    this.state = {
      ...this.state,
      candidateProbePhase: "ready",
      candidateProbeFinishedAt: new Date().toISOString(),
      candidateEndpoints,
      preferredCandidateEndpointId: resolvePreferredCandidateEndpointId(candidateEndpoints),
      preferredDirectCandidateEndpointId: resolvePreferredDirectCandidateEndpointId(candidateEndpoints)
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const hostRuntimeStore = new HostRuntimeStore();

export function useHostRuntimeBoundaryKey(): string {
  return useSyncExternalStore(hostRuntimeStore.subscribe, () => {
    const state = hostRuntimeStore.getState();
    return `${state.activeHostId ?? "anonymous"}:${state.epoch}`;
  });
}

export function useHostRuntimeSelector<T>(selector: (state: HostRuntimeState) => T): T {
  return useSyncExternalStore(hostRuntimeStore.subscribe, () => selector(hostRuntimeStore.getState()));
}

function buildConnectionSignature(config: ReturnType<typeof clientConfigStore.getState>): string {
  const activeHost = getActiveHost(config);

  if (!activeHost) {
    return "no-host";
  }

  return JSON.stringify({
    id: activeHost.id,
    baseUrl: activeHost.baseUrl,
    relayTunnel: activeHost.relayTunnel
  });
}

interface CandidateProbeInput {
  signature: string;
  platform: "desktop" | "web";
  accessToken: string;
  expectedBindingId: string;
  expectedHostFingerprint: string;
  candidateEndpoints: HostCandidateEndpoint[];
}

function buildCandidateProbeInput(
  config: ReturnType<typeof clientConfigStore.getState>,
  accessToken: string | null
): CandidateProbeInput | null {
  const activeHost = getActiveHost(config);
  const relayTunnel = activeHost?.relayTunnel;
  const bindingId = relayTunnel?.bindingId?.trim();
  const hostFingerprint = relayTunnel?.hostFingerprint?.trim();
  const candidateEndpoints = relayTunnel?.candidateEndpoints ?? [];

  if (!activeHost || !accessToken || !bindingId || !hostFingerprint || candidateEndpoints.length === 0) {
    return null;
  }

  const platform = config.platform === "desktop" ? "desktop" : "web";

  // H5 可信前端固定走 relay E2EE，不再做任何候选直连探测。
  // 这些探测只会把浏览器带去碰内网 HTTP 地址，制造 Mixed Content 和错误切换。
  if (platform === "web") {
    return null;
  }

  const probeCandidateEndpoints = candidateEndpoints.filter((endpoint) =>
    shouldProbeCandidateEndpoint(endpoint, platform)
  );

  if (probeCandidateEndpoints.length === 0) {
    return null;
  }

  return {
    signature: JSON.stringify({
      hostId: activeHost.id,
      platform,
      accessToken,
      bindingId,
      hostFingerprint,
      candidateEndpoints: probeCandidateEndpoints.map((endpoint) => ({
        endpointId: endpoint.endpointId,
        url: endpoint.url,
        kind: endpoint.kind,
        priority: endpoint.priority
      }))
    }),
    platform,
    accessToken,
    expectedBindingId: bindingId,
    expectedHostFingerprint: hostFingerprint,
    candidateEndpoints: probeCandidateEndpoints
  };
}

function shouldProbeCandidateEndpoint(
  endpoint: HostCandidateEndpoint,
  platform: CandidateProbeInput["platform"]
): boolean {
  return platform !== "web";
}

function resolvePreferredCandidateEndpointId(
  endpoints: HostRuntimeCandidateEndpointState[]
): string | null {
  return endpoints.find((endpoint) => endpoint.status === "verified")?.endpointId ?? null;
}

function resolvePreferredDirectCandidateEndpointId(
  endpoints: HostRuntimeCandidateEndpointState[]
): string | null {
  return endpoints.find(
    (endpoint) => endpoint.status === "verified" && endpoint.kind !== "relay"
  )?.endpointId ?? null;
}

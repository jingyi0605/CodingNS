import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authStore } from "../features/auth/store/auth-store";
import { clientConfigStore } from "./client-config-store";
import { hostRuntimeStore } from "./host-runtime-store";

const probeAuthenticatedHostCandidateEndpointMock = vi.hoisted(() => vi.fn());

vi.mock("../network/host-candidate-probe", () => ({
  probeAuthenticatedHostCandidateEndpoint: probeAuthenticatedHostCandidateEndpointMock
}));

const storedSession = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresIn: 3600,
  user: {
    userId: "user-1",
    username: "admin",
    role: "admin" as const
  }
};

describe("host-runtime-store 候选入口探测", () => {
  beforeEach(() => {
    window.localStorage.clear();
    probeAuthenticatedHostCandidateEndpointMock.mockReset();
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: null,
      hosts: [],
      discoveredHosts: [],
      activeDiscoveredHostId: null,
      localHostDiscovery: {
        status: "idle",
        lastScannedAt: null,
        cooldownUntil: null,
        errorCode: null,
        errorDetail: null
      },
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    authStore.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("会为当前激活 Host 探测候选入口，并产出优先直连入口", async () => {
    probeAuthenticatedHostCandidateEndpointMock
      .mockResolvedValueOnce({
        status: "verified",
        checkedAt: "2026-04-21T00:00:00.000Z",
        errorCode: null,
        errorDetail: null,
        responseHostBaseUrl: "http://192.168.50.8:3002",
        responseBindingId: "binding_demo",
        responseHostFingerprint: "SHA256:demo"
      })
      .mockResolvedValueOnce({
        status: "verified",
        checkedAt: "2026-04-21T00:00:01.000Z",
        errorCode: null,
        errorDetail: null,
        responseHostBaseUrl: "https://demo.channel.codingns.com",
        responseBindingId: "binding_demo",
        responseHostFingerprint: "SHA256:demo"
      });
    clientConfigStore.hydrate(createRuntimeConfig());
    authStore.hydrate(storedSession);

    await waitFor(() => {
      expect(hostRuntimeStore.getState().candidateProbePhase).toBe("ready");
    });

    expect(probeAuthenticatedHostCandidateEndpointMock).toHaveBeenCalledTimes(2);
    expect(hostRuntimeStore.getState().preferredCandidateEndpointId).toBe(
      "host_reported:http://192.168.50.8:3002"
    );
    expect(hostRuntimeStore.getState().preferredDirectCandidateEndpointId).toBe(
      "host_reported:http://192.168.50.8:3002"
    );
    expect(
      hostRuntimeStore.getState().candidateEndpoints.map((endpoint) => endpoint.status)
    ).toEqual(["verified", "verified"]);
  });

  it("只有 relay 入口验身成功时，不会误报可用直连入口", async () => {
    probeAuthenticatedHostCandidateEndpointMock
      .mockResolvedValueOnce({
        status: "mismatch",
        checkedAt: "2026-04-21T00:00:00.000Z",
        errorCode: "HOST_IDENTITY_MISMATCH",
        errorDetail: "候选入口返回的 Host 身份与当前激活 Host 不一致",
        responseHostBaseUrl: "http://192.168.50.9:3002",
        responseBindingId: "binding_other",
        responseHostFingerprint: "SHA256:other"
      })
      .mockResolvedValueOnce({
        status: "verified",
        checkedAt: "2026-04-21T00:00:01.000Z",
        errorCode: null,
        errorDetail: null,
        responseHostBaseUrl: "https://demo.channel.codingns.com",
        responseBindingId: "binding_demo",
        responseHostFingerprint: "SHA256:demo"
      });
    clientConfigStore.hydrate(createRuntimeConfig());
    authStore.hydrate(storedSession);

    await waitFor(() => {
      expect(hostRuntimeStore.getState().candidateProbePhase).toBe("ready");
    });

    expect(hostRuntimeStore.getState().preferredCandidateEndpointId).toBe(
      "relay:https://demo.channel.codingns.com"
    );
    expect(hostRuntimeStore.getState().preferredDirectCandidateEndpointId).toBeNull();
    expect(hostRuntimeStore.getState().candidateEndpoints[0]?.status).toBe("mismatch");
    expect(hostRuntimeStore.getState().candidateEndpoints[1]?.status).toBe("verified");
  });

  it("Web 可信前端不会再做任何候选入口探测", async () => {
    clientConfigStore.hydrate(createRuntimeConfig({
      platform: "web"
    }));
    authStore.hydrate(storedSession);

    expect(probeAuthenticatedHostCandidateEndpointMock).not.toHaveBeenCalled();
    expect(hostRuntimeStore.getState().candidateProbePhase).toBe("idle");
    expect(hostRuntimeStore.getState().candidateEndpoints).toEqual([]);
    expect(hostRuntimeStore.getState().preferredCandidateEndpointId).toBeNull();
    expect(hostRuntimeStore.getState().preferredDirectCandidateEndpointId).toBeNull();
  });

  it("Android 客户端会按 desktop 口径探测候选入口", async () => {
    probeAuthenticatedHostCandidateEndpointMock.mockResolvedValueOnce({
      status: "verified",
      checkedAt: "2026-04-21T00:00:00.000Z",
      errorCode: null,
      errorDetail: null,
      responseHostBaseUrl: "http://192.168.50.8:3002",
      responseBindingId: "binding_demo",
      responseHostFingerprint: "SHA256:demo"
    }).mockResolvedValueOnce({
      status: "verified",
      checkedAt: "2026-04-21T00:00:01.000Z",
      errorCode: null,
      errorDetail: null,
      responseHostBaseUrl: "https://demo.channel.codingns.com",
      responseBindingId: "binding_demo",
      responseHostFingerprint: "SHA256:demo"
    });
    clientConfigStore.hydrate(createRuntimeConfig({
      platform: "android"
    }));
    authStore.hydrate(storedSession);

    await waitFor(() => {
      expect(hostRuntimeStore.getState().candidateProbePhase).toBe("ready");
    });

    expect(probeAuthenticatedHostCandidateEndpointMock).toHaveBeenCalledWith(expect.objectContaining({
      platform: "desktop"
    }));
  });
});

function createRuntimeConfig(overrides?: {
  platform?: "desktop" | "web" | "ios" | "android";
}) {
  return {
    platform: overrides?.platform ?? ("desktop" as const),
    activeHostId: "host-1",
    hosts: [
      {
        id: "host-1",
        name: "demo.channel.codingns.com",
        baseUrl: "https://demo.channel.codingns.com",
        kind: "remote" as const,
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
        lastConnectedAt: null,
        lastUserId: null,
        lastUsername: null,
        relayTunnel: {
          provider: "codingns_relay" as const,
          enabled: true,
          tunnelDomain: "demo.channel.codingns.com",
          controlBaseUrl: "https://control.codingns.example",
          bindingId: "binding_demo",
          hostFingerprint: "SHA256:demo",
          candidateEndpoints: [
            {
              endpointId: "host_reported:http://192.168.50.8:3002",
              kind: "lan" as const,
              url: "http://192.168.50.8:3002",
              priority: 200,
              expiresAt: null,
              source: "host_reported" as const
            },
            {
              endpointId: "relay:https://demo.channel.codingns.com",
              kind: "relay" as const,
              url: "https://demo.channel.codingns.com",
              priority: 400,
              expiresAt: null,
              source: "host_reported" as const
            }
          ]
        }
      }
    ],
    discoveredHosts: [],
    activeDiscoveredHostId: null,
    localHostDiscovery: {
      status: "idle" as const,
      lastScannedAt: null,
      cooldownUntil: null,
      errorCode: null,
      errorDetail: null
    },
    releaseChannel: "stable" as const,
    autoReconnect: true,
    autoCheckUpdate: true,
    language: "zh-CN" as const,
    defaultPermissionMode: "default" as const
  };
}

import { beforeEach, describe, expect, it } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { mergePeerHostsIntoClientConfig } from "./peer-host-config-sync";

describe("peer-host-config-sync", () => {
  beforeEach(() => {
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "主 Host",
          alias: "HOST",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
          lastConnectedAt: "2026-06-10T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin",
          peerEnabled: false,
          peerHostId: null,
          relayTunnel: null
        },
        {
          id: "host-2",
          name: "WIN",
          alias: "WIN",
          baseUrl: "http://10.255.0.85:3009",
          kind: "lan",
          createdAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
          lastConnectedAt: "2026-06-10T00:00:00.000Z",
          lastUserId: null,
          lastUsername: null,
          peerEnabled: true,
          peerHostId: "peer-1",
          relayTunnel: null
        },
        {
          id: "peer-host-stale",
          name: "WIN",
          alias: "WIN",
          baseUrl: "http://10.255.0.85:3009",
          kind: "lan",
          createdAt: "2026-06-09T00:00:00.000Z",
          updatedAt: "2026-06-09T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          peerEnabled: false,
          peerHostId: null,
          relayTunnel: null
        }
      ],
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
      autoDownloadUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
  });

  it("同步 Peer HOST 时会按同地址合并重复项，只保留一条", async () => {
    await mergePeerHostsIntoClientConfig([
      {
        id: "peer-1",
        ownerUserId: "user-1",
        name: "WIN",
        alias: "WIN",
        baseUrl: "http://10.255.0.85:3009",
        normalizedBaseUrl: "http://10.255.0.85:3009",
        status: "reachable",
        remoteVersion: "0.9.8",
        remoteApiCompatibility: "peer-host-v1",
        remoteHostFingerprint: "fingerprint-1",
        lastCheckedAt: "2026-06-10T01:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        createdAt: "2026-06-10T00:00:00.000Z",
        updatedAt: "2026-06-10T01:00:00.000Z",
        removedAt: null
      }
    ]);

    const peerHosts = clientConfigStore.getState().hosts.filter(
      (host) => host.baseUrl === "http://10.255.0.85:3009"
    );

    expect(peerHosts).toHaveLength(1);
    expect(peerHosts[0]).toMatchObject({
      id: "host-2",
      peerHostId: "peer-1",
      peerEnabled: true
    });
  });

  it("同步 Peer HOST 时不会用服务端别名覆盖本地自定义别名", async () => {
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      hosts: clientConfigStore.getState().hosts.map((host) =>
        host.id === "host-1"
          ? {
              ...host,
              alias: "MAC",
              peerEnabled: true,
              peerHostId: "peer-main"
            }
          : host
      )
    });

    await mergePeerHostsIntoClientConfig([
      {
        id: "peer-main",
        ownerUserId: "user-1",
        name: "主 Host",
        alias: "HOST",
        baseUrl: "http://127.0.0.1:3002",
        normalizedBaseUrl: "http://127.0.0.1:3002",
        status: "reachable",
        remoteVersion: "0.9.8",
        remoteApiCompatibility: "peer-host-v1",
        remoteHostFingerprint: "fingerprint-main",
        lastCheckedAt: "2026-06-10T01:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        createdAt: "2026-06-10T00:00:00.000Z",
        updatedAt: "2026-06-10T01:00:00.000Z",
        removedAt: null
      }
    ]);

    const host = clientConfigStore.getState().hosts.find((item) => item.id === "host-1");

    expect(host?.alias).toBe("MAC");
    expect(host?.peerHostId).toBe("peer-main");
  });
});

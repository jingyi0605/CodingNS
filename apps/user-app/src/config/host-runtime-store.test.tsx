import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { clientConfigStore } from "./client-config-store";
import { getActiveHost } from "./client-config-types";
import { useHostRuntimeBoundaryKey } from "./host-runtime-store";

function BoundaryKeyProbe() {
  const boundaryKey = useHostRuntimeBoundaryKey();

  return <div data-testid="boundary-key">{boundaryKey}</div>;
}

describe("host-runtime-store", () => {
  it("activeHostId 变化时会生成新的运行时边界 key", () => {
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "127.0.0.1:3002",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null
        },
        {
          id: "host-2",
          name: "10.10.1.8:4100",
          baseUrl: "http://10.10.1.8:4100",
          kind: "lan",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    render(<BoundaryKeyProbe />);

    const initialBoundaryKey = screen.getByTestId("boundary-key").textContent ?? "";
    const [, initialEpochRaw] = initialBoundaryKey.split(":");
    const initialEpoch = Number(initialEpochRaw);

    expect(initialBoundaryKey.startsWith("host-1:")).toBe(true);

    act(() => {
      clientConfigStore.hydrate({
        ...clientConfigStore.getState(),
        activeHostId: "host-2"
      });
    });

    const nextBoundaryKey = screen.getByTestId("boundary-key").textContent ?? "";
    const [, nextEpochRaw] = nextBoundaryKey.split(":");

    expect(nextBoundaryKey.startsWith("host-2:")).toBe(true);
    expect(Number(nextEpochRaw)).toBe(initialEpoch + 1);
  });

  it("当前 Host 的 CodingNS Connect profile 变化时也会生成新的运行时边界 key", () => {
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "demo.codingns.example",
          baseUrl: "https://demo.codingns.example",
          kind: "remote",
          createdAt: "2026-04-19T00:00:00.000Z",
          updatedAt: "2026-04-19T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    render(<BoundaryKeyProbe />);

    const initialBoundaryKey = screen.getByTestId("boundary-key").textContent ?? "";
    const [, initialEpochRaw] = initialBoundaryKey.split(":");
    const initialEpoch = Number(initialEpochRaw);

    act(() => {
      const state = clientConfigStore.getState();
      const activeHost = getActiveHost(state);

      if (!activeHost) {
        throw new Error("缺少 active host");
      }

      clientConfigStore.hydrate({
        ...state,
        hosts: state.hosts.map((host) =>
          host.id === activeHost.id
            ? {
                ...host,
                relayTunnel: {
                  provider: "codingns_relay" as const,
                  enabled: true,
                  tunnelDomain: "demo.codingns.example",
                  controlBaseUrl: "https://control.codingns.example"
                },
                updatedAt: "2026-04-19T00:01:00.000Z"
              }
            : host
        )
      });
    });

    const nextBoundaryKey = screen.getByTestId("boundary-key").textContent ?? "";
    const [, nextEpochRaw] = nextBoundaryKey.split(":");

    expect(nextBoundaryKey.startsWith("host-1:")).toBe(true);
    expect(Number(nextEpochRaw)).toBe(initialEpoch + 1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_HOST_PROFILE_ID } from "./client-config-types";
import { loadClientRuntimeConfig } from "./client-config-service";
import { createPlatformAdapter } from "../platform/platform-adapter";

vi.mock("../platform/platform-adapter", () => ({
  createPlatformAdapter: vi.fn(),
  resolveRuntimePlatform: vi.fn(() => "desktop")
}));

function createMockAdapter(overrides: {
  platform?: "desktop" | "web" | "ios" | "android";
  isDesktop?: boolean;
  desktopConfig?: unknown;
} = {}) {
  return {
    platform: overrides.platform ?? "desktop",
    isDesktop: overrides.isDesktop ?? false,
    bridge: {
      readDesktopConfig: vi.fn(async () => ({
        ok: true,
        value: overrides.desktopConfig
      })),
      writeDesktopConfig: vi.fn(async () => ({ ok: true })),
      scanLocalHosts: vi.fn(async () => ({ ok: false }))
    }
  } as never;
}

describe("client-config-service", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(createPlatformAdapter).mockReset();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.mocked(createPlatformAdapter).mockReset();
  });

  it("启动时会把旧 hostBaseUrl 迁移成默认 HOST Profile", async () => {
    window.localStorage.setItem(
      "codingns.client.runtime-config",
      JSON.stringify({
        platform: "desktop",
        hostBaseUrl: "10.10.1.8:4100",
        releaseChannel: "beta",
        autoReconnect: false,
        autoCheckUpdate: false,
        language: "en",
        defaultPermissionMode: "acceptEdits"
      })
    );
    vi.mocked(createPlatformAdapter).mockReturnValue(createMockAdapter({ platform: "desktop" }));

    const config = await loadClientRuntimeConfig();

    expect(config.activeHostId).toBe(DEFAULT_HOST_PROFILE_ID);
    expect(config.hosts).toHaveLength(1);
    expect(config.hosts[0]).toMatchObject({
      id: DEFAULT_HOST_PROFILE_ID,
      baseUrl: "http://10.10.1.8:4100",
      name: "10.10.1.8:4100",
      kind: "lan"
    });
    expect(config.releaseChannel).toBe("beta");
    expect(config.language).toBe("en-US");
    expect(config.defaultPermissionMode).toBe("acceptEdits");

    const stored = JSON.parse(
      window.localStorage.getItem("codingns.client.runtime-config") ?? "null"
    ) as Record<string, unknown>;

    expect(stored.hostBaseUrl).toBeUndefined();
    expect(stored.activeHostId).toBe(DEFAULT_HOST_PROFILE_ID);
    expect(stored.hosts).toBeInstanceOf(Array);
  });

  it("桌面端读到旧 hostBaseUrl patch 时只会更新当前激活 HOST，不会把多 HOST 折回单条", async () => {
    window.localStorage.setItem(
      "codingns.client.runtime-config",
      JSON.stringify({
        platform: "desktop",
        activeHostId: "host-2",
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
      })
    );
    vi.mocked(createPlatformAdapter).mockReturnValue(
      createMockAdapter({
        platform: "desktop",
        isDesktop: true,
        desktopConfig: {
          hostBaseUrl: "http://10.10.1.9:4200"
        }
      })
    );

    const config = await loadClientRuntimeConfig();

    expect(config.activeHostId).toBe("host-2");
    expect(config.hosts).toHaveLength(2);
    expect(config.hosts[0].baseUrl).toBe("http://127.0.0.1:3002");
    expect(config.hosts[1].baseUrl).toBe("http://10.10.1.9:4200");
  });
});

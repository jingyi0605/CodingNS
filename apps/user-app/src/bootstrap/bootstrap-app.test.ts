import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../config/client-config-store", () => ({
  clientConfigStore: {
    initialize: vi.fn(),
    getState: vi.fn(() => ({
      activeHostId: null,
      activeDiscoveredHostId: null,
      hosts: [],
      discoveredHosts: []
    })),
    subscribe: vi.fn(() => () => undefined)
  }
}));

vi.mock("../config/local-host-discovery-store", () => ({
  localHostDiscoveryStore: {
    initialize: vi.fn()
  }
}));

vi.mock("../platform/platform-adapter", () => ({
  createPlatformAdapter: vi.fn()
}));

vi.mock("../preferences/preferences-store", () => ({
  initializePreferences: vi.fn()
}));

import { bootstrapApplication } from "./bootstrap-app";
import { clientConfigStore } from "../config/client-config-store";
import { localHostDiscoveryStore } from "../config/local-host-discovery-store";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { initializePreferences } from "../preferences/preferences-store";

const mockedClientConfigStore = vi.mocked(clientConfigStore);
const mockedLocalHostDiscoveryStore = vi.mocked(localHostDiscoveryStore);
const mockedCreatePlatformAdapter = vi.mocked(createPlatformAdapter);
const mockedInitializePreferences = vi.mocked(initializePreferences);

describe("bootstrapApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreatePlatformAdapter.mockReturnValue({
      platform: "desktop"
    } as never);
    mockedClientConfigStore.initialize.mockResolvedValue({} as never);
    mockedLocalHostDiscoveryStore.initialize.mockImplementation(() => undefined);
  });

  it("不会等待远程偏好初始化完成才返回", async () => {
    mockedInitializePreferences.mockReturnValue(new Promise(() => undefined));

    await expect(bootstrapApplication()).resolves.toEqual({
      platform: "desktop"
    });
    expect(mockedClientConfigStore.initialize).toHaveBeenCalledTimes(1);
    expect(mockedLocalHostDiscoveryStore.initialize).toHaveBeenCalledTimes(1);
    expect(mockedInitializePreferences).toHaveBeenCalledTimes(1);
  });

  it("偏好初始化失败时也不会让首屏启动失败", async () => {
    mockedInitializePreferences.mockRejectedValue(new Error("preferences failed"));

    await expect(bootstrapApplication()).resolves.toEqual({
      platform: "desktop"
    });
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { authStore } from "../../auth/store/auth-store";
import { readRememberedLoginCredentials } from "../../auth/store/remembered-login";
import { ToastProvider } from "../../../shared/toast";
import { WorkbenchHostSwitcher } from "./WorkbenchHostSwitcher";

const switchHostMock = vi.fn();

vi.mock("../../../config/host-switch-coordinator", async () => {
  const actual = await vi.importActual("../../../config/host-switch-coordinator");
  return {
    ...actual,
    hostSwitchCoordinator: {
      switchHost: (...args: unknown[]) => switchHostMock(...args)
    }
  };
});

describe("WorkbenchHostSwitcher", () => {
  beforeEach(() => {
    switchHostMock.mockReset();
    window.localStorage.clear();
    vi.restoreAllMocks();
    clientConfigStore.hydrate({
      platform: "desktop",
      activeHostId: "host-1",
      hosts: [
        {
          id: "host-1",
          name: "本地 Host",
          baseUrl: "http://127.0.0.1:3002",
          kind: "local",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-14T00:00:00.000Z",
          lastUserId: "user-1",
          lastUsername: "admin"
        },
        {
          id: "host-2",
          name: "办公室 Host",
          baseUrl: "http://10.10.1.8:3002",
          kind: "lan",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
          lastConnectedAt: "2026-04-13T00:00:00.000Z",
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
    authStore.hydrate({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    });
  });

  it("会列出 HOST 并调用切换协调器", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: /办公室 Host.*10\.10\.1\.8:3002/ }));

    await waitFor(() => {
      expect(switchHostMock).toHaveBeenCalledWith("host-2");
    });
  });

  it("支持在弹层里新增 HOST", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: /新增 HOST/ }));
    await user.type(screen.getByLabelText("HOST 名称"), "演示机房");
    await user.type(screen.getByLabelText("HOST 地址"), "10.0.0.8:3002");
    await user.click(screen.getByRole("button", { name: "保存 HOST" }));

    await waitFor(() => {
      const nextHost = clientConfigStore.getState().hosts.find((host) => host.name === "演示机房");
      expect(nextHost?.baseUrl).toBe("http://10.0.0.8:3002");
    });
  });

  it("新增 HOST 时可以顺手保存认证信息", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: /新增 HOST/ }));
    await user.type(screen.getByLabelText("HOST 名称"), "机房 Host");
    await user.type(screen.getByLabelText("HOST 地址"), "10.0.0.9:3002");
    await user.type(screen.getByLabelText("用户名"), "root");
    await user.type(screen.getByLabelText("密码"), "Secret123!");
    await user.click(screen.getByRole("button", { name: "保存 HOST" }));

    await waitFor(() => {
      const nextHost = clientConfigStore.getState().hosts.find((host) => host.name === "机房 Host");
      expect(nextHost).toBeDefined();
      expect(readRememberedLoginCredentials(nextHost?.id ?? null)).toMatchObject({
        username: "root",
        password: "Secret123!"
      });
    });
  });

  it("支持删除非当前 HOST，并清理已保存的认证信息", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <ToastProvider>
        <WorkbenchHostSwitcher />
      </ToastProvider>
    );

    const nextHost = clientConfigStore.getState().hosts.find((host) => host.id === "host-2");
    expect(nextHost).toBeDefined();

    if (!nextHost) {
      throw new Error("host-2 should exist");
    }

    window.localStorage.setItem(
      "codingns.auth.remembered-login",
      JSON.stringify({
        [nextHost.id]: {
          hostId: nextHost.id,
          username: "tester",
          password: "Secret123!",
          savedAt: Date.now()
        }
      })
    );

    await user.click(screen.getByRole("button", { name: "切换 HOST" }));
    await user.click(screen.getByRole("button", { name: `删除 HOST ${nextHost.name}` }));

    await waitFor(() => {
      expect(clientConfigStore.getState().hosts.some((host) => host.id === "host-2")).toBe(false);
      expect(readRememberedLoginCredentials("host-2")).toBeNull();
    });
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { writeWorkbenchNavigationSnapshot } from "../../workbench/utils/workbench-navigation-snapshot";
import { ToastProvider } from "../../../shared/toast";
import { MobileWorkspaceSwitcherHeader } from "./MobileWorkspaceSwitcherHeader";

const switchHostMock = vi.fn();
const listScopedWorkspacesMock = vi.fn();

vi.mock("../../../config/host-switch-coordinator", async () => {
  const actual = await vi.importActual("../../../config/host-switch-coordinator");
  return {
    ...actual,
    hostSwitchCoordinator: {
      switchHost: (...args: unknown[]) => switchHostMock(...args)
    }
  };
});

vi.mock("../../conversation/api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../../conversation/api/conversation-api")>(
    "../../conversation/api/conversation-api"
  );

  return {
    ...actual,
    listScopedWorkspaces: (...args: unknown[]) => listScopedWorkspacesMock(...args)
  };
});

describe("MobileWorkspaceSwitcherHeader", () => {
  beforeEach(() => {
    switchHostMock.mockReset();
    listScopedWorkspacesMock.mockReset();
    listScopedWorkspacesMock.mockResolvedValue({ items: [] });
    window.sessionStorage.clear();
    clientConfigStore.hydrate({
      platform: "ios",
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
          lastUsername: "jackson"
        }
      ],
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    writeWorkbenchNavigationSnapshot(
      {
        items: [
          {
            workspace: {
              id: "workspace-2",
              name: "项目二",
              path: "/repo/project-two",
              repoRoot: "/repo/project-two"
            },
            sessions: [],
            childWorktrees: []
          }
        ]
      },
      "host-2"
    );
  });

  it("点击 HOST 节点时只切 HOST 并回到工作区首页", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions"]}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <MobileWorkspaceSwitcherHeader
                    currentWorkspace={{
                      id: "workspace-1",
                      name: "项目一",
                      path: "/repo/project-one"
                    }}
                    workspaces={[
                      {
                        id: "workspace-1",
                        name: "项目一",
                        path: "/repo/project-one"
                      }
                    ]}
                    workspaceOptions={[
                      {
                        workspace: {
                          id: "workspace-1",
                          name: "项目一",
                          path: "/repo/project-one",
                          repoRoot: "/repo/project-one"
                        },
                        label: "项目一",
                        subtitle: "/repo/project-one",
                        depth: 0,
                        kind: "workspace",
                        meta: null
                      }
                    ]}
                  />
                  <RouteProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换工作区" }));
    const hostSection = screen.getByRole("dialog", { name: "HOST 与工作区" });
    const hostRow = within(hostSection)
      .getAllByRole("button", { name: /办公室 Host/ })
      .find((row) => row.getAttribute("data-host-entry-kind") === "host");

    expect(hostRow).toBeDefined();

    if (!hostRow) {
      throw new Error("办公室 Host 行不存在");
    }

    await user.click(hostRow);

    await waitFor(() => {
      expect(switchHostMock).toHaveBeenCalledWith("host-2");
    });
    expect(screen.getByTestId("route-probe")).toHaveTextContent("/workspaces");
  });

  it("点击跨 HOST 工作区节点时会先切 HOST 再回调工作区选择", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();

    render(
      <ToastProvider>
        <MemoryRouter>
          <MobileWorkspaceSwitcherHeader
            currentWorkspace={{
              id: "workspace-1",
              name: "项目一",
              path: "/repo/project-one"
            }}
            workspaces={[
              {
                id: "workspace-1",
                name: "项目一",
                path: "/repo/project-one"
              }
            ]}
            workspaceOptions={[
              {
                workspace: {
                  id: "workspace-1",
                  name: "项目一",
                  path: "/repo/project-one",
                  repoRoot: "/repo/project-one"
                },
                label: "项目一",
                subtitle: "/repo/project-one",
                depth: 0,
                kind: "workspace",
                meta: null
              }
            ]}
            onSelectWorkspace={onSelectWorkspace}
          />
        </MemoryRouter>
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换工作区" }));
    const hostSection = screen.getByRole("dialog", { name: "HOST 与工作区" });
    const workspaceRow = within(hostSection).getByRole("button", { name: /项目二/ });
    await user.click(workspaceRow);

    await waitFor(() => {
      expect(switchHostMock).toHaveBeenCalledWith("host-2");
    });
    expect(onSelectWorkspace).toHaveBeenCalledWith("workspace-2", {
      hostId: "host-2",
      workspaceId: "workspace-2"
    });
  });

  it("同一个 workspaceId 在两个 HOST 下能同时显示，且 Peer HOST 使用独立 scoped key", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();

    render(
      <ToastProvider>
        <MemoryRouter>
          <MobileWorkspaceSwitcherHeader
            currentWorkspace={{
              id: "workspace-1",
              name: "当前项目",
              path: "/repo/current"
            }}
            workspaces={[
              {
                id: "workspace-1",
                name: "当前项目",
                path: "/repo/current"
              }
            ]}
            workspaceOptions={[
              {
                workspace: {
                  id: "workspace-1",
                  name: "当前项目",
                  path: "/repo/current",
                  repoRoot: "/repo/current"
                },
                label: "当前项目",
                subtitle: "/repo/current",
                depth: 0,
                kind: "workspace",
                meta: null
              }
            ]}
            scopedWorkspaces={[
              {
                hostId: "host-2",
                hostName: "办公室 Host",
                hostStatus: "reachable",
                workspace: {
                  id: "workspace-1",
                  name: "当前项目",
                  path: "/repo/office",
                  repoRoot: "/repo/office"
                }
              }
            ]}
            onSelectWorkspace={onSelectWorkspace}
          />
        </MemoryRouter>
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换工作区" }));
    const dialog = screen.getByRole("dialog", { name: "HOST 与工作区" });

    expect(within(dialog).getAllByRole("button", { name: /当前项目/ })).toHaveLength(2);
    expect(within(dialog).getByText("来自 办公室 Host · /repo/office")).toBeInTheDocument();

    const peerRow = within(dialog).getByRole("button", { name: /当前项目.*办公室 Host/ });
    await user.click(peerRow);

    expect(onSelectWorkspace).toHaveBeenCalledWith("workspace-1", {
      hostId: "host-2",
      workspaceId: "workspace-1"
    });
  });

  it("Peer HOST 不可用时显示不可用状态，点击不会切到错误工作区", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();

    render(
      <ToastProvider>
        <MemoryRouter>
          <MobileWorkspaceSwitcherHeader
            currentWorkspace={{
              id: "workspace-1",
              name: "项目一",
              path: "/repo/project-one"
            }}
            workspaces={[
              {
                id: "workspace-1",
                name: "项目一",
                path: "/repo/project-one"
              }
            ]}
            workspaceOptions={[
              {
                workspace: {
                  id: "workspace-1",
                  name: "项目一",
                  path: "/repo/project-one",
                  repoRoot: "/repo/project-one"
                },
                label: "项目一",
                subtitle: "/repo/project-one",
                depth: 0,
                kind: "workspace",
                meta: null
              }
            ]}
            scopedWorkspaces={[
              {
                hostId: "host-2",
                hostName: "办公室 Host",
                hostStatus: "unreachable",
                workspace: {
                  id: "workspace-2",
                  name: "项目二",
                  path: "/repo/project-two",
                  repoRoot: "/repo/project-two"
                }
              }
            ]}
            onSelectWorkspace={onSelectWorkspace}
          />
        </MemoryRouter>
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "切换工作区" }));
    const dialog = screen.getByRole("dialog", { name: "HOST 与工作区" });
    const peerWorkspaceRow = within(dialog).getByRole("button", { name: /项目二/ });

    expect(within(dialog).getAllByText("不可用").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("办公室 Host 当前不可用，暂时不能打开这个工作区。")).toBeInTheDocument();

    await user.click(peerWorkspaceRow);

    expect(switchHostMock).not.toHaveBeenCalled();
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    expect(await screen.findByText("办公室 Host 当前不可用")).toBeInTheDocument();
  });

  it("当前 HOST 没有工作区时也会回退显示 HOST 标题", () => {
    render(
      <ToastProvider>
        <MemoryRouter>
          <MobileWorkspaceSwitcherHeader
            currentWorkspace={null}
            workspaces={[]}
          />
        </MemoryRouter>
      </ToastProvider>
    );

    expect(screen.getAllByText("本地 Host")).toHaveLength(2);
    expect(screen.getByText("http://127.0.0.1:3002")).toBeInTheDocument();
  });
});

function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route-probe">{location.pathname}</div>;
}

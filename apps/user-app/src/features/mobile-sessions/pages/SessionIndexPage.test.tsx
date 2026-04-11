import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { SessionIndexPage } from "./SessionIndexPage";

const navigationGroups = [
  {
    workspace: {
      id: "workspace-1",
      name: "项目一"
    },
    sessions: [
      {
        sessionId: "session-1",
        title: "会话 Alpha",
        provider: "codex",
        workspaceId: "workspace-1",
        lastMessageAt: "2026-03-27T10:00:00Z",
        runningState: null,
        syncStatus: null,
        lastErrorCode: null,
        lastErrorDetail: null
      },
      {
        sessionId: "session-2",
        title: "会话 Beta",
        provider: "claude-code",
        workspaceId: "workspace-1",
        isFavorite: true,
        lastMessageAt: "2026-03-27T09:00:00Z",
        runningState: null,
        syncStatus: null,
        lastErrorCode: null,
        lastErrorDetail: null
      },
      {
        sessionId: "session-2-sub",
        title: "子代理 Beta-1",
        provider: "codex",
        workspaceId: "workspace-1",
        parentSessionId: "session-2",
        isSubagent: true,
        subagentLabel: "worker · Beta",
        lastMessageAt: "2026-03-27T08:30:00Z",
        runningState: null,
        syncStatus: null,
        lastErrorCode: null,
        lastErrorDetail: null
      }
    ]
  },
  {
    workspace: {
      id: "workspace-2",
      name: "Project Two"
    },
    sessions: [
      {
        sessionId: "session-3",
        title: "会话 Gamma",
        provider: "codex",
        workspaceId: "workspace-2",
        lastMessageAt: "2026-03-26T12:00:00Z",
        runningState: null,
        syncStatus: null,
        lastErrorCode: null,
        lastErrorDetail: null
      }
    ]
  }
];

const contextValue = {
  navigationGroups,
  currentWorkspaceId: "workspace-1",
  currentSessionId: "session-1",
  favoriteSessionIds: ["session-2"],
  navigationLoading: false,
  selectWorkspace: vi.fn(),
  toggleFavoriteSession: vi.fn(async () => undefined),
  archiveSession: vi.fn(async () => undefined),
  unarchiveSession: vi.fn(async () => undefined),
  renameSession: vi.fn(),
  startDraftSession: vi.fn()
};

vi.mock("../../conversation/components/WorkbenchLayout", async () => {
  const actual = await vi.importActual("../../conversation/components/WorkbenchLayout");
  return {
    ...actual,
    useWorkbenchShell: () => contextValue
  };
});

function renderPage(options?: { withRouteProbe?: boolean }) {
  const withRouteProbe = options?.withRouteProbe ?? false;

  return render(
    <MemoryRouter initialEntries={["/workspaces/workspace-1/sessions"]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/sessions"
          element={
            <>
              <SessionIndexPage />
              {withRouteProbe ? <RouteProbe /> : null}
            </>
          }
        />
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={withRouteProbe ? <RouteProbe /> : null}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("SessionIndexPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("渲染当前工作区的对话列表", () => {
    renderPage();

    expect(screen.queryByText("对话")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "项目一" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "当前工作区" })).toBeInTheDocument();
  });

  it("当前工作区列表会保留收藏会话，但不会混入其他工作区会话", () => {
    renderPage();

    const workspaceSection = screen.getByRole("heading", { level: 2, name: "当前工作区" }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到目标区块");
    }

    expect(within(workspaceSection).getByText("会话 Alpha")).toBeInTheDocument();
    expect(within(workspaceSection).getByText("会话 Beta")).toBeInTheDocument();
    expect(within(workspaceSection).queryByText("会话 Gamma")).not.toBeInTheDocument();
  });

  it("新建会话按钮会先选择工作区和供应商再调用 startDraftSession", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "新建会话" }));
    await user.click(screen.getByRole("button", { name: /选择工作区 项目一/ }));
    await user.click(screen.getByRole("button", { name: /Project Two/ }));
    await user.click(screen.getByRole("button", { name: "OpenCode" }));

    expect(contextValue.startDraftSession).toHaveBeenCalledWith("workspace-2", "opencode");
  }, 10000);

  it("列表操作按钮会调用上下文函数", async () => {
    const user = userEvent.setup();
    renderPage();

    const workspaceSection = screen.getByRole("heading", { level: 2, name: "当前工作区" }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到会话区块");
    }

    const alphaEntry = within(workspaceSection).getByText("会话 Alpha").closest("article");
    const betaEntry = within(workspaceSection).getByText("会话 Beta").closest("article");

    if (!alphaEntry || !betaEntry) {
      throw new Error("未找到会话列表项");
    }

    await user.click(within(alphaEntry).getByRole("button", { name: "更多操作" }));
    const archiveButton = await screen.findByRole("menuitem", { name: "归档会话" });
    await user.click(archiveButton);
    expect(contextValue.archiveSession).toHaveBeenCalledWith("session-1");

    await user.click(within(betaEntry).getByRole("button", { name: "更多操作" }));
    const unfavoriteButton = await screen.findByRole("menuitem", { name: "取消收藏" });
    await user.click(unfavoriteButton);
    expect(contextValue.toggleFavoriteSession).toHaveBeenCalledWith("session-2");

    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("New Title");
    await user.click(within(alphaEntry).getByRole("button", { name: "更多操作" }));
    const renameButton = await screen.findByRole("menuitem", { name: "重命名" });
    await user.click(renameButton);
    expect(contextValue.renameSession).toHaveBeenCalledWith("session-1", "New Title");
    promptSpy.mockRestore();
  }, 10000);

  it("更多操作菜单会挂到视口层并保持在屏幕范围内", async () => {
    const user = userEvent.setup();
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 720
    });

    renderPage();

    const workspaceSection = screen.getByRole("heading", { level: 2, name: "当前工作区" }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到会话区块");
    }

    const alphaEntry = within(workspaceSection).getByText("会话 Alpha").closest("article");

    if (!alphaEntry) {
      throw new Error("未找到 Alpha 会话");
    }

    const trigger = within(alphaEntry).getByRole("button", { name: "更多操作" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 350,
      y: 620,
      width: 48,
      height: 32,
      top: 620,
      right: 398,
      bottom: 652,
      left: 350,
      toJSON: () => undefined
    });

    await user.click(trigger);

    const menu = screen.getByRole("menu", { name: "更多操作" });
    Object.defineProperty(menu, "offsetWidth", {
      configurable: true,
      get: () => 180
    });
    Object.defineProperty(menu, "offsetHeight", {
      configurable: true,
      get: () => 160
    });

    fireEvent(window, new Event("resize"));

    expect(document.body.contains(menu)).toBe(true);
    expect(menu).toHaveStyle({
      position: "fixed",
      left: "198px",
      top: "452px",
      width: "180px"
    });

    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it("主会话点击状态指示器后会展开和收起子会话列表", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByText("子代理 Beta-1")).not.toBeInTheDocument();

    const workspaceSection = screen.getByRole("heading", { level: 2, name: "当前工作区" }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到当前工作区会话区块");
    }

    const betaEntry = within(workspaceSection).getByText("会话 Beta").closest("article");

    if (!betaEntry) {
      throw new Error("未找到 Beta 会话");
    }

    await user.click(within(betaEntry).getByRole("button", { name: t("shell.subagentExpand") }));

    expect(within(workspaceSection).getByText("子代理 Beta-1")).toBeInTheDocument();
    expect(within(betaEntry).getByRole("button", { name: t("shell.subagentCollapse") })).toBeInTheDocument();

    await user.click(within(betaEntry).getByRole("button", { name: t("shell.subagentCollapse") }));

    expect(within(workspaceSection).queryByText("子代理 Beta-1")).not.toBeInTheDocument();
  });

  it("移动端列表会显示会话失败错误摘要", () => {
    contextValue.navigationGroups[0].sessions[0] = {
      ...contextValue.navigationGroups[0].sessions[0],
      runningState: "failed",
      syncStatus: "error",
      lastErrorCode: "CODEX_HTTP_429",
      lastErrorDetail: "unexpected status 429 Too Many Requests"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    renderPage();

    expect(
      screen.getByText(/CODEX_HTTP_429 · unexpected status 429 Too Many Requests/)
    ).toBeInTheDocument();
  });

  it("从全部会话页进入会话时，会写入沉浸模式并且不自动展开侧边会话栏", async () => {
    const user = userEvent.setup();
    renderPage({ withRouteProbe: true });

    const workspaceSection = screen.getByRole("heading", { level: 2, name: "当前工作区" }).closest("section");

    if (!workspaceSection) {
      throw new Error("未找到当前工作区会话区块");
    }

    const alphaEntry = within(workspaceSection).getByText("会话 Alpha").closest("article");

    if (!alphaEntry) {
      throw new Error("未找到 Alpha 会话");
    }

    await user.click(within(alphaEntry).getByRole("button", { name: /会话 Alpha/ }));

    expect(window.localStorage.getItem("mobile.conversation.preview.mode")).toBe("immersive");
    expect(screen.getByTestId("route-probe")).toHaveTextContent("/workspaces/workspace-1/sessions/session-1");
  });
});

function RouteProbe() {
  const location = useLocation();

  return <div data-testid="route-probe">{location.pathname}</div>;
}

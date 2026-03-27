import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        lastMessageAt: "2026-03-27T10:00:00Z"
      },
      {
        sessionId: "session-2",
        title: "会话 Beta",
        provider: "claude-code",
        workspaceId: "workspace-1",
        isFavorite: true,
        lastMessageAt: "2026-03-27T09:00:00Z"
      },
      {
        sessionId: "session-2-sub",
        title: "子代理 Beta-1",
        provider: "codex",
        workspaceId: "workspace-1",
        parentSessionId: "session-2",
        isSubagent: true,
        subagentLabel: "worker · Beta",
        lastMessageAt: "2026-03-27T08:30:00Z"
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
        lastMessageAt: "2026-03-26T12:00:00Z"
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sessions"]}>
      <Routes>
        <Route path="/sessions" element={<SessionIndexPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("SessionIndexPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("渲染最近、收藏和当前工作区三个区块", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 2, name: "会话" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "收藏会话" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "项目一" })).toBeInTheDocument();
  });

  it("已收藏会话不会再出现在当前工作区区块里", () => {
    renderPage();

    const favoriteSection = screen.getByRole("heading", { level: 2, name: "收藏会话" }).closest("section");
    const workspaceSection = screen.getByRole("heading", { level: 2, name: "项目一" }).closest("section");

    if (!favoriteSection || !workspaceSection) {
      throw new Error("未找到目标区块");
    }

    expect(within(favoriteSection).getByText("会话 Beta")).toBeInTheDocument();
    expect(within(workspaceSection).queryByText("会话 Beta")).not.toBeInTheDocument();
  });

  it("新建会话按钮会调用 startDraftSession", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "新建会话" }));

    expect(contextValue.startDraftSession).toHaveBeenCalledWith("workspace-1", "codex");
  });

  it("列表操作按钮会调用上下文函数", async () => {
    const user = userEvent.setup();
    renderPage();

    const recentSection = screen.getByRole("heading", { level: 2, name: "会话" }).closest("section");
    const favoriteSection = screen.getByRole("heading", { level: 2, name: "收藏会话" }).closest("section");

    if (!recentSection || !favoriteSection) {
      throw new Error("未找到会话区块");
    }

    const alphaEntry = within(recentSection)
      .getByRole("button", { name: "会话 Alpha 项目一 Codex" })
      .closest("article");
    const betaEntry = within(favoriteSection)
      .getByRole("button", { name: "会话 Beta 项目一 Claude" })
      .closest("article");

    if (!alphaEntry || !betaEntry) {
      throw new Error("未找到会话列表项");
    }

    await user.click(within(alphaEntry).getByRole("button", { name: "更多操作" }));
    const archiveButton = screen.getByRole("menuitem", { name: "归档会话" });
    await user.click(archiveButton);
    expect(contextValue.archiveSession).toHaveBeenCalledWith("session-1");

    await user.click(within(betaEntry).getByRole("button", { name: "更多操作" }));
    const unfavoriteButton = screen.getByRole("menuitem", { name: "取消收藏" });
    await user.click(unfavoriteButton);
    expect(contextValue.toggleFavoriteSession).toHaveBeenCalledWith("session-2");

    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("New Title");
    await user.click(within(alphaEntry).getByRole("button", { name: "更多操作" }));
    const renameButton = screen.getByRole("menuitem", { name: "重命名" });
    await user.click(renameButton);
    expect(contextValue.renameSession).toHaveBeenCalledWith("session-1", "New Title");
    promptSpy.mockRestore();
  });

  it("主会话长按后会展开和收起子会话列表", () => {
    vi.useFakeTimers();
    renderPage();

    expect(screen.queryByText("子代理 Beta-1")).not.toBeInTheDocument();

    const favoriteSection = screen.getByRole("heading", { level: 2, name: "收藏会话" }).closest("section");

    if (!favoriteSection) {
      throw new Error("未找到收藏会话区块");
    }

    const betaButton = within(favoriteSection).getByRole("button", { name: "会话 Beta 项目一 Claude" });

    fireEvent.pointerDown(betaButton, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerUp(betaButton, { pointerType: "touch" });

    expect(within(favoriteSection).getByText("子代理 Beta-1")).toBeInTheDocument();

    fireEvent.pointerDown(betaButton, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerUp(betaButton, { pointerType: "touch" });

    expect(within(favoriteSection).queryByText("子代理 Beta-1")).not.toBeInTheDocument();
  });
});

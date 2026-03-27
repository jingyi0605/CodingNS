import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ToolsHomePage,
  resolvePrimaryToolAfterSwipe,
  resolvePrimaryToolFromSearch
} from "./ToolsHomePage";

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => ({
    navigationGroups: [
      {
        workspace: {
          id: "workspace-1",
          name: "CodingNS"
        },
        sessions: []
      }
    ],
    currentWorkspaceId: "workspace-1",
    currentSessionId: null
  })
}));

vi.mock("../conversation/components/FileContextPanel", () => ({
  FileContextPanel: () => <div>文件面板</div>
}));

vi.mock("../conversation/components/GitSidebar", () => ({
  GitSidebar: () => <div>Git 面板</div>
}));

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

describe("ToolsHomePage", () => {
  afterEach(() => {
    window.localStorage.removeItem("mobile.tools.last-primary-tool");
  });

  it("默认优先使用 URL 指定的主工具，否则回退到持久化结果", () => {
    expect(resolvePrimaryToolFromSearch("files", "git")).toBe("files");
    expect(resolvePrimaryToolFromSearch("git", "files")).toBe("git");
    expect(resolvePrimaryToolFromSearch(null, "files")).toBe("files");
  });

  it("水平滑动会在文件和 Git 主工具之间切换", () => {
    expect(
      resolvePrimaryToolAfterSwipe("files", { x: 240, y: 80 }, { x: 120, y: 88 })
    ).toBe("git");
    expect(
      resolvePrimaryToolAfterSwipe("git", { x: 120, y: 88 }, { x: 240, y: 80 })
    ).toBe("files");
  });

  it("垂直手势或位移过小不应该切换主工具", () => {
    expect(
      resolvePrimaryToolAfterSwipe("files", { x: 240, y: 80 }, { x: 210, y: 84 })
    ).toBe("files");
    expect(
      resolvePrimaryToolAfterSwipe("files", { x: 240, y: 80 }, { x: 200, y: 160 })
    ).toBe("files");
    expect(resolvePrimaryToolAfterSwipe("files", null, { x: 120, y: 88 })).toBe("files");
  });

  it("点击主工具切换后应该稳定停在目标 tab，不再和 URL 来回打架", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/workspaces/workspace-1/tools?tab=files"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/tools"
            element={
              <>
                <ToolsHomePage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    const filesButton = screen.getByRole("tab", { name: "文件管理" });
    const gitButton = screen.getByRole("tab", { name: "GIT管理" });

    expect(filesButton).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/workspaces/workspace-1/tools?tab=files"
    );

    await user.click(gitButton);

    await waitFor(() => {
      expect(gitButton).toHaveAttribute("aria-selected", "true");
      expect(filesButton).toHaveAttribute("aria-selected", "false");
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/workspaces/workspace-1/tools?tab=git"
      );
    });
  });
});

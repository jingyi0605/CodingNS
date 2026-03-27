import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolGitPage } from "./ToolGitPage";
import { t } from "../../shared/i18n";

const mockUseWorkbenchShell = vi.fn();
const mockGitSidebar = vi.fn();

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../conversation/components/GitSidebar", () => ({
  GitSidebar: (props: { className?: string; workspaceId: string }) => {
    mockGitSidebar(props);
    return <div data-testid="git-sidebar" data-class-name={props.className} />;
  }
}));

describe("ToolGitPage", () => {
  it("shows empty state when no workspace", () => {
    mockUseWorkbenchShell.mockReturnValue({ currentWorkspaceId: null });

    render(<ToolGitPage />);

    expect(screen.getByText(t("shell.toolsWorkspaceRequiredBody"))).toBeInTheDocument();
  });

  it("renders git sidebar inside panel when a workspace exists", () => {
    mockUseWorkbenchShell.mockReturnValue({ currentWorkspaceId: "workspace-1" });

    render(<ToolGitPage />);

    expect(screen.getByRole("main")).toHaveClass(
      "mobile-page-fixed-root",
      "mobile-tool-panel-page",
      "mobile-tool-git-page"
    );
    expect(screen.getByTestId("git-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("git-sidebar")).toHaveAttribute(
      "data-class-name",
      "mobile-panel-scroll-root mobile-tool-native-panel mobile-tool-git-panel"
    );
    expect(mockGitSidebar).toHaveBeenCalledWith(
      expect.objectContaining({
        className: "mobile-panel-scroll-root mobile-tool-native-panel mobile-tool-git-panel",
        workspaceId: "workspace-1"
      })
    );
  });
});

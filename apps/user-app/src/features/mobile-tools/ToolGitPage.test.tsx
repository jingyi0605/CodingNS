import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolGitPage } from "./ToolGitPage";
import { t } from "../../shared/i18n";

const mockUseWorkbenchShell = vi.fn();

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../conversation/components/GitSidebar", () => ({
  GitSidebar: () => <div data-testid="git-sidebar" />
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

    expect(screen.getByTestId("git-sidebar")).toBeInTheDocument();
    expect(screen.getByText(t("shell.gitEntry"))).toBeInTheDocument();
  });
});

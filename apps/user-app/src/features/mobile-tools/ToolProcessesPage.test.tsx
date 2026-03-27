import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolProcessesPage } from "./ToolProcessesPage";
import { t } from "../../shared/i18n";

const mockUseWorkbenchShell = vi.fn();
const mockTerminalManagerPanel = vi.fn();

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../workbench/components/TerminalManagerPanel", () => ({
  TerminalManagerPanel: (props: {
    className?: string;
    currentWorkspaceId: string;
    navigationGroups: unknown[];
  }) => {
    mockTerminalManagerPanel(props);
    return <div data-testid="terminal-panel" data-class-name={props.className} />;
  }
}));

describe("ToolProcessesPage", () => {
  it("shows empty state before a workspace is selected", () => {
    mockUseWorkbenchShell.mockReturnValue({ currentWorkspaceId: null });

    render(<ToolProcessesPage />);

    expect(screen.getByText(t("shell.toolsWorkspaceRequiredBody"))).toBeInTheDocument();
  });

  it("renders the terminal manager when workspace context exists", () => {
    mockUseWorkbenchShell.mockReturnValue({
      currentWorkspaceId: "workspace-1",
      navigationGroups: []
    });

    render(<ToolProcessesPage />);

    expect(screen.getByRole("main")).toHaveClass("mobile-page-fixed-root", "mobile-tool-panel-page");
    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-panel")).toHaveAttribute(
      "data-class-name",
      "mobile-panel-scroll-root mobile-tool-native-panel"
    );
    expect(mockTerminalManagerPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        className: "mobile-panel-scroll-root mobile-tool-native-panel",
        currentWorkspaceId: "workspace-1",
        navigationGroups: []
      })
    );
  });
});

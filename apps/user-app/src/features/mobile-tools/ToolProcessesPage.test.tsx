import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolProcessesPage } from "./ToolProcessesPage";
import { t } from "../../shared/i18n";

const mockUseWorkbenchShell = vi.fn();

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../workbench/components/TerminalManagerPanel", () => ({
  TerminalManagerPanel: () => <div data-testid="terminal-panel" />
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

    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
    expect(screen.getByText(t("shell.terminalManagerEntry"))).toBeInTheDocument();
  });
});

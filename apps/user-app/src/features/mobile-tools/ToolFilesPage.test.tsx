import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolFilesPage } from "./ToolFilesPage";
import { t } from "../../shared/i18n";

const mockUseWorkbenchShell = vi.fn();

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../conversation/components/FileContextPanel", () => ({
  FileContextPanel: () => <div data-testid="file-panel" />
}));

describe("ToolFilesPage", () => {
  it("shows empty state when no workspace", () => {
    mockUseWorkbenchShell.mockReturnValue({ currentWorkspaceId: null, currentSessionId: null });

    render(<ToolFilesPage />);

    expect(screen.getByText(t("shell.toolsWorkspaceRequiredBody"))).toBeInTheDocument();
  });

  it("renders the file context panel when a workspace is selected", () => {
    mockUseWorkbenchShell.mockReturnValue({
      currentWorkspaceId: "workspace-1",
      currentSessionId: "session-1"
    });

    render(<ToolFilesPage />);

    expect(screen.getByTestId("file-panel")).toBeInTheDocument();
    expect(screen.getByText(t("shell.filesEntry"))).toBeInTheDocument();
  });
});

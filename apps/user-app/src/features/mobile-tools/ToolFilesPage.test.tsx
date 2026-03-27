import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolFilesPage } from "./ToolFilesPage";
import { t } from "../../shared/i18n";

const mockUseWorkbenchShell = vi.fn();
const mockFileContextPanel = vi.fn();

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../conversation/components/FileContextPanel", () => ({
  FileContextPanel: (props: { className?: string; sessionId?: string | null; workspaceId: string }) => {
    mockFileContextPanel(props);
    return <div data-testid="file-panel" data-class-name={props.className} />;
  }
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

    expect(screen.getByRole("main")).toHaveClass("mobile-page-fixed-root", "mobile-tool-panel-page");
    expect(screen.getByTestId("file-panel")).toBeInTheDocument();
    expect(screen.getByTestId("file-panel")).toHaveAttribute(
      "data-class-name",
      "mobile-panel-scroll-root mobile-tool-native-panel"
    );
    expect(mockFileContextPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        className: "mobile-panel-scroll-root mobile-tool-native-panel",
        sessionId: "session-1",
        workspaceId: "workspace-1"
      })
    );
  });
});

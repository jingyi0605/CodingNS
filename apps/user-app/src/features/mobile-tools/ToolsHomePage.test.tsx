import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToolsHomePage } from "./ToolsHomePage";
import { t } from "../../shared/i18n";

const mockNavigate = vi.fn();
const mockUseWorkbenchShell = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate
}));

vi.mock("../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

describe("ToolsHomePage", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseWorkbenchShell.mockReturnValue({
      currentWorkspaceId: "workspace-1",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "项目一",
            path: "/repo/project-one"
          },
          sessions: []
        }
      ]
    });
  });

  it("renders primary tool cards", () => {
    render(<ToolsHomePage />);

    expect(screen.getByText(t("shell.filesEntry"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.gitEntry"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.terminalsEntry"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.terminalManagerEntry"))).toBeInTheDocument();
  });

  it("opens the terminal page from the tool card", async () => {
    const user = userEvent.setup();

    render(<ToolsHomePage />);

    await user.click(screen.getByRole("button", { name: /终端/i }));

    expect(mockNavigate).toHaveBeenCalledWith("/terminals");
  });
});

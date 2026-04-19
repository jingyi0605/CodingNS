import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdaptiveButlerPage } from "./AdaptiveButlerPage";

const mockUseWorkbenchShell = vi.fn();

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("./ButlerPage", () => ({
  ButlerPage: () => <div data-testid="adaptive-butler-desktop">desktop-butler</div>
}));

vi.mock("./MobileButlerPage", () => ({
  MobileButlerPage: () => <div data-testid="adaptive-butler-mobile">mobile-butler</div>
}));

describe("AdaptiveButlerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("desktop 壳层渲染桌面 Butler 页面", () => {
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop"
    });

    render(<AdaptiveButlerPage />);

    expect(screen.getByTestId("adaptive-butler-desktop")).toBeInTheDocument();
    expect(screen.queryByTestId("adaptive-butler-mobile")).not.toBeInTheDocument();
  });

  it("mobile 壳层渲染移动 Butler 页面", () => {
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "mobile"
    });

    render(<AdaptiveButlerPage />);

    expect(screen.getByTestId("adaptive-butler-mobile")).toBeInTheDocument();
    expect(screen.queryByTestId("adaptive-butler-desktop")).not.toBeInTheDocument();
  });
});

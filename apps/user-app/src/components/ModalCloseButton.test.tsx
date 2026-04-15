import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModalCloseButton } from "./ModalCloseButton";

describe("ModalCloseButton", () => {
  it("统一渲染关闭图标并透传点击事件", () => {
    const handleClick = vi.fn();

    const { container } = render(<ModalCloseButton aria-label="关闭预览" onClick={handleClick} />);
    const button = screen.getByRole("button", { name: "关闭预览" });

    expect(button).toHaveClass("workbench-modal-close");
    expect(container.querySelector(".workbench-modal-close svg")).not.toBeNull();

    fireEvent.click(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});

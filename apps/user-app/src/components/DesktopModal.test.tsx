import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DesktopModal } from "./DesktopModal";
import { t } from "../shared/i18n";

describe("DesktopModal", () => {
  it("会在遮罩、关闭按钮和 Escape 下触发关闭", () => {
    const onClose = vi.fn();

    render(
      <DesktopModal
        open
        title="归档确认"
        description="确认后会把当前会话移到归档区。"
        onClose={onClose}
      >
        <p>正文</p>
      </DesktopModal>
    );

    const dialog = screen.getByRole("dialog", { name: "归档确认" });
    const closeButtons = screen.getAllByRole("button", { name: t("common.close") });
    const closeButton = closeButtons.find((button) => button.classList.contains("workbench-modal-close"));

    expect(dialog).toHaveAttribute("data-size", "compact");
    expect(dialog).toHaveAttribute("data-layout", "form");

    const backdrop = document.querySelector(".workbench-modal-backdrop");

    if (!(backdrop instanceof HTMLButtonElement)) {
      throw new Error("未找到模态框 backdrop");
    }

    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error("未找到关闭按钮");
    }

    fireEvent.click(backdrop);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("在不可关闭时会禁用遮罩、关闭按钮和 Escape", () => {
    const onClose = vi.fn();

    render(
      <DesktopModal
        open
        title="处理中"
        dismissible={false}
        onClose={onClose}
      >
        <p>正文</p>
      </DesktopModal>
    );

    const backdrop = document.querySelector(".workbench-modal-backdrop");
    const closeButtons = screen.getAllByRole("button", { name: t("common.close") });
    const closeButton = closeButtons.find((button) => button.classList.contains("workbench-modal-close"));

    if (!(backdrop instanceof HTMLButtonElement)) {
      throw new Error("未找到模态框 backdrop");
    }

    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error("未找到关闭按钮");
    }

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(closeButton);
    fireEvent.click(backdrop);

    expect(backdrop.disabled).toBe(true);
    expect(closeButton).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

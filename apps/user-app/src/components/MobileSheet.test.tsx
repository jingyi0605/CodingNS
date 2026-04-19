import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileSheet } from "./MobileSheet";
import { t } from "../shared/i18n";

describe("MobileSheet", () => {
  it("会渲染标题、描述和取消按钮，并支持遮罩关闭", () => {
    const onClose = vi.fn();

    render(
      <MobileSheet
        open
        title="终端操作"
        description="选择一个动作继续处理当前终端。"
        kind="action"
        height="half"
        onClose={onClose}
      >
        <button type="button">复制标签</button>
      </MobileSheet>
    );

    const dialog = screen.getByRole("dialog", { name: "终端操作" });

    expect(dialog).toHaveAttribute("data-kind", "action");
    expect(dialog).toHaveAttribute("data-height", "half");
    expect(screen.getByText("选择一个动作继续处理当前终端。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));

    const overlay = document.querySelector(".mobile-sheet-overlay");

    if (!(overlay instanceof HTMLDivElement)) {
      throw new Error("未找到 mobile sheet overlay");
    }

    fireEvent.click(overlay);

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("在不可关闭时会禁用取消按钮和遮罩关闭", () => {
    const onClose = vi.fn();

    render(
      <MobileSheet
        open
        title="处理中"
        dismissible={false}
        onClose={onClose}
      >
        <p>正文</p>
      </MobileSheet>
    );

    const cancelButton = screen.getByRole("button", { name: t("common.cancel") });
    const overlay = document.querySelector(".mobile-sheet-overlay");

    if (!(overlay instanceof HTMLDivElement)) {
      throw new Error("未找到 mobile sheet overlay");
    }

    fireEvent.click(cancelButton);
    fireEvent.click(overlay);

    expect(cancelButton).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

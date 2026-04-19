import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { TerminalRuntimeFallbackModal } from "./TerminalRuntimeFallbackModal";

describe("TerminalRuntimeFallbackModal", () => {
  it("会渲染统一桌面模态框结构，并在可关闭时响应遮罩和操作按钮", () => {
    const onClose = vi.fn();
    const onConfirmFallback = vi.fn();

    render(
      <TerminalRuntimeFallbackModal
        open
        onClose={onClose}
        onConfirmFallback={onConfirmFallback}
      />
    );

    expect(screen.getByRole("dialog", { name: t("terminal.runtimeMissingDialogTitle") })).toBeInTheDocument();
    expect(screen.getByText("tmux")).toBeInTheDocument();
    expect(screen.getByText("embedded-pty")).toBeInTheDocument();

    const backdrop = document.querySelector(".workbench-modal-backdrop");

    if (!(backdrop instanceof HTMLButtonElement)) {
      throw new Error("未找到桌面模态框遮罩");
    }

    fireEvent.click(screen.getByRole("button", { name: t("terminal.runtimeMissingFallbackAction") }));
    fireEvent.click(backdrop);

    expect(onConfirmFallback).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("在忙碌态时会禁用关闭路径", () => {
    const onClose = vi.fn();

    render(
      <TerminalRuntimeFallbackModal
        open
        busy
        onClose={onClose}
        onConfirmFallback={vi.fn()}
      />
    );

    const backdrop = document.querySelector(".workbench-modal-backdrop");
    const closeButton = screen.getAllByRole("button", { name: t("common.close") })
      .find((button) => button.classList.contains("workbench-modal-close"));

    if (!(backdrop instanceof HTMLButtonElement)) {
      throw new Error("未找到桌面模态框遮罩");
    }

    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error("未找到桌面模态框关闭按钮");
    }

    fireEvent.click(backdrop);
    fireEvent.click(closeButton);

    expect(backdrop).toBeDisabled();
    expect(closeButton).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

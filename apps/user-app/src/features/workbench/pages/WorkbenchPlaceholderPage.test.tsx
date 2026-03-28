import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { WorkbenchPlaceholderPage } from "./WorkbenchPlaceholderPage";

const originalTauriInternals = window.__TAURI_INTERNALS__;
const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "platform");

function mockMacDesktopPlatform() {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "MacIntel"
  });
  const invoke: NonNullable<Window["__TAURI_INTERNALS__"]>["invoke"] = async () => undefined as never;
  window.__TAURI_INTERNALS__ = {
    invoke
  };
}

describe("WorkbenchPlaceholderPage", () => {
  beforeEach(() => {
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      language: "zh-CN"
    });
  });

  afterEach(() => {
    if (userAgentDescriptor) {
      Object.defineProperty(window.navigator, "userAgent", userAgentDescriptor);
    }

    if (platformDescriptor) {
      Object.defineProperty(window.navigator, "platform", platformDescriptor);
    }

    if (originalTauriInternals) {
      window.__TAURI_INTERNALS__ = originalTauriInternals;
      return;
    }

    delete window.__TAURI_INTERNALS__;
  });

  it("显示用户友好的空会话引导", () => {
    render(<WorkbenchPlaceholderPage />);

    expect(screen.getByText("开始")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "先选一个会话" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "继续" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新建" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "查看辅助信息" })).toBeInTheDocument();
    expect(screen.getByText("准备好后，从左侧选一个会话开始。")).toBeInTheDocument();
  });

  it("macOS 桌面端在透明标题栏方案下不再给主内容补 HTML 拖拽区", () => {
    mockMacDesktopPlatform();

    const { container } = render(<WorkbenchPlaceholderPage />);
    const page = container.querySelector(".workbench-page");
    const placeholder = container.querySelector(".workbench-center-placeholder");
    const guide = container.querySelector(".workbench-empty-guide");

    expect(page).not.toHaveAttribute("data-tauri-drag-region");
    expect(placeholder).not.toHaveAttribute("data-tauri-drag-region");
    expect(guide).not.toHaveAttribute("data-tauri-drag-region");
  });
});

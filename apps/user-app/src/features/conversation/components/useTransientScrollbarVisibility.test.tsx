import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetTransientScrollbarVisibilityCacheForTest,
  useTransientScrollbarVisibility
} from "./useTransientScrollbarVisibility";

function HookHarness() {
  const scrollableRef = useTransientScrollbarVisibility<HTMLDivElement>();
  return <div ref={scrollableRef} data-testid="scrollable" />;
}

function installScrollbarProbeWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function offsetWidth() {
    return this.dataset.scrollbarProbe === "true" ? 120 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function clientWidth() {
    return this.dataset.scrollbarProbe === "true" ? 120 - width : 0;
  });
}

describe("useTransientScrollbarVisibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetTransientScrollbarVisibilityCacheForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("在经典滚动条环境下为容器启用稳定 gutter，并在滚动后短暂显示滚动条", () => {
    installScrollbarProbeWidth(16);
    render(<HookHarness />);

    const scrollable = screen.getByTestId("scrollable");
    expect(scrollable.dataset.scrollbarLayout).toBe("stable");

    fireEvent.scroll(scrollable);
    expect(scrollable.dataset.scrolling).toBe("true");

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(scrollable.hasAttribute("data-scrolling")).toBe(false);
  });

  it("在 overlay 滚动条环境下不预留 gutter", () => {
    installScrollbarProbeWidth(0);
    render(<HookHarness />);

    const scrollable = screen.getByTestId("scrollable");
    expect(scrollable.hasAttribute("data-scrollbar-layout")).toBe(false);
  });
});

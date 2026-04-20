import { describe, expect, it, vi } from "vitest";

import {
  installMacOsCopyShortcutFallback,
  readSelectedText
} from "./copy-shortcut-fallback";

describe("copy-shortcut-fallback", () => {
  it("优先读取输入框选区", () => {
    document.body.innerHTML = '<input value="terminal-copy" />';
    const input = document.querySelector("input");

    if (!(input instanceof HTMLInputElement)) {
      throw new Error("测试输入框未创建成功");
    }

    input.focus();
    input.setSelectionRange(0, 8);

    expect(readSelectedText(document)).toBe("terminal");
  });

  it("在普通文档选区上返回选中文本", () => {
    document.body.innerHTML = '<div id="selection-host">copy me</div>';
    const host = document.getElementById("selection-host");

    if (!(host instanceof HTMLElement) || !host.firstChild) {
      throw new Error("测试选区节点未创建成功");
    }

    const range = document.createRange();
    range.setStart(host.firstChild, 0);
    range.setEnd(host.firstChild, 4);

    const selection = document.getSelection();

    if (!selection) {
      throw new Error("测试环境不支持 Selection");
    }

    selection.removeAllRanges();
    selection.addRange(range);

    expect(readSelectedText(document)).toBe("copy");
  });

  it("在按下 Cmd+C 且存在选区时写入剪贴板", async () => {
    document.body.innerHTML = '<div id="selection-host">copy me</div>';
    const host = document.getElementById("selection-host");

    if (!(host instanceof HTMLElement) || !host.firstChild) {
      throw new Error("测试选区节点未创建成功");
    }

    const range = document.createRange();
    range.setStart(host.firstChild, 0);
    range.setEnd(host.firstChild, 7);
    const selection = document.getSelection();

    if (!selection) {
      throw new Error("测试环境不支持 Selection");
    }

    selection.removeAllRanges();
    selection.addRange(range);

    const writeClipboardText = vi.fn().mockResolvedValue(true);
    const dispose = installMacOsCopyShortcutFallback({
      window,
      document,
      writeClipboardText
    });

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "c",
      metaKey: true
    });
    window.dispatchEvent(event);
    await Promise.resolve();

    expect(writeClipboardText).toHaveBeenCalledWith("copy me");
    expect(event.defaultPrevented).toBe(true);

    dispose();
  });

  it("没有选区时不拦截 Cmd+C", async () => {
    document.body.innerHTML = '<div id="selection-host">copy me</div>';
    const writeClipboardText = vi.fn().mockResolvedValue(true);
    const dispose = installMacOsCopyShortcutFallback({
      window,
      document,
      writeClipboardText
    });

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "c",
      metaKey: true
    });
    window.dispatchEvent(event);
    await Promise.resolve();

    expect(writeClipboardText).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    dispose();
  });
});

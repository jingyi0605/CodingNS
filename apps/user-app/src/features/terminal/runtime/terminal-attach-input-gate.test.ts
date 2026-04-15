import { describe, expect, it, vi } from "vitest";

import { createTerminalAttachInputGate } from "./terminal-attach-input-gate";

describe("createTerminalAttachInputGate", () => {
  it("恢复后会立刻放行缓冲输入", () => {
    const forwarded: string[] = [];
    const gate = createTerminalAttachInputGate((content) => {
      forwarded.push(content);
    });

    gate.enqueue("abc");
    expect(forwarded).toEqual([]);

    gate.resume();

    expect(forwarded).toEqual(["abc"]);

    gate.enqueue("def");
    expect(forwarded).toEqual(["abc", "def"]);
  });

  it("延迟恢复期间会继续合并输入，直到计时结束再统一放行", () => {
    vi.useFakeTimers();

    const forwarded: string[] = [];
    const gate = createTerminalAttachInputGate((content) => {
      forwarded.push(content);
    });

    gate.enqueue("\u001b[?1;2c");
    gate.resume(120);
    gate.enqueue("\u001b[>0;276;0c");

    vi.advanceTimersByTime(119);
    expect(forwarded).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(forwarded).toEqual(["\u001b[?1;2c\u001b[>0;276;0c"]);

    vi.useRealTimers();
  });

  it("重新挂起后不会提前放行旧缓冲，直到下一次恢复", () => {
    vi.useFakeTimers();

    const forwarded: string[] = [];
    const gate = createTerminalAttachInputGate((content) => {
      forwarded.push(content);
    });

    gate.enqueue("first");
    gate.resume(120);
    vi.advanceTimersByTime(40);
    gate.suspend();
    gate.enqueue("second");

    vi.advanceTimersByTime(200);
    expect(forwarded).toEqual([]);

    gate.resume();
    expect(forwarded).toEqual(["firstsecond"]);

    vi.useRealTimers();
  });
});

import { describe, expect, it } from "vitest";

import { TerminalOutputBuffer } from "../../src/modules/terminal/runtime/terminal-output-buffer.js";

describe("TerminalOutputBuffer", () => {
  it("旧游标超出当前缓冲区时会降级为整段回补而不是报错", () => {
    const buffer = new TerminalOutputBuffer();

    buffer.append("terminal-1", "hello");
    const result = buffer.readSince("terminal-1", "9");

    expect(result).toEqual({
      chunks: [
        expect.objectContaining({
          terminalId: "terminal-1",
          cursor: "1",
          content: "hello"
        })
      ],
      truncated: true,
      cursorReset: true,
      latestCursor: "1"
    });
  });
});

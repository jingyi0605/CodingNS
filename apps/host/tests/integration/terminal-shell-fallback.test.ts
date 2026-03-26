import { afterEach, describe, expect, it } from "vitest";

import { getDefaultShell, listTerminalShellOptions } from "../../src/modules/terminal/terminal-shell.js";

const originalShell = process.env.SHELL;

afterEach(() => {
  if (originalShell === undefined) {
    delete process.env.SHELL;
    return;
  }

  process.env.SHELL = originalShell;
});

describe.sequential("POSIX shell 兜底", () => {
  it("会把带参数的 SHELL 环境变量收敛成真实可执行文件", () => {
    if (process.platform === "win32") {
      return;
    }

    process.env.SHELL = "/bin/sh -l";

    const shellOptions = listTerminalShellOptions();

    expect(shellOptions).toHaveLength(1);
    expect(shellOptions[0]?.available).toBe(true);
    expect(shellOptions[0]?.shell).toBe("/bin/sh");
    expect(getDefaultShell()).toBe("/bin/sh");
  });

  it("会在 SHELL 无效时回退到可执行的默认 shell", () => {
    if (process.platform === "win32") {
      return;
    }

    process.env.SHELL = "/definitely/missing-shell -l";

    const shellOptions = listTerminalShellOptions();
    const shell = getDefaultShell();

    expect(shellOptions).toHaveLength(1);
    expect(shellOptions[0]?.available).toBe(true);
    expect(shell).not.toContain("missing-shell");
    expect(shell).not.toContain(" ");
    expect(shellOptions[0]?.shell).toBe(shell);
  });
});

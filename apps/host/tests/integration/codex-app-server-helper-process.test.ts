import { describe, expect, it } from "vitest";

describe("codex-app-server-helper-process", () => {
  it("退出时优先返回 codex app-server 的 stderr", async () => {
    const originalArgv = process.argv;
    process.argv = [...process.argv.slice(0, 2), "--command-path", "/mock/codex"];
    const { __internal__ } = await import("../../src/modules/sessions/codex-app-server-helper-process.js")
      .finally(() => {
        process.argv = originalArgv;
      });

    expect(
      __internal__.buildCodexAppServerExitDetail(
        "OpenAI auth missing\n请重新登录\n",
        1,
        null
      )
    ).toBe("OpenAI auth missing\n请重新登录");
  });

  it("没有 stderr 时回退到退出码或 signal", async () => {
    const originalArgv = process.argv;
    process.argv = [...process.argv.slice(0, 2), "--command-path", "/mock/codex"];
    const { __internal__ } = await import("../../src/modules/sessions/codex-app-server-helper-process.js")
      .finally(() => {
        process.argv = originalArgv;
      });

    expect(__internal__.buildCodexAppServerExitDetail("", 1, null)).toBe(
      "codex app-server exited with code 1"
    );
    expect(__internal__.buildCodexAppServerExitDetail("   ", null, "SIGTERM")).toBe(
      "codex app-server exited with signal SIGTERM"
    );
  });
});

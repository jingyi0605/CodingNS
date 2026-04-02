import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildTemplateCommandLine } from "../../src/modules/terminal/terminal-shell.js";
import type { TerminalCommandTemplate } from "../../src/types/domain.js";

function createTemplate(overrides: Partial<TerminalCommandTemplate> = {}): TerminalCommandTemplate {
  return {
    id: "template-1",
    workspaceId: "workspace-1",
    name: "测试模板",
    cwd: process.cwd(),
    command: "echo",
    args: [],
    env: {},
    port: null,
    proxyEnabled: false,
    proxySlug: null,
    runtimeType: "embedded-pty",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
    ...overrides
  };
}

describe("buildTemplateCommandLine", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("在 POSIX 下会把整条快捷命令拆成真实命令和参数", () => {
    if (process.platform === "win32") {
      return;
    }

    const commandLine = buildTemplateCommandLine(
      createTemplate({
        command: "npm run dev:frontend"
      }),
      "/bin/zsh"
    );

    expect(commandLine).toBe("'npm' 'run' 'dev:frontend'");
  });

  it("在 POSIX 下遇到 shell 运算符时会保留原始命令", () => {
    if (process.platform === "win32") {
      return;
    }

    const commandLine = buildTemplateCommandLine(
      createTemplate({
        command: "npm run dev:frontend && npm run lint"
      }),
      "/bin/zsh"
    );

    expect(commandLine).toBe("npm run dev:frontend && npm run lint");
  });

  it("在 POSIX 下不会把带空格的可执行路径误拆成多段", () => {
    if (process.platform === "win32") {
      return;
    }

    const tempDir = mkdtempSync(path.join(tmpdir(), "codingns-terminal-shell-"));
    tempDirs.push(tempDir);
    const scriptPath = path.join(tempDir, "demo script.sh");

    writeFileSync(scriptPath, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(scriptPath, 0o755);

    const commandLine = buildTemplateCommandLine(
      createTemplate({
        cwd: tempDir,
        command: scriptPath
      }),
      "/bin/zsh"
    );

    expect(commandLine).toBe(`'${scriptPath}'`);
  });
});

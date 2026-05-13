import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";

const tempDirs: string[] = [];
const originalPath = process.env.PATH;

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  delete process.env.CODINGNS_WEB_UI_PORT;
  delete process.env.CODINGNS_CODEX_HOME;
  process.env.PATH = originalPath;
});

describe("HostConfig 的 Tailscale 前端暴露端口规则", () => {
  it("调试模式默认暴露前端开发服务器端口", () => {
    const config = resolveHostConfig({
      port: 3002,
      webUiDir: null
    });

    expect(config.webUiPort).toBe(4174);
  });

  it("调试模式允许通过 CODINGNS_WEB_UI_PORT 指定前端开发服务器端口", () => {
    process.env.CODINGNS_WEB_UI_PORT = "5188";

    const config = resolveHostConfig({
      port: 3002,
      webUiDir: null
    });

    expect(config.webUiPort).toBe(5188);
  });

  it("npm 包安装模式始终跟随 Host 的 --port 参数，不受开发端口覆盖", () => {
    process.env.CODINGNS_WEB_UI_PORT = "5188";
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-web-ui-public-"));
    tempDirs.push(tempDir);
    const publicDir = path.join(tempDir, "public");
    mkdirSync(publicDir, { recursive: true });

    const config = resolveHostConfig({
      port: 4310,
      webUiDir: publicDir
    });

    expect(config.webUiPort).toBe(4310);
  });

  it("会忽略当前 Codex 会话注入的私有 runtime home，继续使用原生 ~/.codex", () => {
    process.env.CODINGNS_CODEX_HOME =
      "/Users/jackson/.codingns/session-provider-runtime/codex/session-123";

    const config = resolveHostConfig();

    expect(config.codexHomeDir).toBe(path.join(os.homedir(), ".codex"));
  });

  it("会保留用户显式指定的自定义 Codex Home", () => {
    process.env.CODINGNS_CODEX_HOME = "/Users/jackson/custom-codex-home";

    const config = resolveHostConfig();

    expect(config.codexHomeDir).toBe("/Users/jackson/custom-codex-home");
  });

  it("npm 包安装模式会优先使用随包安装的 Codex CLI", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-codex-cli-"));
    tempDirs.push(tempDir);
    const originalCwd = process.cwd();
    const publicDir = path.join(tempDir, "public");
    const globalBinDir = path.join(tempDir, "global-bin");
    const globalCodexPath = path.join(globalBinDir, "codex");
    const codexShimPath = path.join(tempDir, "node_modules", ".bin", "codex");
    mkdirSync(publicDir, { recursive: true });
    mkdirSync(globalBinDir, { recursive: true });
    mkdirSync(path.dirname(codexShimPath), { recursive: true });
    writeFileSync(globalCodexPath, "#!/usr/bin/env sh\n");
    writeFileSync(codexShimPath, "#!/usr/bin/env sh\n");
    process.env.PATH = globalBinDir;

    try {
      process.chdir(tempDir);

      const config = resolveHostConfig({
        webUiDir: publicDir
      });

      expect(realpathSync(config.codexCliPath)).toBe(realpathSync(codexShimPath));
      expect(realpathSync(config.codexCliPath)).not.toBe(realpathSync(globalCodexPath));
    } finally {
      process.chdir(originalCwd);
    }
  });
});

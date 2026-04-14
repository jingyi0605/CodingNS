import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  delete process.env.CODINGNS_WEB_UI_PORT;
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
});

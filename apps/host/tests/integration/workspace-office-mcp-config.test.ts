import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCodexAppServerArgsWithWorkspaceOfficeMcp,
  buildCodexWorkspaceOfficeMcpConfigOverrides,
  buildWorkspaceOfficeMcpCommandArgs,
  CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV,
  CODINGNS_OFFICE_MCP_AUTH_FILE_ENV,
  resolveCodingnsPackageRootDir
} from "../../src/modules/sessions/workspace-office-mcp-config.js";

describe("workspace-office-mcp-config", () => {
  it("会为 Codex app-server 生成进程级 MCP 覆盖参数", () => {
    const args = buildCodexAppServerArgsWithWorkspaceOfficeMcp({
      [CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV]: "1",
      [CODINGNS_OFFICE_MCP_AUTH_FILE_ENV]: "/tmp/workspace-auth.json",
      WORKSPACE_SESSION_ASSISTANT_FILE: "/tmp/WORKSPACE_SESSION_COMPOSED.md"
    });

    expect(args).toContain("app-server");
    expect(args).toContain("features.code_mode_host=true");
    expect(args).toContain("-c");
    expect(args).toContain(
      "mcp_servers.codingns-workspace-office.command="
        + JSON.stringify(process.execPath)
    );
    expect(args).toContain(
      "mcp_servers.codingns-workspace-office.env.CODINGNS_OFFICE_MCP_AUTH_FILE="
        + JSON.stringify("/tmp/workspace-auth.json")
    );
    expect(args).toContain(
      "mcp_servers.codingns-workspace-office.startup_timeout_sec=90"
    );
    expect(args).toContain(
      "model_instructions_file=" + JSON.stringify("/tmp/WORKSPACE_SESSION_COMPOSED.md")
    );
  });

  it("未开启标记时不会注入任何 MCP 覆盖参数", () => {
    const args = buildCodexAppServerArgsWithWorkspaceOfficeMcp({
      [CODINGNS_OFFICE_MCP_AUTH_FILE_ENV]: "/tmp/workspace-auth.json"
    });

    expect(args).toContain("app-server");
    expect(args).toContain("features.code_mode_host=true");
    expect(args.some((arg) => arg.startsWith("mcp_servers.node_repl.command="))).toBe(true);
    expect(args).not.toContain("mcp_servers.codingns-workspace-office.startup_timeout_sec=90");
  });

  it("会生成可直接传给 `codex app-server -c` 的覆盖项", () => {
    const overrides = buildCodexWorkspaceOfficeMcpConfigOverrides({
      authFilePath: "/tmp/workspace-auth.json",
      instructionFilePath: "/tmp/WORKSPACE_SESSION_COMPOSED.md"
    });

    expect(overrides).toEqual([
      expect.stringContaining("mcp_servers.codingns-workspace-office.command="),
      expect.stringContaining("mcp_servers.codingns-workspace-office.args="),
      expect.stringContaining("mcp_servers.codingns-workspace-office.env.CODINGNS_OFFICE_MCP_AUTH_FILE="),
      "mcp_servers.codingns-workspace-office.startup_timeout_sec=90",
      "model_instructions_file=" + JSON.stringify("/tmp/WORKSPACE_SESSION_COMPOSED.md")
    ]);
  });

  it("打包安装后会从 dist 目录向上找到 npm 包根目录", () => {
    const packageRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-package-root-"));
    const nestedModuleDir = path.join(packageRootDir, "dist", "server", "modules", "sessions");

    fs.mkdirSync(path.join(packageRootDir, "bin"), { recursive: true });
    fs.mkdirSync(nestedModuleDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageRootDir, "package.json"),
      `${JSON.stringify({ name: "@jingyi0605/codingns" }, null, 2)}\n`,
      "utf8"
    );
    fs.writeFileSync(path.join(packageRootDir, "bin", "codingns.mjs"), "", "utf8");

    expect(resolveCodingnsPackageRootDir(nestedModuleDir)).toBe(packageRootDir);
    expect(buildWorkspaceOfficeMcpCommandArgs("C:\\Users\\jackson\\.codingns\\auth.json", packageRootDir)[0])
      .toBe(path.join(packageRootDir, "bin", "codingns.mjs"));
  });
});

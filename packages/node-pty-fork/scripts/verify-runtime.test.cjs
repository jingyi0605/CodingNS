"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const {
  isInstalledUnderNodeModules,
  isWorkspaceSourceInstall
} = require("./runtime-install-context.cjs");

const scriptPath = path.join(__dirname, "verify-runtime.cjs");

test("源码工作区路径不会被误判成 node_modules 安装", () => {
  assert.equal(
    isInstalledUnderNodeModules("/repo/packages/node-pty-fork"),
    false
  );
  assert.equal(
    isWorkspaceSourceInstall("/repo/packages/node-pty-fork"),
    true
  );
});

test("node_modules 路径会命中正式安装上下文", () => {
  assert.equal(
    isInstalledUnderNodeModules(
      "C:\\repo\\node_modules\\@codingns\\node-pty"
    ),
    true
  );
  assert.equal(
    isWorkspaceSourceInstall(
      "C:\\repo\\node_modules\\@codingns\\node-pty"
    ),
    false
  );
});

test("非 Windows 环境会跳过 node-pty 运行时校验", () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8"
  });

  if (process.platform === "win32") {
    assert.notEqual(result.status, 0);
    return;
  }

  assert.equal(result.status, 0);
  assert.match(result.stdout, /非 win32 环境，跳过运行时校验/);
});

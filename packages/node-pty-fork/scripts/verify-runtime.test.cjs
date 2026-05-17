"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(__dirname, "verify-runtime.cjs");

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

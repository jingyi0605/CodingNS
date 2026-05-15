"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const tarballs = fs.readdirSync(packageRoot).filter((fileName) => fileName.endsWith(".tgz")).sort();

if (tarballs.length === 0) {
  console.error("[codingns-node-pty] 安装验证失败：当前目录没有 npm pack 产物。");
  process.exit(1);
}

const tarballPath = path.join(packageRoot, tarballs[tarballs.length - 1]);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-node-pty-smoke-"));
const installLogPath = path.join(tempRoot, "npm-install.log");

fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({
  name: "codingns-node-pty-smoke",
  private: true
}, null, 2));

const installResult = spawnSync("npm", ["install", tarballPath, "--ignore-scripts=false"], {
  cwd: tempRoot,
  encoding: "utf8",
  shell: process.platform === "win32"
});

const combinedOutput = `${installResult.stdout || ""}${installResult.stderr || ""}`;
fs.writeFileSync(installLogPath, combinedOutput, "utf8");

if (installResult.status !== 0) {
  process.stderr.write(combinedOutput);
  console.error(`[codingns-node-pty] 安装验证失败：npm install 返回非 0，日志：${installLogPath}`);
  process.exit(1);
}

if (/node-gyp rebuild/i.test(combinedOutput)) {
  console.error(`[codingns-node-pty] 安装验证失败：npm install 过程中触发了 node-gyp rebuild，日志：${installLogPath}`);
  process.exit(1);
}

const moduleRoot = path.join(tempRoot, "node_modules", "@codingns", "node-pty");
const smokeResult = spawnSync("node", [path.join(moduleRoot, "scripts", "smoke-load.cjs")], {
  cwd: tempRoot,
  encoding: "utf8",
  shell: process.platform === "win32"
});

if (smokeResult.status !== 0) {
  process.stderr.write(`${smokeResult.stdout || ""}${smokeResult.stderr || ""}`);
  console.error("[codingns-node-pty] 安装验证失败：tarball 安装后无法完成最小加载检查。");
  process.exit(1);
}

process.stdout.write(smokeResult.stdout || "");
console.log("[codingns-node-pty] tarball 安装验证通过。");

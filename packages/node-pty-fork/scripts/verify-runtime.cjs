"use strict";

const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(packageRoot, "build", "Release");

const requiredFiles = [
  path.join(packageRoot, "lib", "index.js"),
  path.join(packageRoot, "typings", "node-pty.d.ts"),
  path.join(packageRoot, "binding.gyp")
];

const runtimeRequired = [
  "conpty.node",
  "conpty_console_list.node",
  "pty.node",
  "winpty-agent.exe",
  "winpty.dll"
];

if (process.platform !== "win32") {
  console.error("[codingns-node-pty] 当前仅支持 win32。");
  process.exit(1);
}

if (process.arch !== "x64") {
  console.error("[codingns-node-pty] 当前仅支持 x64。");
  process.exit(1);
}

const nodeMajor = Number((process.versions.node || "").split(".")[0]);
if (nodeMajor !== 22) {
  console.error(`[codingns-node-pty] 当前仅支持 Node 22，检测到 ${process.versions.node || "unknown"}。`);
  process.exit(1);
}

for (const filePath of requiredFiles) {
  if (!fs.existsSync(filePath)) {
    console.error(`[codingns-node-pty] 缺少关键文件：${filePath}`);
    process.exit(1);
  }
}

for (const fileName of runtimeRequired) {
  const filePath = path.join(releaseDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.error(`[codingns-node-pty] 缺少预编译产物：${filePath}`);
    process.exit(1);
  }
}

console.log("[codingns-node-pty] 运行时校验通过。");

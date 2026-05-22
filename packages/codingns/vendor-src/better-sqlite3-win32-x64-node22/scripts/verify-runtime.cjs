"use strict";

const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(packageRoot, "build", "Release");
const requiredFiles = [
  path.join(packageRoot, "lib", "index.js"),
  path.join(packageRoot, "binding.gyp")
];

if (process.platform !== "win32") {
  console.log("[codingns-better-sqlite3] 非 win32 环境，跳过运行时校验。");
  process.exit(0);
}

if (process.arch !== "x64") {
  console.error("[codingns-better-sqlite3] 当前仅支持 x64。");
  process.exit(1);
}

const nodeMajor = Number((process.versions.node || "").split(".")[0]);
if (nodeMajor !== 22) {
  console.error(`[codingns-better-sqlite3] 当前仅支持 Node 22，检测到 ${process.versions.node || "unknown"}。`);
  process.exit(1);
}

for (const filePath of requiredFiles) {
  if (!fs.existsSync(filePath)) {
    console.error(`[codingns-better-sqlite3] 缺少关键文件：${filePath}`);
    process.exit(1);
  }
}

const binaryPath = path.join(releaseDir, "better_sqlite3.node");
if (!fs.existsSync(binaryPath)) {
  console.error(`[codingns-better-sqlite3] 缺少预编译产物：${binaryPath}`);
  process.exit(1);
}

console.log("[codingns-better-sqlite3] 运行时校验通过。");

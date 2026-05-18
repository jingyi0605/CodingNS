"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const tarballs = fs.readdirSync(packageRoot).filter((fileName) => fileName.endsWith(".tgz")).sort();

if (tarballs.length === 0) {
  console.error("[codingns-node-pty] tarball 校验失败：当前目录没有 npm pack 产物。");
  process.exit(1);
}

const tarballPath = path.join(packageRoot, tarballs[tarballs.length - 1]);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-node-pty-pack-"));

const extractResult = spawnSync("tar", ["-xzf", tarballPath, "-C", tempRoot], {
  cwd: packageRoot,
  encoding: "utf8",
  shell: process.platform === "win32"
});

if (extractResult.status !== 0) {
  process.stderr.write(`${extractResult.stdout || ""}${extractResult.stderr || ""}`);
  console.error(`[codingns-node-pty] tarball 校验失败：无法解包 ${tarballPath}`);
  process.exit(1);
}

const unpackedRoot = path.join(tempRoot, "package");
const packageJsonPath = path.join(unpackedRoot, "package.json");

if (!fs.existsSync(packageJsonPath)) {
  console.error("[codingns-node-pty] tarball 校验失败：解包后缺少 package/package.json。");
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

if (packageJson.name !== "@codingns/node-pty") {
  console.error(`[codingns-node-pty] tarball 校验失败：包名不对，检测到 ${packageJson.name || "unknown"}。`);
  process.exit(1);
}

if (packageJson.version !== "1.0.0-cns.1") {
  console.error(`[codingns-node-pty] tarball 校验失败：版本不对，检测到 ${packageJson.version || "unknown"}。`);
  process.exit(1);
}

if (packageJson.types !== "./typings/node-pty.d.ts") {
  console.error(`[codingns-node-pty] tarball 校验失败：types 入口不对，检测到 ${packageJson.types || "unknown"}。`);
  process.exit(1);
}

const requiredPaths = [
  path.join(unpackedRoot, "README.md"),
  path.join(unpackedRoot, "LICENSE"),
  path.join(unpackedRoot, "lib", "index.js"),
  path.join(unpackedRoot, "typings", "node-pty.d.ts"),
  path.join(unpackedRoot, "binding.gyp"),
  path.join(unpackedRoot, "scripts", "verify-runtime.cjs"),
  path.join(unpackedRoot, "scripts", "verify-tarball.cjs"),
  path.join(unpackedRoot, "scripts", "smoke-load.cjs"),
  path.join(unpackedRoot, "scripts", "install-smoke.cjs"),
  path.join(unpackedRoot, "build", "Release", "conpty.node"),
  path.join(unpackedRoot, "build", "Release", "conpty_console_list.node"),
  path.join(unpackedRoot, "build", "Release", "pty.node"),
  path.join(unpackedRoot, "build", "Release", "winpty-agent.exe"),
  path.join(unpackedRoot, "build", "Release", "winpty.dll")
];

for (const filePath of requiredPaths) {
  if (!fs.existsSync(filePath)) {
    console.error(`[codingns-node-pty] tarball 校验失败：缺少关键文件 ${filePath}`);
    process.exit(1);
  }
}

console.log(`[codingns-node-pty] tarball 校验通过：${path.basename(tarballPath)}`);

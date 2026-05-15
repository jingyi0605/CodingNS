import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstreamRoot = path.join(packageRoot, "vendor", "upstream", "package");

const copyTargets = [
  "binding.gyp",
  "LICENSE",
  "lib",
  "src",
  "typings",
  "deps"
];

for (const target of copyTargets) {
  const sourcePath = path.join(upstreamRoot, target);
  const targetPath = path.join(packageRoot, target);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`缺少上游路径：${sourcePath}`);
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

console.log("[codingns-node-pty] 已同步上游源码骨架。");

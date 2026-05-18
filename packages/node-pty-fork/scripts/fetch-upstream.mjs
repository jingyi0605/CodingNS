import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { spawnSync } from "node:child_process";

const upstreamTarballUrl =
  process.env.CODINGNS_NODE_PTY_UPSTREAM_TARBALL ??
  "https://registry.npmjs.org/node-pty/-/node-pty-1.0.0.tgz";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(packageRoot, "vendor");
const downloadDir = path.join(vendorDir, "downloads");
const extractDir = path.join(vendorDir, "upstream");
const archivePath = path.join(downloadDir, "node-pty-1.0.0.tgz");

fs.mkdirSync(downloadDir, { recursive: true });

if (!fs.existsSync(archivePath)) {
  const response = await fetch(upstreamTarballUrl);
  if (!response.ok || !response.body) {
    throw new Error(`下载上游 tarball 失败：${upstreamTarballUrl} -> ${response.status} ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(archivePath));
}

fs.rmSync(extractDir, { recursive: true, force: true });
fs.mkdirSync(extractDir, { recursive: true });

const tarResult = spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (tarResult.status !== 0) {
  process.exit(tarResult.status ?? 1);
}

console.log(`[codingns-node-pty] 已准备上游源码：${extractDir}`);

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const tarballPath = process.argv[2];

if (!tarballPath) {
  throw new Error("缺少 tgz 路径参数");
}

if (!fs.existsSync(tarballPath)) {
  throw new Error(`找不到 tgz 文件：${tarballPath}`);
}

const packageJson = readTarballJson(tarballPath, "package/package.json");
const tarEntries = listTarEntries(tarballPath);
const problems = [];

const bundledSessionSyncPath = "package/node_modules/@codingns/session-sync-core/package.json";
const bundledSessionSyncPackageJson = tarEntries.includes(bundledSessionSyncPath)
  ? readTarballJson(tarballPath, bundledSessionSyncPath)
  : null;

if (!Array.isArray(packageJson.bundleDependencies) || !packageJson.bundleDependencies.includes("@codingns/session-sync-core")) {
  problems.push("发布包 package.json 缺少 bundleDependencies.@codingns/session-sync-core");
}

if (packageJson.optionalDependencies?.["@codingns/node-pty"] !== "file:vendor/node-pty-fork") {
  problems.push("发布包 package.json 没把 @codingns/node-pty 固定到 vendor/node-pty-fork");
}

if (!tarEntries.includes(bundledSessionSyncPath)) {
  problems.push("发布包缺少打进去的 @codingns/session-sync-core 实体目录");
} else if (
  typeof bundledSessionSyncPackageJson?.version !== "string" ||
  packageJson.dependencies?.["@codingns/session-sync-core"] !== bundledSessionSyncPackageJson.version
) {
  problems.push("发布包 package.json 没把 @codingns/session-sync-core 改写成 bundled 实际版本号");
}

if (!tarEntries.includes("package/vendor/node-pty-fork/package.json")) {
  problems.push("发布包缺少 vendor/node-pty-fork");
}

if (problems.length > 0) {
  const detail = problems.map((item) => `- ${item}`).join("\n");
  throw new Error(`发布包自检失败：\n${detail}`);
}

console.info(`[codingns] 发布包自检通过：${tarballPath}`);

function readTarballJson(targetTarballPath, entryPath) {
  const content = execFileSync("tar", ["-xOf", targetTarballPath, entryPath], {
    encoding: "utf8"
  });
  return JSON.parse(content);
}

function listTarEntries(targetTarballPath) {
  const output = execFileSync("tar", ["-tf", targetTarballPath], {
    encoding: "utf8"
  });

  return output
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

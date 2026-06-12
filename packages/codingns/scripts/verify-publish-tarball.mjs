import fs from "node:fs";
import zlib from "node:zlib";

const tarballPath = process.argv[2];

if (!tarballPath) {
  throw new Error("缺少 tgz 路径参数");
}

if (!fs.existsSync(tarballPath)) {
  throw new Error(`找不到 tgz 文件：${tarballPath}`);
}

const tarEntries = readTarEntriesFromGzipTarball(tarballPath);
const packageJson = readTarballJson(tarEntries, "package/package.json");
const problems = [];

const bundledSessionSyncPath = "package/node_modules/@codingns/session-sync-core/package.json";
const bundledSessionSyncPackageJson = tarEntries.has(bundledSessionSyncPath)
  ? readTarballJson(tarEntries, bundledSessionSyncPath)
  : null;

if (!Array.isArray(packageJson.bundleDependencies) || !packageJson.bundleDependencies.includes("@codingns/session-sync-core")) {
  problems.push("发布包 package.json 缺少 bundleDependencies.@codingns/session-sync-core");
}

if (packageJson.optionalDependencies?.["@codingns/node-pty"] !== "file:vendor/node-pty-fork") {
  problems.push("发布包 package.json 没把 @codingns/node-pty 固定到 vendor/node-pty-fork");
}

if (packageJson.dependencies?.["better-sqlite3"]) {
  problems.push("发布包 package.json 仍然保留了 dependencies.better-sqlite3");
}

if (packageJson.codingnsRuntimeDependencies?.betterSqlite3 !== "^12.8.0") {
  problems.push("发布包 package.json 没保留 better-sqlite3 的默认上游版本元信息");
}

if (packageJson.codingnsWindowsRuntimePackages?.betterSqlite3 !== "file:vendor/better-sqlite3-win32-x64-node22") {
  problems.push("发布包 package.json 没记录 Windows 专用 better-sqlite3 受控包路径");
}

if (!tarEntries.has(bundledSessionSyncPath)) {
  problems.push("发布包缺少打进去的 @codingns/session-sync-core 实体目录");
} else if (
  typeof bundledSessionSyncPackageJson?.version !== "string" ||
  packageJson.dependencies?.["@codingns/session-sync-core"] !== bundledSessionSyncPackageJson.version
) {
  problems.push("发布包 package.json 没把 @codingns/session-sync-core 改写成 bundled 实际版本号");
}

if (!tarEntries.has("package/vendor/node-pty-fork/package.json")) {
  problems.push("发布包缺少 vendor/node-pty-fork");
}

if (!tarEntries.has("package/vendor/better-sqlite3-win32-x64-node22/package.json")) {
  problems.push("发布包缺少 vendor/better-sqlite3-win32-x64-node22");
}

if (!tarEntries.has("package/vendor/better-sqlite3-win32-x64-node22/build/Release/better_sqlite3.node")) {
  problems.push("发布包缺少 better-sqlite3 Windows Node 22 预编译产物");
}

if (problems.length > 0) {
  const detail = problems.map((item) => `- ${item}`).join("\n");
  throw new Error(`发布包自检失败：\n${detail}`);
}

console.info(`[codingns] 发布包自检通过：${tarballPath}`);

function readTarballJson(entries, entryPath) {
  const content = readTarEntryText(entries, entryPath);
  return JSON.parse(content);
}

function readTarEntryText(entries, entryPath) {
  const content = entries.get(entryPath);

  if (!content) {
    throw new Error(`tgz 内缺少文件：${entryPath}`);
  }

  return content.toString("utf8");
}

function readTarEntriesFromGzipTarball(targetTarballPath) {
  const compressed = fs.readFileSync(targetTarballPath);
  const tarBuffer = zlib.gunzipSync(compressed);
  const entries = new Map();
  let offset = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);

    if (isZeroBlock(header)) {
      break;
    }

    const entryName = readTarString(header, 0, 100);
    const sizeOctal = readTarString(header, 124, 12);
    const prefix = readTarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${entryName}` : entryName;
    const size = Number.parseInt(sizeOctal.trim() || "0", 8);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;

    if (!Number.isFinite(size) || size < 0 || bodyEnd > tarBuffer.length) {
      throw new Error(`无效 tar 条目：${fullName || "<unknown>"}`);
    }

    const typeFlag = header[156];
    if (typeFlag !== 53 /* '5' 目录 */) {
      entries.set(fullName, tarBuffer.subarray(bodyStart, bodyEnd));
    }

    offset = bodyStart + alignTarBlockSize(size);
  }

  return entries;
}

function readTarString(buffer, start, length) {
  const raw = buffer.subarray(start, start + length);
  const zeroIndex = raw.indexOf(0);
  const slice = zeroIndex >= 0 ? raw.subarray(0, zeroIndex) : raw;
  return slice.toString("utf8").trim();
}

function alignTarBlockSize(size) {
  return Math.ceil(size / 512) * 512;
}

function isZeroBlock(buffer) {
  for (const value of buffer) {
    if (value !== 0) {
      return false;
    }
  }

  return true;
}

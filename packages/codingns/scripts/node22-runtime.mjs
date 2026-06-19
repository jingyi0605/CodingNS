import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function ensureNode22ForCurrentScript(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const scriptLabel = options.scriptLabel ?? "script";
  const allowWindowsPrivateRuntimeInstall = options.allowWindowsPrivateRuntimeInstall === true;
  const desiredVersion = readDesiredNodeVersion(rootDir);

  if (isNodeVersionSatisfied(process.versions.node, desiredVersion)) {
    return inspectNodeCandidate(process.execPath, desiredVersion) ?? resolveNode22Runtime(rootDir, {
      allowWindowsPrivateRuntimeInstall
    });
  }

  if (process.env.CODINGNS_NODE22_ENFORCED === "1") {
    throw new Error(
      `[${scriptLabel}] 已尝试切换到 Node 22，但当前进程仍是 v${process.versions.node}。请检查本机 Node 22 安装。`
    );
  }

  const runtime = resolveNode22Runtime(rootDir, {
    allowWindowsPrivateRuntimeInstall
  });

  if (!runtime) {
    throw new Error(
      allowWindowsPrivateRuntimeInstall && process.platform === "win32"
        ? `[${scriptLabel}] 未找到可用的 Node 22 运行时，且自动准备 Windows 私有 Node 22 失败。请检查网络、权限或 CODINGNS_WINDOWS_NODE_DIST_BASE。`
        : `[${scriptLabel}] 未找到可用的 Node 22 运行时。请先执行 nvm use 22，或安装 /opt/homebrew/opt/node@22。`
    );
  }

  const result = spawnSync(runtime.nodePath, process.argv.slice(1), {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      CODINGNS_NODE22_ENFORCED: "1",
      CODINGNS_NODE22_BIN: runtime.nodePath
    }
  });

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return runtime;
  }

  process.exit(result.status ?? 0);
}

export function resolveNode22Runtime(rootDir, options = {}) {
  const desiredVersion = readDesiredNodeVersion(rootDir);
  const currentRuntime = inspectNodeCandidate(process.execPath, desiredVersion);
  if (currentRuntime) {
    return {
      ...currentRuntime,
      source: "current-process"
    };
  }
  const managedWindowsRuntime = resolveManagedWindowsNode22Runtime(rootDir, desiredVersion, options);
  if (managedWindowsRuntime) {
    return managedWindowsRuntime;
  }
  const candidates = collectNodeCandidates(desiredVersion);

  for (const candidate of candidates) {
    const runtime = inspectNodeCandidate(candidate, desiredVersion);

    if (runtime) {
      return runtime;
    }
  }

  return null;
}

export function readDesiredNodeVersion(rootDir) {
  const nvmrcPath = path.join(rootDir, ".nvmrc");

  try {
    return readFileSync(nvmrcPath, "utf8").trim();
  } catch {
    return "22";
  }
}

export function resolvePackageRoot(fromUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(fromUrl)), "..");
}

function collectNodeCandidates(desiredVersion) {
  const homeDir = os.homedir();
  const candidates = [];
  const exactVersion = normalizeNodeVersion(desiredVersion);
  const majorVersion = exactVersion.split(".")[0] || "22";

  pushCandidate(candidates, process.env.CODINGNS_NODE22_BIN);
  pushCandidate(candidates, process.env.NODE22_BIN);
  pushCandidate(candidates, path.join(homeDir, ".nvm", "versions", "node", `v${exactVersion}`, "bin", "node"));
  pushCandidate(candidates, path.join(homeDir, ".nvm", "versions", "node", exactVersion, "bin", "node"));
  pushCandidate(candidates, path.join(homeDir, ".fnm", "node-versions", `v${exactVersion}`, "installation", "bin", "node"));
  pushCandidate(candidates, path.join(homeDir, "Library", "Application Support", "fnm", "node-versions", `v${exactVersion}`, "installation", "bin", "node"));
  pushCandidate(candidates, "/opt/homebrew/opt/node@22/bin/node");
  pushCandidate(candidates, "/usr/local/opt/node@22/bin/node");
  pushCandidate(candidates, process.execPath);

  for (const item of readVersionedNodeBins(path.join(homeDir, ".nvm", "versions", "node"), majorVersion, "nvm")) {
    pushCandidate(candidates, item);
  }
  for (const item of readVersionedNodeBins(path.join(homeDir, ".fnm", "node-versions"), majorVersion, "fnm")) {
    pushCandidate(candidates, item);
  }
  for (const item of readVersionedNodeBins(path.join(homeDir, "Library", "Application Support", "fnm", "node-versions"), majorVersion, "fnm")) {
    pushCandidate(candidates, item);
  }

  return candidates;
}

function resolveManagedWindowsNode22Runtime(rootDir, desiredVersion, options) {
  if (process.platform !== "win32") {
    return null;
  }

  const runtimeLayout = resolveWindowsRuntimeLayout(desiredVersion);
  const activeRuntime = readWindowsActiveRuntime(runtimeLayout.activeMetaPath, desiredVersion);
  if (activeRuntime) {
    return activeRuntime;
  }

  if (options.allowWindowsPrivateRuntimeInstall !== true) {
    return null;
  }

  return ensureManagedWindowsNode22Runtime(runtimeLayout, desiredVersion);
}

function resolveWindowsRuntimeLayout(desiredVersion) {
  const privateVersion = normalizeNodeVersion(
    process.env.CODINGNS_WINDOWS_NODE_VERSION || desiredVersion || "22.16.0"
  );
  const dataDir = process.env.CODINGNS_DATA_DIR || path.join(os.homedir(), ".codingns");
  const runtimeRoot = process.env.CODINGNS_RUNTIME_ROOT || path.join(dataDir, "runtime");
  const nodeRuntimeRoot = path.join(runtimeRoot, "node-22");
  const versionDir = path.join(nodeRuntimeRoot, "versions", `node-v${privateVersion}-win-x64`);
  const downloadDir = path.join(runtimeRoot, "cache", "downloads");

  return {
    version: privateVersion,
    runtimeRoot,
    nodeRuntimeRoot,
    versionDir,
    activeMetaPath: path.join(nodeRuntimeRoot, "active.json"),
    downloadDir,
    distBaseUrls: resolveWindowsNodeDistBaseUrls()
  };
}

function readWindowsActiveRuntime(activeMetaPath, desiredVersion) {
  if (!existsSync(activeMetaPath)) {
    return null;
  }

  try {
    const payload = JSON.parse(readFileSync(activeMetaPath, "utf8"));
    const runtime = inspectNodeCandidate(payload?.nodeExe, desiredVersion);
    if (!runtime) {
      return null;
    }

    const npmCmd = typeof payload?.npmCmd === "string" ? payload.npmCmd : "";
    const npxCmd = typeof payload?.npxCmd === "string" ? payload.npxCmd : "";
    if (!existsSync(npmCmd) || !existsSync(npxCmd)) {
      return null;
    }

    return {
      ...runtime,
      npmCmd,
      npxCmd,
      source: "managed-windows-active-meta"
    };
  } catch {
    return null;
  }
}

function ensureManagedWindowsNode22Runtime(runtimeLayout, desiredVersion) {
  ensureDir(path.dirname(runtimeLayout.activeMetaPath));
  ensureDir(runtimeLayout.downloadDir);

  const archiveName = `node-v${runtimeLayout.version}-win-x64.zip`;
  const archivePath = path.join(runtimeLayout.downloadDir, archiveName);
  const shasumsPath = path.join(
    runtimeLayout.downloadDir,
    `SHASUMS256-v${runtimeLayout.version}.txt`
  );
  const downloadSource = resolveWindowsRuntimeDownloadSource(runtimeLayout, archiveName);

  if (!existsSync(shasumsPath)) {
    downloadFile(downloadSource.shasumsUrls, shasumsPath);
  }

  const expectedSha256 = readArchiveSha256(shasumsPath, archiveName);
  if (!expectedSha256) {
    throw new Error(`[codingns-node22-runtime] 无法读取 Node 22 校验值：${shasumsPath}`);
  }

  if (existsSync(archivePath)) {
    const currentHash = computeFileSha256(archivePath);
    if (currentHash !== expectedSha256) {
      rmSync(archivePath, { force: true });
    }
  }

  if (!existsSync(archivePath)) {
    downloadFile(downloadSource.archiveUrls, archivePath);
  }

  const archiveSha256 = computeFileSha256(archivePath);
  if (archiveSha256 !== expectedSha256) {
    rmSync(archivePath, { force: true });
    throw new Error(`[codingns-node22-runtime] Node 22 压缩包校验失败：${archiveName}`);
  }

  rmSync(runtimeLayout.versionDir, { recursive: true, force: true });
  extractZipArchive(archivePath, path.join(runtimeLayout.nodeRuntimeRoot, "versions"));
  writeWindowsActiveRuntimeMeta(runtimeLayout, downloadSource.archiveUrls[0], expectedSha256);

  const runtime = inspectNodeCandidate(path.join(runtimeLayout.versionDir, "node.exe"), desiredVersion);
  if (!runtime) {
    throw new Error(`[codingns-node22-runtime] Node 22 私有运行时准备失败：${runtimeLayout.versionDir}`);
  }

  return {
    ...runtime,
    npmCmd: path.join(runtimeLayout.versionDir, "npm.cmd"),
    npxCmd: path.join(runtimeLayout.versionDir, "npx.cmd"),
    source: "managed-windows-download"
  };
}

function writeWindowsActiveRuntimeMeta(runtimeLayout, sourceUrl, sha256) {
  const payload = {
    version: runtimeLayout.version,
    platform: "win32",
    arch: "x64",
    nodeDir: runtimeLayout.versionDir,
    nodeExe: path.join(runtimeLayout.versionDir, "node.exe"),
    npmCmd: path.join(runtimeLayout.versionDir, "npm.cmd"),
    npxCmd: path.join(runtimeLayout.versionDir, "npx.cmd"),
    installedAt: new Date().toISOString(),
    sourceUrl,
    sha256
  };

  writeFileSync(runtimeLayout.activeMetaPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function ensureDir(targetPath) {
  mkdirSync(targetPath, { recursive: true });
}

function downloadFile(sourceUrl, targetPath) {
  const sourceUrls = uniqueNormalizedUrls(Array.isArray(sourceUrl) ? sourceUrl : [sourceUrl]);
  const failures = [];

  for (const currentSourceUrl of sourceUrls) {
    try {
      execFileSync("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        `$ErrorActionPreference = "Stop"; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '${escapePowerShellString(currentSourceUrl)}' -OutFile '${escapePowerShellString(targetPath)}'`
      ], {
        stdio: "ignore"
      });
      return;
    } catch (error) {
      failures.push(formatDownloadFailure(currentSourceUrl, error));
    }

    const result = spawnSync("curl", ["-fL", currentSourceUrl, "-o", targetPath], {
      stdio: "ignore"
    });
    if (result.status === 0) {
      return;
    }

    failures.push(`${currentSourceUrl} (curl exit ${result.status ?? "unknown"})`);
  }

  throw new Error(
    `[codingns-node22-runtime] 下载失败，已尝试以下地址：${failures.join("；")}`
  );
}

function extractZipArchive(archivePath, outputDir) {
  ensureDir(outputDir);

  try {
    execFileSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `$ErrorActionPreference = "Stop"; Expand-Archive -LiteralPath '${escapePowerShellString(archivePath)}' -DestinationPath '${escapePowerShellString(outputDir)}' -Force`
    ], {
      stdio: "ignore"
    });
    return;
  } catch {
  }

  const result = spawnSync("tar", ["-xf", archivePath, "-C", outputDir], {
    stdio: "ignore"
  });
  if (result.status === 0) {
    return;
  }

  throw new Error(`[codingns-node22-runtime] 解压失败：${archivePath}`);
}

function readArchiveSha256(shasumsPath, archiveName) {
  const content = readFileSync(shasumsPath, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.endsWith(` ${archiveName}`)) {
      continue;
    }
    return trimmed.split(/\s+/u)[0]?.toLowerCase() || "";
  }
  return "";
}

function computeFileSha256(targetPath) {
  const script = `
const fs = require("node:fs");
const crypto = require("node:crypto");
const input = fs.readFileSync(process.argv[1]);
process.stdout.write(crypto.createHash("sha256").update(input).digest("hex"));
  `.trim();
  const result = spawnSync(process.execPath, ["-e", script, targetPath], {
    encoding: "utf8"
  });
  return result.stdout.trim().toLowerCase();
}

function escapePowerShellString(value) {
  return String(value).replace(/'/gu, "''");
}

function readVersionedNodeBins(baseDir, majorVersion, mode) {
  if (!existsSync(baseDir)) {
    return [];
  }

  const prefixes = [`v${majorVersion}.`, `${majorVersion}.`];
  const result = [];

  for (const item of readdirSync(baseDir)) {
    if (!prefixes.some((prefix) => item.startsWith(prefix))) {
      continue;
    }

    const nodePath = mode === "fnm"
      ? path.join(baseDir, item, "installation", "bin", "node")
      : path.join(baseDir, item, "bin", "node");

    if (existsSync(nodePath)) {
      result.push(nodePath);
    }
  }

  return result.sort().reverse();
}

function inspectNodeCandidate(nodePath, desiredVersion) {
  if (!nodePath || !existsSync(nodePath)) {
    return null;
  }

  try {
    const versionText = spawnSync(nodePath, ["-v"], {
      encoding: "utf8"
    }).stdout.trim();

    if (!versionText) {
      return null;
    }

    const normalized = normalizeNodeVersion(versionText);
    if (!isNodeVersionSatisfied(normalized, desiredVersion)) {
      return null;
    }

    return {
      nodePath,
      binDir: path.dirname(nodePath),
      versionText,
      desiredVersion: normalizeNodeVersion(desiredVersion)
    };
  } catch {
    return null;
  }
}

function normalizeNodeVersion(versionText) {
  return String(versionText || "").trim().replace(/^v/, "");
}

function resolveWindowsNodeDistBaseUrls() {
  return uniqueNormalizedUrls([
    ...splitEnvList(process.env.CODINGNS_WINDOWS_NODE_DIST_BASE),
    "https://nodejs.org/dist",
    "https://npmmirror.com/mirrors/node",
    "https://registry.npmmirror.com/-/binary/node"
  ]);
}

function resolveWindowsRuntimeDownloadSource(runtimeLayout, archiveName) {
  const versionBaseUrls = runtimeLayout.distBaseUrls.map((baseUrl) => `${baseUrl}/v${runtimeLayout.version}`);

  return {
    archiveUrls: versionBaseUrls.map((versionBaseUrl) => `${versionBaseUrl}/${archiveName}`),
    shasumsUrls: versionBaseUrls.map((versionBaseUrl) => `${versionBaseUrl}/SHASUMS256.txt`)
  };
}

function isNodeVersionSatisfied(versionText, desiredVersion) {
  const normalizedVersion = normalizeNodeVersion(versionText);
  const normalizedDesiredVersion = normalizeNodeVersion(desiredVersion || "22");
  const currentParts = parseVersionParts(normalizedVersion);
  const desiredParts = parseVersionParts(normalizedDesiredVersion);

  if (!currentParts || !desiredParts) {
    return false;
  }

  if (currentParts[0] !== 22 || desiredParts[0] !== 22) {
    return false;
  }

  return compareVersionParts(currentParts, desiredParts) >= 0;
}

function parseVersionParts(versionText) {
  const parts = normalizeNodeVersion(versionText)
    .split(".")
    .map((value) => Number.parseInt(value, 10));

  if (parts.length === 0 || parts.some((value) => Number.isNaN(value))) {
    return null;
  }

  while (parts.length < 3) {
    parts.push(0);
  }

  return parts.slice(0, 3);
}

function compareVersionParts(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function splitEnvList(value) {
  return String(value || "")
    .split(/[,\n;]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueNormalizedUrls(values) {
  const result = [];

  for (const value of values) {
    const normalized = String(value || "").trim().replace(/\/+$/u, "");
    if (!normalized || result.includes(normalized)) {
      continue;
    }
    result.push(normalized);
  }

  return result;
}

function formatDownloadFailure(sourceUrl, error) {
  if (error instanceof Error && error.message) {
    return `${sourceUrl} (${error.message})`;
  }

  return `${sourceUrl} (${String(error)})`;
}

function pushCandidate(target, value) {
  if (!value || target.includes(value)) {
    return;
  }

  target.push(value);
}

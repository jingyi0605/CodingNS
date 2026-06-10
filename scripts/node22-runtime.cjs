const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

function ensureNode22ForCurrentScript(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const scriptLabel = options.scriptLabel ?? "script";

  if (Number.parseInt(process.versions.node.split(".")[0] ?? "", 10) === 22) {
    return resolveNode22Runtime(rootDir);
  }

  if (process.env.CODINGNS_NODE22_ENFORCED === "1") {
    throw new Error(
      `[${scriptLabel}] 已尝试切换到 Node 22，但当前进程仍是 v${process.versions.node}。请检查本机 Node 22 安装。`
    );
  }

  const runtime = resolveNode22Runtime(rootDir);

  if (!runtime) {
    throw new Error(
      `[${scriptLabel}] 未找到可用的 Node 22 运行时。请先执行 docs/使用说明/DEVELOPMENT.md 里的 nvm use 22，或安装 /opt/homebrew/opt/node@22。`
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

function resolveNode22Runtime(rootDir) {
  const desiredVersion = readDesiredNodeVersion(rootDir);
  const candidates = collectNodeCandidates(desiredVersion);

  for (const candidate of candidates) {
    const runtime = inspectNodeCandidate(candidate, desiredVersion);

    if (runtime) {
      return runtime;
    }
  }

  return null;
}

function buildNode22Env(baseEnv, runtime) {
  const nextPath = [runtime.binDir, baseEnv.PATH ?? ""].filter(Boolean).join(":");
  return {
    ...baseEnv,
    PATH: nextPath,
    CODINGNS_NODE22_BIN: runtime.nodePath
  };
}

function readDesiredNodeVersion(rootDir) {
  const nvmrcPath = path.join(rootDir, ".nvmrc");

  try {
    return readFileSync(nvmrcPath, "utf8").trim();
  } catch {
    return "22";
  }
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
    const major = normalized.split(".")[0];

    if (major !== "22") {
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

function pushCandidate(target, value) {
  if (!value || target.includes(value)) {
    return;
  }

  target.push(value);
}

module.exports = {
  buildNode22Env,
  ensureNode22ForCurrentScript,
  resolveNode22Runtime
};

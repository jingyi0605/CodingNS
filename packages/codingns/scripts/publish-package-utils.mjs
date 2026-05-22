import fs from "node:fs";
import path from "node:path";

export const SESSION_SYNC_CORE_PACKAGE_NAME = "@codingns/session-sync-core";
export const NODE_PTY_PACKAGE_NAME = "@codingns/node-pty";
export const NODE_PTY_VENDOR_RELATIVE_PATH = "vendor/node-pty-fork";
export const BETTER_SQLITE_PACKAGE_NAME = "better-sqlite3";
export const BETTER_SQLITE_VENDOR_RELATIVE_PATH = "vendor/better-sqlite3-win32-x64-node22";

export function readJson(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

export function writeJson(targetPath, data) {
  fs.writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`);
}

export function collectWorkspacePackageVersions(workspaceRoot) {
  const packageDirectories = [
    path.join(workspaceRoot, "packages"),
    path.join(workspaceRoot, "apps")
  ];
  const versionMap = new Map();

  for (const directory of packageDirectories) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath = path.join(directory, entry.name, "package.json");
      if (!fs.existsSync(manifestPath)) {
        continue;
      }

      const manifest = readJson(manifestPath);
      if (typeof manifest.name === "string" && typeof manifest.version === "string") {
        versionMap.set(manifest.name, manifest.version);
      }
    }
  }

  return versionMap;
}

export function rewriteWorkspaceDependencies(packageJson, workspacePackageVersions) {
  const dependencyFields = ["dependencies", "optionalDependencies", "peerDependencies"];

  for (const fieldName of dependencyFields) {
    const dependencies = packageJson[fieldName];
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }

    for (const [dependencyName, versionRange] of Object.entries(dependencies)) {
      if (typeof versionRange !== "string" || !versionRange.startsWith("workspace:")) {
        continue;
      }

      dependencies[dependencyName] = resolveWorkspaceRange(
        dependencyName,
        versionRange,
        workspacePackageVersions
      );
    }
  }
}

function resolveWorkspaceRange(dependencyName, versionRange, workspacePackageVersions) {
  const packageVersion = workspacePackageVersions.get(dependencyName);

  if (!packageVersion) {
    throw new Error(`找不到 workspace 依赖版本：${dependencyName}`);
  }

  const workspaceValue = versionRange.slice("workspace:".length);

  if (workspaceValue === "*" || workspaceValue === "") {
    return packageVersion;
  }

  if (workspaceValue === "^") {
    return `^${packageVersion}`;
  }

  if (workspaceValue === "~") {
    return `~${packageVersion}`;
  }

  if (workspaceValue.startsWith("^") || workspaceValue.startsWith("~")) {
    return workspaceValue[0] + packageVersion;
  }

  return workspaceValue;
}

export function rewritePackageJsonForPublish(originalPackageJson, workspacePackageVersions) {
  const publishPackageJson = structuredClone(originalPackageJson);
  const upstreamBetterSqliteRange =
    publishPackageJson.codingnsRuntimeDependencies?.betterSqlite3 ??
    publishPackageJson.optionalDependencies?.[BETTER_SQLITE_PACKAGE_NAME] ??
    publishPackageJson.dependencies?.[BETTER_SQLITE_PACKAGE_NAME];

  rewriteWorkspaceDependencies(publishPackageJson, workspacePackageVersions);

  publishPackageJson.dependencies = {
    ...publishPackageJson.dependencies
  };

  publishPackageJson.bundleDependencies = Array.from(new Set([
    ...(publishPackageJson.bundleDependencies ?? []),
    SESSION_SYNC_CORE_PACKAGE_NAME
  ]));

  publishPackageJson.dependencies = {
    ...publishPackageJson.dependencies
  };

  delete publishPackageJson.dependencies[BETTER_SQLITE_PACKAGE_NAME];

  publishPackageJson.optionalDependencies = {
    ...publishPackageJson.optionalDependencies,
    [NODE_PTY_PACKAGE_NAME]: `file:${NODE_PTY_VENDOR_RELATIVE_PATH}`
  };
  delete publishPackageJson.optionalDependencies[BETTER_SQLITE_PACKAGE_NAME];

  if (upstreamBetterSqliteRange) {
    publishPackageJson.codingnsRuntimeDependencies = {
      ...publishPackageJson.codingnsRuntimeDependencies,
      betterSqlite3: upstreamBetterSqliteRange
    };
  }

  publishPackageJson.codingnsWindowsRuntimePackages = {
    ...publishPackageJson.codingnsWindowsRuntimePackages,
    betterSqlite3: `file:${BETTER_SQLITE_VENDOR_RELATIVE_PATH}`
  };

  return publishPackageJson;
}

export function stripPackLifecycleScripts(packageJson) {
  if (!packageJson.scripts || typeof packageJson.scripts !== "object") {
    return;
  }

  delete packageJson.scripts.prepack;
  delete packageJson.scripts.postpack;
}

export function cleanupVendorRoot(vendorRoot) {
  fs.rmSync(vendorRoot, { recursive: true, force: true });
  fs.mkdirSync(vendorRoot, { recursive: true });
}

export function copyWorkspaceDependency(input) {
  fs.mkdirSync(input.targetDir, { recursive: true });

  const sourcePackageJsonPath = path.join(input.packageDir, "package.json");
  const sourcePackageJson = readJson(sourcePackageJsonPath);
  const copiedPackageJson = structuredClone(sourcePackageJson);

  if (!input.includeBuildScript) {
    delete copiedPackageJson.scripts;
  }

  writeJson(path.join(input.targetDir, "package.json"), copiedPackageJson);

  for (const entry of sourcePackageJson.files ?? []) {
    const sourcePath = path.join(input.packageDir, entry);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    fs.cpSync(sourcePath, path.join(input.targetDir, entry), { recursive: true });
  }
}

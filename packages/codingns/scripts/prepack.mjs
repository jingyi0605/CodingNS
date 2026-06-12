import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureNode22ForCurrentScript, resolvePackageRoot } from "./node22-runtime.mjs";
import {
  cleanupVendorRoot,
  collectWorkspacePackageVersions,
  copyWorkspaceDependency,
  readJson,
  rewritePackageJsonForPublish,
  writeJson
} from "./publish-package-utils.mjs";

ensureNode22ForCurrentScript({
  rootDir: resolvePackageRoot(import.meta.url),
  scriptLabel: "codingns-prepack"
});

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const backupPackageJsonPath = path.join(packageRoot, ".package.json.prepack-backup");
const vendorRoot = path.join(packageRoot, "vendor");

main();

function main() {
  const originalPackageJson = readJson(packageJsonPath);
  const workspacePackageVersions = collectWorkspacePackageVersions(workspaceRoot);

  writeBackupFile(originalPackageJson);
  cleanupVendorRoot(vendorRoot);
  runBuild();
  copyWorkspaceDependency({
    packageDir: path.join(workspaceRoot, "packages", "node-pty-fork"),
    targetDir: path.join(vendorRoot, "node-pty-fork"),
    includeBuildScript: false
  });
  copyWorkspaceDependency({
    packageDir: path.join(workspaceRoot, "packages", "codingns", "vendor-src", "better-sqlite3-win32-x64-node22"),
    targetDir: path.join(vendorRoot, "better-sqlite3-win32-x64-node22"),
    includeBuildScript: true
  });
  writeJson(
    packageJsonPath,
    rewritePackageJsonForPublish(originalPackageJson, workspacePackageVersions)
  );
}

function runBuild() {
  execFileSync(process.execPath, ["./scripts/build.mjs"], {
    cwd: packageRoot,
    stdio: "inherit"
  });
}

function writeBackupFile(originalPackageJson) {
  fs.writeFileSync(backupPackageJsonPath, `${JSON.stringify(originalPackageJson, null, 2)}\n`);
}

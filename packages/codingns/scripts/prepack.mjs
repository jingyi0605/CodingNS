import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const backupPackageJsonPath = path.join(packageRoot, ".package.json.prepack-backup");
const vendorRoot = path.join(packageRoot, "vendor");

main();

function main() {
  const originalPackageJson = readJson(packageJsonPath);

  writeBackupFile(originalPackageJson);
  cleanupVendorRoot();
  runBuild();
  copyWorkspaceDependency({
    packageDir: path.join(workspaceRoot, "packages", "node-pty-fork"),
    targetDir: path.join(vendorRoot, "node-pty-fork"),
    includeBuildScript: false
  });
  rewritePackageJsonForPublish(originalPackageJson);
}

function runBuild() {
  execFileSync(process.execPath, ["./scripts/build.mjs"], {
    cwd: packageRoot,
    stdio: "inherit"
  });
}

function copyWorkspaceDependency(input) {
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

function rewritePackageJsonForPublish(originalPackageJson) {
  const publishPackageJson = structuredClone(originalPackageJson);

  publishPackageJson.dependencies = {
    ...publishPackageJson.dependencies
  };
  publishPackageJson.bundleDependencies = ["@codingns/session-sync-core"];

  publishPackageJson.optionalDependencies = {
    ...publishPackageJson.optionalDependencies,
    "@codingns/node-pty": "file:vendor/node-pty-fork"
  };

  writeJson(packageJsonPath, publishPackageJson);
}

function cleanupVendorRoot() {
  fs.rmSync(vendorRoot, { recursive: true, force: true });
  fs.mkdirSync(vendorRoot, { recursive: true });
}

function writeBackupFile(originalPackageJson) {
  fs.writeFileSync(backupPackageJsonPath, `${JSON.stringify(originalPackageJson, null, 2)}\n`);
}

function readJson(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function writeJson(targetPath, data) {
  fs.writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`);
}

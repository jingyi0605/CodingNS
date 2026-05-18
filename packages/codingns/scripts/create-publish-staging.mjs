import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupVendorRoot,
  collectWorkspacePackageVersions,
  copyWorkspaceDependency,
  readJson,
  rewritePackageJsonForPublish,
  stripPackLifecycleScripts,
  writeJson
} from "./publish-package-utils.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const stagingRoot = process.argv[2];
const vendorRoot = path.join(stagingRoot, "vendor");

if (!stagingRoot) {
  throw new Error("缺少发布暂存目录参数");
}

const packageJsonPath = path.join(packageRoot, "package.json");
const stagingPackageJsonPath = path.join(stagingRoot, "package.json");

fs.rmSync(stagingRoot, { recursive: true, force: true });
fs.mkdirSync(stagingRoot, { recursive: true });
fs.cpSync(packageRoot, stagingRoot, {
  recursive: true,
  filter: (sourcePath) => {
    const baseName = path.basename(sourcePath);
    return baseName !== ".DS_Store" && !baseName.endsWith(".tgz");
  }
});

cleanupVendorRoot(vendorRoot);
copyWorkspaceDependency({
  packageDir: path.join(workspaceRoot, "packages", "node-pty-fork"),
  targetDir: path.join(vendorRoot, "node-pty-fork"),
  includeBuildScript: false
});

const packageJson = rewritePackageJsonForPublish(
  readJson(packageJsonPath),
  collectWorkspacePackageVersions(workspaceRoot)
);
stripPackLifecycleScripts(packageJson);
writeJson(stagingPackageJsonPath, packageJson);

console.info(`[codingns] 已生成发布暂存目录：${stagingRoot}`);

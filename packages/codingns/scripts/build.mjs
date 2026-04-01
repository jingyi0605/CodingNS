import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const outputRoot = path.join(packageRoot, "dist");
const packageJsonPath = path.join(packageRoot, "package.json");
const bundledSessionSyncRoot = path.join(
  packageRoot,
  "node_modules",
  "@codingns",
  "session-sync-core"
);
const bundledOpenAiRoot = path.join(packageRoot, "node_modules", "@openai");

buildWorkspaceTargets();
prepareOutputDirectory();
bundleSessionSyncCore();
removeLegacyBundledOpenAiPackages();
assertPublishablePackageManifest();

console.info("[codingns] 独立构建完成");

function buildWorkspaceTargets() {
  runPnpm(["--dir", path.join(workspaceRoot, "packages", "session-sync-core"), "build"]);
  runPnpm(["--dir", path.join(workspaceRoot, "apps", "user-app"), "build"]);
  runPnpm(["--dir", path.join(workspaceRoot, "apps", "host"), "build"]);
}

function prepareOutputDirectory() {
  const hostBuildRoot = path.join(workspaceRoot, "apps", "host", ".build", "src");
  const userAppBuildRoot = path.join(workspaceRoot, "apps", "user-app", "dist");

  ensureDirectoryExists(hostBuildRoot, "后端构建产物");
  ensureDirectoryExists(userAppBuildRoot, "前端构建产物");

  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.cpSync(hostBuildRoot, path.join(outputRoot, "server"), { recursive: true });
  fs.cpSync(userAppBuildRoot, path.join(outputRoot, "public"), { recursive: true });
}

function bundleSessionSyncCore() {
  const sourceRoot = path.join(workspaceRoot, "packages", "session-sync-core");
  const distRoot = path.join(sourceRoot, "dist");
  const packageJsonPath = path.join(sourceRoot, "package.json");

  ensureDirectoryExists(distRoot, "session-sync-core 构建产物");

  fs.rmSync(bundledSessionSyncRoot, { recursive: true, force: true });
  fs.mkdirSync(bundledSessionSyncRoot, { recursive: true });
  fs.cpSync(distRoot, path.join(bundledSessionSyncRoot, "dist"), { recursive: true });
  fs.copyFileSync(packageJsonPath, path.join(bundledSessionSyncRoot, "package.json"));
}

function removeLegacyBundledOpenAiPackages() {
  fs.rmSync(bundledOpenAiRoot, { recursive: true, force: true });
}

function assertPublishablePackageManifest() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const dependencyFields = ["dependencies", "optionalDependencies", "peerDependencies"];
  const invalidEntries = [];

  for (const fieldName of dependencyFields) {
    const dependencies = packageJson[fieldName];

    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }

    for (const [dependencyName, versionRange] of Object.entries(dependencies)) {
      if (typeof versionRange === "string" && versionRange.startsWith("workspace:")) {
        invalidEntries.push(`${fieldName}.${dependencyName}=${versionRange}`);
      }
    }
  }

  if (invalidEntries.length > 0) {
    throw new Error(
      `发布包 package.json 仍包含 workspace 依赖，请改成可发布版本号：${invalidEntries.join(", ")}`
    );
  }
}

function ensureDirectoryExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`缺少 ${label}：${targetPath}`);
  }
}

function runPnpm(args) {
  execFileSync("pnpm", args, {
    cwd: workspaceRoot,
    stdio: "inherit"
  });
}

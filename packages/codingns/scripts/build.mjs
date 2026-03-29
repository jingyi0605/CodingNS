import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const outputRoot = path.join(packageRoot, "dist");
const sessionSyncCorePackageJsonPath = path.join(
  workspaceRoot,
  "packages",
  "session-sync-core",
  "package.json"
);
const bundledSessionSyncRoot = path.join(
  packageRoot,
  "node_modules",
  "@codingns",
  "session-sync-core"
);
const bundledOpenAiRoot = path.join(packageRoot, "node_modules", "@openai");
const codexSdkVersion = readPinnedDependencyVersion(
  sessionSyncCorePackageJsonPath,
  "@openai/codex-sdk"
);
const codexCliVersion = readPinnedDependencyVersion(
  resolvePnpmPackageRoot("@openai/codex-sdk", codexSdkVersion, false, false),
  "@openai/codex"
);

buildWorkspaceTargets();
prepareOutputDirectory();
bundleSessionSyncCore();
bundleCodexRuntimeDependencies();

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

function bundleCodexRuntimeDependencies() {
  const codexSdkSourceRoot = resolvePnpmPackageRoot("@openai/codex-sdk", codexSdkVersion);
  const codexSourceRoot = resolvePnpmPackageRoot("@openai/codex", codexCliVersion);

  fs.rmSync(bundledOpenAiRoot, { recursive: true, force: true });
  fs.mkdirSync(bundledOpenAiRoot, { recursive: true });

  copyPackageDirectory(codexSdkSourceRoot, path.join(bundledOpenAiRoot, "codex-sdk"));
  copyPackageDirectory(codexSourceRoot, path.join(bundledOpenAiRoot, "codex"));
}

function resolvePnpmPackageRoot(packageName, version, ensureExists = true, includeNodeModules = true) {
  const normalizedName = packageName.replace("/", "+");
  const packageRoot = path.join(
    workspaceRoot,
    "node_modules",
    ".pnpm",
    `${normalizedName}@${version}`,
    "node_modules",
    ...packageName.split("/")
  );

  if (ensureExists) {
    ensureDirectoryExists(packageRoot, `${packageName}@${version}`);
  }

  if (!includeNodeModules) {
    return path.join(
      workspaceRoot,
      "node_modules",
      ".pnpm",
      `${normalizedName}@${version}`,
      "node_modules",
      ...packageName.split("/"),
      "package.json"
    );
  }

  return packageRoot;
}

function copyPackageDirectory(sourceRoot, targetRoot) {
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  fs.cpSync(sourceRoot, targetRoot, {
    recursive: true,
    filter: (sourcePath) => path.basename(sourcePath) !== "node_modules"
  });
}

function readPinnedDependencyVersion(packageJsonPath, dependencyName) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const rawVersion =
    packageJson.dependencies?.[dependencyName] ??
    packageJson.optionalDependencies?.[dependencyName] ??
    packageJson.devDependencies?.[dependencyName];

  if (typeof rawVersion !== "string" || rawVersion.trim().length === 0) {
    throw new Error(`缺少依赖版本：${dependencyName} in ${packageJsonPath}`);
  }

  const trimmed = rawVersion.trim();
  const normalized = trimmed.match(/\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?/);

  if (!normalized) {
    throw new Error(`无法解析依赖版本：${dependencyName}=${trimmed}`);
  }

  return normalized[0];
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

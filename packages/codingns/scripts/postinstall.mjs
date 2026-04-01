import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const moduleRequire = createRequire(import.meta.url);
const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const sdkVersionRange = packageJson.dependencies?.["@openai/codex-sdk"];
const sessionSyncCoreRange = packageJson.dependencies?.["@codingns/session-sync-core"];

if (!sdkVersionRange) {
  logInfo("[codingns] 未声明 @openai/codex-sdk，跳过 Codex 安装校验");
  process.exit(0);
}

if (isWorkspaceSourceInstall()) {
  logInfo("[codingns] 检测到工作区源码安装，跳过发布包运行时修复");
  process.exit(0);
}

if (process.env.CODINGNS_SKIP_CODEX_POSTINSTALL === "1") {
  logInfo("[codingns] 已跳过 Codex 安装校验");
  process.exit(0);
}

logInfo(`[codingns] 正在校验 Codex 运行时依赖（${process.platform}/${process.arch}）...`);

if (await verifyCodexRuntime()) {
  logInfo("[codingns] Codex 运行时依赖已就绪");
  process.exit(0);
}

if (process.env.CODINGNS_SKIP_POSTINSTALL_REENTRY === "1") {
  console.error("[codingns] Codex 运行时依赖校验失败，且已处于修复重入阶段");
  process.exit(1);
}

logInfo("[codingns] 正在修复 Codex SDK 与当前平台二进制，请稍候...");
cleanupBrokenCodexPackages();

const repairResult = runNpmInstall([
  "install",
  "--no-save",
  "--include=optional",
  "--package-lock=false",
  `@openai/codex-sdk@${sdkVersionRange}`
]);

if (repairResult.status !== 0) {
  process.exit(repairResult.status ?? 1);
}

if (!(await verifyCodexRuntime())) {
  console.error("[codingns] Codex 运行时依赖修复后仍然不可用");
  process.exit(1);
}

logInfo("[codingns] Codex 运行时依赖修复完成");

async function verifyCodexRuntime() {
  try {
    const sdkEntryPath =
      resolveModuleFile("@openai/codex-sdk") ??
      findNodeModulesFile(packageRoot, ["@openai", "codex-sdk", "dist", "index.js"]);

    if (!sdkEntryPath) {
      console.error(`[codingns] 未找到 Codex SDK 入口：${sdkEntryPath}`);
      return false;
    }

    const sdkPackageRoot = path.dirname(path.dirname(sdkEntryPath));

    const sdkModule = await import(pathToFileURL(sdkEntryPath).href);

    if (typeof sdkModule.Codex !== "function") {
      console.error("[codingns] @openai/codex-sdk 已安装，但未导出 Codex 客户端");
      return false;
    }

    const codexBinPath =
      resolveModuleFile("@openai/codex/bin/codex.js") ??
      resolveCodexCliScriptPath(sdkPackageRoot);

    if (!codexBinPath) {
      console.error(`[codingns] 未找到 Codex CLI 包装脚本：${codexBinPath}`);
      return false;
    }

    const versionCheck = spawnSync(process.execPath, [codexBinPath, "--version"], {
      cwd: packageRoot,
      env: process.env,
      encoding: "utf8",
      timeout: 30_000
    });

    if (versionCheck.status !== 0) {
      const stderr = versionCheck.stderr?.trim() || versionCheck.stdout?.trim() || "unknown error";
      console.error(`[codingns] Codex CLI 校验失败：${stderr}`);
      return false;
    }

    const versionText = versionCheck.stdout?.trim() || "unknown";
    logInfo(`[codingns] Codex CLI 已就绪：${versionText}`);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[codingns] Codex 运行时校验失败：${detail}`);
    return false;
  }
}

function cleanupBrokenCodexPackages() {
  const openAiRoot = path.join(packageRoot, "node_modules", "@openai");
  const binRoot = path.join(packageRoot, "node_modules", ".bin");

  fs.rmSync(openAiRoot, { recursive: true, force: true });
  fs.rmSync(path.join(binRoot, "codex"), { force: true });
  fs.rmSync(path.join(binRoot, "codex.cmd"), { force: true });
  fs.rmSync(path.join(binRoot, "codex.ps1"), { force: true });
}

function runNpmInstall(args) {
  const env = {
    ...process.env,
    CODINGNS_SKIP_POSTINSTALL_REENTRY: "1",
    npm_config_global: "false",
    npm_config_location: "project"
  };
  delete env.npm_config_prefix;
  delete env.npm_execpath;
  delete env.npm_command;
  delete env.npm_config_user_agent;

  const installArgs = [
    ...args,
    "--global=false",
    "--prefix",
    packageRoot,
    "--install-strategy=nested"
  ];

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  return spawnSync(npmCommand, installArgs, {
    cwd: packageRoot,
    env,
    stdio: "inherit"
  });
}

function logInfo(message) {
  console.error(message);
}

function isWorkspaceSourceInstall() {
  return (
    typeof sessionSyncCoreRange === "string" && sessionSyncCoreRange.startsWith("workspace:")
  );
}

function resolveCodexCliScriptPath(sdkPackageRoot) {
  const directNestedPath = path.join(
    sdkPackageRoot,
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js"
  );

  if (fs.existsSync(directNestedPath)) {
    return directNestedPath;
  }

  return (
    findNodeModulesFile(sdkPackageRoot, ["@openai", "codex", "bin", "codex.js"]) ??
    findNodeModulesFile(packageRoot, ["@openai", "codex", "bin", "codex.js"])
  );
}

function resolveModuleFile(specifier) {
  try {
    return moduleRequire.resolve(specifier);
  } catch {
    return null;
  }
}

function findNodeModulesFile(startDirectory, relativeSegments) {
  let currentDirectory = startDirectory;

  while (true) {
    const candidate = resolveNodeModulesCandidate(currentDirectory, relativeSegments);

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = path.dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

function resolveNodeModulesCandidate(currentDirectory, relativeSegments) {
  if (path.basename(currentDirectory) === "node_modules") {
    return path.join(currentDirectory, ...relativeSegments);
  }

  return path.join(currentDirectory, "node_modules", ...relativeSegments);
}

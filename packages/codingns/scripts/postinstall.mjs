import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const moduleRequire = createRequire(import.meta.url);
const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const cliVersionRange = packageJson.dependencies?.["@openai/codex"];
const sdkVersionRange = packageJson.dependencies?.["@openai/codex-sdk"];
const sessionSyncCoreRange = packageJson.dependencies?.["@codingns/session-sync-core"];
const windowsNodePtyRange = packageJson.optionalDependencies?.["@codingns/node-pty"];
const betterSqliteRuntimeRange =
  packageJson.codingnsRuntimeDependencies?.betterSqlite3 ??
  packageJson.optionalDependencies?.["better-sqlite3"] ??
  packageJson.dependencies?.["better-sqlite3"];
const windowsBetterSqlitePackageSpec = packageJson.codingnsWindowsRuntimePackages?.betterSqlite3;

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

logInfo(`[codingns] 正在校验运行时依赖（${process.platform}/${process.arch}）...`);

if (!verifyPtyRuntimeDependency()) {
  process.exit(1);
}

if (!(await ensureBetterSqliteRuntimeDependency())) {
  process.exit(1);
}

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
  cliVersionRange ? `@openai/codex@${cliVersionRange}` : null,
  `@openai/codex-sdk@${sdkVersionRange}`
].filter(Boolean));

if (repairResult.status !== 0) {
  process.exit(repairResult.status ?? 1);
}

if (!(await verifyCodexRuntime())) {
  console.error("[codingns] Codex 运行时依赖修复后仍然不可用");
  process.exit(1);
}

logInfo("[codingns] Codex 运行时依赖修复完成");

function verifyPtyRuntimeDependency() {
  const requiredPackageName = resolveRequiredPtyPackageName();
  const packageJsonPath = resolveModuleExportFile(requiredPackageName, "package.json");

  if (!packageJsonPath) {
    if (requiredPackageName === "@codingns/node-pty") {
      console.error(
        `[codingns] 当前 Windows Node 22 运行时需要 ${requiredPackageName}${windowsNodePtyRange ? `@${windowsNodePtyRange}` : ""}，但安装结果里没有找到它`
      );
    } else {
      console.error(`[codingns] 未找到 PTY 运行时依赖：${requiredPackageName}`);
    }
    return false;
  }

  const packageVersion = readPackageVersion(packageJsonPath);
  const packageSummary = packageVersion
    ? `${requiredPackageName}@${packageVersion}`
    : requiredPackageName;

  logInfo(`[codingns] PTY 运行时依赖已就绪：${packageSummary}`);
  return true;
}


async function ensureBetterSqliteRuntimeDependency() {
  let packageJsonPath = resolveModuleExportFile("better-sqlite3", "package.json");

  if (!packageJsonPath) {
    const installSpec = resolveBetterSqliteInstallSpec();

    if (!installSpec) {
      console.error(
        `[codingns] 未找到 SQLite 运行时依赖：better-sqlite3${betterSqliteRuntimeRange ? `（默认上游版本 ${betterSqliteRuntimeRange}）` : ""}`
      );
      return false;
    }

    if (process.env.CODINGNS_SKIP_POSTINSTALL_REENTRY === "1") {
      console.error(`[codingns] SQLite 运行时依赖修复后仍然缺失：${installSpec}`);
      return false;
    }

    logInfo(`[codingns] 正在补装 SQLite 运行时依赖：${installSpec}`);
    if (isWindowsManagedBetterSqliteInstallSpec(installSpec)) {
      if (!copyManagedBetterSqliteRuntime(installSpec)) {
        return false;
      }
    } else {
      const installResult = runNpmInstall([
        "install",
        "--no-save",
        "--package-lock=false",
        "--install-strategy=nested",
        installSpec
      ]);

      if (installResult.status !== 0) {
        return false;
      }
    }

    packageJsonPath = resolveModuleExportFile("better-sqlite3", "package.json");
  }

  if (!packageJsonPath) {
    console.error(
      `[codingns] 未找到 SQLite 运行时依赖：better-sqlite3${betterSqliteRuntimeRange ? `（默认上游版本 ${betterSqliteRuntimeRange}）` : ""}`
    );
    return false;
  }

  const packageVersion = readPackageVersion(packageJsonPath);
  const actualPackageName = readPackageName(packageJsonPath) || "better-sqlite3";
  const packageSummary = packageVersion
    ? `${actualPackageName}@${packageVersion}`
    : actualPackageName;

  if (actualPackageName !== "better-sqlite3") {
    console.error(
      `[codingns] 当前平台需要 better-sqlite3，但实际解析到了 ${actualPackageName}，说明安装结果混入了错误的平台包`
    );
    return false;
  }

  const nativeBindingPath = path.join(path.dirname(packageJsonPath), "build", "Release", "better_sqlite3.node");
  if (!fs.existsSync(nativeBindingPath)) {
    console.error(`[codingns] SQLite 运行时缺少预编译产物：${actualPackageName}`);
    return false;
  }

  logInfo(`[codingns] SQLite 运行时依赖已就绪：${packageSummary}`);
  return true;
}

async function verifyCodexRuntime() {
  try {
    const sdkEntryPath =
      resolveModuleExportFile("@openai/codex-sdk", "dist/index.js") ??
      findNodeModulesFile(packageRoot, ["@openai", "codex-sdk", "dist", "index.js"]);

    if (!sdkEntryPath) {
      console.error(`[codingns] 未找到 Codex SDK 入口：${sdkEntryPath}`);
      return false;
    }

    const sdkModule = await import(pathToFileURL(sdkEntryPath).href);

    if (typeof sdkModule.Codex !== "function") {
      console.error("[codingns] @openai/codex-sdk 已安装，但未导出 Codex 客户端");
      return false;
    }

    const codexBinPath = resolveCodexCliPath(sdkEntryPath);

    if (!codexBinPath) {
      console.error("[codingns] 未找到 Codex CLI 入口");
      return false;
    }

    const nativeCodexBinaryPath = resolveCodexNativeBinaryPath(codexBinPath);

    if (!nativeCodexBinaryPath) {
      console.error("[codingns] 未找到 Codex CLI 平台二进制");
      return false;
    }

    if (!isExecutableFile(nativeCodexBinaryPath)) {
      console.error(`[codingns] Codex CLI 平台二进制不可执行：${nativeCodexBinaryPath}`);
      return false;
    }

    logInfo(`[codingns] Codex CLI 入口已就绪：${codexBinPath}`);
    logInfo(`[codingns] Codex CLI 平台运行文件已就绪：${nativeCodexBinaryPath}`);
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
  delete env.npm_command;

  const installArgs = [
    ...args,
    "--global=false",
    "--prefix",
    packageRoot,
    "--install-strategy=nested"
  ];

  const command = resolveNpmInvocation(installArgs);
  logInfo(
    `[codingns] 执行运行时修复命令：${command.file} ${command.args.map(formatCommandArg).join(" ")}`
  );

  const result = spawnSync(command.file, command.args, {
    cwd: packageRoot,
    env,
    stdio: "inherit"
  });

  if (result.error) {
    const detail = result.error instanceof Error ? result.error.message : String(result.error);
    console.error(`[codingns] 运行时修复命令启动失败：${detail}`);
  }

  if (typeof result.status === "number") {
    logInfo(`[codingns] 运行时修复命令退出码：${result.status}`);
  } else if (result.signal) {
    console.error(`[codingns] 运行时修复命令被信号中断：${result.signal}`);
  }

  return result;
}

function resolveNpmInvocation(args) {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return {
      file: process.execPath,
      args: [npmExecPath, ...args]
    };
  }

  if (process.platform !== "win32") {
    return {
      file: "npm",
      args
    };
  }

  return {
    file: "cmd.exe",
    args: ["/d", "/s", "/c", quoteWindowsCommand("npm", args)]
  };
}

function quoteWindowsCommand(command, args) {
  return [command, ...args].map(quoteWindowsArg).join(" ");
}

function quoteWindowsArg(value) {
  if (!value.length) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function formatCommandArg(value) {
  return /[\s"]/u.test(value) ? JSON.stringify(value) : value;
}

function logInfo(message) {
  console.error(message);
}

function isWorkspaceSourceInstall() {
  return (
    typeof sessionSyncCoreRange === "string" && sessionSyncCoreRange.startsWith("workspace:")
  );
}

function resolveCodexCliPath(sdkEntryPath) {
  const sdkPackageRoot = path.dirname(path.dirname(sdkEntryPath));
  const moduleRoots = uniquePaths([
    packageRoot,
    path.dirname(packageRoot),
    sdkPackageRoot,
    path.dirname(sdkPackageRoot)
  ]);

  const candidates = process.platform === "win32"
    ? moduleRoots.flatMap((root) => [
      path.join(root, "node_modules", ".bin", "codex.cmd"),
      path.join(root, "node_modules", ".bin", "codex.exe"),
      path.join(root, "node_modules", ".bin", "codex"),
      path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js"),
      path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", ".bin", "codex.cmd"),
      path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", ".bin", "codex.exe"),
      path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", ".bin", "codex"),
      path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", "@openai", "codex", "bin", "codex.js")
    ])
    : moduleRoots.flatMap((root) => [
      path.join(root, "node_modules", ".bin", "codex"),
      path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js"),
      path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", ".bin", "codex"),
      path.join(root, "node_modules", "@openai", "codex-sdk", "node_modules", "@openai", "codex", "bin", "codex.js")
    ]);

  const resolvedCodexScript = resolveModuleFile("@openai/codex/bin/codex.js");

  if (resolvedCodexScript) {
    candidates.unshift(resolvedCodexScript);
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveCodexNativeBinaryPath(codexBinPath) {
  const platformPackage = resolveCodexPlatformPackageName();

  if (!platformPackage) {
    return null;
  }

  const targetTriple = resolveCodexTargetTriple();
  const codexBinaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const codexPackageRoot = findPackageRoot(codexBinPath);
  const localBinaryPath = codexPackageRoot
    ? path.join(codexPackageRoot, "vendor", targetTriple, "codex", codexBinaryName)
    : null;

  if (localBinaryPath && fs.existsSync(localBinaryPath)) {
    return localBinaryPath;
  }

  const platformPackageJsonPath =
    resolveModuleExportFile(platformPackage, "package.json") ??
    (codexPackageRoot
      ? findNodeModulesFile(codexPackageRoot, [...platformPackage.split("/"), "package.json"])
      : null);

  if (!platformPackageJsonPath) {
    return null;
  }

  const platformBinaryPath = path.join(
    path.dirname(platformPackageJsonPath),
    "vendor",
    targetTriple,
    "codex",
    codexBinaryName
  );

  return fs.existsSync(platformBinaryPath) ? platformBinaryPath : null;
}

function resolveCodexPlatformPackageName() {
  switch (`${process.platform}/${process.arch}`) {
    case "linux/x64":
      return "@openai/codex-linux-x64";
    case "linux/arm64":
      return "@openai/codex-linux-arm64";
    case "darwin/x64":
      return "@openai/codex-darwin-x64";
    case "darwin/arm64":
      return "@openai/codex-darwin-arm64";
    case "win32/x64":
      return "@openai/codex-win32-x64";
    case "win32/arm64":
      return "@openai/codex-win32-arm64";
    default:
      return null;
  }
}

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readPackageVersion(packageJsonPath) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return typeof packageJson?.version === "string" ? packageJson.version : "";
  } catch {
    return "";
  }
}

function readPackageName(packageJsonPath) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return typeof packageJson?.name === "string" ? packageJson.name : "";
  } catch {
    return "";
  }
}

function resolveBetterSqliteInstallSpec() {
  if (
    process.platform === "win32" &&
    process.arch === "x64" &&
    Number((process.versions.node || "").split(".")[0]) === 22
  ) {
    return windowsBetterSqlitePackageSpec ?? null;
  }

  if (betterSqliteRuntimeRange) {
    return `better-sqlite3@${betterSqliteRuntimeRange}`;
  }

  return "better-sqlite3";
}

function isWindowsManagedBetterSqliteInstallSpec(installSpec) {
  return (
    process.platform === "win32" &&
    process.arch === "x64" &&
    Number((process.versions.node || "").split(".")[0]) === 22 &&
    typeof installSpec === "string" &&
    installSpec.startsWith("file:")
  );
}

function copyManagedBetterSqliteRuntime(installSpec) {
  const sourceDirectory = resolveFileInstallSpecPath(installSpec);
  if (!sourceDirectory || !fs.existsSync(path.join(sourceDirectory, "package.json"))) {
    console.error(`[codingns] Windows SQLite 受控包不存在：${installSpec}`);
    return false;
  }

  const sourceBinaryPath = path.join(sourceDirectory, "build", "Release", "better_sqlite3.node");
  if (!fs.existsSync(sourceBinaryPath)) {
    console.error(`[codingns] Windows SQLite 受控包缺少预编译产物：${sourceBinaryPath}`);
    return false;
  }

  const targetDirectory = path.join(packageRoot, "node_modules", "better-sqlite3");
  fs.rmSync(targetDirectory, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDirectory), { recursive: true });
  fs.cpSync(sourceDirectory, targetDirectory, { recursive: true });
  logInfo(`[codingns] SQLite 运行时依赖已复制到：${targetDirectory}`);
  return true;
}

function resolveFileInstallSpecPath(installSpec) {
  if (typeof installSpec !== "string" || !installSpec.startsWith("file:")) {
    return null;
  }

  const filePath = installSpec.slice("file:".length);
  return path.resolve(packageRoot, filePath);
}

function resolveRequiredPtyPackageName() {
  if (
    process.platform === "win32" &&
    process.arch === "x64" &&
    Number((process.versions.node || "").split(".")[0]) === 22
  ) {
    return "@codingns/node-pty";
  }

  return "node-pty";
}

function resolveCodexTargetTriple() {
  switch (`${process.platform}/${process.arch}`) {
    case "linux/x64":
      return "x86_64-unknown-linux-musl";
    case "linux/arm64":
      return "aarch64-unknown-linux-musl";
    case "darwin/x64":
      return "x86_64-apple-darwin";
    case "darwin/arm64":
      return "aarch64-apple-darwin";
    case "win32/x64":
      return "x86_64-pc-windows-msvc";
    case "win32/arm64":
      return "aarch64-pc-windows-msvc";
    default:
      return null;
  }
}

function findPackageRoot(startPath) {
  let currentDirectory = fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);

  while (true) {
    const packageJsonCandidate = path.join(currentDirectory, "package.json");

    if (fs.existsSync(packageJsonCandidate)) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

function resolveModuleFile(specifier) {
  try {
    return moduleRequire.resolve(specifier);
  } catch {
    return null;
  }
}

function resolveModuleExportFile(specifier, fallbackRelativePath) {
  const resolvedEntry = resolveModuleFile(specifier);

  if (resolvedEntry) {
    return resolvedEntry;
  }

  try {
    const packageJsonPath = moduleRequire.resolve(`${specifier}/package.json`);
    return fallbackRelativePath
      ? path.join(path.dirname(packageJsonPath), fallbackRelativePath)
      : packageJsonPath;
  } catch (error) {
    if (!isPackagePathNotExportedError(error)) {
      return null;
    }
  }

  const manualPackagePath = findNodeModulesFile(
    packageRoot,
    [...specifier.split("/"), "package.json"]
  );

  if (!manualPackagePath) {
    return null;
  }

  return fallbackRelativePath
    ? path.join(path.dirname(manualPackagePath), fallbackRelativePath)
    : manualPackagePath;
}

function isPackagePathNotExportedError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
  );
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

function uniquePaths(values) {
  return Array.from(new Set(values.map((value) => path.resolve(value))));
}

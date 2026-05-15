import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dataDir = process.argv[2];
const installOutputLogPath = process.argv[3] || "";

if (!dataDir) {
  throw new Error("缺少数据目录参数");
}

const runtimeRoot = path.join(dataDir, "runtime");
const serviceRoot = path.join(runtimeRoot, "service");
const logsRoot = path.join(runtimeRoot, "logs", "install");
const installStatePath = path.join(serviceRoot, "install-state.json");
const launchEnvPath = path.join(serviceRoot, "launch-env.json");

assertExists(installStatePath, "install-state.json");
assertExists(launchEnvPath, "launch-env.json");

const installState = JSON.parse(fs.readFileSync(installStatePath, "utf8"));
const launchEnv = JSON.parse(fs.readFileSync(launchEnvPath, "utf8"));
const installOutput = installOutputLogPath && fs.existsSync(installOutputLogPath)
  ? fs.readFileSync(installOutputLogPath, "utf8")
  : "";

assertEqual(installState.packageName, "@jingyi0605/codingns", "正式包名不对");
assertEqual(installState.ptyPackageName, "@codingns/node-pty", "PTY 包名不对");
assertEqual(installState.ptyPackageVersion, "1.0.0-cns.1", "PTY 包版本不对");

if (!String(installState.nodeVersion || "").startsWith("22.")) {
  throw new Error(`私有运行时 Node 版本不对：${installState.nodeVersion || "unknown"}`);
}

assertPathContains(installState.nodeExe, `${path.sep}runtime${path.sep}node-22${path.sep}`, "nodeExe 没有落在私有运行时目录");
assertPathContains(installState.npmPrefix, `${path.sep}runtime${path.sep}npm-global`, "npmPrefix 没有落在私有前缀目录");
assertPathContains(installState.pm2Home, `${path.sep}runtime${path.sep}pm2`, "pm2Home 没有落在私有目录");

assertTextContains(launchEnv.PATH, "runtime", "launch-env PATH 缺少私有运行时");
assertTextContains(launchEnv.PATH, "npm-global", "launch-env PATH 缺少私有 npm 前缀");

assertExists(installState.nodeExe, "私有 node.exe");
assertExists(installState.codingnsCommand, "codingns 命令");
assertExists(installState.pm2Command, "pm2 命令");

verifyPrivateNodeExecutable(installState.nodeExe);
verifyPm2Process(installState.pm2Command, installState.pm2Home, installState.processName);
verifyInstallLogs(logsRoot);
verifyInstallOutput(installOutput);

console.log("[windows-replay] Windows 安装回放校验通过。");

function assertExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`缺少 ${label}：${targetPath}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}：expected=${expected} actual=${actual}`);
  }
}

function assertPathContains(actualPath, expectedFragment, message) {
  const normalizedActual = path.normalize(actualPath || "");
  const normalizedFragment = path.normalize(expectedFragment);

  if (!normalizedActual.includes(normalizedFragment)) {
    throw new Error(`${message}：${actualPath || "unknown"}`);
  }
}

function assertTextContains(text, expectedFragment, message) {
  if (!String(text || "").includes(expectedFragment)) {
    throw new Error(`${message}：${text || "unknown"}`);
  }
}

function verifyPrivateNodeExecutable(nodeExePath) {
  const result = spawnSync(nodeExePath, ["-p", "process.version"], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    throw new Error(`私有 node.exe 无法执行：${formatSpawnFailure(result)}`);
  }

  const versionText = (result.stdout || "").trim();
  if (!versionText.startsWith("v22.")) {
    throw new Error(`私有 node.exe 版本不对：${versionText || "unknown"}`);
  }
}

function verifyPm2Process(pm2Command, pm2Home, processName) {
  const result = spawnSync(pm2Command, ["jlist"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      PM2_HOME: pm2Home
    }
  });

  if (result.status !== 0) {
    throw new Error(`PM2 列表校验失败：${formatSpawnFailure(result)}`);
  }

  const processList = JSON.parse(result.stdout || "[]");
  const matchedProcess = Array.isArray(processList)
    ? processList.find((item) => item?.name === processName)
    : null;

  if (!matchedProcess) {
    throw new Error(`PM2 中未找到进程：${processName}`);
  }

  if (matchedProcess.pm2_env?.status !== "online") {
    throw new Error(`PM2 进程状态不对：${matchedProcess.pm2_env?.status || "unknown"}`);
  }
}

function verifyInstallLogs(logsRoot) {
  assertExists(logsRoot, "安装日志目录");

  const logFiles = fs.readdirSync(logsRoot)
    .filter((fileName) => fileName.endsWith(".log"))
    .sort();

  if (logFiles.length === 0) {
    throw new Error(`安装日志目录为空：${logsRoot}`);
  }

  const latestLogPath = path.join(logsRoot, logFiles[logFiles.length - 1]);
  const latestLogText = fs.readFileSync(latestLogPath, "utf8");

  if (/(^|\r?\n)gyp (?:info|ERR!)/i.test(latestLogText) || /(^|\r?\n)node-gyp\b/i.test(latestLogText)) {
    throw new Error(`安装日志仍触发了本机编译：${latestLogPath}`);
  }

  if (/node_modules[\\/](?:node-pty)[\\/]/i.test(latestLogText)) {
    throw new Error(`安装日志仍出现官方 node-pty 安装路径，说明回放包没有收口干净：${latestLogPath}`);
  }
}

function verifyInstallOutput(installOutput) {
  if (!installOutput) {
    return;
  }

  assertTextContains(installOutput, "Windows 正式安装将使用 CodingNS 私有 Node.js 22.16.0 运行时", "安装输出缺少私有 Node 提示");
  assertTextContains(installOutput, "PTY 运行时依赖已就绪：@codingns/node-pty", "安装输出缺少 PTY 命中结果");
  assertTextContains(installOutput, "实际运行时 Node.js：v22.16.0", "安装输出缺少最终运行时 Node");
  assertTextContains(installOutput, "实际 PTY 依赖：@codingns/node-pty@1.0.0-cns.1", "安装输出缺少最终 PTY 依赖");
}

function formatSpawnFailure(result) {
  return [
    result.stderr?.trim(),
    result.stdout?.trim(),
    typeof result.status === "number" ? `exitCode=${result.status}` : null,
    result.signal ? `signal=${result.signal}` : null
  ].filter(Boolean).join("\n");
}

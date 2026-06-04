import { spawn } from "node:child_process";

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const TEST_TIMEOUT_MS = resolveTimeoutMs();
const VITEST_TEST_TIMEOUT_MS = resolveVitestTimeoutMs();
const VITEST_HOOK_TIMEOUT_MS = resolveVitestHookTimeoutMs();

if (rawArgs.length === 0) {
  console.error("[user-app test] 默认禁止全量测试。请传入本次改动相关的测试文件、目录或过滤参数。\n示例：pnpm --dir apps/user-app test src/features/workbench/components/AffairsWorkbenchView.test.tsx");
  console.error("[user-app test] 如需全量测试，请显式执行：pnpm --dir apps/user-app test:all");
  process.exit(1);
}

const { vitestCommand, forwardedArgs } = resolveVitestInvocation(rawArgs);
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(command, [
  "exec",
  "vitest",
  vitestCommand,
  `--testTimeout=${VITEST_TEST_TIMEOUT_MS}`,
  `--hookTimeout=${VITEST_HOOK_TIMEOUT_MS}`,
  ...forwardedArgs
], {
  stdio: "inherit"
});
let timedOut = false;
const timeoutId = setTimeout(() => {
  timedOut = true;
  console.error(`[user-app test] 超时退出：${Math.round(TEST_TIMEOUT_MS / 1000)} 秒内未结束。`);
  child.kill("SIGTERM");
  setTimeout(() => {
    child.kill("SIGKILL");
  }, 5_000).unref();
}, TEST_TIMEOUT_MS);

timeoutId.unref();

child.on("exit", (code, signal) => {
  clearTimeout(timeoutId);

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if (timedOut) {
    process.exit(124);
  }

  process.exit(code ?? 1);
});

function resolveTimeoutMs() {
  return readPositiveInt(process.env.CODINGNS_TEST_TIMEOUT_MS, 180_000);
}

function resolveVitestTimeoutMs() {
  return readPositiveInt(process.env.CODINGNS_VITEST_TEST_TIMEOUT_MS, 30_000);
}

function resolveVitestHookTimeoutMs() {
  return readPositiveInt(process.env.CODINGNS_VITEST_HOOK_TIMEOUT_MS, 30_000);
}

function resolveVitestInvocation(args) {
  const [firstArg, ...restArgs] = args;

  if (firstArg === "run" || firstArg === "related") {
    return {
      vitestCommand: firstArg,
      forwardedArgs: restArgs
    };
  }

  return {
    vitestCommand: "run",
    forwardedArgs: args
  };
}

function readPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

import { spawn } from "node:child_process";

// pnpm run test -- <patterns> 会把额外的 `--` 传进来，这里统一剥离，避免误触发全量测试。
const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(command, ["exec", "vitest", "run", ...forwardedArgs], {
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});


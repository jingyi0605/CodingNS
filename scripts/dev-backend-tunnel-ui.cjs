const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");

const isWindows = process.platform === "win32";
const rootDir = process.cwd();
const userAppDistDir = path.join(rootDir, "apps", "user-app", "dist");
let shuttingDown = false;

const children = {
  build: null,
  watch: null,
  backend: null
};

run().catch((error) => {
  console.error("[tunnel-ui] 启动失败");
  console.error(error);
  shutdown(1);
});

function run() {
  return new Promise((resolve, reject) => {
    console.log(`[tunnel-ui] 初始构建 user-app 静态产物 -> ${userAppDistDir}`);

    children.build = spawnCommand(
      "build",
      ["pnpm", "--dir", "apps/user-app", "build"],
      {},
      {
        onLine: (line, source) => {
          printLine("build", line, source);
        },
        onExit: (code) => {
          if (code === 0) {
            startBuildWatch();
            startBackend();
            resolve();
            return;
          }

          reject(new Error(`user-app 初始构建失败，退出码 ${code ?? 1}`));
        }
      }
    );
  });
}

function startBuildWatch() {
  console.log("[tunnel-ui] 启动 user-app 构建监听（供公共隧道访问）");

  children.watch = spawnCommand(
    "watch",
    ["pnpm", "--dir", "apps/user-app", "exec", "vite", "build", "--watch"],
    {},
    {
      onLine: (line, source) => {
        printLine("watch", line, source);
      },
      onExit: (code) => {
        if (shuttingDown) {
          return;
        }

        console.error(`[tunnel-ui] user-app 构建监听已退出，退出码 ${code ?? 1}`);
        shutdown(code ?? 1);
      }
    }
  );
}

function startBackend() {
  console.log("[tunnel-ui] 启动 Host（公共隧道将回源到 Host 托管的 dist）");

  children.backend = spawnCommand(
    "backend",
    [
      "node",
      "scripts/dev-backend.cjs",
      `CODINGNS_WEB_UI_DIR=${userAppDistDir}`
    ],
    {},
    {
      onLine: (line, source) => {
        printLine("backend", line, source);
      },
      onExit: (code) => {
        if (shuttingDown) {
          return;
        }

        console.error(`[tunnel-ui] backend 进程已退出，退出码 ${code ?? 1}`);
        shutdown(code ?? 1);
      }
    }
  );

  console.log("[tunnel-ui] 本地直接调样式仍可单独运行 `pnpm dev:user-app` 使用 Vite HMR");
}

function spawnCommand(name, args, envOverrides, hooks) {
  const { command, commandArgs } = getSpawnTarget(args);
  const child = spawn(command, commandArgs, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...envOverrides
    },
    stdio: ["inherit", "pipe", "pipe"]
  });

  bindStream(name, child.stdout, "stdout", hooks.onLine);
  bindStream(name, child.stderr, "stderr", hooks.onLine);

  child.on("error", (error) => {
    console.error(`[tunnel-ui] ${name} 进程启动失败`);
    console.error(error);
    shutdown(1);
  });

  child.on("exit", (code) => {
    hooks.onExit(code);
  });

  return child;
}

function getSpawnTarget(args) {
  if (isWindows) {
    return {
      command: "cmd.exe",
      commandArgs: ["/d", "/s", "/c", ...args]
    };
  }

  return {
    command: args[0],
    commandArgs: args.slice(1)
  };
}

function bindStream(name, stream, source, onLine) {
  const reader = readline.createInterface({
    input: stream
  });

  reader.on("line", (line) => {
    onLine(line, source);
  });
}

function printLine(name, line, source) {
  const target = source === "stderr" ? console.error : console.log;
  target(`[${name}] ${line}`);
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of Object.values(children)) {
    if (!child || child.killed) {
      continue;
    }

    child.kill("SIGTERM");
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 50);
}

process.once("SIGINT", () => {
  shutdown(0);
});

process.once("SIGTERM", () => {
  shutdown(0);
});

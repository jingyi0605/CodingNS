const { spawn } = require("node:child_process");
const { buildNode22Env, ensureNode22ForCurrentScript } = require("./node22-runtime.cjs");
const readline = require("node:readline");

const isWindows = process.platform === "win32";
let shuttingDown = false;
let hostStarted = false;
const envOverrides = parseEnvOverrides(process.argv.slice(2));
const node22Runtime = ensureNode22ForCurrentScript({
  rootDir: process.cwd(),
  scriptLabel: "backend"
});
const forcedNodeEnv = buildNode22Env(process.env, node22Runtime);
console.log(`[backend] 强制使用 Node ${node22Runtime.versionText} -> ${node22Runtime.nodePath}`);

const children = {
  build: null,
  core: null,
  host: null
};

run().catch((error) => {
  console.error("[backend] 启动失败");
  console.error(error);
  shutdown(1);
});

function run() {
  return new Promise((resolve, reject) => {
    const build = spawnCommand("build", ["pnpm", "--dir", "packages/session-sync-core", "build"], {
      onLine: (line, source) => {
        printLine("build", line, source);
      },
      onExit: (code) => {
        if (code === 0) {
          startCoreWatch();
          resolve();
          return;
        }

        reject(new Error(`session-sync-core build 失败，退出码 ${code ?? 1}`));
      }
    });

    children.build = build;
  });
}

function startCoreWatch() {
  children.core = spawnCommand("core", ["pnpm", "--dir", "packages/session-sync-core", "dev"], {
    onLine: (line, source) => {
      printLine("core", line, source);

      if (!hostStarted && line.includes("Watching for file changes.")) {
        hostStarted = true;
        startHostWatch();
      }
    },
    onExit: (code) => {
      if (shuttingDown) {
        return;
      }

      console.error(`[backend] core 进程已退出，退出码 ${code ?? 1}`);
      shutdown(code ?? 1);
    }
  });
}

function startHostWatch() {
  if (Object.keys(envOverrides).length > 0) {
    console.log(`[backend] 额外挂载环境变量: ${Object.keys(envOverrides).join(", ")}`);
  }

  children.host = spawnCommand("host", ["pnpm", "--filter", "host", "dev:watch"], {
    onLine: (line, source) => {
      printLine("host", line, source);
    },
    onExit: (code) => {
      if (shuttingDown) {
        return;
      }

      console.error(`[backend] host 进程已退出，退出码 ${code ?? 1}`);
      shutdown(code ?? 1);
    }
  });
}

function spawnCommand(name, args, hooks) {
  const { command, commandArgs } = getSpawnTarget(args);
  const child = spawn(command, commandArgs, {
    cwd: process.cwd(),
    env: {
      ...forcedNodeEnv,
      ...envOverrides
    },
    stdio: ["inherit", "pipe", "pipe"]
  });

  bindStream(name, child.stdout, "stdout", hooks.onLine);
  bindStream(name, child.stderr, "stderr", hooks.onLine);

  child.on("error", (error) => {
    console.error(`[backend] ${name} 进程启动失败`);
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
      commandArgs: ["/d", "/s", "/c", "pnpm", ...args]
    };
  }

  return {
    command: "pnpm",
    commandArgs: args
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

function parseEnvOverrides(argv) {
  const overrides = {};

  for (const arg of argv) {
    const match = arg.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    overrides[match[1]] = match[2];
  }

  return overrides;
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

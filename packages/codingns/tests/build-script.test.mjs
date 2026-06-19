import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { resolvePnpmInvocation } from "../scripts/build.mjs";
import {
  collectWorkspacePackageVersions,
  rewritePackageJsonForPublish,
  stripPackLifecycleScripts
} from "../scripts/publish-package-utils.mjs";
import { resolveNode22Runtime } from "../scripts/node22-runtime.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("resolvePnpmInvocation 遇到 npm_execpath 指向 npm 时会回退到 pnpm 命令", () => {
  const command = resolvePnpmInvocation(["--dir", "/tmp/project", "build"], {
    env: {
      npm_execpath: "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js"
    },
    platform: "darwin",
    execPath: "/opt/homebrew/bin/node",
    fileExists: () => true
  });

  assert.deepEqual(command, {
    file: "pnpm",
    args: ["--dir", "/tmp/project", "build"]
  });
});

test("resolvePnpmInvocation 遇到 pnpm 的 npm_execpath 时会复用当前入口", () => {
  const command = resolvePnpmInvocation(["--dir", "/tmp/project", "build"], {
    env: {
      npm_execpath: "/opt/homebrew/lib/node_modules/pnpm/bin/pnpm.cjs"
    },
    platform: "darwin",
    execPath: "/opt/homebrew/bin/node",
    fileExists: () => true
  });

  assert.deepEqual(command, {
    file: "/opt/homebrew/bin/node",
    args: [
      "/opt/homebrew/lib/node_modules/pnpm/bin/pnpm.cjs",
      "--dir",
      "/tmp/project",
      "build"
    ]
  });
});

test("rewritePackageJsonForPublish 会改写 workspace 依赖并补齐 bundle 设置", () => {
  const originalPackageJson = JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, "codingns", "package.json"), "utf8")
  );
  const rewritten = rewritePackageJsonForPublish(
    originalPackageJson,
    collectWorkspacePackageVersions(path.resolve(workspaceRoot, ".."))
  );

  assert.equal(rewritten.dependencies["@codingns/session-sync-core"], "0.1.0");
  assert.deepEqual(rewritten.bundleDependencies, ["@codingns/session-sync-core"]);
  assert.equal(rewritten.optionalDependencies["@codingns/node-pty"], "file:vendor/node-pty-fork");
  assert.equal(
    rewritten.optionalDependencies["better-sqlite3"],
    undefined
  );
  assert.equal(rewritten.dependencies["better-sqlite3"], undefined);
  assert.equal(rewritten.codingnsRuntimeDependencies.betterSqlite3, "^12.8.0");
  assert.equal(
    rewritten.codingnsWindowsRuntimePackages.betterSqlite3,
    "file:vendor/better-sqlite3-win32-x64-node22"
  );
});

test("stripPackLifecycleScripts 会移除 prepack 和 postpack，避免 staging 再跑一遍打包脚本", () => {
  const packageJson = {
    scripts: {
      prepack: "node prepack.mjs",
      postpack: "node postpack.mjs",
      postinstall: "node postinstall.mjs"
    }
  };

  stripPackLifecycleScripts(packageJson);

  assert.deepEqual(packageJson, {
    scripts: {
      postinstall: "node postinstall.mjs"
    }
  });
});


test("vendor 里的 better-sqlite3 Windows 受控包在非 Windows 平台会跳过 install 校验", async () => {
  const verifyRuntime = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "vendor-src",
    "better-sqlite3-win32-x64-node22",
    "scripts",
    "verify-runtime.cjs"
  );
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [verifyRuntime], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /非 win32 环境，跳过运行时校验/);
});

test("codingns CLI 在非 Node 22 进程下会自动切换到 Node 22", () => {
  const cliPath = path.join(workspaceRoot, "codingns", "bin", "codingns.mjs");
  const node25Path = "/opt/homebrew/bin/node";
  const node22Path = "/opt/homebrew/opt/node@22/bin/node";

  if (!fs.existsSync(node25Path) || !fs.existsSync(node22Path)) {
    return;
  }

  const result = spawnSync(node25Path, [cliPath, "--help"], {
    cwd: path.join(workspaceRoot, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      CODINGNS_CLI_RUNTIME_PROBE: "1"
    }
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.nodeVersion.startsWith("v22."), true);
  assert.equal(fs.realpathSync(payload.execPath), fs.realpathSync(node22Path));
  assert.equal(result.error, undefined);
});

test("resolveNode22Runtime 会优先复用 install.sh 产出的 Windows 私有运行时 active.json", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-node22-runtime-"));
  const runtimeRoot = path.join(tempRoot, "runtime");
  const versionDir = path.join(runtimeRoot, "node-22", "versions", "node-v22.16.0-win-x64");
  const activeMetaPath = path.join(runtimeRoot, "node-22", "active.json");
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, "npm.cmd"), "");
  fs.writeFileSync(path.join(versionDir, "npx.cmd"), "");

  const node22Path = process.execPath;
  const previousPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const previousExecPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
  const previousEnv = {
    CODINGNS_DATA_DIR: process.env.CODINGNS_DATA_DIR,
    CODINGNS_RUNTIME_ROOT: process.env.CODINGNS_RUNTIME_ROOT,
    CODINGNS_WINDOWS_NODE_VERSION: process.env.CODINGNS_WINDOWS_NODE_VERSION
  };

  try {
    fs.writeFileSync(
      activeMetaPath,
      `${JSON.stringify({
        version: "22.16.0",
        nodeExe: node22Path,
        npmCmd: path.join(versionDir, "npm.cmd"),
        npxCmd: path.join(versionDir, "npx.cmd")
      }, null, 2)}\n`
    );

    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32"
    });
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: path.join(tempRoot, "missing-node.exe")
    });
    process.env.CODINGNS_DATA_DIR = tempRoot;
    process.env.CODINGNS_RUNTIME_ROOT = runtimeRoot;
    process.env.CODINGNS_WINDOWS_NODE_VERSION = "22.16.0";

    const runtime = resolveNode22Runtime(workspaceRoot, {});
    assert.ok(runtime);
    assert.equal(fs.realpathSync(runtime.nodePath), fs.realpathSync(node22Path));
    assert.equal(runtime.npmCmd, path.join(versionDir, "npm.cmd"));
  } finally {
    if (previousPlatformDescriptor) {
      Object.defineProperty(process, "platform", previousPlatformDescriptor);
    }
    if (previousExecPathDescriptor) {
      Object.defineProperty(process, "execPath", previousExecPathDescriptor);
    }
    restoreEnv("CODINGNS_DATA_DIR", previousEnv.CODINGNS_DATA_DIR);
    restoreEnv("CODINGNS_RUNTIME_ROOT", previousEnv.CODINGNS_RUNTIME_ROOT);
    restoreEnv("CODINGNS_WINDOWS_NODE_VERSION", previousEnv.CODINGNS_WINDOWS_NODE_VERSION);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("resolveNode22Runtime 在 Windows 下当前 Node 已满足版本要求时优先复用当前进程", () => {
  const previousPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const previousExecPath = process.execPath;
  const previousEnv = {
    CODINGNS_WINDOWS_NODE_VERSION: process.env.CODINGNS_WINDOWS_NODE_VERSION
  };

  try {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32"
    });
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: previousExecPath
    });
    process.env.CODINGNS_WINDOWS_NODE_VERSION = "22.16.0";

    const runtime = resolveNode22Runtime(workspaceRoot, {
      allowWindowsPrivateRuntimeInstall: true
    });
    assert.ok(runtime);
    assert.equal(fs.realpathSync(runtime.nodePath), fs.realpathSync(previousExecPath));
    assert.equal(runtime.source, "current-process");
  } finally {
    if (previousPlatformDescriptor) {
      Object.defineProperty(process, "platform", previousPlatformDescriptor);
    }
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: previousExecPath
    });
    restoreEnv("CODINGNS_WINDOWS_NODE_VERSION", previousEnv.CODINGNS_WINDOWS_NODE_VERSION);
  }
});

test("Windows Node 下载链路包含大陆镜像回退", () => {
  const source = fs.readFileSync(
    path.join(workspaceRoot, "codingns", "scripts", "node22-runtime.mjs"),
    "utf8"
  );

  assert.match(source, /https:\/\/nodejs\.org\/dist/);
  assert.match(source, /https:\/\/npmmirror\.com\/mirrors\/node/);
  assert.match(source, /https:\/\/registry\.npmmirror\.com\/-\/binary\/node/);
});

test("postinstall 的 npm 修复链路包含多个 registry 回退", () => {
  const source = fs.readFileSync(
    path.join(workspaceRoot, "codingns", "scripts", "postinstall.mjs"),
    "utf8"
  );

  assert.match(source, /https:\/\/registry\.npmjs\.org\//);
  assert.match(source, /https:\/\/registry\.npmmirror\.com\//);
  assert.match(source, /https:\/\/mirrors\.cloud\.tencent\.com\/npm\//);
  assert.match(source, /https:\/\/repo\.huaweicloud\.com\/repository\/npm\//);
});

function restoreEnv(key, value) {
  if (typeof value === "string") {
    process.env[key] = value;
    return;
  }

  delete process.env[key];
}

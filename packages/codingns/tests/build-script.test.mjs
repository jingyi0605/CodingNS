import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolvePnpmInvocation } from "../scripts/build.mjs";
import {
  collectWorkspacePackageVersions,
  rewritePackageJsonForPublish,
  stripPackLifecycleScripts
} from "../scripts/publish-package-utils.mjs";

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
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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

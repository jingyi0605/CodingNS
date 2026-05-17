import assert from "node:assert/strict";
import test from "node:test";

import { resolvePnpmInvocation } from "../scripts/build.mjs";

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
